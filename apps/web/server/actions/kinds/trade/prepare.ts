import "server-only";
import { parseAddress, requireAddress } from "@/shared/chain/hex";

import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi } from "viem";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { convertDirectionAdmitted, resolveTradeAsset } from "@/shared/trading/assets";
import { resolveConvertPair } from "@/shared/currencies/convert";
import { currencyRecordForContract } from "@/shared/currencies/registry";
import { tradeCustomerAmounts } from "@/shared/trading/fee-amounts";
import type { TradeMoneyActionMetadata } from "@/shared/trading/contract";
import { feePolicyForTaker, resolveOperatorFeePolicy } from "@/server/fees/policy";
import { createTradeFeeStrategy, type TradeFeeStrategy } from "@/server/fees/strategy";
import { readErc20ExecutionIdentity, TokenUnreadable } from "@/server/chain/erc20-execution-identity";
import { readsToken0 } from "@/server/chain/pair";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { parseTradeActionParams, TRADE_SLIPPAGE_BPS, type TradeAssetRef, type TradeFeeFact, type TradeSigningRequest } from "@/shared/trading/contract";
import type { Address, CoinbaseSmartWalletTypedData, Permit2TypedData, TradeSignerResolver } from "@/shared/trading/server-types";
import { baseRpc, parseRpcQuantity } from "@/server/chain/rpc";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import type { PendingTradeConfirmation } from "./finalize";
import { CdpSwapsRefusalError, CdpSwapsUnavailableError, createCdpSwapsClient } from "./cdp-swaps";
import { PERMIT2_ADDRESS, TradePreparationError } from "./permit2";
import { readSettlerRouter, rfqMakerAuthorizations, swapTokens, validateSwapQuote } from "./quote";
import { verifyRfqMakerAuthorizations } from "./rfq-maker";
import { createTradeSignerResolver } from "./signer";
import { tradeBuyBlocked } from "./buy-policy";

type TradePreparationDependencies = {
  resolveSigner?: TradeSignerResolver;
  createSwapsClient?: typeof createCdpSwapsClient;
  rpc?: typeof baseRpc;
  now?: () => Date;
  requestKey?: () => string;
  buyBlocked?: typeof tradeBuyBlocked;
  convertPair?: typeof resolveConvertPair;
  resolveFeePolicy?: typeof resolveOperatorFeePolicy;
  feeStrategy?: TradeFeeStrategy;
};

export async function prepareTradeAction(
  { session, request, params, signal }: { session: VerifiedAccountSession; request: Request; params: unknown; signal?: AbortSignal },
  deps: TradePreparationDependencies = {},
): Promise<{ draft: MoneyActionDraft; callGasLimit: bigint; pending: Omit<PendingTradeConfirmation, "calls" | "swapCallIndex"> & { permit2Typed: Permit2TypedData } }> {
  const parsed = parseTradeActionParams(params);
  if (!parsed) throw new TradePreparationError("invalid-request");
  if (!session.smartAccount) throw new TradePreparationError("smart-account-unavailable");
  const taker = session.smartAccount.address;
  const signer = await (deps.resolveSigner ?? createTradeSignerResolver({ getValidator: getCdpAccessTokenValidator }))(request, session, signal);
  if (signer.smartAccount.toLowerCase() !== taker.toLowerCase() || signer.ownerIndex !== 0) throw new TradePreparationError("signer-unsupported");
  const pairDeps = { convertPair: deps.convertPair };
  const resolved = resolveTradeAsset(parsed.assetId, pairDeps);
  if (!resolved || resolved.status !== "tradeable") throw new TradePreparationError("invalid-request");
  const currencyRecord = currencyRecordForContract(resolved.address);
  if (currencyRecord && !convertDirectionAdmitted(currencyRecord.id, parsed.direction, pairDeps)) {
    throw new TradePreparationError(parsed.direction === "buy" ? "buy-unavailable" : "invalid-request");
  }
  if (parsed.direction === "buy" && (deps.buyBlocked ?? tradeBuyBlocked)(resolved.assetId)) throw new TradePreparationError("buy-unavailable");
  const rpc = deps.rpc ?? baseRpc;
  const read = (method: string, params: readonly unknown[]) => rpc(method, params, { signal });
  let identity: Awaited<ReturnType<typeof readErc20ExecutionIdentity>>;
  try {
    if (!resolved.configured) {
      const pair = await readsToken0(resolved.address, read);
      if (pair === true) throw new TradePreparationError("invalid-request");
      if (pair === null) throw new TradePreparationError("provider-unavailable");
    }
    identity = await readErc20ExecutionIdentity({ token: resolved.address, holder: parsed.amountBaseUnits === "all" ? taker : undefined,
      configuredDecimals: resolved.configured?.representation.decimals, read });
  } catch (error) {
    if (error instanceof TradePreparationError) throw error;
    if (error instanceof TokenUnreadable) throw new TradePreparationError("token-unreadable");
    throw new TradePreparationError("provider-unavailable", error);
  }
  const tokenAsset: TradeAssetRef = {
    id: resolved.assetId, address: resolved.address, decimals: identity.decimals,
    symbol: resolved.configured?.representation.tokenSymbol ?? identity.symbol ?? `0x${resolved.address.slice(2, 6)}`,
  };
  const usdcAsset: TradeAssetRef = { id: "usdc", symbol: "USDC", decimals: 6, address: requireAddress(BASE_USDC_ADDRESS) };
  const grossAmount = parsed.amountBaseUnits === "all" ? identity.balance! : BigInt(parsed.amountBaseUnits);
  if (grossAmount === BigInt(0)) throw new TradePreparationError("insufficient-balance");
  const policy = feePolicyForTaker(await (deps.resolveFeePolicy ?? resolveOperatorFeePolicy)("trade"), taker);
  const feeStrategy = deps.feeStrategy ?? createTradeFeeStrategy("in-batch-transfer");
  const feeQuote = feeStrategy.quote(parsed.direction, grossAmount, policy);
  const fromAmount = feeQuote.fromAmount;
  const reviewRequest = { direction: parsed.direction, token: resolved.address, fromAmount, taker,
    signerAddress: signer.signerAddress, slippageBps: TRADE_SLIPPAGE_BPS };
  const tokens = swapTokens(parsed.direction, resolved.address);
  const client = (deps.createSwapsClient ?? createCdpSwapsClient)();
  const key = (deps.requestKey ?? randomUUID)();
  const quote = await client.createQuote({ ...tokens, ...feeQuote, taker, slippageBps: TRADE_SLIPPAGE_BPS, requestKey: key });
  if (!quote.liquidityAvailable) {
    const referenceBuy = { ...swapTokens("buy", resolved.address), fromAmount: BigInt(25_000_000), taker, slippageBps: TRADE_SLIPPAGE_BPS };
    let below = false;
    try {
      const buyPrice = await client.getPrice(referenceBuy);
      if (parsed.direction === "buy") below = fromAmount < referenceBuy.fromAmount && buyPrice.liquidityAvailable;
      else if (buyPrice.liquidityAvailable && buyPrice.toAmount > BigInt(0) && fromAmount < buyPrice.toAmount) {
        const sellPrice = await client.getPrice({ ...tokens, fromAmount: buyPrice.toAmount, taker, slippageBps: TRADE_SLIPPAGE_BPS });
        below = sellPrice.liquidityAvailable;
      }
    } catch { below = false; }
    throw new TradePreparationError(below ? "below-minimum" : "no-liquidity");
  }
  let block: bigint;
  let router: Address;
  try {
    const chain = parseRpcQuantity(await read("eth_chainId", []), "chain ID");
    if (chain !== BigInt(8453)) throw new Error("Unexpected chain");
    block = parseRpcQuantity(await read("eth_blockNumber", []), "block number");
    router = await readSettlerRouter(read, resolved.address);
  } catch (error) {
    if (error instanceof TradePreparationError) throw error;
    throw new TradePreparationError("provider-unavailable", error);
  }
  const now = (deps.now ?? (() => new Date()))();
  const reviewed = validateSwapQuote({ request: reviewRequest, quote, now, currentBlockNumber: block, swapRouter: router });
  const nonce = reviewed.permit.nonce;
  const pinnedBlockTag = `0x${block.toString(16)}` as const;
  const readWord = async (to: Address, data: `0x${string}`): Promise<bigint> => {
    const result = await read("eth_call", [{ to, data }, pinnedBlockTag]);
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error("Invalid chain read word");
    return BigInt(result);
  };
  let bitmap: bigint;
  try {
    bitmap = await readWord(PERMIT2_ADDRESS, `0x4fe02b44${taker.slice(2).padStart(64, "0")}${(nonce >> BigInt(8)).toString(16).padStart(64, "0")}`);
  } catch (error) {
    throw new TradePreparationError("provider-unavailable", error);
  }
  if ((bitmap & (BigInt(1) << (nonce & BigInt(255)))) !== BigInt(0)) throw new TradePreparationError("permit-used");
  if (!quote.liquidityAvailable) throw new TradePreparationError("no-liquidity");
  await verifyRfqMakerAuthorizations(rfqMakerAuthorizations(reviewRequest, quote, router), read, pinnedBlockTag);
  let balance: bigint;
  let allowance: bigint;
  try {
    balance = await readWord(tokens.fromToken, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [taker] }));
    allowance = await readWord(tokens.fromToken, encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [taker, PERMIT2_ADDRESS] }));
  } catch (error) {
    throw new TradePreparationError("provider-unavailable", error);
  }
  if (balance < (parsed.direction === "buy" ? grossAmount : reviewed.fromAmount)) throw new TradePreparationError("insufficient-balance");
  const needsApproval = allowance < reviewed.fromAmount;
  const collection = feeStrategy.collect(parsed.direction, grossAmount, reviewed.minToAmount, policy);
  const fromAsset: TradeAssetRef = parsed.direction === "buy" ? usdcAsset : tokenAsset;
  const toAsset: TradeAssetRef = parsed.direction === "buy" ? tokenAsset : usdcAsset;
  const fees: TradeFeeFact[] = [];
  for (const [kind, fee] of [["gas", reviewed.fees.gasFee], ["protocol", reviewed.fees.protocolFee]] as const) {
    if (!fee) continue;
    const ref = [usdcAsset, tokenAsset].find((entry) => entry.address === fee.token);
    if (!ref) throw new TradePreparationError("quote-rejected");
    fees.push({ kind, assetId: ref.id, symbol: ref.symbol, decimals: ref.decimals, amountBaseUnits: fee.amount.toString() });
  }
  const signingTypedData: CoinbaseSmartWalletTypedData = {
    domain: { name: "Coinbase Smart Wallet", version: "1", chainId: 8453, verifyingContract: taker },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
    },
    primaryType: "CoinbaseSmartWalletMessage",
    message: { hash: reviewed.permit.hash },
  };
  const evmAccount = parseAddress(signer.signerAddress);
  if (session.accountProvider !== "base-account" && !evmAccount) throw new TradePreparationError("signer-unsupported");
  const signing: TradeSigningRequest = session.accountProvider === "base-account" || !evmAccount
    ? { signer: "base-account", typedData: reviewed.permit.typedData }
    : { signer: "cdp-embedded", evmAccount, typedData: signingTypedData };
  const expiresAt = Math.min(Number(reviewed.executionDeadline) * 1000 - 30_000, now.getTime() + 120_000);
  if (expiresAt <= now.getTime()) throw new TradePreparationError("stale-quote");
  const metadata: TradeMoneyActionMetadata = {
    product: "trade", provider: "cdp-swaps", direction: parsed.direction, assetId: resolved.assetId, assetName: resolved.configured?.displayName ?? tokenAsset.symbol, network: { name: "Base", chainId: 8453 },
    fromAsset, toAsset, fromAmountBaseUnits: reviewed.fromAmount.toString(), expectedToAmountBaseUnits: reviewed.toAmount.toString(),
    minimumToAmountBaseUnits: reviewed.minToAmount.toString(), slippageBps: TRADE_SLIPPAGE_BPS, fees,
    ...(collection.record ? { operatorFee: collection.record } : {}),
    ...(currencyRecord ? { currencyRecordId: currencyRecord.id } : {}),
    approval: needsApproval ? "permit2-exact" : "existing-permit2-allowance",
    quoteBlockNumber: reviewed.blockNumber.toString(), quotedAt: now.toISOString(), permitDeadline: reviewed.permit.deadline.toString(),
    executionDeadline: reviewed.executionDeadline.toString(),
  };
  const customerAmounts = tradeCustomerAmounts(metadata);
  const calls: MoneyActionDraft["calls"] = [];
  if (parsed.direction === "buy" && collection.call) calls.push(collection.call);
  if (needsApproval && allowance > BigInt(0)) calls.push({
    to: fromAsset.address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, BigInt(0)] }),
    value: "0", approval: { assetId: fromAsset.id, spender: PERMIT2_ADDRESS },
  });
  if (needsApproval) calls.push({
    to: fromAsset.address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, reviewed.fromAmount] }),
    value: "0", approval: { assetId: fromAsset.id, spender: PERMIT2_ADDRESS },
  });
  calls.push({ to: reviewed.swapCall.to, data: reviewed.swapCall.data, value: "0" });
  if (parsed.direction === "sell" && collection.call) calls.push(collection.call);
  return {
    callGasLimit: reviewed.swapCall.gas,
    draft: {
      kind: "trade", title: parsed.direction === "buy" ? `Buy ${resolved.configured?.displayName ?? tokenAsset.symbol}` : `Sell ${resolved.configured?.displayName ?? tokenAsset.symbol}`, calls,
      amounts: [
        { assetId: fromAsset.id, symbol: fromAsset.symbol, decimals: fromAsset.decimals, amountBaseUnits: customerAmounts.spendBaseUnits, direction: "spend" },
        { assetId: toAsset.id, symbol: toAsset.symbol, decimals: toAsset.decimals, amountBaseUnits: customerAmounts.expectedReceiveBaseUnits, direction: "receive", estimated: true },
      ], warnings: [], expiresAt: new Date(expiresAt).toISOString(), signing,
      metadata,
    },
    pending: {
      permitHash: reviewed.permit.hash, permit2Typed: reviewed.permit.typedData,
      signingTypedData, signerAddress: signer.signerAddress, signerOwnerIndex: signer.ownerIndex, signerDeployed: signer.deployed,
    },
  };
}

export function tradePreparationResponse(error: unknown): { code: string; message: string; status: number } | null {
  if (error instanceof CdpSwapsRefusalError) return error.reason === "below-minimum"
    ? { code: "TRADE_BELOW_MINIMUM", message: "The amount is below the available trade minimum.", status: 422 }
    : { code: "TRADE_ROUTE_UNAVAILABLE", message: "No verified trade route is available.", status: 422 };
  if (error instanceof CdpSwapsUnavailableError) return { code: "TRADE_UNAVAILABLE", message: "Trading is temporarily unavailable.", status: 503 };
  if (!(error instanceof TradePreparationError)) return null;
  switch (error.reason) {
    case "invalid-request": return { code: "TRADE_INVALID", message: "Enter a valid trade amount and direction.", status: 400 };
    case "stock-eligibility": return { code: "TRADE_STOCK_RESTRICTED", message: "Stock buys aren't available in this location.", status: 403 };
    case "token-not-routed": return { code: "TRADE_NOT_ROUTED", message: "This asset can't be traded in Home yet.", status: 422 };
    case "signer-unsupported":
    case "smart-account-unavailable": return { code: "TRADE_SIGNER_UNSUPPORTED", message: "This account cannot sign this trade.", status: 422 };
    case "insufficient-balance": return { code: "TRADE_INSUFFICIENT_BALANCE", message: "The available balance is insufficient.", status: 409 };
    case "no-liquidity": return { code: "TRADE_ROUTE_UNAVAILABLE", message: "No verified trade route is available.", status: 422 };
    case "below-minimum": return { code: "TRADE_BELOW_MINIMUM", message: "The amount is below the available trade minimum.", status: 422 };
    case "token-unreadable": return { code: "TRADE_TOKEN_UNREADABLE", message: "This token cannot be read for trading.", status: 422 };
    case "buy-unavailable": return { code: "TRADE_BUY_UNAVAILABLE", message: "Buying this asset is unavailable.", status: 422 };
    case "unverified-actions": return { code: "TRADE_ROUTE_UNAVAILABLE", message: "No verified trade route is available.", status: 422 };
    case "stale-quote": return { code: "TRADE_QUOTE_STALE", message: "The trade quote changed. Prepare it again.", status: 409 };
    case "permit-used": return { code: "TRADE_QUOTE_STALE", message: "This trade quote can no longer be used. Get a new quote.", status: 409 };
    case "provider-unavailable": return { code: "TRADE_UNAVAILABLE", message: "Trading is temporarily unavailable.", status: 503 };
    default: return { code: "TRADE_QUOTE_REJECTED", message: "The trade quote could not be verified.", status: 502 };
  }
}

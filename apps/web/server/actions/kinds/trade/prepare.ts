import "server-only";

import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi } from "viem";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { parseTradeActionParams, TRADE_SLIPPAGE_BPS, type TradeAssetRef, type TradeFeeFact, type TradeSigningRequest } from "@/shared/trading/contract";
import type { Address, CoinbaseSmartWalletTypedData, Permit2TypedData, TradeSignerResolver } from "@/shared/trading/server-types";
import { baseRpc, parseRpcQuantity } from "@/server/chain/rpc";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import type { PendingTradeConfirmation } from "./finalize";
import { CdpSwapsUnavailableError, createCdpSwapsClient } from "./cdp-swaps";
import { PERMIT2_ADDRESS, TradePreparationError } from "./permit2";
import { readSettlerRouter, rfqMakerAuthorizations, swapTokens, validateSwapQuote } from "./quote";
import { verifyRfqMakerAuthorizations } from "./rfq-maker";
import { createTradeSignerResolver } from "./signer";

const CBBTC = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as Address;
const asset = {
  usdc: { id: "usdc", symbol: "USDC", decimals: 6, address: BASE_USDC_ADDRESS.toLowerCase() as Address },
  cbbtc: { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: CBBTC },
} as const;

type TradePreparationDependencies = {
  resolveSigner?: TradeSignerResolver;
  createSwapsClient?: typeof createCdpSwapsClient;
  rpc?: typeof baseRpc;
  now?: () => Date;
  requestKey?: () => string;
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
  const reviewRequest = {
    direction: parsed.direction, fromAmount: BigInt(parsed.amountBaseUnits), taker, signerAddress: signer.signerAddress, slippageBps: TRADE_SLIPPAGE_BPS,
  };
  const tokens = swapTokens(parsed.direction);
  const key = (deps.requestKey ?? randomUUID)();
  const quote = await (deps.createSwapsClient ?? createCdpSwapsClient)().createQuote({
    ...tokens, fromAmount: reviewRequest.fromAmount, taker, slippageBps: TRADE_SLIPPAGE_BPS, requestKey: key,
  });
  const rpc = deps.rpc ?? baseRpc;
  const read = (method: string, params: readonly unknown[]) => rpc(method, params, { signal });
  let block: bigint;
  let router: Address;
  try {
    const chain = parseRpcQuantity(await read("eth_chainId", []), "chain ID");
    if (chain !== BigInt(8453)) throw new Error("Unexpected chain");
    block = parseRpcQuantity(await read("eth_blockNumber", []), "block number");
    router = await readSettlerRouter(read);
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
  if (balance < reviewed.fromAmount) throw new TradePreparationError("insufficient-balance");
  const needsApproval = allowance < reviewed.fromAmount;
  const fromAsset: TradeAssetRef = parsed.direction === "buy" ? asset.usdc : asset.cbbtc;
  const toAsset: TradeAssetRef = parsed.direction === "buy" ? asset.cbbtc : asset.usdc;
  const fees: TradeFeeFact[] = [];
  for (const [kind, fee] of [["gas", reviewed.fees.gasFee], ["protocol", reviewed.fees.protocolFee]] as const) {
    if (!fee) continue;
    const ref = Object.values(asset).find((entry) => entry.address === fee.token);
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
  const signing: TradeSigningRequest = session.accountProvider === "base-account"
    ? { signer: "base-account", typedData: reviewed.permit.typedData }
    : { signer: "cdp-embedded", evmAccount: signer.signerAddress, typedData: signingTypedData };
  const expiresAt = Math.min(Number(reviewed.executionDeadline) * 1000 - 30_000, now.getTime() + 120_000);
  if (expiresAt <= now.getTime()) throw new TradePreparationError("stale-quote");
  const calls: MoneyActionDraft["calls"] = [];
  if (needsApproval) calls.push({
    to: fromAsset.address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, reviewed.fromAmount] }),
    value: "0", approval: { assetId: fromAsset.id, spender: PERMIT2_ADDRESS },
  });
  calls.push({ to: reviewed.swapCall.to, data: reviewed.swapCall.data, value: "0" });
  return {
    callGasLimit: reviewed.swapCall.gas,
    draft: {
      kind: "trade", title: parsed.direction === "buy" ? "Buy Bitcoin" : "Sell Bitcoin", calls,
      amounts: [
        { assetId: fromAsset.id, symbol: fromAsset.symbol, decimals: fromAsset.decimals, amountBaseUnits: reviewed.fromAmount.toString(), direction: "spend" },
        { assetId: toAsset.id, symbol: toAsset.symbol, decimals: toAsset.decimals, amountBaseUnits: reviewed.toAmount.toString(), direction: "receive", estimated: true },
      ], warnings: [], expiresAt: new Date(expiresAt).toISOString(), signing,
      metadata: {
        product: "trade", provider: "cdp-swaps", direction: parsed.direction, network: { name: "Base", chainId: 8453 },
        fromAsset, toAsset, fromAmountBaseUnits: reviewed.fromAmount.toString(), expectedToAmountBaseUnits: reviewed.toAmount.toString(),
        minimumToAmountBaseUnits: reviewed.minToAmount.toString(), slippageBps: TRADE_SLIPPAGE_BPS, fees,
        approval: needsApproval ? "permit2-exact" : "existing-permit2-allowance",
        quoteBlockNumber: reviewed.blockNumber.toString(), quotedAt: now.toISOString(), permitDeadline: reviewed.permit.deadline.toString(),
        executionDeadline: reviewed.executionDeadline.toString(),
      },
    },
    pending: {
      permitHash: reviewed.permit.hash, permit2Typed: reviewed.permit.typedData,
      signingTypedData, signerAddress: signer.signerAddress, signerOwnerIndex: signer.ownerIndex, signerDeployed: signer.deployed,
    },
  };
}

export function tradePreparationResponse(error: unknown): { code: string; message: string; status: number } | null {
  if (error instanceof CdpSwapsUnavailableError) return { code: "TRADE_UNAVAILABLE", message: "Trading is temporarily unavailable.", status: 503 };
  if (!(error instanceof TradePreparationError)) return null;
  switch (error.reason) {
    case "invalid-request": return { code: "TRADE_INVALID", message: "Enter a valid trade amount and direction.", status: 400 };
    case "signer-unsupported":
    case "smart-account-unavailable": return { code: "TRADE_SIGNER_UNSUPPORTED", message: "This account cannot sign this trade.", status: 422 };
    case "insufficient-balance": return { code: "TRADE_INSUFFICIENT_BALANCE", message: "The available balance is insufficient.", status: 409 };
    case "no-liquidity": return { code: "TRADE_NO_LIQUIDITY", message: "No trade quote is available.", status: 422 };
    case "stale-quote": return { code: "TRADE_QUOTE_STALE", message: "The trade quote expired. Prepare it again.", status: 409 };
    case "permit-used": return { code: "TRADE_QUOTE_STALE", message: "This trade quote can no longer be used. Get a new quote.", status: 409 };
    case "provider-unavailable": return { code: "TRADE_UNAVAILABLE", message: "Trading is temporarily unavailable.", status: 503 };
    default: return { code: "TRADE_QUOTE_REJECTED", message: "The trade quote could not be verified.", status: 502 };
  }
}

import { createHash, randomUUID } from "node:crypto";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import type { MoneyActionCall, MoneyActionDraft } from "@/features/money-actions/types";
import {
  BASE_USDC,
  getTradeAssetStatus,
  getTradeBuyAsset,
  getTradeSellAsset,
  type TradeAsset,
} from "@/features/trading/assets";
import {
  assertCanonicalTradeBaseUnits,
  formatTradeBaseUnits,
} from "@/features/trading/amount";
import type { PrepareTradeRequest, TradeIntentReview } from "@/features/trading/types";
import { moneyActionOwner } from "@/server/money-actions/session";
import {
  createCoinbaseSmartWalletTypedData,
  PERMIT2_ADDRESS,
  validatePermit2,
} from "./permit2";
import type {
  Address,
  PrepareTradeDependencies,
  PrepareTradeInput,
  TradeFee,
  TradeIntent,
  TradeQuote,
} from "./types";

const BASE_NETWORK = "base" as const;
const MIN_SLIPPAGE_BPS = 10;
const MAX_SLIPPAGE_BPS = 300;
const QUOTE_LIFETIME_MS = 180_000;
export const MAX_QUOTE_BLOCK_LAG = BigInt(150);
const MAX_QUOTE_BLOCK_LEAD = BigInt(2);
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})+$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type TradePreparationFailure =
  | "invalid-request"
  | "stock-eligibility"
  | "smart-account-unavailable"
  | "signer-unsupported"
  | "insufficient-balance"
  | "no-liquidity"
  | "stale-quote"
  | "quote-rejected"
  | "permit-expired"
  | "permit-used"
  | "invalid-finalization"
  | "provider-unavailable";

export class TradePreparationError extends Error {
  readonly reason: TradePreparationFailure;

  constructor(reason: TradePreparationFailure, cause?: unknown) {
    super(reason, { cause });
    this.name = "TradePreparationError";
    this.reason = reason;
  }
}

export async function prepareTradeAction(
  dependencies: PrepareTradeDependencies,
  input: PrepareTradeInput,
): Promise<TradeIntentReview> {
  const now = dependencies.now ?? (() => new Date());
  const currentTime = assertNow(now());
  const request = assertTradeRequest(input.request);
  const session = assertTradeSession(input.session);
  const status = getTradeAssetStatus(request.assetId);
  if (!status) throw new TradePreparationError("invalid-request");
  if (status.status === "eligibility-required") {
    throw new TradePreparationError("stock-eligibility");
  }

  const owner = moneyActionOwner(session);
  if (!owner) throw new TradePreparationError("smart-account-unavailable");
  const signer = await dependencies.resolveSigner(input.httpRequest, session, input.signal);
  if (signer.smartAccount !== session.smartAccount.address) {
    throw new TradePreparationError("signer-unsupported");
  }

  const sellAsset = getTradeSellAsset(status.asset, request.side);
  const buyAsset = getTradeBuyAsset(status.asset, request.side);
  const quoteId = randomUUID();
  let quote: TradeQuote;
  try {
    quote = await dependencies.quoteClient.createSwapQuote({
      network: BASE_NETWORK,
      fromToken: normalizeAddress(sellAsset.contractAddress),
      toToken: normalizeAddress(buyAsset.contractAddress),
      fromAmount: BigInt(request.amountBaseUnits),
      taker: session.smartAccount.address,
      signerAddress: signer.signerAddress,
      slippageBps: request.slippageBps,
      idempotencyKey: quoteId,
    });
  } catch (error) {
    if (error instanceof TradePreparationError) throw error;
    throw new TradePreparationError("provider-unavailable", error);
  }
  if (!quote.liquidityAvailable) throw new TradePreparationError("no-liquidity");

  let balance;
  try {
    balance = await dependencies.readBalance(
      session.smartAccount.address,
      normalizeAddress(sellAsset.contractAddress),
      input.signal,
    );
  } catch (error) {
    throw new TradePreparationError("provider-unavailable", error);
  }

  const built = buildTradeIntent({
    request,
    asset: status.asset,
    quote,
    balance,
    signer,
    currentTime,
    quoteId,
  });
  const nonceState = await dependencies.readPermit2State(
    owner.address,
    BigInt(built.permit.message.nonce),
    input.signal,
  );
  if (nonceState.used) throw new TradePreparationError("permit-used");
  if (
    built.quoteBlockNumberAsBigInt + MAX_QUOTE_BLOCK_LAG < nonceState.blockNumber ||
    built.quoteBlockNumberAsBigInt > nonceState.blockNumber + MAX_QUOTE_BLOCK_LEAD
  ) throw new TradePreparationError("stale-quote");

  const withoutHash = {
    version: 1 as const,
    id: randomUUID(),
    owner,
    signer,
    request,
    quoteId,
    quoteBlockNumber: built.quoteBlockNumberAsBigInt.toString(),
    balanceBlockNumber: balance.blockNumber.toString(),
    sellToken: built.sellToken,
    spendAmount: request.amountBaseUnits,
    permitHash: built.permitHash,
    permit: built.permit,
    signingTypedData: createCoinbaseSmartWalletTypedData(owner.address, built.permitHash),
    permitDeadline: built.permitDeadline.toString(),
    createdAt: currentTime.toISOString(),
    expiresAt: built.expiresAt.toISOString(),
    swapCallIndex: built.swapCallIndex,
    draft: built.draft,
    reservedActionId: randomUUID(),
    reservedActionCreatedAt: currentTime.toISOString(),
  };
  const intent: TradeIntent = {
    ...withoutHash,
    intentHash: createHash("sha256").update(stableStringify(withoutHash)).digest("hex"),
  };
  try {
    await dependencies.intentStore.issue(intent);
  } catch (error) {
    throw new TradePreparationError("provider-unavailable", error);
  }
  return toReview(intent);
}

function buildTradeIntent({
  request,
  asset,
  quote,
  balance,
  signer,
  currentTime,
  quoteId,
}: {
  request: PrepareTradeRequest;
  asset: TradeAsset;
  quote: Extract<TradeQuote, { liquidityAvailable: true }>;
  balance: { address: Address; token: Address; balance: bigint; blockNumber: bigint };
  signer: { smartAccount: Address; signerAddress: Address; ownerIndex: 0; deployed: boolean };
  currentTime: Date;
  quoteId: string;
}) {
  const sellAsset = getTradeSellAsset(asset, request.side);
  const buyAsset = getTradeBuyAsset(asset, request.side);
  const fromToken = normalizeAddress(sellAsset.contractAddress);
  const toToken = normalizeAddress(buyAsset.contractAddress);
  const fromAmount = BigInt(request.amountBaseUnits);

  validateQuoteIdentity(quote, {
    fromToken,
    toToken,
    fromAmount,
    slippageBps: request.slippageBps,
    balanceBlock: balance.blockNumber,
  });
  if (
    balance.address !== signer.smartAccount ||
    balance.token.toLowerCase() !== fromToken ||
    balance.balance < fromAmount
  ) throw new TradePreparationError("insufficient-balance");
  if (quote.issues.balance) {
    if (
      normalizeAddress(quote.issues.balance.token) !== fromToken ||
      quote.issues.balance.requiredBalance !== fromAmount ||
      quote.issues.balance.currentBalance > balance.balance
    ) throw new TradePreparationError("quote-rejected");
    throw new TradePreparationError("insufficient-balance");
  }
  if (quote.issues.simulationIncomplete || !quote.permit2 || !quote.transaction) {
    throw new TradePreparationError("quote-rejected");
  }
  const permit = validatePermit2({
    eip712: quote.permit2.eip712,
    providerHash: quote.permit2.hash,
    token: fromToken,
    amount: fromAmount,
    now: currentTime,
  });
  const transaction = validateTransaction(quote.transaction, fromAmount);
  const calls: MoneyActionCall[] = [];
  if (quote.issues.allowance) {
    const spender = normalizeAddress(quote.issues.allowance.spender);
    if (
      spender !== PERMIT2_ADDRESS ||
      quote.issues.allowance.currentAllowance >= fromAmount
    ) throw new TradePreparationError("quote-rejected");
    calls.push({
      to: fromToken,
      data: encodeApprove(PERMIT2_ADDRESS, fromAmount),
      value: "0",
      approval: { assetId: request.side === "buy" ? BASE_USDC.id : asset.id, spender: PERMIT2_ADDRESS },
    });
  }
  const swapCallIndex = calls.length;
  calls.push({ to: transaction.to, data: transaction.data, value: transaction.value.toString() });

  const permitExpiryMs = Number(permit.deadline * BigInt(1000));
  const expiresAt = new Date(Math.min(currentTime.getTime() + QUOTE_LIFETIME_MS, permitExpiryMs));
  if (expiresAt.getTime() <= currentTime.getTime()) throw new TradePreparationError("permit-expired");
  const expected = `${formatTradeBaseUnits(quote.toAmount, buyAsset.decimals)} ${buyAsset.symbol}`;
  const minimum = `${formatTradeBaseUnits(quote.minToAmount, buyAsset.decimals)} ${buyAsset.symbol}`;
  const spend = `${formatTradeBaseUnits(fromAmount, sellAsset.decimals)} ${sellAsset.symbol}`;
  const warnings = [
    `CDP Trade API quote on Base 8453: spend ${spend}; expected ${expected}; minimum received ${minimum}.`,
    `Maximum slippage: ${formatBps(request.slippageBps)}. Home signing expires at ${expiresAt.toISOString()}.`,
    `Permit2 authorization expires at ${new Date(permitExpiryMs).toISOString()} and is limited to exactly ${spend}.`,
    feeWarning(quote.fees, asset),
    `Provider-returned transaction target: ${transaction.to}. The final wallet review binds this exact target and signed calldata.`,
  ];
  if (quote.issues.allowance) {
    warnings.push(`This atomic action approves exactly ${request.amountBaseUnits} base units to canonical Permit2 ${PERMIT2_ADDRESS}; no unlimited approval is used.`);
  }
  const draft: MoneyActionDraft = {
    kind: "swap",
    title: request.side === "buy"
      ? `Buy ${asset.representation.tokenSymbol}`
      : `Sell ${asset.representation.tokenSymbol}`,
    calls,
    amounts: [
      {
        assetId: request.side === "buy" ? BASE_USDC.id : asset.id,
        symbol: sellAsset.symbol,
        decimals: sellAsset.decimals,
        amountBaseUnits: fromAmount.toString(),
        direction: "spend",
      },
      {
        assetId: request.side === "buy" ? asset.id : BASE_USDC.id,
        symbol: buyAsset.symbol,
        decimals: buyAsset.decimals,
        amountBaseUnits: quote.minToAmount.toString(),
        direction: "receive",
        estimated: true,
      },
    ],
    warnings,
    expiresAt: expiresAt.toISOString(),
    quoteId,
  };
  return {
    permit: permit.typedData,
    permitHash: permit.permitHash,
    permitDeadline: permit.deadline,
    quoteBlockNumberAsBigInt: quote.blockNumber,
    sellToken: fromToken,
    expiresAt,
    swapCallIndex,
    draft,
  };
}

export function validateQuoteIdentity(
  quote: Extract<TradeQuote, { liquidityAvailable: true }>,
  expected: {
    fromToken: Address;
    toToken: Address;
    fromAmount: bigint;
    slippageBps: number;
    balanceBlock: bigint;
  },
): void {
  if (
    quote.network !== BASE_NETWORK ||
    normalizeAddress(quote.fromToken) !== expected.fromToken ||
    normalizeAddress(quote.toToken) !== expected.toToken ||
    quote.fromAmount !== expected.fromAmount ||
    quote.fromAmount <= BigInt(0) ||
    quote.fromAmount > UINT256_MAX ||
    quote.toAmount <= BigInt(0) ||
    quote.toAmount > UINT256_MAX ||
    quote.minToAmount <= BigInt(0) ||
    quote.minToAmount > quote.toAmount
  ) throw new TradePreparationError("quote-rejected");
  const minimumForSlippage =
    (quote.toAmount * BigInt(10_000 - expected.slippageBps)) / BigInt(10_000);
  if (quote.minToAmount < minimumForSlippage) throw new TradePreparationError("quote-rejected");
  if (
    quote.blockNumber <= BigInt(0) ||
    quote.blockNumber + MAX_QUOTE_BLOCK_LAG < expected.balanceBlock ||
    quote.blockNumber > expected.balanceBlock + MAX_QUOTE_BLOCK_LEAD
  ) throw new TradePreparationError("stale-quote");
  validateFee(quote.fees.gasFee);
  validateFee(quote.fees.protocolFee);
}

function toReview(intent: TradeIntent): TradeIntentReview {
  const spend = intent.draft.amounts.find((amount) => amount.direction === "spend")!;
  const receive = intent.draft.amounts.find((amount) => amount.direction === "receive")!;
  return {
    status: "signature-required",
    id: intent.id,
    intentHash: intent.intentHash,
    title: intent.draft.title,
    signerAddress: intent.signer.signerAddress,
    signingRequestId: `trade-permit:${intent.id}`,
    signingTypedData: intent.signingTypedData,
    permit: intent.permit,
    spend: {
      assetId: spend.assetId,
      symbol: spend.symbol,
      decimals: spend.decimals,
      amountBaseUnits: spend.amountBaseUnits,
    },
    receive: {
      assetId: receive.assetId,
      symbol: receive.symbol,
      decimals: receive.decimals,
      minimumAmountBaseUnits: receive.amountBaseUnits,
    },
    warnings: intent.draft.warnings,
    permitExpiresAt: new Date(Number(BigInt(intent.permitDeadline) * BigInt(1000))).toISOString(),
    expiresAt: intent.expiresAt,
  };
}

function assertTradeRequest(request: PrepareTradeRequest): PrepareTradeRequest {
  try { assertCanonicalTradeBaseUnits(request.amountBaseUnits); } catch (error) {
    throw new TradePreparationError("invalid-request", error);
  }
  if (
    (request.side !== "buy" && request.side !== "sell") ||
    !Number.isInteger(request.slippageBps) ||
    request.slippageBps < MIN_SLIPPAGE_BPS ||
    request.slippageBps > MAX_SLIPPAGE_BPS ||
    BigInt(request.amountBaseUnits) === BigInt(0)
  ) throw new TradePreparationError("invalid-request");
  return request;
}

function assertTradeSession(session: VerifiedAccountSession): VerifiedAccountSession & {
  smartAccount: NonNullable<VerifiedAccountSession["smartAccount"]>;
} {
  if (
    !session.smartAccount ||
    session.smartAccount.chainId !== 8453 ||
    normalizeAddress(session.smartAccount.address) !== session.smartAccount.address
  ) throw new TradePreparationError("smart-account-unavailable");
  return session as VerifiedAccountSession & { smartAccount: NonNullable<VerifiedAccountSession["smartAccount"]> };
}

function validateTransaction(
  transaction: NonNullable<Extract<TradeQuote, { liquidityAvailable: true }>["transaction"]>,
  fromAmount: bigint,
) {
  const to = normalizeAddress(transaction.to);
  if (
    to === ZERO_ADDRESS ||
    !hexPattern.test(transaction.data) ||
    transaction.data.length > 200_002 ||
    transaction.value !== BigInt(0) ||
    transaction.gas <= BigInt(0) ||
    transaction.gasPrice < BigInt(0) ||
    fromAmount <= BigInt(0)
  ) throw new TradePreparationError("quote-rejected");
  return { ...transaction, to };
}

function validateFee(fee: TradeFee | undefined): void {
  if (!fee) return;
  normalizeAddress(fee.token);
  if (fee.amount < BigInt(0) || fee.amount > UINT256_MAX) {
    throw new TradePreparationError("quote-rejected");
  }
}

function feeWarning(
  fees: Extract<TradeQuote, { liquidityAvailable: true }>["fees"],
  asset: TradeAsset,
): string {
  const parts = [formatFee("Estimated network fee", fees.gasFee, asset), formatFee("Protocol fee", fees.protocolFee, asset)]
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(". ") + "." : "CDP reported no itemized fee; network gas may still apply at execution.";
}

function formatFee(label: string, fee: TradeFee | undefined, asset: TradeAsset): string | null {
  if (!fee) return null;
  const token = normalizeAddress(fee.token);
  if (token === BASE_USDC.contractAddress.toLowerCase()) {
    return `${label}: ${formatTradeBaseUnits(fee.amount, BASE_USDC.decimals)} USDC`;
  }
  if (token === asset.contractAddress.toLowerCase()) {
    return `${label}: ${formatTradeBaseUnits(fee.amount, asset.representation.decimals)} ${asset.representation.tokenSymbol}`;
  }
  return `${label}: ${fee.amount.toString()} base units of ${token}`;
}

function encodeApprove(spender: Address, amount: bigint): `0x${string}` {
  return `0x095ea7b3${spender.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
}

function normalizeAddress(value: string): Address {
  if (!addressPattern.test(value)) throw new TradePreparationError("quote-rejected");
  return value.toLowerCase() as Address;
}

function formatBps(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}%`;
}

function assertNow(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new TradePreparationError("provider-unavailable");
  return now;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

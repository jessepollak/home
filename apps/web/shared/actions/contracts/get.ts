
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseMoneyActionCalls } from "@/shared/money-actions/calls";
import {
  isActionKind,
  type ActionKind,
  DerivedActionStatus,
  MoneyActionCall,
  MoneyActionAmount,
  MoneyActionMetadata,
  MoneyActionOwner,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { isSavingsMetadata } from "@/shared/savings/review";
import { parseCashoutQuote } from "@/shared/funding/cash-out-quote";
import { parseTradeMetadata, parseTradeSigning } from "@/shared/trading/review";
import { parseCardAllowanceMetadata } from "@/shared/cards/allowance-contract";
import type { TradeSigningRequest } from "@/shared/trading/contract";
import { parseMoneyActionNetworkFee } from "@/shared/money-actions/network-fee";
import type { MoneyActionNetworkFee } from "@/shared/money-actions/types";

export type ActionSummaryResponse = {
  title: string;
  amounts: MoneyActionAmount[] | unknown[];
  warnings: string[];
  expiresAt: string;
  quoteId?: string;
  metadata?: MoneyActionMetadata;
  networkFee?: MoneyActionNetworkFee;
  signing?: TradeSigningRequest;
};

export type GetActionPendingResponse = {
  id: string;
  kind: ActionKind;
  summary: ActionSummaryResponse;
  calls: MoneyActionCall[];
  expiresAt: string;
  signing?: TradeSigningRequest;
};

export type PresentedAction = {
  id: string;
  provider: string;
  kind: ActionKind;
  summary: ActionSummaryResponse;
  status: DerivedActionStatus;
  createdAt: string;
  confirmedAt: string;
  submittedAt?: string;
  settledAt?: string;
  settledBlockNumber?: string;
  providerHandle?: string;
  transactionHash?: string;
  owner: MoneyActionOwner;
};

export type GetActionResponse = GetActionPendingResponse | PresentedAction;

function isActionSummaryResponse(value: unknown): value is ActionSummaryResponse {
  return !(!isRecord(value) || typeof value.title !== "string" || !Array.isArray(value.amounts) ||
    !Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === "string") ||
    typeof value.expiresAt !== "string" ||
    (value.quoteId !== undefined && typeof value.quoteId !== "string") ||
    (value.metadata !== undefined && !isRecord(value.metadata)) ||
    (value.signing !== undefined && !isRecord(value.signing)) ||
    (value.networkFee !== undefined && !parseMoneyActionNetworkFee(value.networkFee)));
}

export function parsePresentedAction(value: unknown): PresentedAction | null {
  return isPresentedAction(value) ? value : null;
}

function isPresentedAction(value: unknown): value is PresentedAction {
  if (!isRecord(value)) return false;
  const { id, provider, kind, summary, status, createdAt, confirmedAt, submittedAt, settledAt,
    settledBlockNumber, providerHandle, transactionHash, owner } = value;
  return typeof id === "string" && id.length > 0 && id.length <= 64 &&
    typeof provider === "string" && provider.length > 0 && isActionKind(kind) &&
    isActionSummaryResponse(summary) &&
    (status === "pending" || status === "unknown" || status === "confirmed" || status === "failed") &&
    isTimestamp(createdAt) && isTimestamp(confirmedAt) &&
    (submittedAt === undefined || isTimestamp(submittedAt)) &&
    (settledAt === undefined || isTimestamp(settledAt)) &&
    (settledBlockNumber === undefined || (typeof settledBlockNumber === "string" && /^(?:0|[1-9][0-9]*)$/.test(settledBlockNumber))) &&
    (providerHandle === undefined || (typeof providerHandle === "string" && providerHandle.length > 0 && providerHandle.length <= 512)) &&
    (transactionHash === undefined || (typeof transactionHash === "string" && transactionHash.length > 0)) &&
    isRecord(owner) && typeof owner.subject === "string" && owner.subject.length > 0 &&
    typeof owner.address === "string" && owner.address.length > 0 && Number.isSafeInteger(owner.chainId) &&
    (owner.accountProvider == null || typeof owner.accountProvider === "string");
}

export function parseGetActionPendingResponse(value: unknown, accountAddress: `0x${string}`): GetActionPendingResponse | null {
  if (!isPendingActionShape(value, accountAddress)) return null;
  const calls = parseMoneyActionCalls(value.calls);
  if (!calls) return null;
  return { ...value, calls };
}

function isPendingActionShape(value: unknown, accountAddress: `0x${string}`): value is Record<string, unknown> & Omit<GetActionPendingResponse, "calls"> {
  return isRecord(value) && typeof value.id === "string" && isActionKind(value.kind) &&
    isTimestamp(value.expiresAt) && (value.signing === undefined || isRecord(value.signing)) &&
    isActionSummaryResponse(value.summary) && validPendingActionKind(value.kind, value.summary, value.signing, accountAddress);
}

export function parsePendingActionResponse(
  value: unknown,
  id: string,
  active: VerifiedAccountSession,
): PreparedMoneyAction | null {
  if (
    !isRecord(value) ||
    value.id !== id ||
    !isActionKind(value.kind) ||
    !isRecord(value.summary) ||
    typeof value.summary.title !== "string" ||
    !Array.isArray(value.summary.amounts) ||
    !Array.isArray(value.summary.warnings) ||
    typeof value.expiresAt !== "string" ||
    (value.summary.networkFee !== undefined && !parseMoneyActionNetworkFee(value.summary.networkFee)) ||
    !active.smartAccount || !validPendingActionKind(value.kind, { amounts: value.summary.amounts, metadata: value.summary.metadata }, value.signing, active.smartAccount.address)
  ) {
    return null;
  }
  const calls = parseMoneyActionCalls(value.calls);
  if (!calls) return null;
  return {
    id,
    owner: {
      subject: active.user.subject,
      address: active.smartAccount.address,
      chainId: active.smartAccount.chainId,
      accountProvider: active.accountProvider,
    },
    kind: value.kind,
    title: value.summary.title,
    calls,
    amounts: value.summary.amounts as PreparedMoneyAction["amounts"],
    warnings: value.summary.warnings as string[],
    expiresAt: value.expiresAt,
    ...(isMoneyActionMetadata(value.summary.metadata)
      ? { metadata: value.summary.metadata.product === "trade" ? parseTradeMetadata(value.summary.metadata)! : value.summary.metadata }
      : {}),
    ...(parseMoneyActionNetworkFee(value.summary.networkFee) ? { networkFee: parseMoneyActionNetworkFee(value.summary.networkFee)! } : {}),
    ...(value.kind === "trade" ? { signing: parseTradeSigning(value.signing, parseTradeMetadata(value.summary.metadata)!, active.smartAccount.address)! } : {}),
    createdAt: new Date().toISOString(),
  };
}

function validPendingActionKind(
  kind: ActionKind,
  summary: { amounts: unknown[]; metadata?: unknown },
  signing: unknown,
  accountAddress: `0x${string}`,
): boolean {
  if (kind === "card-allowance") return summary.amounts.length === 0 && parseCardAllowanceMetadata(summary.metadata) !== null;
  if (isRecord(summary.metadata) && summary.metadata.product === "card") return false;
  if (kind !== "trade") return true;
  const metadata = parseTradeMetadata(summary.metadata);
  return metadata !== null && parseTradeSigning(signing, metadata, accountAddress) !== null;
}

function isMoneyActionMetadata(value: unknown): value is MoneyActionMetadata {
  if (!isRecord(value)) return false;
  if (value.product === "cashout") {
    return (value.operation === "deposit" || value.operation === "withdraw") &&
      typeof value.providerId === "string" && typeof value.providerName === "string" && typeof value.environment === "string" &&
      typeof value.platform === "string" && typeof value.platformLabel === "string" && typeof value.currency === "string" &&
      (value.operation === "deposit" ? typeof value.canonicalHandle === "string" && (value.payeeHash === undefined || typeof value.payeeHash === "string") && value.depositId === undefined : value.canonicalHandle === undefined && value.payeeHash === undefined && typeof value.depositId === "string") &&
      typeof value.approximateFiatAmount === "string" &&
      typeof value.minConversionRate === "string" && isRecord(value.intentAmountRange) &&
      typeof value.intentAmountRange.min === "string" && typeof value.intentAmountRange.max === "string" &&
      typeof value.estimateAsOf === "string" && typeof value.escrow === "string" &&
      (value.quote === undefined || (value.operation === "deposit" && parseCashoutQuote(value.quote) !== null));
  }
  if (value.product === "card") return parseCardAllowanceMetadata(value) !== null;
  if (value.product === "savings") return isSavingsMetadata(value);
  if (value.product === "trade") return parseTradeMetadata(value) !== null;
  return value.product === "borrow";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

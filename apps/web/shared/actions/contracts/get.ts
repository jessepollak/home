
import type { VerifiedAccountSession } from "@/shared/account/session-types";
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
import { parseTradeMetadata, parseTradeSigning } from "@/shared/trading/review";
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

export type GetActionResponse = GetActionPendingResponse | {
  id: string;
  provider: string;
  kind: ActionKind;
  summary: ActionSummaryResponse;
  status: DerivedActionStatus;
  createdAt: string;
  confirmedAt: string;
  submittedAt?: string;
  providerHandle?: string;
  transactionHash?: string;
  owner: MoneyActionOwner;
};

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
    !Array.isArray(value.calls) ||
    typeof value.expiresAt !== "string" ||
    (value.summary.networkFee !== undefined && !parseMoneyActionNetworkFee(value.summary.networkFee)) ||
    !active.smartAccount
    || (value.kind === "trade" && (!parseTradeMetadata(value.summary.metadata) ||
      !parseTradeSigning(value.signing, parseTradeMetadata(value.summary.metadata)!, active.smartAccount.address)))
  ) {
    return null;
  }
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
    calls: value.calls as PreparedMoneyAction["calls"],
    amounts: value.summary.amounts as PreparedMoneyAction["amounts"],
    warnings: value.summary.warnings as string[],
    expiresAt: value.expiresAt,
    ...(isMoneyActionMetadata(value.summary.metadata) ? { metadata: value.summary.metadata } : {}),
    ...(parseMoneyActionNetworkFee(value.summary.networkFee) ? { networkFee: parseMoneyActionNetworkFee(value.summary.networkFee)! } : {}),
    ...(value.kind === "trade" ? { signing: parseTradeSigning(value.signing, parseTradeMetadata(value.summary.metadata)!, active.smartAccount.address)! } : {}),
    createdAt: new Date().toISOString(),
  };
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
      typeof value.estimateAsOf === "string" && typeof value.escrow === "string";
  }
  if (value.product === "savings") return isSavingsMetadata(value);
  if (value.product === "trade") return parseTradeMetadata(value) !== null;
  return value.product === "borrow";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

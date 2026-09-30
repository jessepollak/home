import { parseAddress, parseHash32, type Hash32 } from "@/shared/chain/hex";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { ActionSummaryResponse } from "./get";
import { readCashoutProgress, type CashoutProgress } from "@/shared/funding/contracts/cash-out-progress";
import {
  isActionKind,
  type ActionKind,
  type DerivedActionStatus,
  type MoneyActionAmount,
  type MoneyActionMetadata,
  type MoneyActionOwner,
} from "@/shared/money-actions/types";
import { isSavingsMetadata } from "@/shared/savings/review";
import { parseCashoutQuote } from "@/shared/funding/cash-out-quote";
import { parseTradeMetadata } from "@/shared/trading/review";

export type ActionListItem = {
  id: string;
  provider: string;
  kind: ActionKind;
  summary: ActionSummaryResponse;
  status: DerivedActionStatus;
  createdAt: string;
  confirmedAt: string;
  submittedAt?: string;
  settledAt?: string;
  providerHandle?: string;
  transactionHash?: string;
  owner: MoneyActionOwner;
  cashout?: CashoutProgress;
};
export const RECENT_ACTIONS_LIMIT = 100 as const;

export type ListActionsResponse = { actions: ActionListItem[]; truncated?: boolean };

export type RecentMoneyActionOperation = {
  action: {
    id: string;
    kind: ActionKind;
    title: string;
    amounts: MoneyActionAmount[];
    warnings: string[];
    expiresAt: string;
    quoteId?: string;
    metadata?: MoneyActionMetadata;
    createdAt: string;
  };
  status: DerivedActionStatus;
  transactionHash?: Hash32;
  userOperationHash?: Hash32;
  cashout?: CashoutProgress;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  settledAt?: string;
};

class RecentActionsContractError extends Error {
  constructor() {
    super("Recent actions response is invalid.");
    this.name = "RecentActionsContractError";
  }
}

export function isRecentActionsResponse(value: unknown): value is { actions: unknown[] } {
  return isRecord(value) && Array.isArray(value.actions);
}
export function readRecentActionsTruncated(value: unknown): boolean {
  return isRecord(value) && value.truncated === true;
}

export function readRecentActionsIncomplete(value: unknown, session: VerifiedAccountSession): boolean {
  if (!session.smartAccount || !isRecord(value) || !Array.isArray(value.actions)) return false;
  return value.actions.some((item) => {
    if (!isRecord(item) || !isRecord(item.owner)) return false;
    if (item.kind !== "cash-out" && item.kind !== "cash-out-withdraw" && !("cashout" in item)) return false;
    return sameOwner(item.owner, session) && !isCompleteRecentActionItem(item);
  });
}

type CompleteRecentActionItem = Record<string, unknown> & {
  id: string;
  kind: ActionKind;
  status: DerivedActionStatus;
  createdAt: string;
  confirmedAt: string;
  summary: Record<string, unknown> & { title: string; amounts: unknown[]; warnings: unknown[]; expiresAt: string };
};

function isCompleteRecentActionItem(item: unknown): item is CompleteRecentActionItem {
  if (!isRecord(item) || !isRecord(item.summary)) return false;
  const summary = item.summary;
  if (typeof item.id !== "string" || !isActionKind(item.kind) || !isDerivedStatus(item.status) ||
    typeof item.createdAt !== "string" || typeof item.confirmedAt !== "string" || typeof summary.title !== "string" ||
    typeof summary.expiresAt !== "string") return false;
  const maxDecimals = item.kind === "cash-out" || item.kind === "cash-out-withdraw" ? maxCashoutAmountDecimals : maxActionAmountDecimals;
  if (!Array.isArray(summary.amounts) || !summary.amounts.every((amount) => isMoneyActionAmount(amount, maxDecimals)) ||
    !Array.isArray(summary.warnings) || !summary.warnings.every((warning) => typeof warning === "string")) return false;
  if ("cashout" in item && item.kind !== "cash-out") return false;
  const isDeposit = item.kind === "cash-out";
  const isWithdraw = item.kind === "cash-out-withdraw";
  if (!isDeposit && !isWithdraw) return true;
  const metadata = summary.metadata;
  if (metadata === undefined) return isDeposit;
  if (!isMoneyMetadata(metadata) || metadata.product !== "cashout" || metadata.operation !== (isWithdraw ? "withdraw" : "deposit")) return false;
  return true;
}

const maxAtomicUnits = (BigInt(1) << BigInt(256)) - BigInt(1);
const maxCashoutAmountDecimals = 20;
const maxActionAmountDecimals = 255;

function isMoneyActionAmount(value: unknown, maxDecimals: number): value is MoneyActionAmount {
  return isRecord(value) && typeof value.assetId === "string" && typeof value.symbol === "string" &&
    typeof value.decimals === "number" && Number.isSafeInteger(value.decimals) && value.decimals >= 0 &&
    value.decimals <= maxDecimals &&
    typeof value.amountBaseUnits === "string" && /^(?:0|[1-9][0-9]*)$/.test(value.amountBaseUnits) &&
    BigInt(value.amountBaseUnits) <= maxAtomicUnits &&
    (value.direction === "spend" || value.direction === "receive") &&
    (value.estimated === undefined || typeof value.estimated === "boolean") &&
    (value.maximum === undefined || typeof value.maximum === "boolean");
}

function sameOwner(owner: Record<string, unknown>, session: VerifiedAccountSession): boolean {
  const account = session.smartAccount;
  if (account === null) return false;
  const ownerAddress = parseAddress(owner.address);
  return ownerAddress !== null && ownerAddress === parseAddress(account.address) &&
    owner.subject === session.user.subject && owner.accountProvider === session.accountProvider;
}


export function assertRecentActionsResponse(value: unknown): asserts value is { actions: unknown[] } {
  if (!isRecentActionsResponse(value)) throw new RecentActionsContractError();
}

export function parseRecentMoneyActions(value: unknown, session: VerifiedAccountSession): RecentMoneyActionOperation[] {
  if (!session.smartAccount) return [];
  assertRecentActionsResponse(value);
  const parsed: RecentMoneyActionOperation[] = [];
  for (const item of value.actions) {
    if (!isRecord(item) || !isRecord(item.owner)) continue;
    if (!sameOwner(item.owner, session)) continue;
    if (!isCompleteRecentActionItem(item)) continue;
    const cashout = item.kind === "cash-out" ? readCashoutProgress(item.cashout) : null;
    const transactionHash = parseHash32(item.transactionHash);
    const userOperationHash = parseHash32(item.providerHandle);
    const metadata = isMoneyMetadata(item.summary.metadata) ? normalizeRecentMetadata(item.summary.metadata) : null;
    parsed.push({
      action: {
        id: item.id,
        kind: item.kind,
        title: item.summary.title,
        amounts: item.summary.amounts as MoneyActionAmount[],
        warnings: item.summary.warnings as string[],
        expiresAt: item.summary.expiresAt,
        ...(typeof item.summary.quoteId === "string" ? { quoteId: item.summary.quoteId } : {}),
        ...(metadata ? { metadata } : {}),
        createdAt: item.createdAt,
      },
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.confirmedAt,
      ...(typeof item.submittedAt === "string" && Number.isFinite(Date.parse(item.submittedAt)) ? { submittedAt: item.submittedAt } : {}),
      ...(typeof item.settledAt === "string" && Number.isFinite(Date.parse(item.settledAt)) ? { settledAt: item.settledAt } : {}),
      ...(cashout ? { cashout } : {}),
      ...(transactionHash ? { transactionHash } : {}),
      ...(userOperationHash ? { userOperationHash } : {}),
    });
  }
  return parsed.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isMoneyMetadata(value: unknown): value is MoneyActionMetadata {
  if (!isRecord(value)) return false;
  if (value.product === "cashout") {
    return (value.operation === "deposit" || value.operation === "withdraw") &&
      typeof value.providerId === "string" && typeof value.providerName === "string" &&
      (value.environment === "production" || value.environment === "sandbox") &&
      typeof value.platform === "string" && typeof value.platformLabel === "string" && typeof value.currency === "string" &&
      (value.operation === "deposit" ? typeof value.canonicalHandle === "string" && (value.payeeHash === undefined || typeof value.payeeHash === "string") && value.depositId === undefined : value.canonicalHandle === undefined && value.payeeHash === undefined && typeof value.depositId === "string" && value.depositId.trim().length > 0) &&
      typeof value.approximateFiatAmount === "string" &&
      typeof value.minConversionRate === "string" && isRecord(value.intentAmountRange) &&
      typeof value.intentAmountRange.min === "string" && typeof value.intentAmountRange.max === "string" &&
      typeof value.estimateAsOf === "string" && typeof value.escrow === "string" &&
      (value.quote === undefined || (value.operation === "deposit" && parseCashoutQuote(value.quote) !== null));
  }
  if (value.product === "savings") return isSavingsMetadata(value);
  if (value.product === "trade") return parseTradeMetadata(value) !== null;
  return value.product === "borrow" && typeof value.operation === "string" &&
    parseHash32(value.marketId) !== null &&
    isRecord(value.loanAsset) && typeof value.loanAsset.id === "string" && typeof value.loanAsset.symbol === "string" &&
    isRecord(value.collateralAsset) && typeof value.collateralAsset.id === "string" && typeof value.collateralAsset.symbol === "string" &&
    isRecord(value.source) && typeof value.source.blockNumber === "string" && parseHash32(value.source.blockHash) !== null && typeof value.source.blockTimestamp === "string";
}
function normalizeRecentMetadata(metadata: MoneyActionMetadata): MoneyActionMetadata {
  if (metadata.product === "trade") return parseTradeMetadata(metadata) ?? metadata;
  if (metadata.product === "borrow") {
    const marketId = parseHash32(metadata.marketId) ?? metadata.marketId;
    const blockHash = parseHash32(metadata.source.blockHash) ?? metadata.source.blockHash;
    return { ...metadata, marketId, source: { ...metadata.source, blockHash } };
  }
  if (metadata.product === "savings") {
    const vaultAddress = parseAddress(metadata.vaultAddress) ?? metadata.vaultAddress;
    const blockHash = parseHash32(metadata.source.blockHash) ?? metadata.source.blockHash;
    return { ...metadata, vaultAddress, source: { ...metadata.source, blockHash } };
  }
  return metadata;
}
function isDerivedStatus(value: unknown): value is DerivedActionStatus {
  return value === "pending" || value === "unknown" || value === "confirmed" || value === "failed";
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

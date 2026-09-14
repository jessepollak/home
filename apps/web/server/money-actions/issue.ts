import "server-only";

import { randomUUID } from "node:crypto";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { decodeMoneyActionApproval } from "@/shared/money-actions/approval";
import {
  isActionKind,
  type MoneyActionAmount,
  type MoneyActionCall,
  type MoneyActionDraft,
  type MoneyActionMetadata,
  type PreparedMoneyAction,
} from "@/shared/money-actions/types";
import { getDirectPortfolioAssets } from "@/config/portfolio-assets";
import { getActionsStore } from "@/server/actions/store";
import { moneyActionOwner } from "./session";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hexDataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const integerPattern = /^(?:0|[1-9][0-9]*)$/;
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const MAX_ACTION_LIFETIME_MS = 30 * 60 * 1000;
const actionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MoneyActionIssueOptions = {
  actionId?: string;
  createdAt?: string;
};

export async function issueMoneyAction(
  session: VerifiedAccountSession,
  draft: MoneyActionDraft,
  options: MoneyActionIssueOptions = {},
): Promise<PreparedMoneyAction> {
  const owner = moneyActionOwner(session);
  if (!owner) throw new MoneyActionIssueError("owner-unavailable");
  const normalizedDraft = normalizeDraft(draft);
  const now = new Date();
  const nowMs = now.getTime();
  if ((options.actionId === undefined) !== (options.createdAt === undefined)) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  const createdAtMs = options.createdAt ? Date.parse(options.createdAt) : nowMs;
  if (
    (options.actionId !== undefined && !actionIdPattern.test(options.actionId)) ||
    !Number.isFinite(createdAtMs) ||
    createdAtMs > nowMs ||
    (options.createdAt !== undefined && new Date(createdAtMs).toISOString() !== options.createdAt)
  ) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  const createdAt = new Date(createdAtMs).toISOString();
  const expiry = Date.parse(normalizedDraft.expiresAt);
  if (
    !Number.isFinite(expiry) ||
    expiry <= nowMs ||
    expiry - nowMs > MAX_ACTION_LIFETIME_MS ||
    expiry - createdAtMs > MAX_ACTION_LIFETIME_MS
  ) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  const action: PreparedMoneyAction = {
    ...normalizedDraft,
    id: options.actionId ?? randomUUID(),
    owner,
    createdAt,
  };
  await getActionsStore().insert({
    id: action.id,
    owner,
    kind: action.kind,
    summary: {
      title: action.title,
      amounts: action.amounts,
      warnings: action.warnings,
      expiresAt: action.expiresAt,
      ...(action.quoteId ? { quoteId: action.quoteId } : {}),
      ...(action.metadata ? { metadata: action.metadata } : {}),
    },
    pending: { calls: action.calls },
    createdAt: action.createdAt,
  });
  return action;
}

export class MoneyActionIssueError extends Error {
  constructor(readonly reason: "owner-unavailable" | "invalid-draft") {
    super(reason);
    this.name = "MoneyActionIssueError";
  }
}

function normalizeDraft(draft: MoneyActionDraft): MoneyActionDraft {
  if (
    !draft ||
    !isActionKind(draft.kind) ||
    typeof draft.title !== "string" ||
    draft.title.trim().length === 0 ||
    draft.title.length > 120 ||
    !Array.isArray(draft.calls) ||
    draft.calls.length < 1 ||
    draft.calls.length > 8 ||
    !Array.isArray(draft.amounts) ||
    draft.amounts.length < 1 ||
    draft.amounts.length > 16 ||
    !Array.isArray(draft.warnings) ||
    draft.warnings.length > 12 ||
    typeof draft.expiresAt !== "string" ||
    (draft.quoteId !== undefined &&
      (typeof draft.quoteId !== "string" || draft.quoteId.length > 200))
  ) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  const warnings = draft.warnings.map((warning) => {
    if (typeof warning !== "string" || warning.trim().length === 0 || warning.length > 300) {
      throw new MoneyActionIssueError("invalid-draft");
    }
    return warning.trim();
  });
  if (warnings.length === 0) {
    warnings.push("Your wallet will show the Base network fee before you sign.");
  }
  const calls = draft.calls.map(normalizeCall);
  const amounts = draft.amounts.map(normalizeAmount);
  const metadata = draft.metadata === undefined ? undefined : normalizeMetadata(draft.metadata);
  assertExactApprovalCaps(calls, amounts);
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    calls,
    amounts,
    warnings,
    expiresAt: new Date(draft.expiresAt).toISOString(),
    ...(draft.quoteId ? { quoteId: draft.quoteId } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeMetadata(value: MoneyActionMetadata): MoneyActionMetadata {
  if (!value || typeof value.marketId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.marketId) ||
    !validSummaryAsset(value.loanAsset) || !validMetadataSource(value.source)) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  if (value.product === "borrow") {
    if (!["supply-collateral", "borrow", "supply-and-borrow", "repay", "repay-all", "withdraw-collateral", "close-position"].includes(value.operation) ||
      !validSummaryAsset(value.collateralAsset) || !validNullableInteger(value.projectedHealthFactorWad) ||
      !validNullableInteger(value.projectedLiquidationPriceRaw) || !integerPattern.test(value.borrowAprWad)) {
      throw new MoneyActionIssueError("invalid-draft");
    }
    return {
      ...value,
      marketId: value.marketId.toLowerCase() as `0x${string}`,
      loanAsset: { id: value.loanAsset.id.trim(), symbol: value.loanAsset.symbol.trim() },
      collateralAsset: { id: value.collateralAsset.id.trim(), symbol: value.collateralAsset.symbol.trim() },
      source: { ...value.source, blockHash: value.source.blockHash.toLowerCase() as `0x${string}` },
    };
  }
  if (value.product !== "lend" || !["supply", "withdraw", "withdraw-all"].includes(value.operation) ||
    ![value.supplySharesRaw, value.suppliedAssetsRaw, value.withdrawableAssetsRaw, value.supplyAprWad].every((field) => integerPattern.test(field))) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  return {
    ...value,
    marketId: value.marketId.toLowerCase() as `0x${string}`,
    loanAsset: { id: value.loanAsset.id.trim(), symbol: value.loanAsset.symbol.trim() },
    source: { ...value.source, blockHash: value.source.blockHash.toLowerCase() as `0x${string}` },
  };
}

function validMetadataSource(value: MoneyActionMetadata["source"] | undefined) {
  return Boolean(value && typeof value.blockNumber === "string" && integerPattern.test(value.blockNumber) &&
    typeof value.blockTimestamp === "string" && integerPattern.test(value.blockTimestamp) &&
    typeof value.blockHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.blockHash));
}
function validSummaryAsset(value: { id: string; symbol: string } | undefined) {
  return Boolean(value && typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 200 &&
    typeof value.symbol === "string" && value.symbol.trim().length > 0 && value.symbol.length <= 24);
}
function validNullableInteger(value: string | null) { return value === null || (typeof value === "string" && integerPattern.test(value)); }

function normalizeCall(call: MoneyActionCall): MoneyActionCall {
  if (
    !call ||
    typeof call.to !== "string" ||
    !addressPattern.test(call.to) ||
    /^0x0{40}$/i.test(call.to) ||
    typeof call.data !== "string" ||
    !hexDataPattern.test(call.data) ||
    typeof call.value !== "string" ||
    !integerPattern.test(call.value) ||
    BigInt(call.value) > MAX_UINT256
  ) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  let approval: MoneyActionCall["approval"];
  if (call.approval !== undefined) {
    if (
      !call.approval ||
      typeof call.approval.assetId !== "string" ||
      call.approval.assetId.trim().length === 0 ||
      call.approval.assetId.length > 200 ||
      typeof call.approval.spender !== "string" ||
      !addressPattern.test(call.approval.spender) ||
      /^0x0{40}$/i.test(call.approval.spender)
    ) {
      throw new MoneyActionIssueError("invalid-draft");
    }
    approval = {
      assetId: call.approval.assetId.trim(),
      spender: call.approval.spender.toLowerCase() as `0x${string}`,
    };
  }
  return {
    to: call.to.toLowerCase() as `0x${string}`,
    data: call.data.toLowerCase() as `0x${string}`,
    value: BigInt(call.value).toString(10),
    ...(approval ? { approval } : {}),
  };
}

function normalizeAmount(amount: MoneyActionAmount): MoneyActionAmount {
  if (
    !amount ||
    typeof amount.assetId !== "string" ||
    amount.assetId.trim().length === 0 ||
    amount.assetId.length > 200 ||
    typeof amount.symbol !== "string" ||
    amount.symbol.trim().length === 0 ||
    amount.symbol.length > 24 ||
    !Number.isSafeInteger(amount.decimals) ||
    amount.decimals < 0 ||
    amount.decimals > 255 ||
    typeof amount.amountBaseUnits !== "string" ||
    !integerPattern.test(amount.amountBaseUnits) ||
    BigInt(amount.amountBaseUnits) > MAX_UINT256 ||
    (amount.direction !== "spend" && amount.direction !== "receive") ||
    (amount.estimated !== undefined && typeof amount.estimated !== "boolean") ||
    (amount.maximum !== undefined && typeof amount.maximum !== "boolean") ||
    (amount.maximum === true && (amount.direction !== "spend" || amount.estimated === true))
  ) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  return {
    assetId: amount.assetId.trim(),
    symbol: amount.symbol.trim(),
    decimals: amount.decimals,
    amountBaseUnits: BigInt(amount.amountBaseUnits).toString(10),
    direction: amount.direction,
    ...(amount.estimated === undefined ? {} : { estimated: amount.estimated }),
    ...(amount.maximum === undefined ? {} : { maximum: amount.maximum }),
  };
}

function assertExactApprovalCaps(
  calls: MoneyActionCall[],
  amounts: MoneyActionAmount[],
): void {
  for (const call of calls) {
    if (!call.data.startsWith("0x095ea7b3")) {
      if (call.approval) throw new MoneyActionIssueError("invalid-draft");
      continue;
    }
    const approval = decodeMoneyActionApproval(call);
    if (
      !approval ||
      approval.amountBaseUnits === MAX_UINT256.toString(10) ||
      approval.spender !== call.approval?.spender
    ) {
      throw new MoneyActionIssueError("invalid-draft");
    }
    const eligibleSpends = amounts.filter((amount) =>
      amount.direction === "spend" && amount.assetId === approval.assetId
    );
    const cappedSpends = eligibleSpends.filter((amount) => amount.maximum === true);
    const spend = (cappedSpends.length > 0 ? cappedSpends : eligibleSpends).find((amount) =>
      amount.amountBaseUnits === approval.amountBaseUnits
    );
    if (!spend || !approvalTokenMatchesCanonicalAsset(approval.token, spend.assetId)) {
      throw new MoneyActionIssueError("invalid-draft");
    }
  }
}

function approvalTokenMatchesCanonicalAsset(token: string, assetId: string): boolean {
  const canonical = /^eip155:8453\/erc20:(0x[0-9a-fA-F]{40})$/.exec(assetId);
  if (canonical) return canonical[1].toLowerCase() === token;
  const registered = getDirectPortfolioAssets().find((asset) => asset.id === assetId);
  return registered?.kind === "erc20" && registered.contractAddress?.toLowerCase() === token;
}

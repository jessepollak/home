import "server-only";

import { randomUUID } from "node:crypto";
import { hashTypedData } from "viem";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { decodeMoneyActionApproval } from "@/shared/money-actions/approval";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS, parseMoneyActionNetworkFee } from "@/shared/money-actions/network-fee";
import type { MoneyActionNetworkFee } from "@/shared/money-actions/types";
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
import { isSavingsMetadata } from "@/shared/savings/review";
import { parseTradeMetadata, parseTradeSigning } from "@/shared/trading/review";
import { validatePermit2 } from "@/server/actions/kinds/trade/permit2";
import type { PendingAction } from "@/server/actions/store";
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
  pending?: Omit<PendingAction, "calls">;
};

export async function issueMoneyAction(
  session: VerifiedAccountSession,
  draft: MoneyActionDraft,
  options: MoneyActionIssueOptions = {},
): Promise<PreparedMoneyAction> {
  const owner = moneyActionOwner(session);
  if (!owner) throw new MoneyActionIssueError("owner-unavailable");
  const normalizedDraft = normalizeDraft(draft, owner.address);
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
  const pending = normalizePending(options.pending, normalizedDraft, owner.address);
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
      ...(action.networkFee ? { networkFee: action.networkFee } : {}),
      expiresAt: action.expiresAt,
      ...(action.quoteId ? { quoteId: action.quoteId } : {}),
      ...(action.metadata ? { metadata: action.metadata } : {}),
      ...(action.signing ? { signing: action.signing } : {}),
    },
    pending: { calls: action.calls, ...pending },
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

function normalizeDraft(draft: MoneyActionDraft, owner: `0x${string}`): MoneyActionDraft {
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
  const networkFee = draft.networkFee === undefined ? undefined : parseMoneyActionNetworkFee(draft.networkFee);
  if (draft.networkFee !== undefined && !networkFee) throw new MoneyActionIssueError("invalid-draft");
  if (networkFee?.payment === "usdc") {
    const approval = draft.calls[0] && decodeMoneyActionApproval(draft.calls[0]);
    if (!approval || approval.token !== BASE_USDC_ADDRESS.toLowerCase() ||
      approval.spender !== BASE_USDC_PAYMASTER_ADDRESS.toLowerCase() ||
      approval.amountBaseUnits !== networkFee.maxFeeBaseUnits ||
      draft.calls[0]?.value !== "0" || draft.calls[0]?.approval?.spender.toLowerCase() !== BASE_USDC_PAYMASTER_ADDRESS.toLowerCase() ||
      draft.calls[0]?.approval?.assetId !== "usdc") throw new MoneyActionIssueError("invalid-draft");
  }
  if (warnings.length === 0 && networkFee?.payment !== "usdc") {
    warnings.push("Your wallet will show the Base network fee before you sign.");
  }
  const calls = draft.calls.map(normalizeCall);
  const amounts = draft.amounts.map(normalizeAmount);
  const metadata = draft.metadata === undefined
    ? undefined
    : normalizeMetadata(draft.metadata, draft.kind);
  const signing = draft.signing === undefined ? undefined : metadata?.product === "trade" ? parseTradeSigning(draft.signing, metadata, owner) : null;
  if ((draft.kind === "trade") !== Boolean(signing) || (draft.signing !== undefined && !signing)) throw new MoneyActionIssueError("invalid-draft");
  assertExactApprovalCaps(calls, amounts, networkFee ?? undefined);
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    calls,
    amounts,
    warnings,
    ...(networkFee ? { networkFee } : {}),
    expiresAt: new Date(draft.expiresAt).toISOString(),
    ...(draft.quoteId ? { quoteId: draft.quoteId } : {}),
    ...(metadata ? { metadata } : {}),
    ...(signing ? { signing } : {}),
  };
}

function normalizeMetadata(
  value: MoneyActionMetadata,
  kind: MoneyActionDraft["kind"],
): MoneyActionMetadata {
  if (value?.product === "cashout") {
    if (
      (value.operation !== "deposit" && value.operation !== "withdraw") ||
      !validShortText(value.providerId, 64) ||
      !validShortText(value.providerName, 100) ||
      (value.environment !== "production" && value.environment !== "sandbox") ||
      !validShortText(value.platform, 64) ||
      !validShortText(value.platformLabel, 100) ||
      !/^[A-Z]{3}$/.test(value.currency) ||
      (value.operation === "deposit" ? !validShortText(value.canonicalHandle, 200) ||
        (value.payeeHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(value.payeeHash))
        : value.canonicalHandle !== undefined || value.payeeHash !== undefined) ||
      !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.approximateFiatAmount) ||
      (value.etaSeconds !== undefined && value.etaSeconds !== null && (!Number.isSafeInteger(value.etaSeconds) || value.etaSeconds < 0)) ||
      !integerPattern.test(value.minConversionRate) ||
      !value.intentAmountRange ||
      !integerPattern.test(value.intentAmountRange.min) ||
      !integerPattern.test(value.intentAmountRange.max) ||
      BigInt(value.intentAmountRange.min) > BigInt(value.intentAmountRange.max) ||
      !Number.isFinite(Date.parse(value.estimateAsOf)) ||
      !addressPattern.test(value.escrow) ||
      /^0x0{40}$/i.test(value.escrow) ||
      (value.operation === "withdraw" ? !validShortText(value.depositId, 200) : value.depositId !== undefined)
    ) throw new MoneyActionIssueError("invalid-draft");
    const { payeeHash, ...rest } = value;
    const normalized = {
      ...rest,
      providerId: value.providerId.trim(),
      providerName: value.providerName.trim(),
      platform: value.platform.trim(),
      platformLabel: value.platformLabel.trim(),
      minConversionRate: BigInt(value.minConversionRate).toString(10),
      intentAmountRange: {
        min: BigInt(value.intentAmountRange.min).toString(10),
        max: BigInt(value.intentAmountRange.max).toString(10),
      },
      estimateAsOf: new Date(value.estimateAsOf).toISOString(),
      escrow: value.escrow.toLowerCase() as `0x${string}`,
    };
    return value.operation === "deposit"
      ? { ...normalized, operation: "deposit", canonicalHandle: value.canonicalHandle.trim(),
          ...(payeeHash ? { payeeHash: payeeHash.toLowerCase() as `0x${string}` } : {}), depositId: undefined }
      : { ...normalized, operation: "withdraw", canonicalHandle: undefined, depositId: value.depositId.trim() };
  }
  if (value?.product === "trade") {
    const trade = parseTradeMetadata(value);
    if (!trade || kind !== "trade") throw new MoneyActionIssueError("invalid-draft");
    return trade;
  }
  if (value?.product === "savings") {
    const expectedKind = value.operation === "deposit"
      ? "savings-deposit"
      : "savings-withdraw";
    if (!isSavingsMetadata(value) || kind !== expectedKind ||
      (value.operation === "deposit" && value.exchangeConstraint !== "deposit-minimum-shares-or-revert")) {
      throw new MoneyActionIssueError("invalid-draft");
    }
    return {
      product: "savings",
      operation: value.operation,
      vaultAddress: value.vaultAddress.toLowerCase() as `0x${string}`,
      vaultName: value.vaultName,
      network: { name: "Base", chainId: 8453 },
      feeWad: value.feeWad,
      limitBaseUnits: value.limitBaseUnits,
      previewSharesBaseUnits: value.previewSharesBaseUnits,
      shareDecimals: value.shareDecimals,
      exchangeConstraint: value.exchangeConstraint,
      ...(value.operation === "deposit" ? { minimumSharesBaseUnits: BigInt(value.minimumSharesBaseUnits!).toString(10) } : {}),
      discoveryRate: value.discoveryRate.status === "unavailable"
        ? {
            status: "unavailable",
            netApy: null,
            fetchedAt: null,
            stateAsOf: null,
          }
        : {
            status: value.discoveryRate.status,
            netApy: value.discoveryRate.netApy,
            fetchedAt: value.discoveryRate.fetchedAt,
            stateAsOf: value.discoveryRate.stateAsOf,
          },
      source: {
        blockNumber: value.source.blockNumber,
        blockHash: value.source.blockHash.toLowerCase() as `0x${string}`,
        blockTimestamp: value.source.blockTimestamp,
      },
    };
  }
  if (!value || value.product !== "borrow" ||
    !["supply-collateral", "borrow", "supply-and-borrow", "repay", "repay-all", "withdraw-collateral", "close-position"].includes(value.operation) ||
    typeof value.marketId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.marketId) ||
    !validSummaryAsset(value.loanAsset) || !validSummaryAsset(value.collateralAsset) ||
    !validNullableInteger(value.projectedHealthFactorWad) || !validNullableInteger(value.projectedLiquidationPriceRaw) ||
    typeof value.borrowAprWad !== "string" || !integerPattern.test(value.borrowAprWad) ||
    !value.source || typeof value.source.blockNumber !== "string" || !integerPattern.test(value.source.blockNumber) ||
    typeof value.source.blockTimestamp !== "string" || !integerPattern.test(value.source.blockTimestamp) ||
    typeof value.source.blockHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.source.blockHash)) {
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
function normalizePending(pending: MoneyActionIssueOptions["pending"], draft: MoneyActionDraft, owner: `0x${string}`): MoneyActionIssueOptions["pending"] {
  if (draft.kind !== "trade") {
    if (pending) throw new MoneyActionIssueError("invalid-draft");
    return undefined;
  }
  const metadata = draft.metadata;
  const signing = draft.signing;
  if (metadata?.product !== "trade" || !signing || !pending || !pending.permit2Typed ||
    typeof pending.permitHash !== "string" || !/^0x[0-9a-f]{64}$/.test(pending.permitHash) ||
    pending.signingTypedData?.message.hash !== pending.permitHash ||
    pending.signingTypedData.domain.verifyingContract !== owner ||
    typeof pending.signerAddress !== "string" || !addressPattern.test(pending.signerAddress) ||
    pending.signerOwnerIndex !== 0 || typeof pending.signerDeployed !== "boolean" ||
    pending.swapCallIndex !== draft.calls.length - 1 || draft.calls[pending.swapCallIndex]?.approval ||
    (signing.signer === "cdp-embedded" && (signing.evmAccount !== pending.signerAddress.toLowerCase() ||
      JSON.stringify(signing.typedData) !== JSON.stringify(pending.signingTypedData))) ||
    (signing.signer === "base-account" && JSON.stringify(signing.typedData) !== JSON.stringify(pending.permit2Typed))) {
    throw new MoneyActionIssueError("invalid-draft");
  }
  try {
    const permit = validatePermit2({
      eip712: pending.permit2Typed, providerHash: pending.permitHash,
      token: metadata.fromAsset.address, amount: BigInt(metadata.fromAmountBaseUnits), now: new Date(metadata.quotedAt),
    });
    if (permit.deadline.toString() !== metadata.permitDeadline ||
      permit.spender !== draft.calls[pending.swapCallIndex]?.to ||
      (signing.signer === "base-account" && hashTypedData(signing.typedData as Parameters<typeof hashTypedData>[0]) !== pending.permitHash)) {
      throw new MoneyActionIssueError("invalid-draft");
    }
  } catch { throw new MoneyActionIssueError("invalid-draft"); }
  return { ...pending, signerAddress: pending.signerAddress.toLowerCase() as `0x${string}` };
}
function validShortText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
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
  networkFee?: MoneyActionNetworkFee,
): void {
  for (const [index, call] of calls.entries()) {
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
    if (approval.token === BASE_USDC_ADDRESS.toLowerCase() && approval.spender === BASE_USDC_PAYMASTER_ADDRESS.toLowerCase() && (index !== 0 || networkFee?.payment !== "usdc")) throw new MoneyActionIssueError("invalid-draft");
    if (index === 0 && networkFee?.payment === "usdc") continue;
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

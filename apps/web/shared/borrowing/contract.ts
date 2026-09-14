// Private route contracts.
// GET /api/borrow
// GET /api/borrow/markets/:marketId

import type { AccountProvider } from "@/shared/account/session-types";
import type { BorrowAddress, BorrowAssetRef, BorrowMarketId } from "./config";
import { getBorrowMarketRef } from "./config";

export const BORROW_OVERVIEW_VERSION = "1" as const;
export const BORROW_MARKET_DETAIL_VERSION = "1" as const;

export type BorrowMarketIdentity = {
  id: BorrowMarketId;
  morpho: BorrowAddress;
  loanToken: BorrowAssetRef;
  collateralToken: BorrowAssetRef;
  oracle: BorrowAddress;
  irm: BorrowAddress;
  lltvWad: string;
  rank: number;
};

export type BorrowSourceBlock = {
  provider: "Base JSON-RPC";
  blockNumber: string;
  blockHash: `0x${string}`;
  blockTimestamp: string;
  fetchedAt: string;
};

export type BorrowMarketSnapshot = {
  version: typeof BORROW_MARKET_DETAIL_VERSION;
  chainId: 8453;
  walletAddress: BorrowAddress;
  market: BorrowMarketIdentity;
  eligibility: {
    mode: "enabled" | "reducing-only";
    newRisk: boolean;
    reason: string | null;
  };
  source: BorrowSourceBlock;
  state: {
    oraclePriceRaw: string;
    borrowRatePerSecondWad: string;
    borrowAprWad: string;
    totalSupplyAssetsRaw: string;
    totalBorrowAssetsRaw: string;
    totalBorrowSharesRaw: string;
    liquidityAssetsRaw: string;
    lastUpdateTimestamp: string;
  };
  wallet: {
    collateralBalanceRaw: string;
    loanBalanceRaw: string;
    collateralAllowanceRaw: string;
    loanAllowanceRaw: string;
  };
  position: {
    collateralRaw: string;
    borrowSharesRaw: string;
    debtAssetsRaw: string;
    rawBorrowCapacityAssetsRaw: string;
    borrowCapacityAssetsRaw: string;
    rawWithdrawableCollateralRaw: string;
    withdrawableCollateralRaw: string;
    healthFactorWad: string | null;
    liquidationPriceRaw: string | null;
  };
};

export type BorrowOverviewOpportunity = {
  market: BorrowMarketIdentity;
  availability:
    | { status: "available"; mode: "enabled" | "reducing-only"; reason: null; source: BorrowSourceBlock }
    | { status: "unavailable"; mode: "enabled" | "reducing-only"; reason: string; source: null };
};

export type BorrowOverviewPosition = {
  market: BorrowMarketIdentity;
  source: BorrowSourceBlock;
  collateralRaw: string;
  borrowSharesRaw: string;
  debtAssetsRaw: string;
  healthFactorWad: string | null;
};

export type BorrowOverviewResponse = {
  version: typeof BORROW_OVERVIEW_VERSION;
  chainId: 8453;
  owner: {
    address: BorrowAddress;
    accountProvider: AccountProvider;
  };
  discovery: {
    status: "complete" | "partial";
    candidateCount: number;
    verifiedCount: number;
    reason: string | null;
    fetchedAt: string;
  };
  opportunities: BorrowOverviewOpportunity[];
  positions: BorrowOverviewPosition[];
};

export type BorrowResponse = BorrowOverviewResponse;
export type BorrowErrorCode = "SMART_ACCOUNT_UNAVAILABLE" | "BORROW_STATE_UNAVAILABLE" | "BORROW_MARKET_NOT_FOUND";

export function parseSnapshot(value: unknown, expectedOwner: `0x${string}`): BorrowMarketSnapshot | null {
  if (!isRecord(value) || value.version !== BORROW_MARKET_DETAIL_VERSION || value.chainId !== 8453 ||
    typeof value.walletAddress !== "string" || value.walletAddress.toLowerCase() !== expectedOwner.toLowerCase()) return null;
  if (!isRecord(value.market) || typeof value.market.id !== "string") return null;
  const configured = getBorrowMarketRef(value.market.id);
  if (!configured || !marketMatches(value.market, configured)) return null;
  if (!isRecord(value.eligibility) || (value.eligibility.mode !== "enabled" && value.eligibility.mode !== "reducing-only") ||
    typeof value.eligibility.newRisk !== "boolean" || (value.eligibility.reason !== null && typeof value.eligibility.reason !== "string")) return null;
  if (!validSource(value.source) || !isRecord(value.state) || !isRecord(value.wallet) || !isRecord(value.position)) return null;
  const decimalFields = [
    value.state.oraclePriceRaw, value.state.borrowRatePerSecondWad, value.state.borrowAprWad,
    value.state.totalSupplyAssetsRaw, value.state.totalBorrowAssetsRaw, value.state.totalBorrowSharesRaw,
    value.state.liquidityAssetsRaw, value.state.lastUpdateTimestamp,
    value.wallet.collateralBalanceRaw, value.wallet.loanBalanceRaw,
    value.wallet.collateralAllowanceRaw, value.wallet.loanAllowanceRaw,
    value.position.collateralRaw, value.position.borrowSharesRaw, value.position.debtAssetsRaw,
    value.position.rawBorrowCapacityAssetsRaw, value.position.borrowCapacityAssetsRaw,
    value.position.rawWithdrawableCollateralRaw, value.position.withdrawableCollateralRaw,
  ];
  if (decimalFields.some((field) => typeof field !== "string" || !/^\d+$/.test(field))) return null;
  if (!nullableDecimal(value.position.healthFactorWad) || !nullableDecimal(value.position.liquidationPriceRaw)) return null;
  return value as BorrowMarketSnapshot;
}

export function parseBorrowOverview(value: unknown, expectedOwner: `0x${string}`): BorrowOverviewResponse | null {
  if (!isRecord(value) || value.version !== BORROW_OVERVIEW_VERSION || value.chainId !== 8453 || !isRecord(value.owner) ||
    typeof value.owner.address !== "string" || value.owner.address.toLowerCase() !== expectedOwner.toLowerCase() ||
    (value.owner.accountProvider !== "cdp-embedded" && value.owner.accountProvider !== "base-account") ||
    !isRecord(value.discovery) || !Array.isArray(value.opportunities) || !Array.isArray(value.positions)) return null;
  if ((value.discovery.status !== "complete" && value.discovery.status !== "partial") ||
    !Number.isSafeInteger(value.discovery.candidateCount) || (value.discovery.candidateCount as number) < 0 ||
    !Number.isSafeInteger(value.discovery.verifiedCount) || (value.discovery.verifiedCount as number) < 0 ||
    (value.discovery.verifiedCount as number) > (value.discovery.candidateCount as number) ||
    typeof value.discovery.fetchedAt !== "string" ||
    (value.discovery.reason !== null && typeof value.discovery.reason !== "string") ||
    value.opportunities.length !== value.discovery.candidateCount ||
    !value.opportunities.every(validOpportunity) || !value.positions.every(validPosition)) return null;
  const opportunityIds = new Set(value.opportunities.map((entry) => (entry as BorrowOverviewOpportunity).market.id.toLowerCase()));
  const positionIds = new Set(value.positions.map((entry) => (entry as BorrowOverviewPosition).market.id.toLowerCase()));
  if (opportunityIds.size !== value.opportunities.length || positionIds.size !== value.positions.length ||
    [...positionIds].some((id) => !opportunityIds.has(id))) return null;
  return value as BorrowOverviewResponse;
}

function validOpportunity(value: unknown): value is BorrowOverviewOpportunity {
  if (!isRecord(value) || !isRecord(value.market) || typeof value.market.id !== "string" || !isRecord(value.availability)) return false;
  const configured = getBorrowMarketRef(value.market.id);
  if (!configured || !marketMatches(value.market, configured) ||
    (value.availability.mode !== "enabled" && value.availability.mode !== "reducing-only")) return false;
  return value.availability.status === "available"
    ? value.availability.reason === null && validSource(value.availability.source)
    : value.availability.status === "unavailable" && typeof value.availability.reason === "string" && value.availability.source === null;
}
function validPosition(value: unknown): value is BorrowOverviewPosition {
  if (!isRecord(value) || !isRecord(value.market) || typeof value.market.id !== "string" || !validSource(value.source)) return false;
  const configured = getBorrowMarketRef(value.market.id);
  return Boolean(configured && marketMatches(value.market, configured) &&
    [value.collateralRaw, value.borrowSharesRaw, value.debtAssetsRaw].every((field) => typeof field === "string" && /^\d+$/.test(field)) &&
    nullableDecimal(value.healthFactorWad));
}

function marketMatches(value: Record<string, unknown>, configured: ReturnType<typeof getBorrowMarketRef> & {}) {
  return typeof value.morpho === "string" && value.morpho.toLowerCase() === configured.morpho.toLowerCase() &&
    typeof value.oracle === "string" && value.oracle.toLowerCase() === configured.oracle.toLowerCase() &&
    typeof value.irm === "string" && value.irm.toLowerCase() === configured.irm.toLowerCase() &&
    value.lltvWad === configured.lltvWad.toString(10) && isRecord(value.loanToken) && isRecord(value.collateralToken) &&
    value.loanToken.id === configured.loanToken.id && value.collateralToken.id === configured.collateralToken.id;
}
function validSource(value: unknown): value is BorrowSourceBlock {
  return isRecord(value) && value.provider === "Base JSON-RPC" && typeof value.blockNumber === "string" && /^\d+$/.test(value.blockNumber) &&
    typeof value.blockHash === "string" && /^0x[0-9a-f]{64}$/.test(value.blockHash) && typeof value.blockTimestamp === "string" && /^\d+$/.test(value.blockTimestamp) &&
    typeof value.fetchedAt === "string";
}
function nullableDecimal(value: unknown) { return value === null || (typeof value === "string" && /^\d+$/.test(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

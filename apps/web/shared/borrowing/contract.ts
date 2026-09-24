import type { AccountProvider } from "@/shared/account/session-types";
import type { BorrowAddress, BorrowAssetRef, BorrowMarketId } from "./config";
import { getBorrowMarketRef } from "./config";

export const BORROW_OVERVIEW_VERSION = "2" as const;
export const BORROW_MARKET_DETAIL_VERSION = "1" as const;

export type BorrowMarketIdentity = {
  id: BorrowMarketId; morpho: BorrowAddress; loanToken: BorrowAssetRef; collateralToken: BorrowAssetRef;
  oracle: BorrowAddress; irm: BorrowAddress; lltvWad: string; rank: number;
};
export type BorrowSourceBlock = {
  provider: "Base JSON-RPC"; blockNumber: string; blockHash: `0x${string}`;
  blockTimestamp: string; fetchedAt: string;
};
export type BorrowMarketSnapshot = {
  version: typeof BORROW_MARKET_DETAIL_VERSION; chainId: 8453; walletAddress: BorrowAddress;
  market: BorrowMarketIdentity;
  eligibility: { mode: "enabled" | "reducing-only"; newRisk: boolean; reason: string | null };
  source: BorrowSourceBlock;
  state: {
    oraclePriceRaw: string; borrowRatePerSecondWad: string; borrowAprWad: string;
    totalSupplyAssetsRaw: string; totalBorrowAssetsRaw: string; totalBorrowSharesRaw: string;
    liquidityAssetsRaw: string; lastUpdateTimestamp: string;
  };
  wallet: {
    collateralBalanceRaw: string; loanBalanceRaw: string; collateralAllowanceRaw: string; loanAllowanceRaw: string;
  };
  position: {
    collateralRaw: string; borrowSharesRaw: string; debtAssetsRaw: string;
    rawBorrowCapacityAssetsRaw: string; borrowCapacityAssetsRaw: string;
    rawWithdrawableCollateralRaw: string; withdrawableCollateralRaw: string;
    healthFactorWad: string | null; liquidationPriceRaw: string | null;
  };
};
export type BorrowOverviewOpportunity = {
  market: BorrowMarketIdentity;
  availability:
    | { status: "available"; mode: "enabled" | "reducing-only"; reason: null; source: BorrowSourceBlock; snapshot: BorrowMarketSnapshot }
    | { status: "unavailable"; mode: "enabled" | "reducing-only"; reason: string; source: null };
};
export type BorrowOverviewPosition = {
  market: BorrowMarketIdentity; source: BorrowSourceBlock; collateralRaw: string;
  borrowSharesRaw: string; debtAssetsRaw: string; healthFactorWad: string | null;
};
export type BorrowOverviewResponse = {
  version: typeof BORROW_OVERVIEW_VERSION; chainId: 8453;
  owner: { address: BorrowAddress; accountProvider: AccountProvider };
  discovery: {
    status: "complete" | "partial"; sourceBlock: Omit<BorrowSourceBlock, "fetchedAt"> | null;
    candidateCount: number; verifiedCount: number; reason: string | null; fetchedAt: string;
  };
  opportunities: BorrowOverviewOpportunity[]; positions: BorrowOverviewPosition[];
};
export type BorrowResponse = BorrowOverviewResponse;

export function parseSnapshot(value: unknown, expectedOwner: `0x${string}`): BorrowMarketSnapshot | null {
  if (!isRecord(value) || value.version !== BORROW_MARKET_DETAIL_VERSION || value.chainId !== 8453 ||
    typeof value.walletAddress !== "string" || value.walletAddress.toLowerCase() !== expectedOwner.toLowerCase()) return null;
  if (!isRecord(value.market) || typeof value.market.id !== "string") return null;
  const configured = getBorrowMarketRef(value.market.id);
  if (!configured || !marketMatches(value.market, configured)) return null;
  if (!isRecord(value.eligibility) || value.eligibility.mode !== configured.availability ||
    value.eligibility.newRisk !== (configured.availability === "enabled") ||
    (value.eligibility.reason !== null && typeof value.eligibility.reason !== "string")) return null;
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
    !value.opportunities.every((entry) => validOpportunity(entry, expectedOwner)) ||
    !value.positions.every(validPosition)) return null;
  const opportunities = value.opportunities as BorrowOverviewOpportunity[];
  const positions = value.positions as BorrowOverviewPosition[];
  const available = opportunities.filter((entry) => entry.availability.status === "available");
  const sourceBlock = value.discovery.sourceBlock;
  if (value.discovery.verifiedCount !== available.length || (sourceBlock === null) !== (available.length === 0)) return null;
  if (sourceBlock !== null && (!validBlock(sourceBlock) || available.some((entry) =>
    entry.availability.status !== "available" || !sameBlock(entry.availability.source, sourceBlock)))) return null;
  const opportunityIds = new Set(opportunities.map((entry) => entry.market.id.toLowerCase()));
  const positionIds = new Set(positions.map((entry) => entry.market.id.toLowerCase()));
  if (opportunityIds.size !== opportunities.length || positionIds.size !== positions.length ||
    positions.some((entry) => {
      const opportunity = opportunities.find((candidate) => candidate.market.id.toLowerCase() === entry.market.id.toLowerCase());
      return !opportunity || opportunity.availability.status !== "available" ||
        !sameBlock(entry.source, opportunity.availability.source);
    })) return null;
  return value as BorrowOverviewResponse;
}

function validOpportunity(value: unknown, expectedOwner: `0x${string}`): value is BorrowOverviewOpportunity {
  if (!isRecord(value) || !isRecord(value.market) || typeof value.market.id !== "string" || !isRecord(value.availability)) return false;
  const configured = getBorrowMarketRef(value.market.id);
  if (!configured || !marketMatches(value.market, configured) || value.availability.mode !== configured.availability) return false;
  if (value.availability.status === "available") {
    const snapshot = parseSnapshot(value.availability.snapshot, expectedOwner);
    return value.availability.reason === null && validSource(value.availability.source) && snapshot !== null &&
      snapshot.market.id.toLowerCase() === value.market.id.toLowerCase() &&
      snapshot.eligibility.mode === value.availability.mode &&
      sameSource(snapshot.source, value.availability.source);
  }
  return value.availability.status === "unavailable" && typeof value.availability.reason === "string" &&
    value.availability.source === null && !("snapshot" in value.availability);
}
function validPosition(value: unknown): value is BorrowOverviewPosition {
  if (!isRecord(value) || !isRecord(value.market) || typeof value.market.id !== "string" || !validSource(value.source)) return false;
  const configured = getBorrowMarketRef(value.market.id);
  return Boolean(configured && marketMatches(value.market, configured) &&
    [value.collateralRaw, value.borrowSharesRaw, value.debtAssetsRaw].every((field) => typeof field === "string" && /^\d+$/.test(field)) &&
    nullableDecimal(value.healthFactorWad));
}
function marketMatches(value: Record<string, unknown>, configured: NonNullable<ReturnType<typeof getBorrowMarketRef>>) {
  return typeof value.id === "string" && value.id.toLowerCase() === configured.marketId.toLowerCase() &&
    typeof value.morpho === "string" && value.morpho.toLowerCase() === configured.morpho.toLowerCase() &&
    typeof value.oracle === "string" && value.oracle.toLowerCase() === configured.oracle.toLowerCase() &&
    typeof value.irm === "string" && value.irm.toLowerCase() === configured.irm.toLowerCase() &&
    value.lltvWad === configured.lltvWad.toString(10) && value.rank === configured.rank &&
    assetMatches(value.loanToken, configured.loanToken) && assetMatches(value.collateralToken, configured.collateralToken);
}
function assetMatches(value: unknown, expected: BorrowAssetRef): boolean {
  return isRecord(value) && value.id === expected.id && value.chainId === expected.chainId &&
    value.address === expected.address && value.symbol === expected.symbol &&
    value.name === expected.name && value.decimals === expected.decimals;
}
function validBlock(value: unknown): value is Omit<BorrowSourceBlock, "fetchedAt"> {
  return isRecord(value) && value.provider === "Base JSON-RPC" && typeof value.blockNumber === "string" && /^\d+$/.test(value.blockNumber) &&
    typeof value.blockHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.blockHash) &&
    typeof value.blockTimestamp === "string" && /^\d+$/.test(value.blockTimestamp);
}
function validSource(value: unknown): value is BorrowSourceBlock {
  return validBlock(value) && "fetchedAt" in value && typeof value.fetchedAt === "string";
}
function sameBlock(left: Omit<BorrowSourceBlock, "fetchedAt">, right: Omit<BorrowSourceBlock, "fetchedAt">): boolean {
  return left.blockNumber === right.blockNumber && left.blockHash.toLowerCase() === right.blockHash.toLowerCase() && left.blockTimestamp === right.blockTimestamp;
}
function sameSource(left: BorrowSourceBlock, right: BorrowSourceBlock): boolean {
  return sameBlock(left, right) && left.fetchedAt === right.fetchedAt;
}
function nullableDecimal(value: unknown) { return value === null || (typeof value === "string" && /^\d+$/.test(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

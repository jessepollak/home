import type { AccountProvider } from "@/shared/account/session-types";
import type { MorphoAddress, MorphoAssetRef, MorphoMarketId } from "@/shared/morpho-markets/config";
import { getVerifiedMorphoMarket } from "@/shared/morpho-markets/config";

export const LENDING_CONTRACT_VERSION = "1" as const;

export type LendingMarketIdentity = {
  id: MorphoMarketId;
  morpho: MorphoAddress;
  loanToken: MorphoAssetRef;
  collateralToken: MorphoAssetRef;
  oracle: MorphoAddress;
  irm: MorphoAddress;
  lltvWad: string;
  rank: number;
};

export type LendingSourceBlock = {
  provider: "Base JSON-RPC";
  blockNumber: string;
  blockHash: `0x${string}`;
  blockTimestamp: string;
  fetchedAt: string;
};

export type LendingCapabilityMode = "enabled" | "reducing-only" | "withdraw-only";

export type LendingMarketState = {
  totalSupplyAssetsRaw: string;
  totalSupplySharesRaw: string;
  totalBorrowAssetsRaw: string;
  liquidityAssetsRaw: string;
  feeWad: string;
  utilizationWad: string;
  supplyAprWad: string;
};

export type LendingPosition = {
  market: LendingMarketIdentity;
  source: LendingSourceBlock;
  supplySharesRaw: string;
  suppliedAssetsRaw: string;
  withdrawableAssetsRaw: string;
};

export type LendingOpportunity = {
  market: LendingMarketIdentity;
  availability:
    | {
        status: "available";
        mode: LendingCapabilityMode;
        canSupply: boolean;
        canWithdraw: boolean;
        reason: string | null;
        source: LendingSourceBlock;
        state: LendingMarketState;
      }
    | {
        status: "unavailable";
        mode: LendingCapabilityMode;
        canSupply: boolean;
        canWithdraw: false;
        reason: string;
        source: null;
        state: null;
      };
};

export type LendingOverview = {
  version: typeof LENDING_CONTRACT_VERSION;
  opportunities: LendingOpportunity[];
  positions: LendingPosition[];
};

export type LendingMarketDetail = {
  version: typeof LENDING_CONTRACT_VERSION;
  mode: LendingCapabilityMode;
  canSupply: boolean;
  canWithdraw: boolean;
  reason: string | null;
  state: LendingMarketState;
  position: {
    supplySharesRaw: string;
    suppliedAssetsRaw: string;
    withdrawableAssetsRaw: string;
  };
};

export type LendingMarketDetailResponse = {
  version: typeof LENDING_CONTRACT_VERSION;
  chainId: 8453;
  walletAddress: MorphoAddress;
  market: LendingMarketIdentity;
  source: LendingSourceBlock;
  wallet: {
    collateralBalanceRaw: string;
    loanBalanceRaw: string;
    collateralAllowanceRaw: string;
    loanAllowanceRaw: string;
  };
  lending: LendingMarketDetail;
};

export function parseLendingOverviewResponse(value: unknown, expectedOwner: `0x${string}`): LendingOverview | null {
  if (!isRecord(value) || value.version !== LENDING_CONTRACT_VERSION || value.chainId !== 8453 || !isRecord(value.owner) ||
    typeof value.owner.address !== "string" || value.owner.address.toLowerCase() !== expectedOwner.toLowerCase() ||
    !validAccountProvider(value.owner.accountProvider) || !validOverview(value.lending)) return null;
  return value.lending;
}

export function parseLendingMarketDetailEnvelopeResponse(value: unknown, expectedOwner: `0x${string}`): LendingMarketDetailResponse | null {
  if (!isRecord(value) || value.version !== LENDING_CONTRACT_VERSION || value.chainId !== 8453 || typeof value.walletAddress !== "string" ||
    value.walletAddress.toLowerCase() !== expectedOwner.toLowerCase() || !isRecord(value.market) ||
    typeof value.market.id !== "string" || !marketMatches(value.market) || !validSource(value.source) || !validWallet(value.wallet) ||
    !validDetail(value.lending)) return null;
  return value as LendingMarketDetailResponse;
}

export function parseLendingMarketDetailResponse(value: unknown, expectedOwner: `0x${string}`): LendingMarketDetail | null {
  if (!isRecord(value) || value.version !== LENDING_CONTRACT_VERSION || value.chainId !== 8453 || typeof value.walletAddress !== "string" ||
    value.walletAddress.toLowerCase() !== expectedOwner.toLowerCase() || !isRecord(value.market) ||
    typeof value.market.id !== "string" || !marketMatches(value.market) || !validDetail(value.lending)) return null;
  return value.lending;
}

function validOverview(value: unknown): value is LendingOverview {
  if (!isRecord(value) || value.version !== LENDING_CONTRACT_VERSION || !Array.isArray(value.opportunities) || !Array.isArray(value.positions) ||
    !value.opportunities.every(validOpportunity) || !value.positions.every(validPosition)) return false;
  const opportunityIds = new Set(value.opportunities.map((entry) => (entry as LendingOpportunity).market.id.toLowerCase()));
  const positionIds = new Set(value.positions.map((entry) => (entry as LendingPosition).market.id.toLowerCase()));
  return opportunityIds.size === value.opportunities.length && positionIds.size === value.positions.length &&
    [...positionIds].every((id) => opportunityIds.has(id));
}

function validOpportunity(value: unknown): value is LendingOpportunity {
  if (!isRecord(value) || !isRecord(value.market) || !marketMatches(value.market) || !isRecord(value.availability) ||
    !validMode(value.availability.mode) || typeof value.availability.canSupply !== "boolean" || typeof value.availability.canWithdraw !== "boolean") return false;
  if (value.availability.status === "available") {
    return value.availability.source !== null && validSource(value.availability.source) && validState(value.availability.state) &&
      (value.availability.reason === null || typeof value.availability.reason === "string");
  }
  return value.availability.status === "unavailable" && value.availability.canWithdraw === false &&
    typeof value.availability.reason === "string" && value.availability.source === null && value.availability.state === null;
}

function validPosition(value: unknown): value is LendingPosition {
  return isRecord(value) && isRecord(value.market) && marketMatches(value.market) && validSource(value.source) &&
    decimal(value.supplySharesRaw) && decimal(value.suppliedAssetsRaw) && decimal(value.withdrawableAssetsRaw) &&
    BigInt(value.supplySharesRaw as string) > BigInt(0);
}

function validDetail(value: unknown): value is LendingMarketDetail {
  return isRecord(value) && value.version === LENDING_CONTRACT_VERSION && validMode(value.mode) &&
    typeof value.canSupply === "boolean" && typeof value.canWithdraw === "boolean" &&
    (value.reason === null || typeof value.reason === "string") && validState(value.state) && isRecord(value.position) &&
    decimal(value.position.supplySharesRaw) && decimal(value.position.suppliedAssetsRaw) && decimal(value.position.withdrawableAssetsRaw);
}

function validWallet(value: unknown): value is LendingMarketDetailResponse["wallet"] {
  return isRecord(value) && [value.collateralBalanceRaw, value.loanBalanceRaw, value.collateralAllowanceRaw, value.loanAllowanceRaw].every(decimal);
}

function validState(value: unknown): value is LendingMarketState {
  return isRecord(value) && [value.totalSupplyAssetsRaw, value.totalSupplySharesRaw, value.totalBorrowAssetsRaw,
    value.liquidityAssetsRaw, value.feeWad, value.utilizationWad, value.supplyAprWad].every(decimal);
}

function marketMatches(value: Record<string, unknown>): boolean {
  if (typeof value.id !== "string") return false;
  const configured = getVerifiedMorphoMarket(value.id);
  return Boolean(configured && typeof value.morpho === "string" && value.morpho.toLowerCase() === configured.morpho.toLowerCase() &&
    typeof value.oracle === "string" && value.oracle.toLowerCase() === configured.oracle.toLowerCase() &&
    typeof value.irm === "string" && value.irm.toLowerCase() === configured.irm.toLowerCase() &&
    value.lltvWad === configured.lltvWad.toString(10) && isRecord(value.loanToken) && isRecord(value.collateralToken) &&
    value.loanToken.id === configured.loanToken.id && value.collateralToken.id === configured.collateralToken.id);
}

function validSource(value: unknown): value is LendingSourceBlock {
  return isRecord(value) && value.provider === "Base JSON-RPC" && decimal(value.blockNumber) &&
    typeof value.blockHash === "string" && /^0x[0-9a-f]{64}$/.test(value.blockHash) && decimal(value.blockTimestamp) && typeof value.fetchedAt === "string";
}
function validMode(value: unknown): value is LendingCapabilityMode { return value === "enabled" || value === "reducing-only" || value === "withdraw-only"; }
function validAccountProvider(value: unknown): value is AccountProvider { return value === "cdp-embedded" || value === "base-account"; }
function decimal(value: unknown): value is string { return typeof value === "string" && /^\d+$/.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

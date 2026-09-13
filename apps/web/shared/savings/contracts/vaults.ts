// Route contract.
// GET /api/savings/vaults

import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";

export type Address = `0x${string}`;
export const MORPHO_API_VERSION = "v1" as const;
export type MorphoApiVersion = typeof MORPHO_API_VERSION;
export type MorphoSource =
  | { provider: "Morpho GraphQL"; endpoint: "https://api.morpho.org/graphql"; query: "vaults" | "vaultPosition"; fetchedAt: string }
  | { provider: "Base JSON-RPC"; blockNumber: string; fetchedAt: string };
export type MorphoVaultCandidate = {
  version: MorphoApiVersion;
  vaultAddress: Address;
  name: string;
  symbol: string;
  listed: boolean;
  chainId: 8453;
  asset: { address: Address; symbol: "USDC"; decimals: 6 };
  curatorAddress: Address | null;
  grossApy: number | null;
  netApy: number | null;
  feeRate: number | null;
  totalAssetsRaw: string | null;
  liquidityRaw: string | null;
  stateAsOf: string | null;
  blockNumber: string | null;
  source: MorphoSource;
};
export type MorphoVaultsResult = {
  version: MorphoApiVersion;
  chainId: 8453;
  asset: { address: Address; symbol: "USDC"; decimals: 6 };
  candidates: MorphoVaultCandidate[];
  source: MorphoSource;
  stale: boolean;
};
export type SavingsVaultsResponse = MorphoVaultsResult;
export type SavingsVaultsErrorResponse = { error: "vault-data-unavailable"; message: string };

export function parseVaultsResult(value: unknown): MorphoVaultsResult | null {
  if (
    !isRecord(value) ||
    value.version !== MORPHO_API_VERSION ||
    value.chainId !== 8453 ||
    !isSavingsAsset(value.asset) ||
    !Array.isArray(value.candidates) ||
    !value.candidates.every(isVaultCandidate) ||
    !isMorphoSource(value.source, "vaults") ||
    typeof value.stale !== "boolean"
  ) return null;
  const candidateAddresses = value.candidates.map((candidate) =>
    (candidate as MorphoVaultCandidate).vaultAddress.toLowerCase()
  );
  if (new Set(candidateAddresses).size !== candidateAddresses.length) return null;
  return value as MorphoVaultsResult;
}

function isVaultCandidate(value: unknown): boolean {
  if (!isRecord(value) || typeof value.vaultAddress !== "string") return false;
  const vaultAddress = value.vaultAddress;
  return value.version === MORPHO_API_VERSION &&
    MORPHO_V1_CANDIDATE_ADDRESSES.some(
      (address) => address.toLowerCase() === vaultAddress.toLowerCase(),
    ) &&
    typeof value.name === "string" &&
    typeof value.symbol === "string" &&
    typeof value.listed === "boolean" &&
    value.chainId === 8453 &&
    isSavingsAsset(value.asset) &&
    (value.netApy === null || typeof value.netApy === "number") &&
    (value.stateAsOf === null || typeof value.stateAsOf === "string") &&
    isMorphoSource(value.source, "vaults");
}
function isSavingsAsset(value: unknown): boolean {
  return isRecord(value) && typeof value.address === "string" &&
    value.address.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase() &&
    value.symbol === "USDC" && value.decimals === BASE_USDC_DECIMALS;
}
function isMorphoSource(value: unknown, query: "vaults" | "vaultPosition"): boolean {
  if (!isRecord(value) || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt))) return false;
  if (query === "vaultPosition" && value.provider === "Base JSON-RPC") return typeof value.blockNumber === "string" && /^\d+$/.test(value.blockNumber);
  return value.provider === "Morpho GraphQL" && value.endpoint === "https://api.morpho.org/graphql" && value.query === query;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

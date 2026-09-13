// Route contract.
// GET /api/savings/positions

import { MORPHO_API_VERSION, type Address, type MorphoSource } from "./vaults";
import { MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";

export type VerifiedMorphoAccount = { address: Address; verification: "caller-verified-session-smart-account" };
export type MorphoVaultPosition = {
  version: typeof MORPHO_API_VERSION;
  accountAddress: Address;
  vaultAddress: Address;
  assetsRaw: string | null;
  sharesRaw: string;
  indexedAt: string;
  source: MorphoSource;
  withdrawableRaw: null;
  withdrawableNote: string;
};
export type SavingsPositionsResult = {
  accountAddress: Address;
  fetchedAt: string;
  vaults: Array<{ vaultAddress: Address; position: MorphoVaultPosition | null }>;
};
export type SavingsPositionsResponse = SavingsPositionsResult;
export type SavingsPositionsErrorCode = "SMART_ACCOUNT_UNAVAILABLE" | "SAVINGS_POSITIONS_UNAVAILABLE";

export function parsePositionResult(value: unknown, expectedAddress: Address): SavingsPositionsResult | null {
  if (
    !isRecord(value) ||
    typeof value.accountAddress !== "string" ||
    value.accountAddress.toLowerCase() !== expectedAddress.toLowerCase() ||
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    !Array.isArray(value.vaults)
  ) return null;

  const configuredVaults = new Set(MORPHO_V1_CANDIDATE_ADDRESSES.map((address) => address.toLowerCase()));
  const seenVaults = new Set<string>();
  const vaults: SavingsPositionsResult["vaults"] = [];
  for (const entry of value.vaults) {
    if (!isRecord(entry) || typeof entry.vaultAddress !== "string") return null;
    const normalizedVault = entry.vaultAddress.toLowerCase();
    if (!configuredVaults.has(normalizedVault) || seenVaults.has(normalizedVault)) return null;
    seenVaults.add(normalizedVault);
    if (entry.position !== null && !isPosition(entry.position, expectedAddress, entry.vaultAddress)) return null;
    vaults.push({ vaultAddress: entry.vaultAddress as Address, position: entry.position as MorphoVaultPosition | null });
  }
  if (seenVaults.size !== configuredVaults.size) return null;
  return { accountAddress: expectedAddress, fetchedAt: value.fetchedAt, vaults };
}

export function isUsablePositionResult(data: SavingsPositionsResult): boolean {
  return data.vaults.every((entry) => entry.position === null || readUsdcBaseUnits(entry.position.assetsRaw) !== null);
}
export function readUsdcBaseUnits(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  return BigInt(value);
}
function isPosition(value: unknown, accountAddress: Address, vaultAddress: string) {
  return isRecord(value) && typeof value.accountAddress === "string" &&
    value.accountAddress.toLowerCase() === accountAddress.toLowerCase() &&
    typeof value.vaultAddress === "string" && value.vaultAddress.toLowerCase() === vaultAddress.toLowerCase() &&
    (typeof value.assetsRaw === "string" || value.assetsRaw === null) &&
    typeof value.sharesRaw === "string" && readUsdcBaseUnits(value.sharesRaw) !== null &&
    typeof value.indexedAt === "string" && Number.isFinite(Date.parse(value.indexedAt)) &&
    isMorphoSource(value.source, "vaultPosition") && value.withdrawableRaw === null &&
    typeof value.withdrawableNote === "string";
}
function isMorphoSource(value: unknown, query: "vaults" | "vaultPosition"): boolean {
  if (!isRecord(value) || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt))) return false;
  if (query === "vaultPosition" && value.provider === "Base JSON-RPC") return typeof value.blockNumber === "string" && /^\d+$/.test(value.blockNumber);
  return value.provider === "Morpho GraphQL" && value.endpoint === "https://api.morpho.org/graphql" && value.query === query;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

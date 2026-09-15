import {
  BASE_CHAIN_ID,
  BASE_MORPHO_USDC_VAULTS,
  BASE_USDC,
  type BaseVaultAsset,
} from "@/shared/assets/base";
import type { Address } from "./types";

export type SaveVaultCapability = "enabled" | "reducing-only";
export type SaveVaultOperation = "deposit" | "withdraw";
export type VerifiedSaveVaultRef = BaseVaultAsset & {
  chainId: typeof BASE_CHAIN_ID;
  assetAddress: typeof BASE_USDC.address;
  assetDecimals: typeof BASE_USDC.decimals;
  rank: number;
  capabilities: {
    save?: SaveVaultCapability;
  };
};

export { BASE_CHAIN_ID } from "@/shared/assets/base";
export const BASE_USDC_ADDRESS = BASE_USDC.address satisfies Address;
export const BASE_USDC_DECIMALS = BASE_USDC.decimals;
export const MORPHO_GRAPHQL_ENDPOINT =
  "https://api.morpho.org/graphql" as const;

export const VERIFIED_SAVE_VAULTS = BASE_MORPHO_USDC_VAULTS.map(
  (vault, index): VerifiedSaveVaultRef => ({
    ...vault,
    chainId: BASE_CHAIN_ID,
    assetAddress: BASE_USDC.address,
    assetDecimals: BASE_USDC.decimals,
    rank: index + 1,
    capabilities: { save: "enabled" },
  }),
) as readonly VerifiedSaveVaultRef[];

export const MORPHO_V1_CANDIDATE_ADDRESSES = BASE_MORPHO_USDC_VAULTS.map(
  ({ address }) => address,
) as readonly Address[];

const candidateAddressSet = new Set(
  MORPHO_V1_CANDIDATE_ADDRESSES.map((address) => address.toLowerCase()),
);

export function getVerifiedSaveVault(address: string): VerifiedSaveVaultRef | null {
  return VERIFIED_SAVE_VAULTS.find(
    (vault) => vault.address.toLowerCase() === address.toLowerCase(),
  ) ?? null;
}

export function isSaveActionAllowed(
  capability: SaveVaultCapability | undefined,
  operation: SaveVaultOperation,
): boolean {
  return capability === "enabled" ||
    (capability === "reducing-only" && operation === "withdraw");
}

export function isConfiguredMorphoVault(address: string): address is Address {
  return candidateAddressSet.has(address.toLowerCase());
}

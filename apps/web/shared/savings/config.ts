import {
  BASE_MORPHO_USDC_VAULTS,
  BASE_USDC,
} from "@/shared/assets/base";
import type { Address } from "./types";

export { BASE_CHAIN_ID } from "@/shared/assets/base";
export const BASE_USDC_ADDRESS = BASE_USDC.address satisfies Address;
export const BASE_USDC_DECIMALS = BASE_USDC.decimals;
export const MORPHO_GRAPHQL_ENDPOINT =
  "https://api.morpho.org/graphql" as const;

export const MORPHO_V1_CANDIDATE_ADDRESSES = BASE_MORPHO_USDC_VAULTS.map(
  ({ address }) => address,
) as readonly Address[];

const candidateAddressSet = new Set(
  MORPHO_V1_CANDIDATE_ADDRESSES.map((address) => address.toLowerCase()),
);

export function isConfiguredMorphoVault(address: string): address is Address {
  return candidateAddressSet.has(address.toLowerCase());
}

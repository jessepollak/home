import type { Address } from "./types";

export const BASE_CHAIN_ID = 8453 as const;
export const BASE_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const satisfies Address;
export const BASE_USDC_DECIMALS = 6 as const;
export const MORPHO_GRAPHQL_ENDPOINT =
  "https://api.morpho.org/graphql" as const;

export const MORPHO_V1_CANDIDATE_ADDRESSES = [
  "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
  "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
  "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
] as const satisfies readonly Address[];

const candidateAddressSet = new Set(
  MORPHO_V1_CANDIDATE_ADDRESSES.map((address) => address.toLowerCase()),
);

export function isConfiguredMorphoVault(address: string): address is Address {
  return candidateAddressSet.has(address.toLowerCase());
}

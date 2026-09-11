export type Address = `0x${string}`;

export const MORPHO_API_VERSION = "v1" as const;
export type MorphoApiVersion = typeof MORPHO_API_VERSION;

export type MorphoSource = {
  provider: "Morpho GraphQL";
  endpoint: "https://api.morpho.org/graphql";
  query: "vaults" | "vaultPosition";
  fetchedAt: string;
};

export type MorphoVaultCandidate = {
  version: MorphoApiVersion;
  vaultAddress: Address;
  name: string;
  symbol: string;
  listed: boolean;
  chainId: 8453;
  asset: {
    address: Address;
    symbol: "USDC";
    decimals: 6;
  };
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
  asset: {
    address: Address;
    symbol: "USDC";
    decimals: 6;
  };
  candidates: MorphoVaultCandidate[];
  source: MorphoSource;
  stale: boolean;
};

export type VerifiedMorphoAccount = {
  address: Address;
  verification: "caller-verified-session-smart-account";
};

export type MorphoVaultPosition = {
  version: MorphoApiVersion;
  accountAddress: Address;
  vaultAddress: Address;
  assetsRaw: string | null;
  sharesRaw: string;
  indexedAt: string;
  source: MorphoSource;
  withdrawableRaw: null;
  withdrawableNote: string;
};

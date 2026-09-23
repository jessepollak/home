import { portfolioVaults, PORTFOLIO_USDC_ADDRESS } from "../../../config/portfolio-assets";

export const sessionBody = {
  user: { subject: "playwright-smoke-subject" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

export const actionsBody = { actions: [] };
export const fundingProvidersBody = { providers: [] };
export const fundingOfframpOrdersBody = { version: 3, recoveryEligible: false, orders: [] };
export const basenameProfileBody = { profile: null };

export function savingsVaultsBody(stateAsOf: string, fetchedAt: string) {
  return {
    version: "v1",
    chainId: 8453,
    asset: { address: PORTFOLIO_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    candidates: [{
      version: "v1",
      vaultAddress: portfolioVaults[0].address,
      name: portfolioVaults[0].name,
      symbol: portfolioVaults[0].symbol,
      listed: true,
      chainId: 8453,
      asset: { address: PORTFOLIO_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
      curatorAddress: null,
      grossApy: 0.04,
      netApy: 0.035,
      feeRate: 0.1,
      totalAssetsRaw: "100000000",
      liquidityRaw: "50000000",
      stateAsOf,
      blockNumber: "51026404",
      source: {
        provider: "Morpho GraphQL",
        endpoint: "https://api.morpho.org/graphql",
        query: "vaults",
        fetchedAt,
      },
    }],
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt,
    },
    stale: false,
  };
}

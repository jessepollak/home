import type { FundingProviderManifest } from "@/shared/funding/provider-contract";

export const COINBASE_ONRAMP_API_ORIGIN = "https://api.cdp.coinbase.com" as const;
export const COINBASE_ONRAMP_REDIRECT_ORIGIN = "https://pay.coinbase.com" as const;
export const COINBASE_ONRAMP_ENV = [
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
] as const;

export const coinbaseManifest = {
  id: "coinbase",
  displayName: "Coinbase",
  docsUrl: "https://docs.cdp.coinbase.com/onramp/additional-resources/faq",
  bindings: [
    {
      region: "US",
      assetId: "base:usdc",
      paymentMethods: [{ id: "hosted", label: "Coinbase" }],
      env: COINBASE_ONRAMP_ENV,
    },
  ],
  apiOrigins: [COINBASE_ONRAMP_API_ORIGIN],
  redirectOrigins: [COINBASE_ONRAMP_REDIRECT_ORIGIN],
  reference: "provider",
} as const satisfies FundingProviderManifest;

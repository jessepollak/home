import "server-only";

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
  onramp: {
    modeEnv: "COINBASE_ONRAMP_MODE",
    apiOrigins: [COINBASE_ONRAMP_API_ORIGIN],
    redirectOrigins: [COINBASE_ONRAMP_REDIRECT_ORIGIN],
    sandbox: true,
    reference: "provider",
    quotes: true,
  },
  bindings: [
    {
      region: "US",
      assetId: "base:usdc",
      currency: "USD",
      directions: {
        onramp: {
          paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }],
          env: COINBASE_ONRAMP_ENV,
        },
      },
    },
  ],
} as const satisfies FundingProviderManifest;

import "server-only";

import type { FundingProviderManifest } from "@/shared/funding/provider-contract";

export const IDRX_API_ORIGIN = "https://api.idrx.co" as const;
export const IDRX_CHECKOUT_ORIGIN = "https://checkout.idrx.co" as const;
export const IDRX_ENV = [
  "IDRX_CLIENT_ID",
  "IDRX_CLIENT_SECRET",
  "IDRX_CUSTOMER_NAME",
] as const;

export const idrxManifest = {
  id: "idrx",
  displayName: "IDRX",
  docsUrl: "https://docs.idrx.co/",
  onramp: {
    apiOrigins: [IDRX_API_ORIGIN],
    redirectOrigins: [IDRX_CHECKOUT_ORIGIN],
    reference: "provider",
    quotes: true,
  },
  bindings: [
    {
      region: "ID",
      assetId: "base:idrx",
      currency: "IDR",
      directions: {
        onramp: {
          paymentMethods: [{ id: "qris", label: "QRIS" }],
          env: IDRX_ENV,
        },
      },
    },
  ],
} as const satisfies FundingProviderManifest;

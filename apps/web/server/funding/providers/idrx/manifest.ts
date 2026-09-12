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
  bindings: [
    {
      region: "ID",
      assetId: "base:idrx",
      paymentMethods: [
        { id: "bank-va-mandiri", label: "Bank transfer · Mandiri" },
        { id: "bank-va-bri", label: "Bank transfer · BRI" },
        { id: "qris", label: "QRIS" },
      ],
      env: IDRX_ENV,
    },
  ],
  apiOrigins: [IDRX_API_ORIGIN],
  redirectOrigins: [IDRX_CHECKOUT_ORIGIN],
  reference: "provider",
} as const satisfies FundingProviderManifest;

import "server-only";

import type { FundingProviderManifest } from "@/shared/funding/provider-contract";

export const IDRX_API_ORIGIN = "https://api.idrx.co" as const;
export const IDRX_CHECKOUT_ORIGIN = "https://checkout.idrx.co" as const;
export const IDRX_ENV = [
  "IDRX_CLIENT_ID",
  "IDRX_CLIENT_SECRET",
  "IDRX_CUSTOMER_NAME",
] as const;

// IDRX virtual accounts are closed VAs: the bank only accepts the transfer
// from an account registered on the IDRX account that created the order
// (Mandiri/BRI by account number, INA/Nobu by KYC name). With one operator
// API key every Home user pays as the operator, so those transfers are
// rejected. The VA methods stay out of the live binding until Home users get
// their own IDRX identity (per-user KYC + bank account on the seam); the
// adapter code and tests for them are kept for that step.
export const IDRX_VA_PAYMENT_METHODS = [
  { id: "bank-va-mandiri", label: "Bank transfer · Mandiri" },
  { id: "bank-va-bri", label: "Bank transfer · BRI" },
] as const;

export const idrxManifest = {
  id: "idrx",
  displayName: "IDRX",
  docsUrl: "https://docs.idrx.co/",
  onramp: {
    apiOrigins: [IDRX_API_ORIGIN],
    redirectOrigins: [IDRX_CHECKOUT_ORIGIN],
    reference: "provider",
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

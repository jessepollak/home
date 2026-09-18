import "server-only";

import type { FundingProviderManifest } from "@/shared/funding/provider-contract";

export const IDRX_API_ORIGIN = "https://api.idrx.co" as const;
export const IDRX_CHECKOUT_ORIGIN = "https://checkout.idrx.co" as const;
// The pair is the operator's ORGANIZATION API key: members are onboarded
// under it and every order is created for a member.
export const IDRX_ENV = ["IDRX_CLIENT_ID", "IDRX_CLIENT_SECRET"] as const;

// IDRX virtual accounts are closed VAs: the bank only accepts the transfer
// from an account registered on the IDRX account that created the order
// (Mandiri/BRI by account number). Each Home user therefore gets their own
// IDRX identity: `ensureCustomer` onboards them as a member of the operator's
// organization and registers the bank account they will pay from, and every
// order is created for that member (`memberId`). QRIS uses the same identity
// for its payer-name match.
export const IDRX_VA_PAYMENT_METHODS = [
  { id: "bank-va-mandiri", label: "Bank transfer · Mandiri" },
  { id: "bank-va-bri", label: "Bank transfer · BRI" },
] as const;

export const IDRX_BANKS = {
  Mandiri: { code: "008", channel: "MANDIRI" },
  BRI: { code: "002", channel: "BRI" },
} as const;

// What IDRX needs to onboard a member (`POST /auth/onboarding`) and register
// the account a closed VA is paid from (`POST /auth/add-bank-account`). The
// seam form has no file field; the operator's organization is enabled for
// file-less onboarding on the IDRX side.
export const idrxKyc = {
  terms: { url: "https://idrx.co/terms" },
  fields: [
    { name: "email", label: "Email", type: "email" },
    { name: "fullname", label: "Full name (as on your KTP)", type: "text" },
    { name: "idNumber", label: "KTP number (NIK)", type: "text" },
    { name: "address", label: "Address", type: "text" },
    { name: "bank", label: "Bank you will pay from", type: "select", options: ["Mandiri", "BRI"] },
    { name: "bankAccountNumber", label: "Bank account number", type: "text" },
  ],
} as const;

export const idrxManifest = {
  id: "idrx",
  displayName: "IDRX",
  docsUrl: "https://docs.idrx.co/",
  onramp: {
    apiOrigins: [IDRX_API_ORIGIN],
    redirectOrigins: [IDRX_CHECKOUT_ORIGIN],
    reference: "provider",
    // `mint-quote` returns the IDRX delivered and the itemized fees for the
    // chosen method before any order exists, so the quote review shows the
    // net amount instead of "Fees: Not yet available".
    quotes: true,
    kyc: idrxKyc,
  },
  bindings: [
    {
      region: "ID",
      assetId: "base:idrx",
      currency: "IDR",
      directions: {
        onramp: {
          paymentMethods: [...IDRX_VA_PAYMENT_METHODS, { id: "qris", label: "QRIS" }],
          env: IDRX_ENV,
        },
      },
    },
  ],
} as const satisfies FundingProviderManifest;

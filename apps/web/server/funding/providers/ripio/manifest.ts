import type { FundingProviderManifest } from "@/shared/funding/provider-contract";

export const RIPIO_API_ORIGIN = "https://skala.ripio.com" as const;

const kyc = {
  terms: { url: "https://www.ripio.com/terms" },
  fields: [
    { name: "email", label: "Email", type: "email" },
    { name: "firstName", label: "First name", type: "text" },
    { name: "lastName", label: "Last name", type: "text" },
    { name: "birthDate", label: "Date of birth", type: "date" },
    { name: "documentType", label: "Document type", type: "select", options: ["national-id", "passport"] },
    { name: "documentNumber", label: "Document number", type: "text" },
  ],
} as const;

export const ripioManifest = {
  id: "ripio",
  displayName: "Ripio",
  docsUrl: "https://docs.ripio.com/",
  bindings: [
    {
      region: "AR",
      assetId: "base:wars",
      paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }],
      env: ["RIPIO_CLIENT_ID_AR", "RIPIO_CLIENT_SECRET_AR", "RIPIO_WEBHOOK_SECRET"],
    },
    {
      region: "CO",
      assetId: "base:wcop",
      paymentMethods: [
        { id: "bank_transfer", label: "Bank transfer" },
        { id: "breb", label: "Bre-B" },
        { id: "r2p_bancolombia", label: "Bancolombia" },
        { id: "r2p_nequi", label: "Nequi" },
      ],
      env: ["RIPIO_CLIENT_ID_CO", "RIPIO_CLIENT_SECRET_CO", "RIPIO_WEBHOOK_SECRET"],
    },
  ],
  apiOrigins: [RIPIO_API_ORIGIN],
  redirectOrigins: [RIPIO_API_ORIGIN],
  reference: "home",
  quotes: true,
  kyc,
  webhook: { signatureHeader: "http-x-wh-signature-256", env: "RIPIO_WEBHOOK_SECRET" },
} as const satisfies FundingProviderManifest;

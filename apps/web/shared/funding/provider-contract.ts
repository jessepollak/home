import type { CountryCode } from "@/config/regions";
import type { FundingAsset } from "./assets";

export type FundingProviderManifest = {
  id: string;
  displayName: string;
  docsUrl: string;
  bindings: ReadonlyArray<{
    region: CountryCode;
    assetId: string;
    paymentMethods: ReadonlyArray<{ id: string; label: string }>;
    env: ReadonlyArray<string>;
  }>;
  apiOrigins: ReadonlyArray<string>;
  redirectOrigins?: ReadonlyArray<string>;
  reference: "home" | "provider";
  quotes?: boolean;
  kyc?: {
    terms?: { url: string };
    fields?: ReadonlyArray<{
      name: string;
      label: string;
      type: "text" | "email" | "date" | "select";
      options?: ReadonlyArray<string>;
    }>;
  };
  webhook?: { signatureHeader: string; env: string };
};

export type FundingProvider = {
  manifest: FundingProviderManifest;
  ensureCustomer?(
    input: { subject: string; fields: Record<string, string> },
    ctx: ProviderContext,
  ): Promise<{ customerRef: string }>;
  createQuote?(input: QuoteIntent, ctx: ProviderContext): Promise<Quote>;
  createOrder(input: OrderIntent, ctx: ProviderContext): Promise<CreateOrderResult>;
  getOrder(input: ReconciliationIntent, ctx: ProviderContext): Promise<Observation>;
  verifyWebhook?(
    raw: Uint8Array,
    headers: Headers,
    ctx: ProviderContext,
  ): { providerOrderId: string } | null;
};

export type ProviderContext = {
  binding: {
    region: CountryCode;
    asset: FundingAsset;
    paymentMethod: { id: string; label: string };
  };
  env: Readonly<Record<string, string>>;
  fetch: typeof fetch;
};

export type QuoteIntent = {
  destination: `0x${string}`;
  fiatAmount: string;
};

export type Quote = {
  providerQuoteId?: string;
  fiatAmount: string;
  tokenAmountAtomic: string;
  fees: Array<{ label: string; amount: string; currency: string }>;
  feesKnown?: boolean;
  expiresAt: string;
};

export type OrderIntent = {
  homeOrderId: string;
  destination: `0x${string}`;
  fiatAmount: string;
  quote?: Quote;
  customerRef?: string;
  returnUrl: string;
};

export type CreateOrderResult =
  | { outcome: "created"; order: ProviderOrder }
  | { outcome: "rejected"; message: string }
  | { outcome: "ambiguous" };

export type ReconciliationIntent = Readonly<{
  homeOrderId?: string;
  providerOrderId: string;
  providerQuoteId?: string;
  customerRef?: string;
  transactionType: "MINT";
  chainId: FundingAsset["chainId"];
  tokenAddress: `0x${string}`;
  destination: `0x${string}`;
  fiatAmount?: string;
  expectedTokenAmountAtomic: string;
  tokenDecimals: number;
}>;

export type ProviderOrder = {
  providerOrderId: string;
  tokenAddress: `0x${string}`;
  expectedTokenAmountAtomic: string;
  fees: Array<{ label: string; amount: string; currency: string }>;
  expiresAt: string | null;
  instructions: Instruction;
};

export type Instruction =
  | { kind: "redirect"; url: string }
  | {
      kind: "bank-transfer";
      rail: string;
      accountNumber: string;
      accountName?: string;
      bank?: string;
      alias?: string;
      reference?: string;
      amount: string;
      currency: string;
    }
  | {
      kind: "qr";
      scheme: "pix" | "qris" | "promptpay" | "other";
      payload: string;
      amount: string;
      currency: string;
    }
  | {
      kind: "payment-key";
      scheme: string;
      key: string;
      amount: string;
      currency: string;
    };

export type ReportedState =
  | "awaiting-payment"
  | "payment-received"
  | "settling"
  | "sent"
  | "expired"
  | "cancelled"
  | "failed"
  | "refunded"
  | "unknown";

export type Observation = {
  state: ReportedState;
  providerStatus: string;
  transactionHash?: `0x${string}` | null;
};

export type OrderState =
  | ReportedState
  | "reserving"
  | "dispatch-ambiguous"
  | "sent-unverified"
  | "received";

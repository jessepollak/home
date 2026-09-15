import type { CountryCode, FiatCurrencyCode } from "@/config/regions";
import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { FundingAsset } from "./assets";

export type FundingDirection = "onramp" | "offramp";
export type FundingPaymentMethod = { id: string; label: string };

export type FundingKycManifest = {
  terms?: { url: string };
  fields?: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "email" | "date" | "select";
    options?: ReadonlyArray<string>;
  }>;
};

export type FundingWebhookManifest = { signatureHeader: string; env: string };

export type FundingOfframpDeployment = {
  apiOrigins: ReadonlyArray<string>;
  contracts: {
    escrow: `0x${string}`;
    intentGuardian: `0x${string}`;
    intentGatingService: `0x${string}`;
    rateManager?: `0x${string}`;
  };
};

export type FundingProviderManifest = {
  id: string;
  displayName: string;
  docsUrl: string;
  onramp?: {
    modeEnv?: string;
    apiOrigins: ReadonlyArray<string>;
    redirectOrigins?: ReadonlyArray<string>;
    sandbox?: boolean;
    reference: "home" | "provider";
    quotes?: boolean;
    kyc?: FundingKycManifest;
    webhook?: FundingWebhookManifest;
  };
  offramp?: {
    modeEnv?: string;
    production: FundingOfframpDeployment;
    sandbox?: FundingOfframpDeployment;
  };
  bindings: ReadonlyArray<{
    region: CountryCode;
    assetId: string;
    currency: FiatCurrencyCode;
    directions: {
      onramp?: {
        paymentMethods: ReadonlyArray<FundingPaymentMethod>;
        env: ReadonlyArray<string>;
      };
      offramp?: {
        paymentMethods: ReadonlyArray<FundingPaymentMethod>;
        env: ReadonlyArray<string>;
        confirmedBy: string;
      };
    };
  }>;
};

export type FundingProvider = {
  manifest: FundingProviderManifest;
  onramp?: FundingOnrampProvider;
  offramp?: FundingOfframpProvider;
};

export type FundingOnrampProvider = {
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

export type OfframpCatalog = {
  platforms: ReadonlyArray<{
    id: string;
    label: string;
    currencies: ReadonlyArray<FiatCurrencyCode>;
    handleHint: string;
    minimumAmountAtomic: string;
    maximumAmountAtomic: string | null;
    estimateSemantics: "approximate";
    etaSemantics: "historical-not-guaranteed";
    requiresIdentityAttestation: boolean;
    requiresAccessPolicy: boolean;
  }>;
  asOf: string;
  maxAgeSeconds: number;
};

export type OfframpEstimate = {
  amountAtomic: string;
  currency: FiatCurrencyCode;
  approximateFiatAmount: string;
  minConversionRate: string;
  intentAmountRange: { min: string; max: string };
  etaSeconds: number | null;
  asOf: string;
};

export type OfframpOrderState =
  | "awaiting-buyer"
  | "matched"
  | "delivering"
  | "delivered"
  | "returned"
  | "unknown";

export type OfframpOrder = {
  depositId: string;
  owner: `0x${string}`;
  state: OfframpOrderState;
  platform: string;
  currency: FiatCurrencyCode;
  /** Onchain observations cannot recover the private payout handle. */
  canonicalHandle: string | null;
  payeeHash: `0x${string}`;
  amountAtomic: string;
  remainingAmountAtomic: string;
  nextActions: ReadonlyArray<"withdraw">;
  updatedAt: string;
};

export type OfframpReceipt = {
  logs: ReadonlyArray<{
    address: `0x${string}`;
    topics: ReadonlyArray<`0x${string}`>;
    data: `0x${string}`;
  }>;
};

export type FundingOfframpProvider = {
  capabilities(ctx: OfframpContext): Promise<OfframpCatalog>;
  estimate(
    input: { amountAtomic: bigint; platform: string; currency: FiatCurrencyCode },
    ctx: OfframpContext,
  ): Promise<OfframpEstimate>;
  prepareDeposit(
    input: {
      owner: `0x${string}`;
      amountAtomic: bigint;
      platform: string;
      currency: FiatCurrencyCode;
      payoutHandle: string;
    },
    ctx: OfframpContext,
  ): Promise<{
    depositCall: MoneyActionCall;
    payee: {
      hash: `0x${string}`;
      canonicalHandle: string;
      platform: string;
      currency: FiatCurrencyCode;
    };
    accessPolicyPaymentMethods: ReadonlyArray<string>;
    requiresIdentityAttestation: boolean;
  }>;
  prepareWithdraw(
    input: { owner: `0x${string}`; depositId: string },
    ctx: OfframpContext,
  ): Promise<{ calls: ReadonlyArray<MoneyActionCall> }>;
  readOrder(
    input: { owner: `0x${string}`; depositId: string },
    ctx: OfframpContext,
  ): Promise<OfframpOrder>;
  listOrders(
    input: { owner: `0x${string}`; inFlight?: boolean },
    ctx: OfframpContext,
  ): Promise<ReadonlyArray<OfframpOrder>>;
  depositIdFromReceipt(
    receipt: OfframpReceipt,
    input: { owner: `0x${string}`; escrow: `0x${string}` },
  ): string | null;
};

export type ProviderContext = {
  binding: {
    region: CountryCode;
    direction: FundingDirection;
    currency: FiatCurrencyCode;
    asset: FundingAsset;
    paymentMethod: FundingPaymentMethod;
    paymentMethods: ReadonlyArray<FundingPaymentMethod>;
  };
  env: Readonly<Record<string, string>>;
  sandbox: boolean;
  fetch: typeof fetch;
};

export type OfframpContext = ProviderContext & {
  binding: ProviderContext["binding"] & { direction: "offramp" };
  deployment: FundingOfframpDeployment;
};

export type QuoteIntent = {
  destination: `0x${string}`;
  fiatAmount: string;
  returnUrl: string;
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
  clientIp?: string;
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
      kind: "embed";
      url: string;
      presentation: "apple-pay";
      amount: string;
      currency: string;
    }
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

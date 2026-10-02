import type { CountryCode, FiatCurrencyCode } from "@/config/regions";
import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { FundingAsset } from "./assets";
import type { CashoutQuote } from "./cash-out-quote";
import type { FundingQuote } from "./contracts/quotes";

export type FundingDirection = "onramp" | "offramp";
export type FundingPaymentMethod = { id: string; label: string };
export const FUNDING_PAYMENT_METHOD_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export type FundingCustomerManifest = {
  handoffOrigins: ReadonlyArray<string>;
};

export type FundingWebhookManifest = {
  signatureHeader: string;
  env: string | Readonly<Partial<Record<CountryCode, string>>>;
};

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
    customer?: FundingCustomerManifest;
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
        legacyOfferedEnv?: string;
        minimumFiatAmount?: string;
      };
      offramp?: {
        paymentMethods: ReadonlyArray<FundingPaymentMethod>;
        env: ReadonlyArray<string>;
        legacyOfferedEnv?: string;
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

export type FundingCustomerStatus = "pending" | "verified" | "rejected";

export type FundingOnrampProvider = {
  customer?: {
    create(
      input: { email: string },
      ctx: ProviderContext,
    ): Promise<
      | { outcome: "created"; customerRef: string }
      | { outcome: "rejected" }
      | { outcome: "ambiguous" }
    >;
    startVerification(
      input: { customerRef: string; clientIp?: string; redirectUrl: string },
      ctx: ProviderContext,
    ): Promise<
      | { outcome: "created"; providerUrl: string }
      | { outcome: "rejected" }
      | { outcome: "ambiguous" }
    >;
    getStatus(
      input: { customerRef: string },
      ctx: ProviderContext,
    ): Promise<FundingCustomerStatus>;
  };
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
  quote: CashoutQuote;
  minConversionRate: string;
  intentAmountRange: { min: string; max: string };
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
  canonicalHandle: string | null;
  payeeHash: `0x${string}`;
  amountAtomic: string;
  filledAmountAtomic: string;
  returnedAmountAtomic: string;
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
  payeeHash(
    input: { platform: string; currency: string; canonicalHandle: string },
    ctx: OfframpContext,
  ): Promise<`0x${string}`>;
  prepareWithdraw(
    input: { owner: `0x${string}`; depositId: string },
    ctx: OfframpContext,
  ): Promise<{ calls: ReadonlyArray<MoneyActionCall> }>;
  readOrder(
    input: { owner: `0x${string}`; depositId: string },
    ctx: OfframpContext,
  ): Promise<OfframpOrder>;
  listOrders(
    input: { owner: `0x${string}`; inFlight?: boolean; onMalformedPayee: "throw" | "skip" },
    ctx: OfframpContext,
  ): Promise<ReadonlyArray<OfframpOrder>>;
  depositIdFromReceipt(
    receipt: OfframpReceipt,
    input: { owner: `0x${string}`; escrow: `0x${string}`; amountAtomic: string; intentAmountRange: { min: string; max: string } },
  ): string | null;
  withdrawnAmountFromReceipt(receipt: OfframpReceipt, input: { owner: `0x${string}`; depositId: string }): string | null;
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
  customerRef?: string;
};

export type Quote = FundingQuote;

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

export function isFundingInstruction(value: unknown): value is Instruction {
  if (!isRecord(value)) return false;
  const instruction = value;
  switch (instruction.kind) {
    case "redirect":
      return typeof instruction.url === "string";
    case "embed":
      return typeof instruction.url === "string" && instruction.presentation === "apple-pay" &&
        typeof instruction.amount === "string" && typeof instruction.currency === "string";
    case "bank-transfer":
      return typeof instruction.rail === "string" && typeof instruction.accountNumber === "string" &&
        typeof instruction.amount === "string" && typeof instruction.currency === "string" &&
        ["accountName", "bank", "alias", "reference"].every((key) => !Object.hasOwn(instruction, key) || typeof instruction[key] === "string");
    case "qr":
      return (instruction.scheme === "pix" || instruction.scheme === "qris" ||
        instruction.scheme === "promptpay" || instruction.scheme === "other") &&
        typeof instruction.payload === "string" && typeof instruction.amount === "string" && typeof instruction.currency === "string";
    case "payment-key":
      return typeof instruction.scheme === "string" && typeof instruction.key === "string" &&
        typeof instruction.amount === "string" && typeof instruction.currency === "string";
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  settledTokenAmountAtomic?: string;
  fees?: Quote["fees"];
};

export type OrderState =
  | ReportedState
  | "reserving"
  | "dispatch-ambiguous"
  | "sent-unverified"
  | "received";

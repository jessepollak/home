import { isFundingInstruction, type Instruction, type OrderState, type Quote } from "@/shared/funding/provider-contract";
export type {
  Instruction,
} from "@/shared/funding/provider-contract";

export type FundingOrderSummary = {
  id: string;
  providerId: string;
  region?: string;
  assetId?: string;
  paymentMethod?: string;
  state: OrderState | string;
  fiatAmount: string;
  quote?: Quote;
  quoteToken?: string;
  sandbox?: boolean;
  expectedTokenAmountAtomic?: string | null;
  fees?: ReadonlyArray<{ label: string; amount: string; currency: string }>;
  expiresAt?: string | null;
  providerStatus: string | null;
  instructions: Instruction | null;
  transactionHash?: `0x${string}` | null;
  createdAt?: string;
  updatedAt?: string;
  abandonReason?: "owner" | "timed-out" | null;
};
const fiatAmountPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const atomicAmountPattern = /^(?:0|[1-9][0-9]*)$/;
export function isFundingOrderSummary(value: unknown): value is FundingOrderSummary {
  return record(value) && typeof value.id === "string" && typeof value.providerId === "string" && typeof value.state === "string" &&
    typeof value.fiatAmount === "string" && fiatAmountPattern.test(value.fiatAmount) &&
    (value.providerStatus === null || typeof value.providerStatus === "string") &&
    (value.instructions === null || isFundingInstruction(value.instructions)) &&
    ["region", "assetId", "paymentMethod", "quoteToken", "createdAt", "updatedAt"].every((key) => optionalString(value, key)) &&
    optional(value, "quote", isFundingQuote) &&
    optional(value, "sandbox", (sandbox) => typeof sandbox === "boolean") &&
    optional(value, "expectedTokenAmountAtomic", (amount) => amount === null || (typeof amount === "string" && atomicAmountPattern.test(amount))) &&
    optional(value, "fees", isFundingFees) &&
    optional(value, "expiresAt", (expiresAt) => expiresAt === null || typeof expiresAt === "string") &&
    optional(value, "abandonReason", (reason) => reason === null || reason === "owner" || reason === "timed-out") &&
    optional(value, "transactionHash", (hash) => hash === null || (typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)));
}
export function readFundingOrder(value: unknown): FundingOrderSummary | null {
  const candidate = record(value) && record(value.order) ? value.order : null;
  return isFundingOrderSummary(candidate) ? candidate : null;
}
function isFundingQuote(value: unknown): boolean {
  return record(value) &&
    (!Object.hasOwn(value, "providerQuoteId") || typeof value.providerQuoteId === "string") &&
    (!Object.hasOwn(value, "feesKnown") || typeof value.feesKnown === "boolean") &&
    typeof value.fiatAmount === "string" &&
    typeof value.tokenAmountAtomic === "string" &&
    typeof value.expiresAt === "string" &&
    isFundingFees(value.fees);
}

function isFundingFees(value: unknown): boolean {
  return Array.isArray(value) && value.every((fee) => record(fee) && typeof fee.label === "string" && typeof fee.amount === "string" && typeof fee.currency === "string");
}

function optionalString(value: Record<string, unknown>, key: string): boolean {
  return optional(value, key, (field) => typeof field === "string");
}

function optional(value: Record<string, unknown>, key: string, valid: (field: unknown) => boolean): boolean {
  return value[key] === undefined || valid(value[key]);
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

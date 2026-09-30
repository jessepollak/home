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
};
const fiatAmountPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
export function isFundingOrderSummary(value: unknown): value is FundingOrderSummary {
  return record(value) && typeof value.id === "string" && typeof value.providerId === "string" && typeof value.state === "string" &&
    typeof value.fiatAmount === "string" && fiatAmountPattern.test(value.fiatAmount) &&
    (value.providerStatus === null || typeof value.providerStatus === "string") &&
    (value.instructions === null || isFundingInstruction(value.instructions));
}
export function readFundingOrder(value: unknown): FundingOrderSummary | null {
  const candidate = record(value) && record(value.order) ? value.order : null;
  return isFundingOrderSummary(candidate) ? candidate : null;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

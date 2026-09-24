import type { FundingOrderSummary } from "@/shared/funding/contracts/order";

export function shouldPollFundingOrder(
  order: Pick<FundingOrderSummary, "state" | "sandbox"> | null | undefined,
) {
  return Boolean(order && !isTerminalFundingOrderState(order.state, order.sandbox));
}

export function isTerminalFundingOrderState(state: string, sandbox = false) {
  return (sandbox && state === "sent-unverified") || [
    "received",
    "dispatch-ambiguous",
    "failed",
    "cancelled",
    "expired",
    "refunded",
  ].includes(state);
}

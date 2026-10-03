import "server-only";
import { parseHash32 } from "@/shared/chain/hex";

import type { ActivityCashoutOrder, ActivityFundingOrder, ActivityFundingOrderStage, ActivityOrderStatus } from "@/shared/activity/contract-orders";
import { getFundingAsset } from "@/shared/funding/assets";
import type { CashoutOrderRow } from "@/server/actions/store";
import type { FundingOrder } from "@/server/funding/core/store";
import { ambiguousOrderRecoveryAvailableAt } from "@/server/funding/core/service";
import { getFundingProvider } from "@/server/funding/providers";
import { checkoutDeadline } from "@/shared/funding/checkout-deadline";

function fundingStatus(order: FundingOrder, now: Date): { status: ActivityOrderStatus; stage: ActivityFundingOrderStage } {
  switch (order.state) {
    case "reserving":
    case "unknown":
    case "dispatch-ambiguous": return { status: "ambiguous", stage: "unconfirmed" };
    case "awaiting-payment":
      return checkoutDeadline(order) <= now.getTime()
        ? { status: "expired", stage: "expired" }
        : { status: "waiting-customer", stage: "awaiting-payment" };
    case "payment-received":
    case "settling": return { status: "waiting-provider", stage: "provider-processing" };
    case "sent":
    case "sent-unverified": return order.sandbox
      ? { status: "confirmed", stage: "received" }
      : { status: "waiting-chain", stage: "arriving" };
    case "received": return { status: "confirmed", stage: "received" };
    case "expired": return { status: "expired", stage: "expired" };
    case "abandoned": return order.abandonReason === "timed-out"
      ? { status: "expired", stage: "expired" }
      : { status: "failed", stage: "cancelled" };
    case "cancelled": return { status: "failed", stage: order.providerOrderId === null ? "cleared" : "cancelled" };
    case "failed": return { status: "failed", stage: "failed" };
    case "refunded": return { status: "refunded", stage: "refunded" };
  }
}

export function presentFundingOrder(order: FundingOrder, now: Date, resumable: boolean): ActivityFundingOrder | null {
  const asset = getFundingAsset(order.assetId);
  if (!asset) return null;
  const provider = getFundingProvider(order.providerId);
  const binding = provider?.manifest.bindings.find((candidate) => candidate.region === order.region && candidate.assetId === order.assetId && candidate.directions.onramp?.paymentMethods.some((method) => method.id === order.paymentMethod));
  let clearableAt: string | null = null;
  if (order.state === "dispatch-ambiguous") {
    try {
      clearableAt = ambiguousOrderRecoveryAvailableAt(order).toISOString();
    } catch {
      clearableAt = null;
    }
  }
  const transactionHash = order.transactionHash === null ? null : parseHash32(order.transactionHash);
  if (order.transactionHash !== null && !transactionHash) return null;
  return {
    kind: "funding", id: order.id, region: order.region,
    providerId: order.providerId, providerName: provider?.manifest.displayName ?? order.providerId,
    paymentMethodLabel: binding?.directions.onramp?.paymentMethods.find((method) => method.id === order.paymentMethod)?.label ?? order.paymentMethod,
    ...fundingStatus(order, now), instruction: order.instructions?.kind ?? null, resumable,
    ...(order.state === "abandoned" && order.abandonReason ? { abandonReason: order.abandonReason } : {}),
    fiatAmount: order.fiatAmount, fiatCurrency: binding?.currency ?? asset.fiatCurrency,
    asset: { id: asset.id, symbol: asset.symbol, decimals: asset.decimals },
    tokenAmountAtomic: order.expectedTokenAmountAtomic ?? order.quote.tokenAmountAtomic ?? null,
    sandbox: order.sandbox, expiresAt: order.expiresAt, clearableAt,
    transactionHash, logIndex: order.logIndex === null ? null : String(order.logIndex),
    createdAt: order.createdAt, updatedAt: order.updatedAt,
    movedAt: fundingOrderActivityTime(order),
  };
}

function fundingOrderActivityTime(order: FundingOrder): string {
  return ["reserving", "awaiting-payment", "unknown", "dispatch-ambiguous"].includes(order.state) ? order.createdAt : order.updatedAt;
}

function cashoutStatus(row: CashoutOrderRow): ActivityOrderStatus {
  switch (row.state) {
    case "submitted":
    case "awaiting-buyer":
    case "matched":
    case "delivering": return "waiting-provider";
    case "delivered": return "confirmed";
    case "returned": return row.settled_at ? "refunded" : row.withdrawable && BigInt(row.remaining_atomic) > BigInt(0) ? "reversed" : "waiting-chain";
    case "failed": return !row.settled_at && row.withdrawable && BigInt(row.remaining_atomic) > BigInt(0) ? "reversed" : "failed";
    case "unknown": return "ambiguous";
  }
}

export function presentCashoutOrder(row: CashoutOrderRow): ActivityCashoutOrder {
  return {
    kind: "cash-out", id: row.action_id, orderId: row.deposit_id,
    region: row.region, providerId: row.provider_id,
    providerName: getFundingProvider(row.provider_id)?.manifest.displayName ?? row.provider_id,
    platform: row.platform, platformLabel: row.platform_label,
    status: cashoutStatus(row), state: row.state, decimals: 6,
    amountAtomic: row.amount_atomic, filledAtomic: row.filled_atomic,
    returnedAtomic: row.returned_atomic, remainingAtomic: row.remaining_atomic,
    withdrawable: row.withdrawable,
    settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

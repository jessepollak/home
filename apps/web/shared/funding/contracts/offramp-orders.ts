// Route contract.
// GET /api/funding/offramp/orders?providerId=peer&region=US&inFlight=1

export const OFFRAMP_ORDERS_VERSION = 1 as const;

export type CashoutOrderSummary = {
  depositId: string;
  state: string;
  platform: string;
  currency: string;
  canonicalHandle: string | null;
  amountAtomic: string;
  remainingAmountAtomic: string;
  nextActions: ReadonlyArray<"withdraw">;
};

export type OfframpOrdersResponse = {
  version: typeof OFFRAMP_ORDERS_VERSION;
  orders: ReadonlyArray<CashoutOrderSummary>;
};

export function readCashoutOrders(value: unknown): ReadonlyArray<CashoutOrderSummary> {
  if (!isRecord(value) || value.version !== OFFRAMP_ORDERS_VERSION || !Array.isArray(value.orders)) return [];
  const parsed: CashoutOrderSummary[] = [];
  for (const item of value.orders) {
    if (!isRecord(item) || typeof item.depositId !== "string" || typeof item.state !== "string" ||
      typeof item.platform !== "string" || typeof item.currency !== "string" ||
      !(item.canonicalHandle === null || typeof item.canonicalHandle === "string") ||
      typeof item.amountAtomic !== "string" || typeof item.remainingAmountAtomic !== "string" ||
      !Array.isArray(item.nextActions) || !item.nextActions.every((action) => action === "withdraw")) continue;
    parsed.push({
      depositId: item.depositId,
      state: item.state,
      platform: item.platform,
      currency: item.currency,
      canonicalHandle: item.canonicalHandle,
      amountAtomic: item.amountAtomic,
      remainingAmountAtomic: item.remainingAmountAtomic,
      nextActions: item.nextActions,
    });
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

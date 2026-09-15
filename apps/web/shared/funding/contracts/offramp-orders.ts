// Private route contract.
// GET /api/funding/offramp/orders?region=US&inFlight=1[&providerId=peer]

export const OFFRAMP_ORDERS_VERSION = 2 as const;

export type CashoutOrderSummary = {
  providerId: string;
  providerName: string;
  assetId: string;
  assetSymbol: string;
  assetDecimals: number;
  depositId: string;
  state: string;
  platform: string;
  platformLabel: string;
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
    if (!isRecord(item) || typeof item.providerId !== "string" || typeof item.providerName !== "string" ||
      typeof item.assetId !== "string" || typeof item.assetSymbol !== "string" || !Number.isSafeInteger(item.assetDecimals) ||
      typeof item.depositId !== "string" || typeof item.state !== "string" ||
      typeof item.platform !== "string" || typeof item.platformLabel !== "string" || typeof item.currency !== "string" ||
      !(item.canonicalHandle === null || typeof item.canonicalHandle === "string") ||
      typeof item.amountAtomic !== "string" || typeof item.remainingAmountAtomic !== "string" ||
      !Array.isArray(item.nextActions) || !item.nextActions.every((action) => action === "withdraw")) continue;
    parsed.push({
      providerId: item.providerId,
      providerName: item.providerName,
      assetId: item.assetId,
      assetSymbol: item.assetSymbol,
      assetDecimals: item.assetDecimals as number,
      depositId: item.depositId,
      state: item.state,
      platform: item.platform,
      platformLabel: item.platformLabel,
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

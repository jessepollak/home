export const CARD_PURCHASES_VERSION = 1 as const;

export type CardPurchase = Readonly<{
  id: string;
  kind: "authorization" | "transaction";
  amountMinor: string;
  currency: string;
  merchantName: string;
  merchantCategory: string | null;
  status: "pending" | "declined" | "completed" | "reversed" | "refunded";
  declineReasonCode: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CardPurchases = Readonly<{ version: typeof CARD_PURCHASES_VERSION; status: "ready" | "unavailable"; rows: CardPurchase[] }>;

export function parseCardPurchases(value: unknown): CardPurchases {
  if (!record(value) || value.version !== CARD_PURCHASES_VERSION || (value.status !== "ready" && value.status !== "unavailable") ||
      !Array.isArray(value.rows) || value.rows.length > 50) throw new Error("Invalid card purchases");
  return { version: CARD_PURCHASES_VERSION, status: value.status, rows: value.rows.map((row: unknown) => {
    if (!record(row) || typeof row.id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.id) ||
        typeof row.kind !== "string" || !["authorization", "transaction"].includes(row.kind) ||
        typeof row.amountMinor !== "string" || !/^(?:0|[1-9]\d{0,15})$/.test(row.amountMinor) ||
        typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency) ||
        typeof row.merchantName !== "string" || row.merchantName.length === 0 || row.merchantName.length > 120 ||
        !(row.merchantCategory === null || typeof row.merchantCategory === "string" && row.merchantCategory.length <= 80) ||
        typeof row.status !== "string" || !["pending", "declined", "completed", "reversed", "refunded"].includes(row.status) ||
        !(row.declineReasonCode === null || typeof row.declineReasonCode === "string" && /^[a-z_]{1,64}$/.test(row.declineReasonCode)) ||
        !timestamp(row.createdAt) || !timestamp(row.updatedAt)) throw new Error("Invalid card purchase");
    return row as CardPurchase;
  }) };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

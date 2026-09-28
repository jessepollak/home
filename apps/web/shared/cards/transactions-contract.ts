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

export type CardPurchases = Readonly<{ status: "ready" | "unavailable"; rows: CardPurchase[] }>;

export function parseCardPurchases(value: unknown): CardPurchases {
  if (!record(value) || (value.status !== "ready" && value.status !== "unavailable") ||
      !Array.isArray(value.rows) || value.rows.length > 50) throw new Error("Invalid card purchases");
  return { status: value.status, rows: value.rows.map((row: unknown) => {
    if (!record(row) || typeof row.id !== "string" || !/^(?:iauth_|ipi_|itx_)[A-Za-z0-9_]+$/.test(row.id) ||
        !["authorization", "transaction"].includes(String(row.kind)) ||
        typeof row.amountMinor !== "string" || !/^(?:0|[1-9]\d{0,15})$/.test(row.amountMinor) ||
        typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency) ||
        typeof row.merchantName !== "string" || row.merchantName.length === 0 || row.merchantName.length > 120 ||
        !(row.merchantCategory === null || typeof row.merchantCategory === "string" && row.merchantCategory.length <= 80) ||
        !["pending", "declined", "completed", "reversed", "refunded"].includes(String(row.status)) ||
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

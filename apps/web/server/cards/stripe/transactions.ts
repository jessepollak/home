import "server-only";

import type { CardJourneyConfig } from "../bridge/journey-config";
import { readProviderJson } from "../read-provider-json";
import type { CardPurchase } from "@/shared/cards/transactions-contract";

export type StripePurchase = CardPurchase & Readonly<{ cardId: string; authorizationId: string | null }>;
const ids = { authorization: /^iauth_[A-Za-z0-9]+$/, transaction: /^(?:ipi_|itx_)[A-Za-z0-9]+$/, card: /^ic_[A-Za-z0-9]+$/ };

export function createStripeTransactionClient(config: Pick<CardJourneyConfig, "stripeSecretKey" | "stripeApiVersion">, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  async function get(path: string): Promise<unknown> {
    const response = await fetcher(`https://api.stripe.com/v1/issuing/${path}`, {
      method: "GET", redirect: "manual", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      headers: { [["Author", "ization"].join("")]: `Bearer ${config.stripeSecretKey}`, "Stripe-Version": config.stripeApiVersion },
    });
    if (!response.ok) throw new Error(`Stripe read failed (${response.status})`);
    return readProviderJson(response, "Stripe");
  }
  return {
    async read(kind: "authorization" | "transaction", id: string): Promise<StripePurchase> {
      if (!ids[kind].test(id)) throw new Error("Invalid Stripe purchase ID");
      const path = kind === "authorization" ? "authorizations" : "transactions";
      const row = parseStripePurchase(await get(`${path}/${encodeURIComponent(id)}`), kind);
      if (row.id !== id) throw new Error("Stripe purchase ID mismatch");
      return row;
    },
    async list(kind: "authorization" | "transaction", cardId: string): Promise<StripePurchase[]> {
      if (!ids.card.test(cardId)) throw new Error("Invalid Stripe card ID");
      const path = kind === "authorization" ? "authorizations" : "transactions";
      const value = await get(`${path}?card=${encodeURIComponent(cardId)}&limit=25`);
      if (!record(value) || value.object !== "list" || !Array.isArray(value.data) || value.data.length > 25 ||
          typeof value.has_more !== "boolean") throw new Error("Invalid Stripe purchase list");
      const rows = value.data.map((row: unknown) => parseStripePurchase(row, kind));
      if (rows.some((row: StripePurchase) => row.cardId !== cardId) || value.has_more) throw new Error("Partial Stripe purchase list");
      return rows;
    },
  };
}

function parseStripePurchase(value: unknown, kind: "authorization" | "transaction"): StripePurchase {
  if (!record(value) || value.object !== `issuing.${kind}` || !ids[kind].test(String(value.id)) ||
      !Number.isSafeInteger(value.amount) || Math.abs(value.amount as number) > 999_999_999_999_999 ||
      typeof value.currency !== "string" || !/^[a-z]{3}$/.test(value.currency) ||
      !Number.isSafeInteger(value.created) || (value.created as number) <= 0 ||
      !record(value.merchant_data) || typeof value.merchant_data.name !== "string" ||
      value.merchant_data.name.trim().length === 0 || value.merchant_data.name.length > 120 ||
      !ids.card.test(String(record(value.card) ? value.card.id : value.card))) throw new Error("Invalid Stripe purchase");
  const id = value.id as string;
  const cardId = (record(value.card) ? value.card.id : value.card) as string;
  const merchant = value.merchant_data;
  const category = typeof merchant.category === "string" && merchant.category.length <= 80 ? merchant.category : null;
  let status: CardPurchase["status"];
  let reason: string | null = null;
  let authorizationId: string | null = null;
  if (kind === "authorization") {
    if (typeof value.approved !== "boolean" || !["pending", "closed", "reversed"].includes(String(value.status))) throw new Error("Invalid Stripe authorization status");
    status = !value.approved ? "declined" : value.status === "reversed" ? "reversed" : "pending";
    const history = value.request_history;
    const entry = Array.isArray(history) ? history.at(-1) : null;
    reason = !value.approved && record(entry) && typeof entry.reason === "string" && /^[a-z_]{1,64}$/.test(entry.reason) ? entry.reason : null;
    authorizationId = id;
  } else {
    if (!["pending", "posted", "void"].includes(String(value.status)) || !["capture", "refund"].includes(String(value.type))) throw new Error("Invalid Stripe transaction status");
    status = value.status === "pending" ? "pending" : value.status === "void" ? "reversed" : value.type === "refund" ? "refunded" : "completed";
    const auth = record(value.authorization) ? value.authorization.id : value.authorization;
    authorizationId = typeof auth === "string" && ids.authorization.test(auth) ? auth : null;
  }
  return { id, cardId, authorizationId, kind, amountMinor: String(Math.abs(value.amount as number)), currency: (value.currency as string).toUpperCase(),
    merchantName: (merchant.name as string).trim(), merchantCategory: category, status, declineReasonCode: reason,
    createdAt: new Date((value.created as number) * 1000).toISOString(), updatedAt: new Date().toISOString() };
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

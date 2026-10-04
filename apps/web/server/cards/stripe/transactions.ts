import "server-only";

import { isRecord as record, isStringEnum, matchesId } from "../response-guards";
import { parseCardPurchases, CARD_PURCHASES_VERSION } from "@/shared/cards/transactions-contract";
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
    async list(kind: "authorization" | "transaction", cardId: string, from: number): Promise<{ rows: StripePurchase[]; partial: boolean }> {
      if (!ids.card.test(cardId) || !Number.isSafeInteger(from) || from < 0) throw new Error("Invalid Stripe purchase list filter");
      const path = kind === "authorization" ? "authorizations" : "transactions";
      const rows: StripePurchase[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page++) {
        const params = new URLSearchParams({ card: cardId, limit: "25", "created[gte]": String(from) });
        if (cursor) params.set("starting_after", cursor);
        const value = await get(`${path}?${params}`);
        if (!record(value) || value.object !== "list" || !Array.isArray(value.data) || value.data.length > 25 ||
            typeof value.has_more !== "boolean") throw new Error("Invalid Stripe purchase list");
        const next = value.data.map((row: unknown) => parseStripePurchase(row, kind));
        if (next.some((row) => row.cardId !== cardId)) throw new Error("Partial Stripe purchase list");
        rows.push(...next);
        if (!value.has_more) return { rows, partial: false };
        const last = next.at(-1)?.id;
        if (!last || last === cursor) throw new Error("Invalid Stripe purchase pagination");
        cursor = last;
      }
      return { rows, partial: true };
    },
  };
}

function parseStripePurchase(value: unknown, kind: "authorization" | "transaction"): StripePurchase {
  if (!record(value) || value.object !== `issuing.${kind}` || !matchesId(value.id, ids[kind]) ||
      typeof value.amount !== "number" || !Number.isSafeInteger(value.amount) || Math.abs(value.amount) > 999_999_999_999_999 ||
      typeof value.currency !== "string" || !/^[a-z]{3}$/.test(value.currency) ||
      typeof value.created !== "number" || !Number.isSafeInteger(value.created) || value.created <= 0 ||
      !record(value.merchant_data) || typeof value.merchant_data.name !== "string" ||
      value.merchant_data.name.trim().length === 0 || value.merchant_data.name.length > 120 ||
      !matchesId(record(value.card) ? value.card.id : value.card, ids.card)) throw new Error("Invalid Stripe purchase");
  const id = value.id;
  const cardId = record(value.card) ? value.card.id : value.card;
  if (!matchesId(cardId, ids.card)) throw new Error("Invalid Stripe purchase");
  const merchant = value.merchant_data;
  const merchantName = merchant.name;
  if (typeof merchantName !== "string") throw new Error("Invalid Stripe purchase");
  const category = typeof merchant.category === "string" && merchant.category.length <= 80 ? merchant.category : null;
  let status: CardPurchase["status"];
  let reason: string | null = null;
  let authorizationId: string | null = null;
  if (kind === "authorization") {
    if (typeof value.approved !== "boolean" || !isStringEnum(value.status, ["pending", "closed", "reversed"])) throw new Error("Invalid Stripe authorization status");
    status = !value.approved ? "declined" : value.status === "reversed" ? "reversed" : "pending";
    const history = value.request_history;
    const entry: unknown = Array.isArray(history) ? history.at(-1) : null;
    reason = !value.approved && record(entry) && typeof entry.reason === "string" && /^[a-z_]{1,64}$/.test(entry.reason) ? entry.reason : null;
    authorizationId = id;
  } else {
    if (!isStringEnum(value.status, ["pending", "posted", "void"]) || !isStringEnum(value.type, ["capture", "refund"])) throw new Error("Invalid Stripe transaction status");
    status = value.status === "pending" ? "pending" : value.status === "void" ? "reversed" : value.type === "refund" ? "refunded" : "completed";
    const auth = record(value.authorization) ? value.authorization.id : value.authorization;
    authorizationId = typeof auth === "string" && ids.authorization.test(auth) ? auth : null;
  }
  return { id, cardId, authorizationId, kind, amountMinor: String(Math.abs(value.amount)), currency: value.currency.toUpperCase(),
    merchantName: merchantName.trim(), merchantCategory: category, status, declineReasonCode: reason,
    createdAt: new Date(value.created * 1000).toISOString(), updatedAt: new Date().toISOString() };
}

export function isStripePurchase(value: unknown): value is StripePurchase {
  if (!record(value) || typeof value.cardId !== "string" || !ids.card.test(value.cardId) ||
      !(value.authorizationId === null || typeof value.authorizationId === "string" && ids.authorization.test(value.authorizationId))) return false;
  try {
    parseCardPurchases({ version: CARD_PURCHASES_VERSION, status: "ready", rows: [value] });
    return true;
  } catch { return false; }
}

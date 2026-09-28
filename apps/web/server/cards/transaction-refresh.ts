import "server-only";

import type { CardMode, CardObservation } from "./provider";
import type { CardPurchases } from "@/shared/cards/transactions-contract";
import type { StripePurchase } from "./stripe/transactions";
import { createCardTransactionStore } from "./transaction-store";
import { createStripeTransactionClient } from "./stripe/transactions";
import { readCardJourneyConfig } from "./bridge/journey-config";
import { getSqlExecutor } from "@/server/db/sql";

type Store = ReturnType<typeof createCardTransactionStore>;
type Client = ReturnType<typeof createStripeTransactionClient>;

export async function refreshCardPurchases(customerId: string, mode: CardMode, store: Store, client: Client, window?: { from: string; to: string }): Promise<CardPurchases> {
  const cards = await store.cards(customerId, mode);
  let status: CardPurchases["status"] = cards.length > 2 ? "unavailable" : "ready";
  for (const card of cards.slice(0, 2)) {
    try {
      const pending = await store.pending(card.id, mode);
      if (pending.length > 10) status = "unavailable";
      const from = Math.floor((window ? Date.parse(window.from) : Date.now() - 31 * 24 * 60 * 60 * 1000) / 1000);
      const fresh = await Promise.allSettled([
        ...pending.slice(0, 10).map((item) => client.read(item.kind.startsWith("issuing_authorization.") ? "authorization" : "transaction", item.transaction_id)),
        client.list("authorization", card.stripe_card_id, from), client.list("transaction", card.stripe_card_id, from),
      ]);
      const unique = new Map<string, StripePurchase>();
      const failedTargetIds = new Set<string>();
      let writes = 0;
      for (const [index, result] of fresh.slice(0, Math.min(pending.length, 10)).entries()) {
        if (result.status === "rejected") { status = "unavailable"; failedTargetIds.add(pending[index]!.transaction_id); continue; }
        const purchase = result.value as StripePurchase;
        if (purchase.cardId !== card.stripe_card_id) { status = "unavailable"; failedTargetIds.add(pending[index]!.transaction_id); continue; }
        try {
          await store.upsert(card.id, mode, purchase);
          unique.set(purchase.id, purchase);
          writes++;
        } catch { status = "unavailable"; failedTargetIds.add(pending[index]!.transaction_id); }
      }
      const listed: StripePurchase[] = [];
      for (const result of fresh.slice(Math.min(pending.length, 10))) {
        if (result.status === "rejected") { status = "unavailable"; continue; }
        const list = result.value as { rows: StripePurchase[]; partial: boolean };
        if (list.partial) status = "unavailable";
        listed.push(...list.rows);
      }
      listed.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.kind.localeCompare(left.kind));
      for (const purchase of listed) {
        if (purchase.cardId !== card.stripe_card_id) { status = "unavailable"; continue; }
        if (failedTargetIds.has(purchase.id) || unique.has(purchase.id)) continue;
        if (writes >= 25) { status = "unavailable"; continue; }
        try {
          await store.upsert(card.id, mode, purchase);
          unique.set(purchase.id, purchase);
          writes++;
        } catch { status = "unavailable"; }
      }
    } catch {
      status = "unavailable";
    }
  }
  return { status, rows: await store.rows(customerId, mode, window) };
}

export async function refreshObservedCardEvent(event: CardObservation): Promise<void> {
  if (event.provider !== "bridge" || !event.externalIds.card || !event.externalIds.transaction ||
      !(event.kind.startsWith("issuing_authorization.") || event.kind.startsWith("issuing_transaction."))) return;
  const config = readCardJourneyConfig();
  if (!config || config.mode !== event.mode) return;
  const sql = getSqlExecutor();
  const card = await sql.query<{ id: string }>(
    "SELECT id FROM cards WHERE mode=$1 AND stripe_card_id=$2", [event.mode, event.externalIds.card]);
  if (!card.rows[0]) return;
  const kind = event.kind.startsWith("issuing_authorization.") ? "authorization" : "transaction";
  const purchase = await createStripeTransactionClient(config).read(kind, event.externalIds.transaction);
  if (purchase.cardId !== event.externalIds.card) throw new Error("Stripe purchase card mismatch");
  await createCardTransactionStore(sql).upsert(card.rows[0].id, event.mode, purchase);
}

export async function readActivityCardPurchases(customerId: string | null, window: { from: string; to: string }): Promise<CardPurchases> {
  const config = readCardJourneyConfig();
  if (!config) return { status: "ready", rows: [] };
  if (!process.env.DATABASE_URL?.trim()) throw new Error("Card transaction store is unavailable");
  if (!customerId) return { status: "ready", rows: [] };
  return refreshCardPurchases(customerId, config.mode, createCardTransactionStore(getSqlExecutor()),
    createStripeTransactionClient(config, fetch, AbortSignal.timeout(8_000)), window);
}

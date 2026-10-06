import "server-only";

import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor } from "@/server/db/sql";
import { CARD_PURCHASES_VERSION, type CardPurchases } from "@/shared/cards/transactions-contract";
import { isRecord } from "./response-guards";
import { isProgramPurchase } from "./purchases";
import type { CardMode, CardObservation } from "./provider";
import type { CardProgram, ProgramPurchase } from "./program";
import { createCardTransactionStore } from "./transaction-store";
import { readCardPrograms } from "./programs";

type Store = ReturnType<typeof createCardTransactionStore>;
export async function refreshCardPurchases(customerId: string, mode: CardMode, store: Store, program: CardProgram | null, window?: { from: string; to: string }): Promise<CardPurchases> {
  const cards = await store.cards(customerId, mode);
  const signal = AbortSignal.timeout(8_000);
  let status: CardPurchases["status"] = cards.length > 2 || !program && cards.length > 0 ? "unavailable" : "ready";
  for (const card of cards.slice(0, 2)) {
    try {
      if (!program || program.provider !== card.provider || program.mode !== mode) { status = "unavailable"; continue; }
      const pending = (await store.pending(card.id, mode)).flatMap((event) => {
        const ref = program.purchases.refFor(event); return ref ? [ref] : [];
      });
      if (pending.length > 10) status = "unavailable";
      const since = new Date(window ? window.from : Date.now() - 31 * 24 * 60 * 60 * 1000);
      const fresh = await Promise.allSettled([
        ...pending.slice(0, 10).map((ref) => program.purchases.read(ref, signal)), program.purchases.list(card.provider_card_id, since, signal),
      ]);
      const unique = new Map<string, ProgramPurchase>();
      const failedTargetIds = new Set<string>();
      let writes = 0;
      for (const [index, result] of fresh.slice(0, Math.min(pending.length, 10)).entries()) {
        const target = pending[index];
        if (!target) { status = "unavailable"; continue; }
        if (result.status === "rejected" || !isProgramPurchase(result.value) || result.value.id !== target.id || result.value.cardId !== card.provider_card_id) {
          status = "unavailable"; failedTargetIds.add(target.id); continue;
        }
        try {
          await store.upsert(card.id, mode, program.provider, result.value);
          unique.set(result.value.id, result.value); writes++;
        } catch { status = "unavailable"; failedTargetIds.add(target.id); }
      }
      signal.throwIfAborted();
      const result = fresh.at(-1);
      if (!result || result.status === "rejected" || !isProgramPurchaseList(result.value)) { status = "unavailable"; continue; }
      if (result.value.partial) status = "unavailable";
      const listed = result.value.rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.kind.localeCompare(left.kind));
      for (const purchase of listed) {
        if (purchase.cardId !== card.provider_card_id) { status = "unavailable"; continue; }
        if (failedTargetIds.has(purchase.id) || unique.has(purchase.id)) continue;
        if (writes >= 25) { status = "unavailable"; continue; }
        try { await store.upsert(card.id, mode, program.provider, purchase); unique.set(purchase.id, purchase); writes++; }
        catch { status = "unavailable"; }
      }
    } catch { status = "unavailable"; }
  }
  return { version: CARD_PURCHASES_VERSION, status, rows: await store.rows(customerId, mode, window) };
}
function isProgramPurchaseList(value: unknown): value is { rows: ProgramPurchase[]; partial: boolean } {
  return isRecord(value) && typeof value.partial === "boolean" && Array.isArray(value.rows) && value.rows.every(isProgramPurchase);
}
export async function refreshObservedCardEvent(event: CardObservation): Promise<void> {
  const programs = readCardPrograms();
  const program = programs.byProvider(event.provider, event.mode);
  const ref = program?.purchases.refFor(event);
  if (!program || !ref || !event.externalIds.card) return;
  const sql = getSqlExecutor();
  const card = await sql.query<{ id: string }>("SELECT id FROM cards WHERE provider=$1 AND mode=$2 AND provider_card_id=$3", [event.provider, event.mode, event.externalIds.card]);
  if (!card.rows[0]) return;
  const purchase = await program.purchases.read(ref);
  if (!isProgramPurchase(purchase) || purchase.id !== ref.id || purchase.cardId !== event.externalIds.card) throw new Error("Card purchase mismatch");
  await createCardTransactionStore(sql).upsert(card.rows[0].id, event.mode, program.provider, purchase);
}
export async function readActivityCardPurchases(customerId: string | null, window: { from: string; to: string }): Promise<CardPurchases> {
  if (!customerId) return { version: CARD_PURCHASES_VERSION, status: "ready", rows: [] };
  if (!readDatabaseUrl()) throw new Error("Card transaction store unavailable");
  const sql = getSqlExecutor();
  const programs = readCardPrograms(sql);
  const links = await sql.query<{ mode: CardMode }>("SELECT mode FROM card_accounts WHERE customer_id=$1", [customerId]);
  const mode = programs.mode ?? links.rows[0]?.mode;
  if (!mode) return { version: CARD_PURCHASES_VERSION, status: "ready", rows: [] };
  return refreshCardPurchases(customerId, mode, createCardTransactionStore(sql), await programs.programFor(customerId, mode), window);
}

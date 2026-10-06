import { expect, test } from "bun:test";
import { refreshCardPurchases } from "./transaction-refresh";
import type { ProgramPurchase } from "./program";
import type { CardObservation } from "./provider";
import { fakeProgram } from "@/tests/cards/fake-program";
import { parseCardPurchases } from "@/shared/cards/transactions-contract";
const purchase: ProgramPurchase = { id: "purchase-fixture", cardId: "provider-card", authorizationId: "purchase-fixture", kind: "authorization", amountMinor: "100", currency: "USD", merchantName: "Synthetic Cafe", merchantCategory: null,
  status: "pending", declineReasonCode: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
const event = (id: string): CardObservation => ({ provider: "bridge", mode: "sandbox", eventId: id, kind: "purchase", occurredAt: "2026-10-01T00:00:00Z", externalIds: { card: "provider-card", transaction: id, customer: null, cardholder: null } });
function setup() {
  const fake = fakeProgram(); fake.purchases.set(purchase.id, purchase);
  const writes: string[] = [];
  const store: Parameters<typeof refreshCardPurchases>[2] = {
    cards: async () => [{ id: "home-card", provider: "bridge", provider_card_id: "provider-card" }], pending: async () => [event(purchase.id)],
    upsert: async (_card, _mode, _provider, row) => { writes.push(row.id); }, rows: async () => [{ ...purchase, id: "11111111-1111-4111-8111-111111111111" }],
  };
  return { program: fake.program, store, writes };
}
test("refresh uses program purchases and round trips durable Activity rows", async () => {
  const { program, store, writes } = setup();
  const result = await refreshCardPurchases("owner", "sandbox", store, program, { from: "2026-09-01T00:00:00Z", to: "2026-11-01T00:00:00Z" });
  expect(parseCardPurchases(result)).toEqual(result); expect(result.status).toBe("ready"); expect(writes).toEqual([purchase.id]);
});
test.each(["rejected", "timeout", "malformed", "mismatch"] as const)("failed targeted %s remains pending even when listed", async (failure) => {
  const { program, store, writes } = setup();
  const read = async () => {
    if (failure === "rejected") throw new Error("read failed"); if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
    const malformed: ProgramPurchase = JSON.parse('{"id":"purchase-fixture"}');
    return failure === "mismatch" ? { ...purchase, cardId: "other" } : malformed;
  };
  expect((await refreshCardPurchases("owner", "sandbox", store, { ...program, purchases: { ...program.purchases, read } })).status).toBe("unavailable"); expect(writes).toEqual([]);
});
test.each(["rejected", "malformed", "partial", "mismatch"] as const)("list %s retains successful targeted writes", async (failure) => {
  const { program, store, writes } = setup();
  const list = async () => {
    if (failure === "rejected") throw new Error("list failed");
    const malformed: { rows: ProgramPurchase[]; partial: boolean } = JSON.parse('{"rows":[],"partial":"false"}');
    if (failure === "malformed") return malformed;
    return { rows: [{ ...purchase, cardId: failure === "mismatch" ? "other" : purchase.cardId }], partial: failure === "partial" };
  };
  expect((await refreshCardPurchases("owner", "sandbox", store, { ...program, purchases: { ...program.purchases, list } })).status).toBe("unavailable"); expect(writes).toEqual([purchase.id]);
});
test("eleven pending events drain oldest first in bounded batches", async () => {
  const { program, store, writes } = setup(); const remaining = Array.from({ length: 11 }, (_, i) => `purchase${i}`);
  store.pending = async () => remaining.map(event);
  store.upsert = async (_card, _mode, _provider, row) => { writes.push(row.id); remaining.splice(remaining.indexOf(row.id), 1); };
  const adapted = { ...program, purchases: { ...program.purchases, read: async (ref: { id: string }) => ({ ...purchase, id: ref.id }), list: async () => ({ rows: [], partial: false }) } };
  expect((await refreshCardPurchases("owner", "sandbox", store, adapted)).status).toBe("unavailable"); expect(remaining).toEqual(["purchase10"]);
  expect((await refreshCardPurchases("owner", "sandbox", store, adapted)).status).toBe("ready"); expect(writes).toHaveLength(11);
});
test("write budget prefers recent captures and failed persistence stays unavailable", async () => {
  const { program, store, writes } = setup(); store.pending = async () => [];
  const rows = Array.from({ length: 25 }, (_, i) => ({ ...purchase, id: `auth${i}` }));
  rows.push({ ...purchase, id: "capture", kind: "transaction", createdAt: "2026-10-02T00:00:00.000Z" });
  const adapted = { ...program, purchases: { ...program.purchases, list: async () => ({ rows, partial: false }) } };
  expect((await refreshCardPurchases("owner", "sandbox", store, adapted)).status).toBe("unavailable"); expect(writes).toHaveLength(25); expect(writes[0]).toBe("capture");
  store.upsert = async () => { throw new Error("write failed"); };
  expect((await refreshCardPurchases("owner", "sandbox", store, program)).status).toBe("unavailable");
  expect((await refreshCardPurchases("owner", "sandbox", store, null)).status).toBe("unavailable");
});

import { describe, expect, test } from "bun:test";
import { refreshCardPurchases } from "./transaction-refresh";
import type { StripePurchase } from "./stripe/transactions";

const purchase: StripePurchase = { id: "iauth_synthetic", cardId: "ic_synthetic", authorizationId: "iauth_synthetic", kind: "authorization",
  amountMinor: "100", currency: "USD", merchantName: "Synthetic Cafe", merchantCategory: "5812", status: "pending", declineReasonCode: null,
  createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" };
type Store = Parameters<typeof refreshCardPurchases>[2];
type Client = Parameters<typeof refreshCardPurchases>[3];

function setup(overrides: { list?: Client["list"]; read?: Client["read"]; pending?: Store["pending"] } = {}) {
  const writes: string[] = [];
  const store = {
    cards: async () => [{ id: "card-uuid", stripe_card_id: "ic_synthetic" }],
    pending: overrides.pending ?? (async () => [{ transaction_id: "iauth_synthetic", kind: "issuing_authorization.updated" }]),
    upsert: async (_card: string, _mode: string, row: StripePurchase) => { writes.push(row.id); },
    rows: async () => [purchase],
  } as Store;
  const client = { read: overrides.read ?? (async () => purchase), list: overrides.list ?? (async () => [purchase]) } as Client;
  return { store, client, writes };
}

describe("card purchase bounded refresh", () => {
  test("reads fresh detail and both lists, deduplicates identities and retains durable rows", async () => {
    const { store, client, writes } = setup();
    const result = await refreshCardPurchases("owner-uuid", "sandbox", store, client);
    expect(result.status).toBe("ready");
    expect(result.rows).toEqual([purchase]);
    expect(writes).toEqual(["iauth_synthetic"]);
  });
  test("provider rejection, timeout, partial list or detail failure keeps stored rows but reports unavailable", async () => {
    for (const error of [new Error("rejected"), new DOMException("timeout", "TimeoutError"), new Error("Partial Stripe purchase list")]) {
      const failedList = setup({ list: async () => { throw error; } });
      const result = await refreshCardPurchases("owner-uuid", "sandbox", failedList.store, failedList.client);
      expect(result).toEqual({ status: "unavailable", rows: [purchase] });
      expect(failedList.writes).toEqual([]);
    }
    const failedDetail = setup({ read: async () => { throw new Error("detail failed"); } });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", failedDetail.store, failedDetail.client)).status).toBe("unavailable");
  });
  test("mismatched card, event overflow and write failure never turn unavailable into empty success", async () => {
    const mismatch = setup({ list: async () => [{ ...purchase, cardId: "ic_attacker" }] });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", mismatch.store, mismatch.client)).status).toBe("unavailable");
    const overflow = setup({ pending: async () => Array.from({ length: 11 }, (_, i) => ({ transaction_id: `iauth_${i}`, kind: "issuing_authorization.updated" })) });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", overflow.store, overflow.client)).status).toBe("unavailable");
  });
});

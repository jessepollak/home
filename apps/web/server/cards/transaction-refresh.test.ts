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
  const client = { read: overrides.read ?? (async () => purchase), list: overrides.list ?? (async () => ({ rows: [purchase], partial: false })) } as Client;
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
  test("list rejection persists successful targeted reads and retains stored rows as unavailable", async () => {
    for (const error of [new Error("rejected"), new DOMException("timeout", "TimeoutError")]) {
      const failedList = setup({ list: async () => { throw error; } });
      const result = await refreshCardPurchases("owner-uuid", "sandbox", failedList.store, failedList.client);
      expect(result).toEqual({ status: "unavailable", rows: [purchase] });
      expect(failedList.writes).toEqual(["iauth_synthetic"]);
    }
    const failedDetail = setup({ read: async () => { throw new Error("detail failed"); } });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", failedDetail.store, failedDetail.client)).status).toBe("unavailable");
  });
  test("a failed targeted detail stays pending even when a list includes the same purchase", async () => {
    const failed = setup({ read: async () => { throw new Error("detail failed"); } });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", failed.store, failed.client)).status).toBe("unavailable");
    expect(failed.writes).toEqual([]);
  });

  test("eleven pending events drain oldest first across successive refreshes", async () => {
    const remaining = Array.from({ length: 11 }, (_, i) => `iauth_event${i}`);
    const batches: string[][] = [];
    const { store, client, writes } = setup({
      pending: async () => remaining.map((id) => ({ transaction_id: id, kind: "issuing_authorization.updated" })),
      read: async (_kind, id) => ({ ...purchase, id }),
      list: async () => ({ rows: [], partial: false }),
    });
    store.upsert = async (_card, _mode, row) => { writes.push(row.id); remaining.splice(remaining.indexOf(row.id), 1); };
    client.read = async (_kind, id) => { (batches.at(-1) ?? []).push(id); return { ...purchase, id }; };
    batches.push([]);
    expect((await refreshCardPurchases("owner-uuid", "sandbox", store, client)).status).toBe("unavailable");
    expect(batches[0]).toEqual(Array.from({ length: 10 }, (_, i) => `iauth_event${i}`));
    expect(remaining).toEqual(["iauth_event10"]);
    batches.push([]);
    expect((await refreshCardPurchases("owner-uuid", "sandbox", store, client)).status).toBe("ready");
    expect(batches[1]).toEqual(["iauth_event10"]);
    expect(remaining).toEqual([]);
    expect(writes).toHaveLength(11);
  });
  test("window-filtered lists ignore older purchases, while pagination bounds persist rows and report unavailable", async () => {
    const from = "2026-09-01T00:00:00.000Z";
    const window = { from, to: "2026-10-01T00:00:00.000Z" };
    const seen: number[] = [];
    const current = setup({ pending: async () => [], list: async (_kind, _card, start) => {
      seen.push(start);
      return { rows: start >= Date.parse(from) / 1000 ? [purchase] : Array.from({ length: 26 }, (_, i) => ({ ...purchase, id: `iauth_old${i}` })), partial: false };
    } });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", current.store, current.client, window)).status).toBe("ready");
    expect(seen).toEqual([Date.parse(from) / 1000, Date.parse(from) / 1000]);
    const bounded = setup({ pending: async () => [], list: async () => ({ rows: [{ ...purchase, id: "iauth_bounded" }], partial: true }) });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", bounded.store, bounded.client, window)).status).toBe("unavailable");
    expect(bounded.writes).toEqual(["iauth_bounded"]);
  });
  test("write budget keeps the newest linked transaction when authorizations fill the list", async () => {
    const auths = Array.from({ length: 25 }, (_, i) => ({ ...purchase, id: `iauth_recent${i}` }));
    const capture = { ...purchase, id: "ipi_capture", kind: "transaction" as const, authorizationId: "iauth_recent0",
      createdAt: "2026-09-02T12:00:00.000Z" };
    const bounded = setup({ pending: async () => [], list: async (kind) => ({ rows: kind === "authorization" ? auths : [capture], partial: false }) });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", bounded.store, bounded.client)).status).toBe("unavailable");
    expect(bounded.writes).toHaveLength(25);
    expect(bounded.writes[0]).toBe("ipi_capture");
  });

  test("mismatched card and write failure never turn unavailable into empty success", async () => {
    const mismatch = setup({ list: async () => ({ rows: [{ ...purchase, cardId: "ic_attacker" }], partial: false }) });
    expect((await refreshCardPurchases("owner-uuid", "sandbox", mismatch.store, mismatch.client)).status).toBe("unavailable");
    const failed = setup();
    failed.store.upsert = async () => { throw new Error("write failed"); };
    expect((await refreshCardPurchases("owner-uuid", "sandbox", failed.store, failed.client)).status).toBe("unavailable");
  });
});

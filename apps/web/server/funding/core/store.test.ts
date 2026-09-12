import { describe, expect, test } from "bun:test";
import { MemoryFundingOrderStore, type FundingReservation } from "./store";

const owner = { subject: "subject-1", accountProvider: "base-account" as const };
const other = { subject: "subject-2", accountProvider: "base-account" as const };
const base: FundingReservation = {
  id: "11111111-1111-4111-8111-111111111111", owner,
  destination: "0x1111111111111111111111111111111111111111", providerId: "idrx",
  region: "ID", assetId: "base:idrx", paymentMethod: "qris", fiatAmount: "20000.00",
  intentDigest: "digest", quote: { fiatAmount: "20000.00", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
  quoteToken: "signed-token", customerRef: null, creationBlock: "100", createdAt: "2026-09-12T00:00:00.000Z",
};

describe("MemoryFundingOrderStore contract", () => {
  test("atomically returns one reservation for a repeated intent and scopes owner reads", async () => {
    const store = new MemoryFundingOrderStore();
    const [first, second] = await Promise.all([store.reserve(base), store.reserve({ ...base, id: "22222222-2222-4222-8222-222222222222" })]);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(first.order.id).toBe(second.order.id);
    expect(await store.getOwned(first.order.id, other)).toBeNull();
    expect((await store.getOwned(first.order.id, owner))?.destination).toBe(base.destination);
  });

  test("resumes ambiguous orders and rejects stale or terminal observations", async () => {
    const store = new MemoryFundingOrderStore();
    await store.reserve(base);
    const ambiguous = await store.markDispatchAmbiguous(base.id, 0, "2026-09-12T00:00:01.000Z");
    expect((await store.getOpen(owner, "ID"))?.id).toBe(ambiguous.id);
    expect(await store.applyObservation(base.id, { state: "sent-unverified", providerStatus: "late", expectedVersion: ambiguous.version, updatedAt: "2026-09-12T00:00:02.000Z" })).toBeNull();
    expect((await store.getOwned(base.id, owner))?.state).toBe("dispatch-ambiguous");
  });

  test("enforces unique provider IDs and unique receipt claims", async () => {
    const store = new MemoryFundingOrderStore();
    await store.reserve(base);
    await store.completeDispatch(base.id, { providerOrderId: "provider-1", expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null, instructions: { kind: "qr", scheme: "qris", payload: "payload", amount: "20000.00", currency: "IDR" }, expectedVersion: 0, updatedAt: "2026-09-12T00:00:01.000Z" });
    const second = { ...base, id: "22222222-2222-4222-8222-222222222222", intentDigest: "other" };
    await store.reserve(second);
    await expect(store.completeDispatch(second.id, { providerOrderId: "provider-1", expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null, instructions: { kind: "redirect", url: "https://example.com" }, expectedVersion: 0, updatedAt: "2026-09-12T00:00:01.000Z" })).rejects.toThrow("funding-provider-order-conflict");
    expect(await store.claimReceipt(base.id, { transactionHash: `0x${"1".repeat(64)}`, logIndex: 2, expectedVersion: 1, updatedAt: "2026-09-12T00:00:02.000Z" })).not.toBeNull();
    expect(await store.claimReceipt(second.id, { transactionHash: `0x${"1".repeat(64)}`, logIndex: 2, expectedVersion: 0, updatedAt: "2026-09-12T00:00:02.000Z" })).toBeNull();
    expect((await store.getOwned(base.id, owner))?.instructions).toBeNull();
  });
});

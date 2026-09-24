import { describe, expect, test } from "bun:test";
import { MemoryFundingOrderStore, type FundingReservation } from "./store";

const owner = { subject: "subject-1", accountProvider: "base-account" as const };
const other = { subject: "subject-2", accountProvider: "base-account" as const };
const base: FundingReservation = {
  id: "11111111-1111-4111-8111-111111111111", owner,
  destination: "0x1111111111111111111111111111111111111111", providerId: "idrx",
  region: "ID", assetId: "base:idrx", paymentMethod: "qris", fiatAmount: "20000.00",
  intentDigest: "digest", quote: { fiatAmount: "20000.00", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
  quoteToken: "signed-token", customerRef: null, sandbox: false, creationBlock: "100", createdAt: "2026-09-12T00:00:00.000Z",
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

  test("keeps distinct same-region intents as independent reservations", async () => {
    const store = new MemoryFundingOrderStore();
    const first = await store.reserve(base);
    const second = await store.reserve({
      ...base,
      id: "22222222-2222-4222-8222-222222222222",
      intentDigest: "different-intent",
      quoteToken: "different-token",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.order.id).not.toBe(first.order.id);
  });

  test("finds an owner-region ambiguous order even when a newer open order exists", async () => {
    const store = new MemoryFundingOrderStore();
    await store.reserve(base);
    await store.markDispatchAmbiguous(base.id, 0, "2026-09-12T00:00:01.000Z");
    await store.reserve({ ...base, id: "66666666-6666-4666-8666-666666666666", intentDigest: "newer", quoteToken: "newer-token" });
    expect((await store.getOpen(owner, "ID"))?.id).toBe("66666666-6666-4666-8666-666666666666");
    expect((await store.getDispatchAmbiguous(owner, "ID", "idrx"))?.id).toBe(base.id);
    expect(await store.getDispatchAmbiguous(owner, "ID", "other-provider")).toBeNull();
    expect(await store.getDispatchAmbiguous(other, "ID", "idrx")).toBeNull();
    expect(await store.getDispatchAmbiguous(owner, "US", "idrx")).toBeNull();
  });

  test("resolves ambiguous orders only for their owner and excludes them from open-order resume", async () => {
    const store = new MemoryFundingOrderStore();
    await store.reserve(base);
    const ambiguous = await store.markDispatchAmbiguous(base.id, 0, "2026-09-12T00:00:01.000Z");
    expect((await store.getOpen(owner, "ID"))?.id).toBe(ambiguous.id);
    expect(await store.applyObservation(base.id, { state: "sent-unverified", providerStatus: "late", expectedVersion: ambiguous.version, updatedAt: "2026-09-12T00:00:02.000Z" })).toBeNull();
    expect(await store.resolveDispatchAmbiguous(
      base.id,
      other,
      ambiguous.version,
      "2026-09-12T00:00:02.000Z",
    )).toBeNull();
    expect((await store.getOwned(base.id, owner))?.state).toBe("dispatch-ambiguous");

    const resolved = await store.resolveDispatchAmbiguous(
      base.id,
      owner,
      ambiguous.version,
      "2026-09-12T00:00:03.000Z",
    );
    expect(resolved?.state).toBe("cancelled");
    expect(await store.getOpen(owner, "ID")).toBeNull();
    expect(await store.applyObservation(base.id, { state: "sent-unverified", providerStatus: "late", expectedVersion: resolved!.version, updatedAt: "2026-09-12T00:00:04.000Z" })).toBeNull();
  });

  test("does not resume completed sandbox runs but keeps live sent-unverified orders open", async () => {
    const sandboxStore = new MemoryFundingOrderStore();
    const sandbox = { ...base, sandbox: true };
    await sandboxStore.reserve(sandbox);
    const sandboxDispatched = await sandboxStore.completeDispatch(sandbox.id, { providerOrderId: "sandbox-provider", expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null, instructions: { kind: "redirect", url: "https://example.com" }, expectedVersion: 0, updatedAt: "2026-09-12T00:00:01.000Z" });
    await sandboxStore.applyObservation(sandbox.id, { state: "sent-unverified", providerStatus: "complete", expectedVersion: sandboxDispatched.version, updatedAt: "2026-09-12T00:00:02.000Z" });
    expect(await sandboxStore.getOpen(owner, "ID")).toBeNull();
    const replacement = await sandboxStore.reserve({
      ...sandbox,
      id: "44444444-4444-4444-8444-444444444444",
      intentDigest: "sandbox-replacement",
      quoteToken: "sandbox-replacement-token",
    });
    expect(replacement.created).toBe(true);

    const liveStore = new MemoryFundingOrderStore();
    await liveStore.reserve(base);
    const liveDispatched = await liveStore.completeDispatch(base.id, { providerOrderId: "live-provider", expectedTokenAmountAtomic: "2000000", fees: [], expiresAt: null, instructions: { kind: "redirect", url: "https://example.com" }, expectedVersion: 0, updatedAt: "2026-09-12T00:00:01.000Z" });
    await liveStore.applyObservation(base.id, { state: "sent-unverified", providerStatus: "unverified", expectedVersion: liveDispatched.version, updatedAt: "2026-09-12T00:00:02.000Z" });
    expect((await liveStore.getOpen(owner, "ID"))?.id).toBe(base.id);
    const liveReplacement = await liveStore.reserve({
      ...base,
      id: "55555555-5555-4555-8555-555555555555",
      intentDigest: "live-replacement",
      quoteToken: "live-replacement-token",
    });
    expect(liveReplacement.created).toBe(true);
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

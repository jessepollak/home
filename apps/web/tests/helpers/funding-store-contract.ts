import { expect, test } from "bun:test";
import type { FundingOrderStore, FundingReservation } from "@/server/funding/core/store";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a funding order");
  return value;
}

export function fundingAbandonStoreContract(createStore: () => FundingOrderStore, reservation: () => FundingReservation) {
  const at = (seconds: number) => new Date(Date.parse("2026-09-12T00:00:00.000Z") + seconds * 1_000).toISOString();
  async function pending() {
    const store = createStore();
    const input = reservation();
    await store.reserve(input);
    const order = await store.completeDispatch(input.id, { providerOrderId: `provider-${input.id}`, expectedTokenAmountAtomic: input.quote.tokenAmountAtomic, fees: [], expiresAt: null, instructions: { kind: "redirect", url: "https://example.com" }, expectedVersion: 0, updatedAt: at(1) });
    return { store, input, order };
  }

  test("abandon is owner-fenced CAS, clears instructions, preserves checkedAt and is not open", async () => {
    const { store, input, order } = await pending();
    const observation = required(await store.applyObservation(input.id, { state: "awaiting-payment", providerStatus: "PENDING", expectedVersion: order.version, updatedAt: at(2) }));
    const cancel = { expectedVersion: observation.version, reason: "owner" as const, updatedAt: at(3) };
    expect(await store.abandon(input.id, { ...input.owner, subject: "wrong" }, cancel)).toBeNull();
    expect(await store.abandon(input.id, { ...input.owner, accountProvider: "cdp-embedded" }, cancel)).toBeNull();
    expect(await store.abandon(input.id, input.owner, { ...cancel, expectedVersion: 0 })).toBeNull();
    const abandoned = required(await store.abandon(input.id, input.owner, cancel));
    expect(abandoned).toMatchObject({ state: "abandoned", abandonReason: "owner", instructions: null, checkedAt: at(2), updatedAt: at(3), version: observation.version + 1 });
    expect(await store.abandon(input.id, input.owner, { ...cancel, expectedVersion: abandoned.version })).toBeNull();
    expect(await store.getOpen(input.owner, input.region)).toBeNull();
    expect(await store.listOpen(input.owner, input.region)).toEqual([]);
    expect(await store.getOpenForProvider(input.owner, input.region, input.providerId)).toBeNull();
    expect(await store.getOwned(input.id, input.owner)).toEqual(abandoned);
  });

  test("identical observations only advance checkedAt; status and economics changes move the lifecycle timestamp", async () => {
    const { store, input, order } = await pending();
    const observation = { state: "awaiting-payment" as const, providerStatus: "PENDING_VERIFICATION", expectedVersion: order.version, updatedAt: at(2) };
    const first = required(await store.applyObservation(input.id, observation));
    const identical = await store.applyObservation(input.id, { ...observation, expectedVersion: first.version, updatedAt: at(3) });
    expect(identical).toEqual({ ...first, checkedAt: at(3) });
    const changed = required(await store.applyObservation(input.id, { ...observation, providerStatus: "PENDING_PAYMENT", expectedVersion: first.version, updatedAt: at(4) }));
    expect(changed).toMatchObject({ updatedAt: at(4), checkedAt: at(4), version: first.version + 1 });
    const providerTransactionHash: `0x${string}` = `0x${"1".repeat(64)}`;
    for (const change of [
      { expectedTokenAmountAtomic: "100" },
      { fees: [{ label: "Fee", amount: "1", currency: "IDR" }] },
      { providerTransactionHash },
    ]) {
      const before = required(await store.getOwned(input.id, input.owner));
      const providerStatus = required(before.providerStatus);
      const updated = required(await store.applyObservation(input.id, { ...observation, ...change, providerStatus, expectedVersion: before.version, updatedAt: at(5) }));
      expect(updated.version).toBe(before.version + 1);
      expect(updated.updatedAt).toBe(at(5));
      expect(await store.applyObservation(input.id, { ...observation, ...change, providerStatus: required(updated.providerStatus), expectedVersion: updated.version, updatedAt: at(6) })).toEqual({ ...updated, checkedAt: at(6) });
    }
  });

  test("abandoned rejects regression except checkedAt, including changed provider metadata", async () => {
    const { store, input, order } = await pending();
    const abandoned = required(await store.abandon(input.id, input.owner, { expectedVersion: order.version, reason: "timed-out", updatedAt: at(2) }));
    for (const state of ["awaiting-payment", "unknown"] as const) {
      const regressed = await store.applyObservation(input.id, { state, providerStatus: "PENDING", expectedTokenAmountAtomic: "1", fees: [{ label: "Changed", amount: "1", currency: "IDR" }], providerTransactionHash: `0x${"3".repeat(64)}`, expectedVersion: abandoned.version, updatedAt: at(3) });
      expect(regressed).toEqual({ ...abandoned, checkedAt: at(3) });
    }
    const beforeStale = await store.getOwned(input.id, input.owner);
    expect(await store.applyObservation(input.id, { state: "settling", providerStatus: "PROCESSING", expectedVersion: abandoned.version - 1, updatedAt: at(4) })).toBeNull();
    expect(await store.getOwned(input.id, input.owner)).toEqual(beforeStale);
  });

  for (const state of ["payment-received", "settling", "sent-unverified", "expired", "failed", "cancelled", "refunded"] as const) {
    test(`abandoned advances to ${state} and retains cleared instructions`, async () => {
      const { store, input, order } = await pending();
      const abandoned = required(await store.abandon(input.id, input.owner, { expectedVersion: order.version, reason: "owner", updatedAt: at(2) }));
      const observed = required(await store.applyObservation(input.id, { state, providerStatus: state, expectedVersion: abandoned.version, updatedAt: at(3) }));
      expect(observed).toMatchObject({ state, instructions: null, updatedAt: at(3), checkedAt: at(3), version: abandoned.version + 1 });
      if (["expired", "failed", "cancelled", "refunded"].includes(state)) {
        expect(await store.applyObservation(input.id, { state: "sent-unverified", providerStatus: "late", expectedVersion: observed.version, updatedAt: at(4) })).toBeNull();
        expect(await store.getOwned(input.id, input.owner)).toEqual(observed);
      }
    });
  }

  test("abandoned can claim a receipt and sent/sent-unverified share the progress rank", async () => {
    const { store, input, order } = await pending();
    const abandoned = required(await store.abandon(input.id, input.owner, { expectedVersion: order.version, reason: "owner", updatedAt: at(2) }));
    const received = await store.claimReceipt(input.id, { transactionHash: `0x${"5".repeat(64)}`, logIndex: 1, expectedVersion: abandoned.version, updatedAt: at(3) });
    expect(received).toMatchObject({ state: "received", instructions: null, version: abandoned.version + 1 });
    const next = await pending();
    const sent = required(await next.store.applyObservation(next.input.id, { state: "sent-unverified", providerStatus: "COMPLETE", expectedVersion: next.order.version, updatedAt: at(3) }));
    expect(await next.store.applyObservation(next.input.id, { state: "sent", providerStatus: "COMPLETE", expectedVersion: sent.version, updatedAt: at(4) })).toMatchObject({ state: "sent", version: sent.version + 1 });
  });
}

import { describe, expect, test } from "bun:test";
import { MemoryFundingOrderStore, type FundingReservation } from "@/server/funding/core/store";
import { MemoryFundingProviderCustomerStore } from "@/server/funding/core/customer-store";
import { withFundingOrderEvents, withProviderCustomerEvents } from "./funding";
import type { OperatorEventInput } from "./events";

const owner = { subject: "owner", accountProvider: "cdp-embedded" as const };
const reservation: FundingReservation = {
  id: "11111111-1111-4111-8111-111111111111", owner,
  destination: "0x1111111111111111111111111111111111111111", providerId: "idrx",
  region: "ID", assetId: "base:idrx", paymentMethod: "qris", fiatAmount: "20000.00",
  intentDigest: "digest", quote: { fiatAmount: "20000.00", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
  quoteToken: "signed-token", customerRef: null, sandbox: false, creationBlock: "100", createdAt: "2026-09-12T00:00:00.000Z",
};

function orders(record: (event: OperatorEventInput) => Promise<void> = async () => {}) {
  return withFundingOrderEvents(new MemoryFundingOrderStore(), record);
}

describe("funding order operator capture", () => {
  test("first reservation records one created event", async () => {
    const events: OperatorEventInput[] = [];
    const store = orders(async (event) => { events.push(event); });
    const first = await store.reserve(reservation);
    expect(first.created).toBe(true);
    expect(events.map((event) => [event.name, event.idempotencyKey])).toEqual([
      ["funding.order_created", `funding:${reservation.id}:created`],
    ]);
  });

  test("replayed reservation does not record again", async () => {
    const events: OperatorEventInput[] = [];
    const store = orders(async (event) => { events.push(event); });
    const first = await store.reserve(reservation);
    events.length = 0;
    const replay = await store.reserve({ ...reservation, id: "22222222-2222-4222-8222-222222222222" });
    expect(replay).toEqual({ created: false, order: first.order });
    expect(events).toEqual([]);
  });

  test("a received transition records the received finalized event", async () => {
    const events: OperatorEventInput[] = [];
    const store = orders(async (event) => { events.push(event); });
    await store.reserve(reservation);
    events.length = 0;
    const order = await store.claimReceipt(reservation.id, {
      transactionHash: `0x${"ab".repeat(32)}`, logIndex: 0, expectedVersion: 0, updatedAt: "2026-09-12T00:00:01.000Z",
    });
    expect(order?.state).toBe("received");
    expect(events.filter((event) => event.name === "funding.order_finalized")).toEqual([expect.objectContaining({
      idempotencyKey: `funding:${reservation.id}:received`, props: expect.objectContaining({ state: "received" }),
    })]);
  });

  test("dispatch-ambiguous never records a finalized event", async () => {
    const events: OperatorEventInput[] = [];
    const store = orders(async (event) => { events.push(event); });
    await store.reserve(reservation);
    events.length = 0;
    const order = await store.markDispatchAmbiguous(reservation.id, 0, "2026-09-12T00:00:01.000Z");
    expect(order.state).toBe("dispatch-ambiguous");
    expect(events.some((event) => event.name === "funding.order_finalized")).toBe(false);
  });

  test("reads never record events", async () => {
    const events: OperatorEventInput[] = [];
    const store = orders(async (event) => { events.push(event); });
    await store.reserve(reservation);
    events.length = 0;
    await store.getOwned(reservation.id, owner);
    await store.getOpen(owner, reservation.region);
    await store.getByIntent(owner, reservation.intentDigest);
    expect(events).toEqual([]);
  });

  test("a throwing recorder preserves the returned order", async () => {
    const store = orders(async () => { throw new Error("operator capture failed"); });
    const result = await store.reserve(reservation);
    expect(result.created).toBe(true);
    expect(result.order.id).toBe(reservation.id);
    expect((await store.getOwned(reservation.id, owner))?.id).toBe(reservation.id);
  });
});

describe("provider customer operator capture", () => {
  test("reserving emits no verification event", async () => {
    const events: OperatorEventInput[] = [];
    const store = withProviderCustomerEvents(new MemoryFundingProviderCustomerStore(), async (event) => { events.push(event); });
    const reserved = await store.reserve({ id: reservation.id, owner, providerId: "ripio", region: "AR", createdAt: reservation.createdAt });
    expect(reserved.created).toBe(true);
    expect(events).toEqual([]);
  });

  test("verification emits the verified key", async () => {
    const events: OperatorEventInput[] = [];
    const store = withProviderCustomerEvents(new MemoryFundingProviderCustomerStore(), async (event) => { events.push(event); });
    await store.reserve({ id: reservation.id, owner, providerId: "ripio", region: "AR", createdAt: reservation.createdAt });
    const pending = await store.completeCreate(reservation.id, { customerRef: "ref", expectedVersion: 0, updatedAt: "2026-09-12T00:00:01.000Z" });
    const claimed = await store.claimVerification(reservation.id, pending!.version, "2026-09-12T00:00:02.000Z");
    events.length = 0;
    const verified = await store.markVerified(reservation.id, claimed!.version, "2026-09-12T00:00:03.000Z");
    expect(verified?.state).toBe("verified");
    expect(events.map((event) => [event.name, event.idempotencyKey])).toEqual([
      ["verification.changed", `kyc:${reservation.id}:verified`],
    ]);
  });
});

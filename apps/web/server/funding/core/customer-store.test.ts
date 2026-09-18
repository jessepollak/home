import { describe, expect, test } from "bun:test";
import { MemoryFundingProviderCustomerStore } from "./customer-store";

const owner = { subject: "owner", accountProvider: "base-account" as const };
const reservation = { id: "11111111-1111-4111-8111-111111111111", owner, providerId: "ripio", region: "AR", createdAt: "2026-09-18T00:00:00.000Z" };

describe("funding provider customer store", () => {
  test("single-flights reservations and CAS-claims verification", async () => {
    const store = new MemoryFundingProviderCustomerStore();
    const [left, right] = await Promise.all([store.reserve(reservation), store.reserve({ ...reservation, id: "22222222-2222-4222-8222-222222222222" })]);
    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    expect(left.customer.id).toBe(right.customer.id);
    const pending = await store.completeCreate(left.customer.id, { customerRef: "provider-customer", providerCreatedAt: reservation.createdAt, expectedVersion: 0, updatedAt: "2026-09-18T00:00:01.000Z" });
    expect(pending?.state).toBe("pending");
    const [winner, loser] = await Promise.all([
      store.claimVerification(left.customer.id, pending!.version, "2026-09-18T00:00:02.000Z"),
      store.claimVerification(left.customer.id, pending!.version, "2026-09-18T00:00:02.000Z"),
    ]);
    expect([winner, loser].filter(Boolean)).toHaveLength(1);
    expect((await store.get(owner, "ripio", "AR"))?.verificationStartedAt).toBe("2026-09-18T00:00:02.000Z");
  });

  test("makes ambiguous creation terminal for automatic retry", async () => {
    const store = new MemoryFundingProviderCustomerStore();
    const reserved = await store.reserve(reservation);
    await store.markDispatchAmbiguous(reserved.customer.id, 0, "2026-09-18T00:02:01.000Z");
    expect((await store.reserve({ ...reservation, id: "33333333-3333-4333-8333-333333333333" })).customer.state).toBe("dispatch-ambiguous");
  });
});

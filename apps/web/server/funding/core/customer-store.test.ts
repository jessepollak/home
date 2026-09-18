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
    const pending = await store.completeCreate(left.customer.id, { customerRef: "provider-customer", expectedVersion: 0, updatedAt: "2026-09-18T00:00:01.000Z" });
    const [winner, loser] = await Promise.all([
      store.claimVerification(left.customer.id, pending!.version, "2026-09-18T00:00:02.000Z"),
      store.claimVerification(left.customer.id, pending!.version, "2026-09-18T00:00:02.000Z"),
    ]);
    expect([winner, loser].filter(Boolean)).toHaveLength(1);
    expect((await store.get(owner, "ripio", "AR"))?.verificationStartedAt).toBe("2026-09-18T00:00:02.000Z");
  });

  test("CAS-marks verified or rejected and keeps terminal rows terminal", async () => {
    for (const transition of ["verified", "rejected"] as const) {
      const store = new MemoryFundingProviderCustomerStore();
      const reserved = await store.reserve({ ...reservation, id: transition === "verified" ? reservation.id : "22222222-2222-4222-8222-222222222222" });
      const pending = await store.completeCreate(reserved.customer.id, { customerRef: `${transition}-customer`, expectedVersion: 0, updatedAt: "2026-09-18T00:00:01.000Z" });
      const claimed = await store.claimVerification(reserved.customer.id, pending!.version, "2026-09-18T00:00:02.000Z");
      const terminal = transition === "verified"
        ? await store.markVerified(reserved.customer.id, claimed!.version, "2026-09-18T00:00:03.000Z")
        : await store.markRejected(reserved.customer.id, claimed!.version, "2026-09-18T00:00:03.000Z");
      expect(terminal?.state).toBe(transition);
      expect(await store.markDispatchAmbiguous(reserved.customer.id, terminal!.version, "2026-09-18T00:00:04.000Z")).toBeNull();
    }
  });
});

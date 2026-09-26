import { expect, test } from "bun:test";
import { readCashoutProgress } from "./cash-out-progress";

const progress = { version: 1, providerId: "peer", region: "US", depositId: "escrow-1", state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, withdrawing: false, etaSeconds: 1800, settledAt: null, updatedAt: "2026-09-15T12:00:00Z" };

test("accepts only a versioned, typed projection", () => {
  expect(readCashoutProgress(progress)?.depositId).toBe(progress.depositId);
  for (const state of ["submitted", "matched", "delivering", "delivered", "returned", "failed", "unknown"])
    expect(readCashoutProgress({ ...progress, state })).not.toBeNull();
  for (const invalid of [null, {}, { ...progress, version: 2 }, { ...progress, state: "raw-provider-state" },
    { ...progress, amountAtomic: "5.0" }, { ...progress, filledAtomic: "-1" }, { ...progress, returnedAtomic: "abc" },
    { ...progress, remainingAtomic: 20 }, { ...progress, withdrawable: "true" }, { ...progress, withdrawing: undefined },
    { ...progress, withdrawing: "false" }, { ...progress, etaSeconds: -1 },
    { ...progress, depositId: 12 }, { ...progress, platformLabel: null }]) expect(readCashoutProgress(invalid)).toBeNull();
});

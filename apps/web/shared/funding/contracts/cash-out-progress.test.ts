import { expect, test } from "bun:test";
import { readCashoutProgress } from "./cash-out-progress";

const progress = { version: 1, providerId: "peer", region: "US", depositId: "escrow-1", state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, withdrawing: false, etaSeconds: 1800, settledAt: null, updatedAt: "2026-09-15T12:00:00Z" };

test("accepts only a versioned, typed projection", () => {
  expect(readCashoutProgress(progress)?.depositId).toBe(progress.depositId);
  expect(readCashoutProgress({ ...progress, progressConfirmed: true })?.progressConfirmed).toBe(true);
  expect(readCashoutProgress({ ...progress, progressConfirmed: false })?.progressConfirmed).toBe(false);
  for (const invalidConfirmation of ["true", 1, null])
    expect(readCashoutProgress({ ...progress, progressConfirmed: invalidConfirmation })).toBeNull();
  for (const invalidBlock of ["", "-1", "1.5", 123, null])
    expect(readCashoutProgress({ ...progress, depositBlockNumber: invalidBlock })).toBeNull();
  for (const state of ["submitted", "matched", "delivering", "delivered", "returned", "failed", "unknown"])
    expect(readCashoutProgress({ ...progress, state })).not.toBeNull();
  for (const invalid of [null, {}, { ...progress, version: 2 }, { ...progress, state: "raw-provider-state" },
    { ...progress, amountAtomic: "5.0" }, { ...progress, filledAtomic: "-1" }, { ...progress, returnedAtomic: "abc" },
    { ...progress, remainingAtomic: 20 }, { ...progress, withdrawable: "true" }, { ...progress, withdrawing: undefined },
    { ...progress, withdrawing: "false" }, { ...progress, etaSeconds: -1 },
    { ...progress, depositId: 12 }, { ...progress, depositId: "" }, { ...progress, depositId: "   " }, { ...progress, platformLabel: null }]) expect(readCashoutProgress(invalid)).toBeNull();
});

import { expect, test } from "bun:test";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { balanceStartupDetails, createBalanceReadTiming, recordRestoredBalance } from "./balance-performance";

test("only the snapshot from the measured read carries its stages", () => {
  const oldOwner = { ...balancesSnapshotFixture };
  const currentOwner = { ...balancesSnapshotFixture };
  const read = createBalanceReadTiming();
  read.mark("fetch");
  read.mark("response");
  read.parsed(oldOwner);
  expect(balanceStartupDetails(oldOwner)).toMatchObject({ balanceCache: "cold" });
  expect(balanceStartupDetails(oldOwner).balanceFetchMs).toBeNumber();
  expect(balanceStartupDetails(oldOwner).balanceResponseMs).toBeNumber();
  expect(balanceStartupDetails(oldOwner).balanceParsedMs).toBeNumber();
  expect(balanceStartupDetails(currentOwner)).toEqual({ balanceCache: "unknown" });
});

test("restored balances have no fabricated request stages and cannot label another region's snapshot", () => {
  const restored = { ...balancesSnapshotFixture };
  const otherRegion = { ...balancesSnapshotFixture };
  recordRestoredBalance(restored);
  expect(balanceStartupDetails(restored)).toEqual({ balanceCache: "restored" });
  expect(balanceStartupDetails(otherRegion)).toEqual({ balanceCache: "unknown" });
});

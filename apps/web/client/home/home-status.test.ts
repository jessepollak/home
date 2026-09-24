import { describe, expect, test } from "bun:test";
import {
  borrowPosition,
  buildBalancesSnapshotFixture,
  catalogHolding,
  FIXTURE_CATALOG,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
} from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { homeBalancesStatus } from "./home-status";

const cash = {
  usdc: {
    balance: ready("12340000"),
    value: priced("USD", "1234"),
    cashValue: pricedCash("USD", "1234"),
  },
};

function statusFor(snapshot: BalancesSnapshot) {
  return homeBalancesStatus(presentBalances({ status: "ready", snapshot, error: null }));
}

describe("Home header status", () => {
  test("stays hidden while loading and when every balance is complete", () => {
    expect(homeBalancesStatus(presentBalances({ status: "loading", snapshot: null, error: null }))).toBeNull();
    expect(statusFor(buildBalancesSnapshotFixture({ registry: cash }))).toBeNull();
  });

  test("does not interrupt a ready but incomplete catalog read or isolated gaps", () => {
    const partial = buildBalancesSnapshotFixture({ registry: cash, coverage: { catalog: "incomplete" } });
    expect(presentBalances({ status: "ready", snapshot: partial, error: null }).totalStatus).toBe("partial");
    expect(statusFor(partial)).toBeNull();
    expect(statusFor(buildBalancesSnapshotFixture({
      registry: cash,
      catalog: [catalogHolding(FIXTURE_CATALOG.priceMissing, "1000000", {
        status: "unpriced", reason: "price-unavailable",
      })],
    }))).toBeNull();
    expect(statusFor(buildBalancesSnapshotFixture({
      registry: { ...cash, eth: { balance: unavailableBalance, value: { status: "unavailable" } } },
    }))).toBeNull();
    expect(statusFor(buildBalancesSnapshotFixture({
      registry: cash,
      borrow: { coverage: "partial", positions: [borrowPosition({
        collateralBaseUnits: "100000",
        collateralValue: priced("USD", "1000"),
        debtBaseUnits: "1000000",
        debtValue: priced("USD", "100"),
      })] },
    }))).toBeNull();
  });

  test("offers Retry on a failed read, then clears after a ready partial read", () => {
    const failed = presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" });
    expect(homeBalancesStatus(failed)).toEqual({ message: "Balances are unavailable", recovery: "retry" });
    expect(statusFor(buildBalancesSnapshotFixture({ coverage: { catalog: "incomplete" } }))).toBeNull();
  });

  test("keeps the country prompt and routes to Account instead of Retry", () => {
    expect(statusFor(buildBalancesSnapshotFixture({ region: "GLOBAL", registry: cash }))).toEqual({
      message: "Choose a country in Account to set how money is shown",
      recovery: "choose-country",
    });
  });
});

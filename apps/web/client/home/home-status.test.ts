import { describe, expect, test } from "bun:test";
import {
  borrowPosition, buildBalancesSnapshotFixture, catalogHolding, FIXTURE_CATALOG,
  priced, pricedCash, ready, unavailableBalance,
} from "@/shared/balances/fixtures";
import { presentHomeBalances } from "@/shared/balances/present";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { headerStatus, homeBalancesStatus } from "./home-status";

const cash = {
  usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
};

function statusFor(snapshot: BalancesSnapshot) {
  return homeBalancesStatus(presentHomeBalances({ status: "ready", snapshot, error: null }));
}

const partialPrefix = "Partial balance. Total counts only what Home could read and price.";

describe("Home header status", () => {
  test("stays hidden when absent, loading, complete, or merely revalidating", () => {
    expect(homeBalancesStatus(undefined)).toBeNull();
    expect(homeBalancesStatus(presentHomeBalances({ status: "loading", snapshot: null, error: null }))).toBeNull();
    const snapshot = buildBalancesSnapshotFixture({ registry: cash });
    expect(statusFor(snapshot)).toBeNull();
    expect(homeBalancesStatus(presentHomeBalances({ status: "ready", snapshot, error: null, revalidating: true }))).toBeNull();
  });

  test("explains an incomplete catalog as a partial known sum, not a failed refresh", () => {
    expect(statusFor(buildBalancesSnapshotFixture({ registry: cash, coverage: { catalog: "incomplete" } }))).toEqual({
      message: `${partialPrefix} Some balances couldn’t be read.`, recovery: "retry",
    });
  });

  test.each(["price-unavailable", "price-paused", "below-market-gate"] as const)("never calls a %s valuation delayed", (reason) => {
    const status = statusFor(buildBalancesSnapshotFixture({
      registry: cash, catalog: [catalogHolding(FIXTURE_CATALOG.priceMissing, "1000000", { status: "unpriced", reason })],
    }));
    expect(status?.message).toBe(`${partialPrefix} Some holdings can’t be valued right now.`);
    expect(status?.recovery).toBe("retry");
  });

  test("reserves delayed copy for stale prices", () => {
    expect(statusFor(buildBalancesSnapshotFixture({
      registry: { ...cash, eth: { balance: ready("1"), value: { status: "unpriced", reason: "price-stale" } } },
    }))?.message).toBe(`${partialPrefix} Some prices are delayed.`);
  });

  test("combines missing balances and unconfirmed borrowing reasons", () => {
    expect(statusFor(buildBalancesSnapshotFixture({
      registry: { ...cash, eth: { balance: unavailableBalance } }, borrow: { coverage: "partial", positions: [] },
    }))).toEqual({
      message: `${partialPrefix} Some balances couldn’t be read. Home couldn’t check for a loan.`, recovery: "retry",
    });
  });

  test("withholds a net with known unpriced debt and explains it", () => {
    const status = statusFor(buildBalancesSnapshotFixture({ registry: cash, borrow: { coverage: "complete", positions: [borrowPosition({
      collateralBaseUnits: "100000", collateralValue: priced("USD", "1000"),
      debtBaseUnits: "1000000", debtValue: { status: "unpriced", reason: "price-unavailable" },
    })] } }));
    expect(status?.message).toStartWith("Balance unavailable.");
    expect(status?.message).toContain("A loan couldn’t be priced, so the total can’t be shown.");
    expect(status?.message).not.toContain("Total counts only");
    expect(status?.recovery).toBe("retry");
  });

  test.each([
    { reasons: ["pending-cash-out"] as const, recovery: "none" },
    { reasons: ["pending-cash-out", "unreadable"] as const, recovery: "retry" },
    { reasons: ["pending-cash-out-unpriced"] as const, recovery: "retry" },
    { reasons: [] as const, recovery: "retry" },
  ])("recovery follows reasons, not partial status alone ($reasons)", ({ reasons, recovery }) => {
    const status = homeBalancesStatus({
      ...presentHomeBalances({ status: "ready", snapshot: buildBalancesSnapshotFixture({ registry: cash }), error: null }),
      totalStatus: "partial", statusReasons: [...reasons],
    });
    expect(status?.recovery).toBe(recovery);
    if (reasons.length === 1 && reasons[0] === "pending-cash-out") {
      expect(status?.message).toContain("A pending cash-out isn’t counted yet.");
    }
  });

  test("keeps failed reads distinct from successful incomplete reads and clears on recovery", () => {
    const failed = presentHomeBalances({ status: "error", snapshot: null, error: "balances-unavailable" });
    expect(homeBalancesStatus(failed)).toEqual({ message: "Balances are unavailable", recovery: "retry" });
    const partial = statusFor(buildBalancesSnapshotFixture({ registry: cash, coverage: { catalog: "incomplete" } }));
    expect(partial?.message).toStartWith(partialPrefix);
    expect(statusFor(buildBalancesSnapshotFixture({ registry: cash }))).toBeNull();
  });

  test("keeps the country prompt and routes to Account instead of Retry", () => {
    expect(statusFor(buildBalancesSnapshotFixture({ region: "GLOBAL", registry: cash }))).toEqual({
      message: "Choose a country in Account to set how money is shown", recovery: "choose-country",
    });
  });

  test.each([null, { message: partialPrefix, recovery: "retry" as const }, { message: "Choose a country", recovery: "choose-country" as const }])("offline and failed retained refresh take precedence over $message", (coverage) => {
    expect(headerStatus({ interruption: { kind: "offline" }, coverage })).toEqual({
      message: "You’re offline. Home will update when you reconnect.", recovery: "none",
    });
    expect(headerStatus({ interruption: { kind: "interrupted" }, coverage })).toEqual({
      message: "Home can’t refresh right now. Some information may be out of date.", recovery: "retry",
    });
    expect(headerStatus({ interruption: null, coverage })).toBe(coverage);
  });

  test("owner presentation replacement never retains previous coverage", () => {
    expect(statusFor(buildBalancesSnapshotFixture({ registry: cash, coverage: { catalog: "incomplete" } }))).not.toBeNull();
    expect(homeBalancesStatus(presentHomeBalances({ status: "loading", snapshot: null, error: null }))).toBeNull();
    expect(statusFor(buildBalancesSnapshotFixture({ owner: "0x2222222222222222222222222222222222222222", registry: cash }))).toBeNull();
  });
});

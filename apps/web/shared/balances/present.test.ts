import { describe, expect, test } from "bun:test";
import { buildBalancesSnapshotFixture, priced, ready } from "./fixtures";
import { presentBalances, presentCashTotal, presentInvestmentTotal } from "./present";
import type { HoldingValue } from "./types";

const unavailable: HoldingValue = { status: "unpriced", reason: "fx-unavailable" };

function present(snapshot: ReturnType<typeof buildBalancesSnapshotFixture>) {
  return presentBalances({ status: "ready", snapshot, error: null });
}

describe("display currency valuation availability", () => {
  test("available FX keeps exact totals under the selected display currency", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "BR", currency: "USD", registry: {
      usdc: { balance: ready("10000000"), value: priced("USD", "1000") },
      eth: { balance: ready("1000000000000000000"), value: priced("USD", "6000") },
    } });
    const result = present(snapshot);
    expect(result.displayTotal).toMatch(/^\$\s?70,00$/);
    expect(result.valuationUnavailable).toBeUndefined();
    expect(presentCashTotal(snapshot).value).toMatch(/^\$\s?10,00$/);
    expect(presentInvestmentTotal(snapshot).value).toMatch(/^\$\s?60,00$/);
  });

  test("positive holdings with unavailable FX never become zero or partial totals", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "BR", currency: "BRL", registry: {
      usdc: { balance: ready("1"), value: unavailable },
      eth: { balance: ready("1"), value: unavailable },
      cbbtc: { balance: ready("100000"), value: priced("BRL", "30000") },
    } });
    const result = present(snapshot);
    expect(result.displayTotal).toBeNull();
    expect(result.valuationUnavailable).toBe(true);
    expect(result.summary?.cash.value).toBeNull();
    expect(result.summary?.investments.value).toBeNull();
    expect(presentCashTotal(snapshot).value).toBeNull();
    expect(presentInvestmentTotal(snapshot).value).toBeNull();
  });

  test("zero balances with unavailable FX do not invalidate priced totals", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "BR", currency: "BRL", registry: {
      usdc: { balance: ready("10000000"), value: priced("BRL", "5000") },
      eth: { balance: ready("0"), value: unavailable },
    } });
    const result = present(snapshot);
    expect(result.valuationUnavailable).toBeUndefined();
    expect(result.displayTotal).toMatch(/^R\$\s?50,00$/);
    expect(presentCashTotal(snapshot).value).toMatch(/^R\$\s?50,00$/);
    expect(presentInvestmentTotal(snapshot).value).toMatch(/^R\$\s?0,00$/);
  });
});

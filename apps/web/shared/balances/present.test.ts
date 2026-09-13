import { describe, expect, test } from "bun:test";
import {
  FIXTURE_CATALOG,
  balancesSnapshotFixture,
  buildBalancesSnapshotFixture,
  catalogHolding,
  decimal,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
} from "./fixtures";
import { presentBalanceRows, presentBalances, previewBalanceRows } from "./present";

describe("balance presentation", () => {
  test("keeps cash truth, hides noncash zero/unavailable and vault shares, and includes catalog rows", () => {
    const rows = presentBalanceRows(balancesSnapshotFixture);
    expect(rows.map((row) => row.name)).toEqual([
      "US dollar",
      "Ethereum",
      "Aerodrome",
      "Bitcoin",
      "Quiet Token",
      "Thin Market Token",
    ]);
    expect(rows.some((row) => row.name.includes("vault"))).toBeFalse();
    expect(rows.some((row) => row.name === "Toshi")).toBeFalse();
    expect(previewBalanceRows(rows).map((row) => row.name)).toEqual([
      "US dollar",
      "Ethereum",
      "Aerodrome",
      "Bitcoin",
    ]);
  });

  test("orders cash, priced descending, unpriced by name, then dust", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("1"), cashValue: pricedCash("USD", "1") },
        eth: { balance: ready("1"), value: priced("USD", "200") },
        cbbtc: { balance: ready("1"), value: { status: "unpriced", reason: "price-unavailable" } },
        toshi: { balance: ready("1"), value: priced("USD", "9", 3) },
      },
      catalog: [catalogHolding(FIXTURE_CATALOG.priced, "1", priced("USD", "300"))],
    });
    expect(presentBalanceRows(snapshot).map((row) => row.name)).toEqual([
      "US dollar",
      "Aerodrome",
      "Ethereum",
      "Bitcoin",
      "Toshi",
    ]);
  });

  test("cash always renders and distinguishes unavailable from successful zero", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: unavailableBalance, value: { status: "unavailable" }, cashValue: { status: "unavailable" } },
      },
      total: { status: "unavailable", value: null },
    });
    expect(presentBalanceRows(snapshot)[0]).toMatchObject({
      name: "US dollar",
      primary: "Unavailable",
      tone: "error",
    });
  });

  test("uses each cash holding's native denomination in another region", () => {
    const snapshot = buildBalancesSnapshotFixture({
      region: "DE",
      registry: {
        usdc: { balance: ready("1230000"), cashValue: pricedCash("USD", "123", 2) },
        eurc: { balance: ready("0"), cashValue: pricedCash("EUR", "0") },
      },
    });
    const usd = presentBalanceRows(snapshot).find((row) => row.name === "US dollar");
    expect(usd?.primary).toContain("$");
    expect(usd?.primary).not.toContain("€");
  });

  test("maps loading, partial and unavailable total states without sentinel rows", () => {
    expect(presentBalances({ status: "loading", snapshot: null, error: null })).toEqual({
      status: "loading",
      displayTotal: null,
      rows: [],
    });
    const ready = presentBalances({
      status: "ready",
      snapshot: { ...balancesSnapshotFixture, total: { status: "partial", value: decimal("123", 2), currency: "USD" } },
      error: null,
      revalidating: true,
    });
    expect(ready).toMatchObject({ status: "ready", displayTotal: "$1.23", totalStatus: "partial", revalidating: true });
    expect(JSON.stringify(ready.rows)).not.toContain("Updating");
    expect(presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" })).toMatchObject({
      status: "unavailable",
      totalStatus: "unavailable",
    });
  });
});

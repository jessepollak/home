import { describe, expect, test } from "bun:test";
import {
  FIXTURE_CATALOG,
  FIXTURE_WALLET_TOKEN,
  balancesSnapshotFixture,
  buildBalancesSnapshotFixture,
  catalogHolding,
  decimal,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
  walletHolding,
} from "./fixtures";
import {
  presentBalanceRows,
  presentBalances,
  presentMoneyGroups,
  presentSavedSubtotal,
  previewBalanceRows,
} from "./present";

const NOW = Date.parse("2026-09-13T12:03:00.000Z");

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
    expect(presentMoneyGroups(balancesSnapshotFixture).map((group) => ({
      id: group.id,
      rows: group.rows.slice(0, 3).map((row) => row.name),
    }))).toEqual([
      { id: "cash", rows: ["US dollar"] },
      { id: "investments", rows: ["Ethereum", "Aerodrome", "Bitcoin"] },
    ]);
  });

  test("orders each money group by fiat value, then keeps unpriced rows", () => {
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

  test.each([
    {
      name: "priced dust",
      holding: catalogHolding(FIXTURE_CATALOG.priced, "1", priced("USD", "9", 3)),
      hidden: true,
    },
    {
      name: "unpriced wallet",
      holding: walletHolding(FIXTURE_WALLET_TOKEN, "1", {
        status: "unpriced" as const,
        reason: "below-market-gate" as const,
      }),
      hidden: true,
    },
    {
      name: "priced at one cent",
      holding: catalogHolding(FIXTURE_CATALOG.priced, "1", priced("USD", "1", 2)),
      hidden: false,
    },
  ])("partitions $name according to the dust rule", ({ holding, hidden }) => {
    const presentation = presentBalances({
      status: "ready",
      snapshot: buildBalancesSnapshotFixture({ catalog: [holding] }),
      error: null,
    }, { showSmallBalances: false, nowMs: NOW });

    expect(presentation.hiddenRows.some((row) => row.name === holding.name)).toBe(hidden);
    expect(presentation.rows.some((row) => row.name === holding.name)).toBe(!hidden);
  });

  test("never hides cash and restores dust at the end when the setting is on", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: {
          balance: ready("1"),
          value: priced("USD", "1", 3),
          cashValue: pricedCash("USD", "1", 3),
        },
      },
      catalog: [
        catalogHolding(FIXTURE_CATALOG.priced, "1", priced("USD", "9", 3)),
      ],
    });
    const hidden = presentBalances(
      { status: "ready", snapshot, error: null },
      { showSmallBalances: false, nowMs: NOW },
    );
    const shown = presentBalances(
      { status: "ready", snapshot, error: null },
      { showSmallBalances: true, nowMs: NOW },
    );

    expect(hidden.rows.some((row) => row.name === "US dollar")).toBeTrue();
    expect(hidden.rows.some((row) => row.name === "Aerodrome")).toBeFalse();
    expect(hidden.hiddenCount).toBe(1);
    expect(shown.rows.at(-1)?.name).toBe("Aerodrome");
    expect(previewBalanceRows(shown.rows, shown.hiddenRows).some(
      (row) => row.name === "Aerodrome",
    )).toBeFalse();
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
    expect(presentMoneyGroups(snapshot)[0]?.displaySubtotal).toBeNull();
  });

  test("renders a positive non-selected cash holding once in the cash group", () => {
    const snapshot = buildBalancesSnapshotFixture({
      region: "US",
      registry: {
        idrx: {
          balance: ready("1230000"),
          cashValue: pricedCash("IDR", "123", 2),
        },
      },
    });
    const idrRows = presentBalanceRows(snapshot).filter(
      (row) => row.group === "cash" && row.mark.kind === "flag" && row.mark.currency === "IDR",
    );

    expect(idrRows).toHaveLength(1);
  });

  test("keeps an available unpriced cash quantity in the default foreground", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        idrx: {
          balance: ready("23432700"),
          cashValue: { status: "unpriced", reason: "price-unavailable" },
        },
      },
    });

    const idrx = presentBalanceRows(snapshot).find((row) => row.name === "Rupiah");
    expect(idrx).toMatchObject({
      primary: "234,327.00 IDR",
      tone: "default",
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

  test("derives image, native, cash, and symbol marks from holdings", () => {
    const base = buildBalancesSnapshotFixture({
      registry: {
        eth: { balance: ready("1"), value: priced("USD", "100") },
        cbbtc: { balance: ready("1"), value: priced("USD", "200") },
      },
      catalog: [catalogHolding(FIXTURE_CATALOG.priced, "1", priced("USD", "300"))],
    });
    const snapshot = {
      ...base,
      holdings: base.holdings.map((holding) => holding.id === "cbbtc"
        ? { ...holding, imageUrl: "https://assets.example.invalid/cbbtc.png" }
        : holding),
    };
    const rows = presentBalanceRows(snapshot);

    expect(rows.find((row) => row.name === "US dollar")?.mark).toEqual({
      kind: "flag",
      currency: "USD",
    });
    expect(rows.find((row) => row.name === "Ethereum")?.mark).toEqual({ kind: "eth" });
    expect(rows.find((row) => row.name === "Bitcoin")?.mark).toEqual({
      kind: "image",
      url: "https://assets.example.invalid/cbbtc.png",
      fallbackSymbol: "cbBTC",
    });
    expect(rows.find((row) => row.name === "Aerodrome")?.mark).toEqual({
      kind: "image",
      url: FIXTURE_CATALOG.priced.imageUrl,
      fallbackSymbol: "AERO",
    });
  });

  test("uses initials immediately for a registry holding without an image", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        cbbtc: {
          balance: ready("1"),
          value: { status: "unpriced", reason: "price-unavailable" },
        },
      },
    });
    expect(presentBalanceRows(snapshot).find((row) => row.name === "Bitcoin")?.mark).toEqual({
      kind: "symbol",
      symbol: "cbBTC",
    });
  });

  test("does not let priced zero vaults mask funded unpriced savings", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        "morpho-gauntlet-usdc": {
          balance: ready("312000000000000000000"),
          underlyingBalance: ready("320000000"),
          value: { status: "unpriced", reason: "price-unavailable" },
        },
      },
    });

    expect(presentSavedSubtotal(snapshot)).toBeNull();
  });

  test("omits all-zero savings from the hero breakdown", () => {
    const presentation = presentBalances({
      status: "ready",
      snapshot: buildBalancesSnapshotFixture(),
      error: null,
    });

    expect(presentation.breakdown.some((item) => item.id === "saved")).toBeFalse();
  });

  test("maps loading, partial and unavailable total states without sentinel rows", () => {
    expect(presentBalances({ status: "loading", snapshot: null, error: null })).toEqual({
      status: "loading",
      displayTotal: null,
      groups: [],
      breakdown: [],
      rows: [],
      hiddenRows: [],
      hiddenCount: 0,
    });
    const ready = presentBalances({
      status: "ready",
      snapshot: { ...balancesSnapshotFixture, total: { status: "partial", value: decimal("123", 2), currency: "USD" } },
      error: null,
      revalidating: true,
    });
    expect(ready).toMatchObject({
      status: "ready",
      displayTotal: "$1.23",
      totalStatus: "partial",
      breakdown: [
        { id: "cash", label: "Cash", value: "$1,234.56", weight: 762 },
        { id: "saved", label: "Savings", value: "$1,000.12", weight: 618 },
        { id: "investments", label: "Investments", value: "$1,618.20", weight: 1_000 },
      ],
      revalidating: true,
    });
    expect(JSON.stringify(ready.rows)).not.toContain("Updating");
    expect(presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" })).toMatchObject({
      status: "unavailable",
      totalStatus: "unavailable",
    });
  });

  test("prioritizes the country prompt over stale observation age", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "GLOBAL" });

    expect(presentBalances(
      { status: "ready", snapshot: { ...snapshot, stale: true }, error: null },
      { showSmallBalances: false, nowMs: NOW },
    ).statusLabel).toBe("Choose a country in Account to set how money is shown");
  });

  test("labels only stale snapshots with their observation age", () => {
    const snapshot = buildBalancesSnapshotFixture({
      fetchedAt: "2026-09-13T12:00:00.000Z",
    });
    expect(presentBalances(
      { status: "ready", snapshot: { ...snapshot, stale: true }, error: null },
      { showSmallBalances: false, nowMs: NOW },
    ).statusLabel).toBe("Updated 3 min ago");
    expect(presentBalances(
      { status: "ready", snapshot, error: null },
      { showSmallBalances: false, nowMs: NOW },
    ).statusLabel).toBeUndefined();
  });
});

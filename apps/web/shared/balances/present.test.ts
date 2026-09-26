import { describe, expect, test } from "bun:test";
import {
  FIXTURE_BORROW_MARKET_ID,
  FIXTURE_CATALOG,
  FIXTURE_WALLET_TOKEN,
  balancesSnapshotFixture,
  borrowPosition,
  buildBalancesSnapshotFixture,
  catalogHolding,
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
} from "./present";

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
    }, { showSmallBalances: false });

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
      { showSmallBalances: false },
    );
    const shown = presentBalances(
      { status: "ready", snapshot, error: null },
      { showSmallBalances: true },
    );

    expect(hidden.rows.some((row) => row.name === "US dollar")).toBeTrue();
    expect(hidden.rows.some((row) => row.name === "Aerodrome")).toBeFalse();
    expect(hidden.hiddenCount).toBe(1);
    expect(shown.rows.at(-1)?.name).toBe("Aerodrome");
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

  test("maps loading, partial and unavailable net states without sentinel rows", () => {
    expect(presentBalances({ status: "loading", snapshot: null, error: null })).toEqual({
      status: "loading",
      displayTotal: null,
      groups: [],
      breakdown: [],
      summary: null,
      rows: [],
      hiddenRows: [],
      hiddenCount: 0,
    });
    const ready = presentBalances({
      status: "ready",
      snapshot: balancesSnapshotFixture,
      error: null,
      revalidating: true,
    });
    expect(ready).toMatchObject({
      status: "ready",
      displayTotal: "$3,852.88",
      totalStatus: "partial",
      statusLabel: "Some balances are unavailable",
      breakdown: [
        { id: "cash", label: "Cash", value: "$2,234.68", weight: 580 },
        { id: "investments", label: "Investments", value: "$1,618.20", weight: 420 },
      ],
      revalidating: true,
    });
    expect(JSON.stringify(ready.rows)).not.toContain("Updating");
    expect(presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" })).toMatchObject({
      status: "unavailable",
      totalStatus: "unavailable",
      summary: null,
    });
  });

  test("renders the net total, signed breakdown, and Borrow Cash from the snapshot totals", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: {
          balance: ready("12340000"),
          value: priced("USD", "1234"),
          cashValue: pricedCash("USD", "1234"),
        },
      },
      borrow: {
        coverage: "complete",
        positions: [borrowPosition({
          collateralBaseUnits: "100000",
          collateralValue: priced("USD", "7821"),
          debtBaseUnits: "30010000",
          debtValue: priced("USD", "3001"),
        })],
      },
    });
    const presentation = presentBalances({ status: "ready", snapshot, error: null });

    expect(presentation.displayTotal).toBe("$60.54");
    expect(presentation.totalStatus).toBe("complete");
    expect(presentation.statusLabel).toBeUndefined();
    expect(presentation.breakdown.map(({ id, value }) => [id, value])).toEqual([
      ["borrow", "−$30.01"],
      ["cash", "$12.34"],
      ["investments", "$78.21"],
    ]);
    expect(presentation.summary).toEqual({
      cash: { status: "complete", value: "$12.34" },
      investments: { status: "complete", value: "$78.21", assetCount: 1 },
      borrow: { kind: "position", status: "complete", value: "$30.01", rate: "5.10% APR", debts: [{ marketId: FIXTURE_BORROW_MARKET_ID, baseUnits: "30010000" }] },
    });
  });

  test("keeps breakdown weights exact beyond float range", () => {
    const huge = `1${"0".repeat(400)}`;
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: {
          balance: ready("1000000"),
          value: priced("USD", `3${huge}`),
          cashValue: pricedCash("USD", `3${huge}`),
        },
        eth: { balance: ready("1"), value: priced("USD", `1${huge}`) },
        cbbtc: { balance: ready("100000"), value: priced("USD", `6${huge}`) },
      },
    });
    const presentation = presentBalances({ status: "ready", snapshot, error: null });

    expect(presentation.breakdown.map(({ id, weight }) => [id, weight])).toEqual([
      ["cash", 301],
      ["investments", 699],
    ]);
  });

  test("counts a wallet asset and the same asset held as collateral once", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        cbbtc: { balance: ready("100000"), value: priced("USD", "6000") },
        eth: { balance: ready("1"), value: priced("USD", "100") },
      },
      borrow: {
        coverage: "complete",
        positions: [borrowPosition({
          collateralBaseUnits: "100000",
          collateralValue: priced("USD", "6000"),
          debtBaseUnits: "0",
          debtValue: priced("USD", "0"),
        })],
      },
    });
    const summary = presentBalances({ status: "ready", snapshot, error: null }).summary;

    expect(summary?.investments.assetCount).toBe(2);
    expect(summary?.borrow).toEqual({ kind: "none" });
  });

  test("shows a negative net with a leading minus when debt exceeds assets", () => {
    const snapshot = buildBalancesSnapshotFixture({
      borrow: {
        coverage: "complete",
        positions: [borrowPosition({
          collateralBaseUnits: "0",
          collateralValue: priced("USD", "0"),
          debtBaseUnits: "5000000",
          debtValue: priced("USD", "500"),
        })],
      },
    });

    expect(presentBalances({ status: "ready", snapshot, error: null }).displayTotal).toBe("−$5.00");
  });

  test("keeps catalog-incomplete net partial in the hero presentation", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: { eth: { balance: ready("1"), value: priced("USD", "100") } },
      coverage: { catalog: "incomplete" },
    });
    const presentation = presentBalances({ status: "ready", snapshot, error: null });

    expect(presentation.totalStatus).toBe("partial");
    expect(presentation.statusLabel).toBe("Some balances are unavailable");
  });

  test("never presents a gross total as net when the Borrow read is incomplete", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: {
          balance: ready("12340000"),
          value: priced("USD", "1234"),
          cashValue: pricedCash("USD", "1234"),
        },
      },
      borrow: { coverage: "partial", positions: [] },
    });
    const presentation = presentBalances({ status: "ready", snapshot, error: null });

    expect(presentation.totalStatus).toBe("partial");
    expect(presentation.statusLabel).toBe("Some balances are unavailable");
    expect(presentation.summary?.borrow).toEqual({ kind: "unavailable" });
    expect(presentation.breakdown.some((item) => item.id === "borrow")).toBeFalse();
  });

  test("keeps a known partial Borrow debt partial instead of complete", () => {
    const snapshot = buildBalancesSnapshotFixture({
      borrow: {
        coverage: "partial",
        positions: [borrowPosition({
          collateralBaseUnits: "100000",
          collateralValue: priced("USD", "7821"),
          debtBaseUnits: "30010000",
          debtValue: priced("USD", "3001"),
        })],
      },
    });
    const presentation = presentBalances({ status: "ready", snapshot, error: null });

    expect(presentation.totalStatus).toBe("partial");
    expect(presentation.summary?.borrow).toEqual({
      kind: "position",
      status: "partial",
      value: "$30.01",
      rate: "5.10% APR",
      debts: [{ marketId: FIXTURE_BORROW_MARKET_ID, baseUnits: "30010000" }],
    });
  });

  test("weights the Borrow APR by debt value across positions", () => {
    const snapshot = buildBalancesSnapshotFixture({
      borrow: {
        coverage: "complete",
        positions: [
          borrowPosition({
            collateralBaseUnits: "100000",
            collateralValue: priced("USD", "10000"),
            debtBaseUnits: "30000000",
            debtValue: priced("USD", "3000"),
            borrowAprWad: "40000000000000000",
          }),
          borrowPosition({
            marketId: `0x${"b".repeat(64)}`,
            collateralBaseUnits: "100000",
            collateralValue: priced("USD", "10000"),
            debtBaseUnits: "10000000",
            debtValue: priced("USD", "1000"),
            borrowAprWad: "80000000000000000",
          }),
        ],
      },
    });
    const summary = presentBalances({ status: "ready", snapshot, error: null }).summary;

    expect(summary?.borrow).toMatchObject({ kind: "position", rate: "5.00% APR" });
  });

  test("normalizes unpriced Borrow debt by token decimals when weighting the APR", () => {
    const cheap = borrowPosition({
      collateralBaseUnits: "100000",
      collateralValue: priced("USD", "10000"),
      debtBaseUnits: "30000000",
      debtValue: { status: "unavailable" },
      borrowAprWad: "40000000000000000",
    });
    const eighteenDecimals = borrowPosition({
      marketId: `0x${"c".repeat(64)}`,
      collateralBaseUnits: "100000",
      collateralValue: priced("USD", "10000"),
      debtBaseUnits: "10000000000000000000",
      debtValue: priced("USD", "1000"),
      borrowAprWad: "80000000000000000",
    });
    const snapshot = buildBalancesSnapshotFixture({
      borrow: {
        coverage: "complete",
        positions: [
          cheap,
          { ...eighteenDecimals, debt: { ...eighteenDecimals.debt, asset: { ...eighteenDecimals.debt.asset, decimals: 18 } } },
        ],
      },
    });
    const summary = presentBalances({ status: "ready", snapshot, error: null }).summary;

    expect(summary?.borrow).toMatchObject({ kind: "position", rate: "5.00% APR" });
  });

  test("prioritizes the country prompt over stale snapshot state", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "GLOBAL" });

    const presentation = presentBalances(
      { status: "ready", snapshot: { ...snapshot, stale: true }, error: null },
      { showSmallBalances: false },
    );

    expect(presentation.statusLabel).toBe("Choose a country in Account to set how money is shown");
    expect(presentation.needsCountry).toBeTrue();
  });

  test("does not label a cached or revalidating snapshot with its observation age", () => {
    const snapshot = buildBalancesSnapshotFixture({
      fetchedAt: "2026-09-13T12:00:00.000Z",
    });
    expect(presentBalances(
      { status: "ready", snapshot: { ...snapshot, stale: true }, error: null },
      { showSmallBalances: false },
    ).statusLabel).toBeUndefined();
    expect(presentBalances(
      { status: "ready", snapshot: { ...snapshot, stale: true }, error: null, revalidating: true },
      { showSmallBalances: false },
    ).statusLabel).toBeUndefined();
    expect(presentBalances(
      { status: "ready", snapshot, error: null },
      { showSmallBalances: false },
    ).statusLabel).toBeUndefined();
  });
});

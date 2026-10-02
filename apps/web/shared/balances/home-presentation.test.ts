import { describe, expect, test } from "bun:test";
import { parseBalancesSnapshot } from "./contract";
import {
  borrowPosition, buildBalancesSnapshotFixture, catalogHolding, FIXTURE_CATALOG, FIXTURE_WALLET_TOKEN,
  priced, pricedCash, ready, unavailableBalance, walletHolding, type BalancesFixtureOptions,
} from "./fixtures";
import { presentCashTotal, presentHomeBalances } from "./present";

describe("focused Home and Cash presentation", () => {
  test("counts assets without reading labels or formatting each investment", () => {
    const holding = walletHolding(FIXTURE_WALLET_TOKEN, "1000000000000000000", { status: "unpriced", reason: "price-unavailable" });
    const snapshot = buildBalancesSnapshotFixture({ catalog: [holding] });
    Object.defineProperty(holding, "name", { get() { throw new Error("Summary must not sort or format investment labels"); } });
    Object.defineProperty(holding, "symbol", { get() { throw new Error("Summary must not format investment symbols"); } });
    Object.defineProperty(holding, "imageUrl", { get() { throw new Error("Summary must not prepare row marks"); } });
    const summary = presentHomeBalances({ status: "ready", snapshot, error: null }).summary;
    expect(summary?.investments).toEqual({ status: "unavailable", value: null, assetCount: 0, ownedCount: 1 });
  });

  test("preserves separate visible and owned counts for dust, unpriced holdings and shared collateral", () => {
    const snapshot = buildBalancesSnapshotFixture({
      catalog: [
        catalogHolding(FIXTURE_CATALOG.priced, "100", { status: "unpriced", reason: "price-unavailable" }),
        walletHolding(FIXTURE_WALLET_TOKEN, "100", { status: "unpriced", reason: "price-unavailable" }),
        walletHolding({ address: "0x1111111111111111111111111111111111111111", name: "Dust", symbol: "DUST", decimals: 18 }, "1", priced("USD", "1", 3)),
      ],
      borrow: { coverage: "complete", positions: [
        borrowPosition({ collateralBaseUnits: "100", collateralValue: priced("USD", "100"), debtBaseUnits: "0", debtValue: priced("USD", "0") }),
        borrowPosition({ marketId: `0x${"b".repeat(64)}`, collateralBaseUnits: "200", collateralValue: priced("USD", "200"), debtBaseUnits: "0", debtValue: priced("USD", "0") }),
      ] },
    });
    expect(presentHomeBalances({ status: "ready", snapshot, error: null }).summary?.investments)
      .toMatchObject({ assetCount: 2, ownedCount: 4 });
  });

  test.each([
    { status: "complete" as const, expected: { status: "complete", value: "$12.34" } },
    { status: "partial" as const, expected: { status: "partial", value: "$12.34" } },
    { status: "unavailable" as const, expected: { status: "unavailable", value: null } },
    { status: "no-quote-currency" as const, expected: { status: "unavailable", value: null } },
  ])("reads $status Cash totals without walking holdings", ({ status, expected }) => {
    const snapshot = buildBalancesSnapshotFixture();
    snapshot.totals.cash = { status, value: { atoms: "1234", scale: 2 }, currency: "USD" };
    Object.defineProperty(snapshot, "holdings", { get() { throw new Error("Cash total must not walk holdings"); } });
    expect(presentCashTotal(snapshot)).toEqual(expected);
  });

  test("keeps loading and failed Home summaries honest without list fields", () => {
    expect(presentHomeBalances({ status: "loading", snapshot: null, error: null }))
      .toEqual({ status: "loading", displayTotal: null, breakdown: [], summary: null });
    expect(presentHomeBalances({ status: "error", snapshot: null, error: "balances-unavailable" }))
      .toEqual({ status: "unavailable", displayTotal: null, totalStatus: "unavailable", statusLabel: "Balance unavailable", breakdown: [], summary: null });
  });
});

function validatedHomeSnapshot(options: BalancesFixtureOptions = {}) {
  const snapshot = buildBalancesSnapshotFixture(options);
  expect(parseBalancesSnapshot(snapshot, {
    subject: "cdp:test",
    smartAccountAddress: snapshot.owner.address,
    chainId: snapshot.owner.chainId,
  }, snapshot.region)).toEqual(snapshot);
  return snapshot;
}

describe("Home balance figure status", () => {
  test("presents complete balances and breakdown with no status label or reasons", () => {
    const snapshot = validatedHomeSnapshot({
      registry: {
        usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
        eth: { balance: ready("1"), value: priced("USD", "2345") },
      },
    });
    const view = presentHomeBalances({ status: "ready", snapshot, error: null });
    expect(view.displayTotal).toBe("$35.79");
    expect(view.totalStatus).toBe("complete");
    expect(view.statusLabel).toBeUndefined();
    expect(view).not.toHaveProperty("statusReasons");
    expect(view.breakdown).toEqual([
      { id: "cash", label: "Cash", value: "$12.34", weight: 345, status: "complete" },
      { id: "investments", label: "Investments", value: "$23.45", weight: 655, status: "complete" },
    ]);
  });

  test.each([false, true])("marks known pending cash-out escrow partial only when its estimate is partial (%s)", (partial) => {
    const snapshot = validatedHomeSnapshot();
    const usdc = snapshot.holdings.find(({ id }) => id === "usdc");
    if (!usdc) throw new Error("USDC fixture missing");
    usdc.unitValue = { currency: "USD", amount: { atoms: "1", scale: 0 } };
    const view = presentHomeBalances({ status: "ready", snapshot, error: null }, {
      pendingCashout: { state: "escrow", baseUnits: "20000000", partial },
    });
    expect(view.breakdown.find(({ id }) => id === "pending-cash-out")).toEqual({
      id: "pending-cash-out", label: "Pending cash-out", value: "$20.00", weight: 1000, status: partial ? "partial" : "complete",
    });
    expect(view.totalStatus).toBe(partial ? "partial" : "complete");
  });

  test("keeps the exact known sum and partial breakdown when balances or prices are missing", () => {
    const snapshot = validatedHomeSnapshot({
      registry: {
        usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
        eth: { balance: ready("1"), value: priced("USD", "2345") },
        cbbtc: { balance: ready("1"), value: { status: "unpriced", reason: "price-stale" } },
        toshi: { balance: unavailableBalance },
      },
    });
    const view = presentHomeBalances({ status: "ready", snapshot, error: null });
    expect(view.displayTotal).toBe("$35.79");
    expect(view.totalStatus).toBe("partial");
    expect(view.statusLabel).toBe("Partial balance");
    expect(view.statusReasons).toEqual(["unreadable", "price-delayed"]);
    expect(view.breakdown).toEqual([
      { id: "cash", label: "Cash", value: "$12.34", weight: 345, status: "complete" },
      { id: "investments", label: "Investments", value: "$23.45", weight: 655, status: "partial" },
    ]);
  });

  test("distinguishes a known zero from an unavailable balance", () => {
    const snapshot = validatedHomeSnapshot();
    const view = presentHomeBalances({ status: "ready", snapshot, error: null });
    expect(view.displayTotal).toBe("$0.00");
    expect(view.totalStatus).toBe("complete");
    expect(view.statusLabel).toBeUndefined();
    expect(view).not.toHaveProperty("statusReasons");
    expect(view.breakdown).toEqual([]);
    expect(view.summary).toEqual({
      cash: { status: "complete", value: "$0.00" },
      investments: { status: "complete", value: "$0.00", assetCount: 0, ownedCount: 0 },
      borrow: { kind: "none", hasCollateral: false },
    });
  });

  test("never fabricates zero when all holdings are unavailable", () => {
    const registry = Object.fromEntries(buildBalancesSnapshotFixture().holdings.map(({ id }) =>
      [id, { balance: unavailableBalance }]
    ));
    const snapshot = validatedHomeSnapshot({ registry });
    const view = presentHomeBalances({ status: "ready", snapshot, error: null });
    expect(view.displayTotal).toBe("—");
    expect(view.totalStatus).toBe("unavailable");
    expect(view.statusLabel).toBe("Balance unavailable");
    expect(view.statusReasons).toEqual(["unreadable"]);
    expect(view.summary?.cash).toEqual({ status: "unavailable", value: null });
    expect(view.summary?.investments).toMatchObject({ status: "unavailable", value: null });
    expect(view.breakdown).toEqual([]);
    expect(JSON.stringify([view.displayTotal, view.summary, view.breakdown])).not.toContain("$0.00");
  });

  test("withholds net when a positive loan debt cannot be priced", () => {
    const snapshot = validatedHomeSnapshot({
      borrow: { coverage: "complete", positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: priced("USD", "7821"),
        debtBaseUnits: "30010000", debtValue: { status: "unpriced", reason: "price-unavailable" },
      })] },
    });
    expect(snapshot.totals.net.status).toBe("partial");
    expect(snapshot.totals.net.value).not.toBeNull();
    const view = presentHomeBalances({ status: "ready", snapshot, error: null });
    expect(view.displayTotal).toBe("—");
    expect(view.totalStatus).toBe("unavailable");
    expect(view.statusLabel).toBe("Balance unavailable");
    expect(view.statusReasons).toEqual(["value-unavailable", "loan-unpriced"]);
    expect(view.summary?.borrow).toMatchObject({ kind: "position", status: "unavailable", value: null });
    expect(view.breakdown).toEqual([
      { id: "borrow", label: "Borrow", value: "—", weight: 0, status: "unavailable" },
      { id: "cash", label: "Cash", value: "$0.00", weight: 0, status: "complete" },
      { id: "investments", label: "Investments", value: "$78.21", weight: 1000, status: "complete" },
    ]);
  });

  test("keeps the server's known sum partial when loan existence is unconfirmed", () => {
    const snapshot = validatedHomeSnapshot({
      registry: { usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") } },
      borrow: { coverage: "partial", positions: [] },
    });
    const view = presentHomeBalances({ status: "ready", snapshot, error: null });
    expect(view.displayTotal).toBe("$12.34");
    expect(view.totalStatus).toBe("partial");
    expect(view.statusLabel).toBe("Partial balance");
    expect(view.statusReasons).toEqual(["borrow-unconfirmed"]);
    expect(view.summary?.borrow).toEqual({ kind: "unavailable" });
    expect(view.breakdown).toEqual([
      { id: "cash", label: "Cash", value: "$12.34", weight: 1000, status: "complete" },
      { id: "investments", label: "Investments", value: "—", weight: 0, status: "unavailable" },
    ]);
  });

  test("retains an unavailable investments part without giving it a weight", () => {
    const snapshot = validatedHomeSnapshot({
      registry: {
        usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
        eth: { balance: unavailableBalance },
      },
    });
    expect(presentHomeBalances({ status: "ready", snapshot, error: null }).breakdown).toEqual([
      { id: "cash", label: "Cash", value: "$12.34", weight: 1000, status: "complete" },
      { id: "investments", label: "Investments", value: "—", weight: 0, status: "unavailable" },
    ]);
  });

  test.each(["incomplete", "unavailable"] as const)("explains %s catalog coverage without an unavailable holding", (catalog) => {
    const snapshot = validatedHomeSnapshot({
      registry: { eth: { balance: ready("1"), value: priced("USD", "100") } },
      coverage: { catalog },
    });
    expect(presentHomeBalances({ status: "ready", snapshot, error: null }).statusReasons).toEqual(["unreadable"]);
  });

  test("orders and deduplicates every reason while keeping unpriced-loan net unavailable", () => {
    const snapshot = validatedHomeSnapshot({
      registry: { eth: { balance: unavailableBalance } },
      coverage: { catalog: "incomplete" },
      borrow: { coverage: "partial", positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: { status: "unpriced", reason: "price-stale" },
        debtBaseUnits: "30010000", debtValue: { status: "unpriced", reason: "price-unavailable" },
      })] },
    });
    const view = presentHomeBalances({ status: "ready", snapshot, error: null }, { pendingCashout: { state: "indeterminate" } });
    expect(view.totalStatus).toBe("unavailable");
    expect(view.statusReasons).toEqual(["unreadable", "price-delayed", "value-unavailable", "borrow-unconfirmed", "loan-unpriced", "pending-cash-out"]);
  });

  test("keeps country selection ahead of loan and pending-cash-out status", () => {
    const snapshot = validatedHomeSnapshot({
      region: "GLOBAL",
      borrow: { coverage: "partial", positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: { status: "unpriced", reason: "no-quote-currency" },
        debtBaseUnits: "30010000", debtValue: { status: "unpriced", reason: "no-quote-currency" },
      })] },
    });
    const view = presentHomeBalances({ status: "ready", snapshot, error: null }, { pendingCashout: { state: "indeterminate" } });
    expect(view.displayTotal).toBe("—");
    expect(view.totalStatus).toBe("unavailable");
    expect(view.statusLabel).toBe("Choose a country in Account to set how money is shown");
    expect(view.needsCountry).toBe(true);
    expect(view).not.toHaveProperty("statusReasons");
    expect(view.breakdown).toEqual([]);
  });

  test("does not interpret an unpriced zero debt as an unpriced loan", () => {
    const snapshot = validatedHomeSnapshot({
      borrow: { coverage: "complete", positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: priced("USD", "7821"),
        debtBaseUnits: "0", debtValue: { status: "unpriced", reason: "price-unavailable" },
      })] },
    });
    const view = presentHomeBalances({ status: "ready", snapshot, error: null });
    expect(view.displayTotal).toBe("$78.21");
    expect(view.totalStatus).toBe("complete");
    expect(view.statusLabel).toBeUndefined();
    expect(view).not.toHaveProperty("statusReasons");
    expect(view.summary?.borrow).toEqual({ kind: "none", hasCollateral: true });
    expect(view.breakdown.some(({ id }) => id === "borrow")).toBe(false);
  });

  test("explains delayed collateral pricing even without a loan", () => {
    const snapshot = validatedHomeSnapshot({
      registry: { eth: { balance: ready("1"), value: priced("USD", "100") } },
      borrow: { coverage: "complete", positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: { status: "unpriced", reason: "price-stale" },
        debtBaseUnits: "0", debtValue: priced("USD", "0"),
      })] },
    });
    const view = presentHomeBalances({ status: "ready", snapshot, error: null });
    expect(view.displayTotal).toBe("$1.00");
    expect(view.totalStatus).toBe("partial");
    expect(view.statusReasons).toEqual(["price-delayed"]);
  });
});

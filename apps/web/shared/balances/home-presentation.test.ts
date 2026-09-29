import { describe, expect, test } from "bun:test";
import { borrowPosition, buildBalancesSnapshotFixture, catalogHolding, FIXTURE_CATALOG, FIXTURE_WALLET_TOKEN, priced, walletHolding } from "./fixtures";
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

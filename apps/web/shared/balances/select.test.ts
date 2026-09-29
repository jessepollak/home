import { describe, expect, test } from "bun:test";
import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import {
  balancesSnapshotFixture,
  borrowPosition,
  buildBalancesSnapshotFixture,
  catalogHolding,
  FIXTURE_BORROW_MARKET_ID,
  FIXTURE_CATALOG,
  FIXTURE_WALLET_TOKEN,
  priced,
  ready,
  unavailableBalance,
  walletHolding,
} from "./fixtures";
import {
  selectBalanceBaseUnits,
  selectBalanceTotals,
  selectBorrowPositions,
  selectCash,
  selectCollateralHoldings,
  selectMoneyGroups,
  selectSendable,
  selectVaultPositions,
} from "./select";

describe("balance selectors", () => {
  test("selects only positive ready registry transfer assets with base units", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("0") },
        cbbtc: { balance: ready("100000") },
        eth: { balance: ready("1") },
        "morpho-steakhouse-usdc": { balance: ready("1"), underlyingBalance: ready("5") },
      },
      catalog: balancesSnapshotFixture.holdings.filter((holding) => holding.source === "catalog"),
    });

    expect(selectSendable(snapshot)).toEqual([
      { ...getTransferAsset("eth")!, balanceBaseUnits: "1" },
      { ...getTransferAsset("cbbtc")!, balanceBaseUnits: "100000" },
    ]);
  });

  test("shapes vault positions and preserves unavailable underlying balances", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        "morpho-steakhouse-usdc": { balance: ready("1"), underlyingBalance: ready("1000123") },
        "morpho-gauntlet-usdc": { balance: ready("1"), underlyingBalance: unavailableBalance },
      },
    });

    const positions = selectVaultPositions(snapshot);
    expect(positions).toHaveLength(3);
    expect(positions.find((entry) => entry.position?.assetsRaw === "1000123")).toBeDefined();
    expect(positions.filter((entry) => entry.position === null)).toHaveLength(1);
  });

  test("orders selected local cash, canonical USD, then other positive cash", () => {
    const us = buildBalancesSnapshotFixture({
      region: "US",
      registry: {
        usdc: { balance: ready("1") },
        eurc: { balance: ready("2") },
        idrx: { balance: ready("3") },
      },
    });
    const de = buildBalancesSnapshotFixture({
      region: "DE",
      registry: {
        usdc: { balance: ready("1") },
        eurc: { balance: ready("2") },
        idrx: { balance: ready("3") },
      },
    });

    expect(selectCash(us).map((entry) => entry.kind === "holding" ? entry.holding.id : entry.key))
      .toEqual(["usdc", "eurc", "idrx"]);
    expect(selectCash(de).map((entry) => entry.kind === "holding" ? entry.holding.id : entry.key))
      .toEqual([verifiedLocalCashAssets.EUR.id, "usdc", "idrx"]);
  });

  test("lists named unreadable extra cash but not zero or unnamed unreadable holdings", () => {
    const base = buildBalancesSnapshotFixture({
      region: "US",
      registry: { usdc: { balance: ready("1000000") }, eurc: { balance: unavailableBalance }, idrx: { balance: ready("0") } },
      coverage: { catalog: "incomplete" },
    });
    const unnamed = { ...base.holdings.find((holding) => holding.id === "idrx")!, name: " ", symbol: " ", balance: unavailableBalance };
    const snapshot = { ...base, holdings: [...base.holdings.filter((holding) => holding.id !== "idrx"), unnamed] };
    expect(selectCash(snapshot).map((entry) => entry.kind === "holding" ? entry.holding.id : entry.key)).toEqual(["usdc", "eurc"]);
    expect(selectMoneyGroups(snapshot).cash).toHaveLength(2);
    expect(selectMoneyGroups(snapshot).investments).toHaveLength(0);
    expect(selectCash(base).some((entry) => entry.kind === "holding" && entry.holding.id === "idrx")).toBe(false);
  });
  test("lists named unreadable investments but not unreadable unnamed or known-zero holdings", () => {
    const unread = walletHolding(FIXTURE_WALLET_TOKEN, "1", { status: "unavailable" });
    const unnamed = { ...unread, id: "unnamed", key: "unnamed" as typeof unread.key, name: " ", symbol: " ", balance: unavailableBalance };
    const snapshot = buildBalancesSnapshotFixture({
      registry: { eth: { balance: ready("1") }, cbbtc: { balance: unavailableBalance }, nvdac: { balance: ready("0") } },
      catalog: [{ ...unread, balance: unavailableBalance }, unnamed],
      coverage: { catalog: "incomplete" },
    });
    expect(selectMoneyGroups(snapshot).investments.map((holding) => holding.id)).toEqual(["eth", "cbbtc", unread.id]);
    expect(selectMoneyGroups(snapshot).cash).toHaveLength(1);
    expect(selectMoneyGroups(snapshot).investments).toHaveLength(3);
    const symbolOnly = walletHolding({ ...FIXTURE_WALLET_TOKEN, name: "  ", symbol: "DISC" }, "1", { status: "unavailable" });
    const symbolSnapshot = buildBalancesSnapshotFixture({ catalog: [{ ...symbolOnly, balance: unavailableBalance }] });
    expect(selectMoneyGroups(symbolSnapshot).investments.map((holding) => holding.key)).toEqual([symbolOnly.key]);
  });

  test("adds an unsupported local placeholder ahead of USDC", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "BR" });
    expect(selectCash(snapshot).map((entry) => entry.kind)).toEqual(["unsupported", "holding"]);
    expect(selectCash(snapshot)[0]).toMatchObject({ currency: "BRL", symbol: "wBRL" });
  });

  test("the cash group keeps the authored regional order even when USD is larger", () => {
    const de = buildBalancesSnapshotFixture({
      region: "DE",
      registry: {
        usdc: { balance: ready("5000000000"), value: priced("EUR", "460000") },
        eurc: { balance: ready("1000000"), value: priced("EUR", "100") },
      },
    });
    expect(selectMoneyGroups(de).cash.map((entry) => entry.kind === "holding" ? entry.holding.id : entry.key))
      .toEqual([verifiedLocalCashAssets.EUR.id, "usdc"]);
  });

  test("classifies stablecoins as cash and every non-vault asset as one investments group", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("100"), value: priced("USD", "100") },
        eurc: { balance: ready("200"), value: priced("USD", "200") },
        idrx: { balance: ready("300"), value: priced("USD", "300") },
        eth: { balance: ready("1"), value: priced("USD", "900") },
        cbbtc: { balance: ready("1"), value: priced("USD", "800") },
        nvdac: { balance: ready("1"), value: priced("USD", "700") },
        "morpho-steakhouse-usdc": {
          balance: ready("1"),
          underlyingBalance: ready("1000000"),
          value: priced("USD", "100"),
        },
      },
      catalog: [catalogHolding(FIXTURE_CATALOG.priceMissing, "1", {
        status: "unpriced",
        reason: "price-unavailable",
      })],
    });

    const groups = selectMoneyGroups(snapshot);
    const cases = [
      ["usdc", "cash"],
      ["eurc", "cash"],
      ["idrx", "cash"],
      ["eth", "investments"],
      ["cbbtc", "investments"],
      ["nvdac", "investments"],
      ["morpho-steakhouse-usdc", "excluded"],
      [`catalog:${FIXTURE_CATALOG.priceMissing.address}`, "investments"],
    ] as const;
    const cashIds = new Set(groups.cash.flatMap((entry) =>
      entry.kind === "holding" ? [entry.holding.id] : []
    ));
    const investmentIds = new Set(groups.investments.map((holding) => holding.id));
    for (const [id, expected] of cases) {
      expect(cashIds.has(id) ? "cash" : investmentIds.has(id) ? "investments" : "excluded")
        .toBe(expected);
    }
    expect(groups.investments.at(-1)?.value.status).toBe("unpriced");
  });

  test("counts displayed cash and positive or unreadable named assets without vault shares", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("0") },
        eth: { balance: ready("1") },
        cbbtc: { balance: unavailableBalance },
        "morpho-steakhouse-usdc": { balance: ready("1"), underlyingBalance: ready("5") },
      },
      catalog: [catalogHolding(FIXTURE_CATALOG.priced, "1", priced("USD", "1"))],
    });

    expect(selectMoneyGroups(snapshot).cash).toHaveLength(1);
    expect(selectMoneyGroups(snapshot).investments).toHaveLength(3);
  });

  test("returns null for unavailable and preserves successful zero", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: unavailableBalance },
        eth: { balance: ready("0") },
      },
    });
    expect(selectBalanceBaseUnits(snapshot, "usdc")).toBeNull();
    expect(selectBalanceBaseUnits(snapshot, "eth")).toBe("0");
    expect(selectBalanceBaseUnits(snapshot, "missing")).toBeNull();
  });
});

describe("borrow selectors", () => {
  test("expose net totals, positions, and positive collateral holdings without changing money groups", () => {
    const base = buildBalancesSnapshotFixture({
      registry: { cbbtc: { balance: ready("100000"), value: priced("USD", "5000") } },
    });
    const snapshot = buildBalancesSnapshotFixture({
      registry: { cbbtc: { balance: ready("100000"), value: priced("USD", "5000") } },
      borrow: {
        coverage: "complete",
        positions: [borrowPosition({
          collateralBaseUnits: "200000",
          collateralValue: priced("USD", "10000"),
          debtBaseUnits: "30000000",
          debtValue: priced("USD", "3000"),
        })],
      },
    });

    expect(selectMoneyGroups(snapshot)).toEqual(selectMoneyGroups(base));
    expect(selectBorrowPositions(snapshot)).toHaveLength(1);
    expect(selectCollateralHoldings(snapshot).map((holding) => holding.collateral.marketId))
      .toEqual([FIXTURE_BORROW_MARKET_ID]);
    expect(selectBalanceTotals(snapshot).net.negative).toBe(false);
    expect(selectBalanceTotals(snapshot).net.status).toBe("complete");
  });

  test("omit collateral holdings for a borrow-only position", () => {
    const snapshot = buildBalancesSnapshotFixture({
      borrow: {
        coverage: "complete",
        positions: [borrowPosition({
          collateralBaseUnits: "0",
          collateralValue: priced("USD", "0"),
          debtBaseUnits: "1",
          debtValue: priced("USD", "1"),
        })],
      },
    });
    expect(selectCollateralHoldings(snapshot)).toEqual([]);
    expect(selectBorrowPositions(snapshot)[0]?.debt.sign).toBe(-1);
  });
});

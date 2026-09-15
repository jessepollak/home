import { describe, expect, test } from "bun:test";
import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import {
  balancesSnapshotFixture,
  buildBalancesSnapshotFixture,
  catalogHolding,
  FIXTURE_CATALOG,
  priced,
  ready,
  unavailableBalance,
} from "./fixtures";
import {
  selectAssetCount,
  selectBalanceBaseUnits,
  selectCash,
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

  test("counts displayed cash and positive assets without vault shares or unavailable rows", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("0") },
        eth: { balance: ready("1") },
        cbbtc: { balance: unavailableBalance },
        "morpho-steakhouse-usdc": { balance: ready("1"), underlyingBalance: ready("5") },
      },
      catalog: [catalogHolding(FIXTURE_CATALOG.priced, "1", priced("USD", "1"))],
    });

    expect(selectAssetCount(snapshot)).toBe(3);
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

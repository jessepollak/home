import { describe, expect, test } from "bun:test";
import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import {
  balancesSnapshotFixture,
  buildBalancesSnapshotFixture,
  ready,
  unavailableBalance,
} from "./fixtures";
import {
  selectBalanceBaseUnits,
  selectCash,
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
    expect(selectCash(snapshot)[0]).toMatchObject({ currency: "BRL", symbol: "BRZ" });
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

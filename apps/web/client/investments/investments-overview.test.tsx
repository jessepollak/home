import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { cryptoAssets } from "@/config/invest-assets";
import { buildBalancesSnapshotFixture, walletHolding } from "@/shared/balances/fixtures";

const { holdingsQuantity, quantity } = await import("./investments-overview");

function configuredCrypto(id: string) {
  const asset = cryptoAssets.find((entry) => entry.id === id);
  if (!asset) throw new Error(`missing configured asset ${id}`);
  return { symbol: asset.representation.tokenSymbol, decimals: asset.representation.decimals };
}

function holdingAt(address: string, symbol: string, decimals: number, baseUnits: string) {
  return walletHolding({ address, name: symbol, symbol, decimals }, baseUnits, {
    status: "unpriced",
    reason: "price-unavailable",
  });
}

describe("investments route quantity precision", () => {
  test("formats a configured crypto quantity at major precision without an explicit category", () => {
    const { symbol, decimals } = configuredCrypto("cbhype");
    const baseUnits = (BigInt(12345) * BigInt(10) ** BigInt(decimals - 4)).toString();
    const holding = holdingAt("0x1111111111111111111111111111111111111111", symbol, decimals, baseUnits);
    expect(quantity(holding, buildBalancesSnapshotFixture())).toBe(`1.2345 ${symbol}`);
  });

  test("keeps a configured crypto collateral aggregate at major precision", () => {
    const { symbol, decimals } = configuredCrypto("cbzec");
    const baseUnits = (BigInt(12345) * BigInt(10) ** BigInt(decimals - 4)).toString();
    const wallet = holdingAt("0x2222222222222222222222222222222222222222", symbol, decimals, baseUnits);
    const collateral = holdingAt("0x3333333333333333333333333333333333333333", symbol, decimals, baseUnits);
    expect(holdingsQuantity([wallet, collateral], wallet, buildBalancesSnapshotFixture()))
      .toBe(`2.4690 ${symbol}`);
  });
});

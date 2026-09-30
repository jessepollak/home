import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { cryptoAssets } from "@/config/invest-assets";
import { buildBalancesSnapshotFixture, walletHolding } from "@/shared/balances/fixtures";

const { OwnedAssetDetail } = await import("./owned-asset-detail");
const { InvestmentsOverview, holdingsQuantity, quantity } = await import("./investments-overview");

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
  test("reuses snapshot selection when revealing rows and discards it on owner replacement", () => {
    const catalog = Array.from({ length: 25 }, (_, index) =>
      holdingAt(`0x${(index + 100).toString(16).padStart(40, "0")}`, `Asset ${String(index).padStart(2, "0")}`, 18, "1000000000000000000"));
    const snapshot = buildBalancesSnapshotFixture({ catalog });
    const holdings = snapshot.holdings;
    let reads = 0;
    Object.defineProperty(snapshot, "holdings", { get: () => { reads += 1; return holdings; } });
    const props = { snapshot, balanceStatus: "ready" as const, visibleCount: 20, onVisibleCountChange: () => {}, onOpenAsset: () => {}, onRetryBalances: () => {} };
    const view = render(<InvestmentsOverview {...props} />);
    expect(view.getAllByRole("button", { description: /^Open Asset / })).toHaveLength(20);
    const initialReads = reads;
    view.rerender(<InvestmentsOverview {...props} visibleCount={25} />);
    expect(view.getAllByRole("button", { description: /^Open Asset / })).toHaveLength(25);
    expect(reads).toBe(initialReads);
    const replacement = buildBalancesSnapshotFixture({ catalog: [holdingAt("0x9999999999999999999999999999999999999999", "Replacement", 18, "1000000000000000000")] });
    replacement.owner = { ...replacement.owner, address: "0x9999999999999999999999999999999999999999" };
    view.rerender(<InvestmentsOverview {...props} snapshot={replacement} />);
    expect(view.queryByRole("button", { description: /^Open Asset / })).toBeNull();
    expect(view.getByRole("button", { description: "Open Replacement" })).toBeTruthy();
    view.rerender(<InvestmentsOverview {...props} snapshot={null} balanceStatus="loading" />);
    expect(view.queryByRole("button", { description: "Open Replacement" })).toBeNull();
  });

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

test("owned detail reuses its selection on refresh status and replaces it with the owner snapshot", () => {
  const snapshot = buildBalancesSnapshotFixture({ registry: { eth: { balance: { status: "ready", baseUnits: "1000000000000000000" }, value: { status: "priced", currency: "USD", amount: { atoms: "123400", scale: 2 }, asOf: "2026-09-10T12:00:00.000Z" } } } });
  const holdings = snapshot.holdings;
  const assetKey = holdings.find((holding) => holding.id === "eth")!.key;
  let reads = 0;
  Object.defineProperty(snapshot, "holdings", { get: () => { reads += 1; return holdings; } });
  const props = { snapshot, balanceStatus: "ready" as const, assetKey, catalog: [], markets: { stockMarket: { status: "unavailable" as const }, memeMarket: { status: "unavailable" as const }, cryptoMarket: { status: "unavailable" as const } }, assetMarkResolution: {}, onBack: () => {}, onRetryBalances: () => {} };
  const view = render(<OwnedAssetDetail {...props} />);
  expect(view.getByRole("img", { name: "$1,234.00" })).toBeTruthy();
  const initialReads = reads;
  view.rerender(<OwnedAssetDetail {...props} refreshFailed />);
  expect(reads).toBe(initialReads);
  const replacement = buildBalancesSnapshotFixture();
  replacement.owner = { ...replacement.owner, address: "0x9999999999999999999999999999999999999999" };
  view.rerender(<OwnedAssetDetail {...props} snapshot={replacement} />);
  expect(view.queryByRole("img", { name: "$1,234.00" })).toBeNull();
});

test("pending rows preserve their list section only within the same owner and region", () => {
  const snapshot = buildBalancesSnapshotFixture();
  const props = { snapshot, balanceStatus: "ready" as const, ownedRows: [], rowsPending: true,
    visibleCount: 20, onVisibleCountChange: () => {}, onOpenAsset: () => {}, onRetryBalances: () => {} };
  const view = render(<InvestmentsOverview {...props} />);
  const initial = view.getByRole("region", { name: "Your investments" });
  view.rerender(<InvestmentsOverview {...props} snapshot={{ ...snapshot, fetchedAt: "2026-09-30T00:00:00.000Z" }} />);
  expect(view.getByRole("region", { name: "Your investments" })).toBe(initial);
  const replacement: typeof snapshot = { ...snapshot, owner: { ...snapshot.owner, address: "0x9999999999999999999999999999999999999999" } };
  view.rerender(<InvestmentsOverview {...props} snapshot={replacement} />);
  const ownerSection = view.getByRole("region", { name: "Your investments" });
  expect(ownerSection).not.toBe(initial);
  view.rerender(<InvestmentsOverview {...props} snapshot={{ ...replacement, region: "MX" }} />);
  expect(view.getByRole("region", { name: "Your investments" })).not.toBe(ownerSection);
});

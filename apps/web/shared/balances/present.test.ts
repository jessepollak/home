import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import { formatPresentationTokenAmount, presentationAssetClass } from "@/shared/formatting/money";
import { describe, expect, test } from "bun:test";
import { parseBalancesSnapshot } from "./contract";
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
import type { BalancesFixtureOptions } from "./fixtures";
import type { BalancesSnapshot } from "./types";
import {
  presentBalances,
  presentPendingCashout,
  presentInvestmentTotal,
  presentHoldingMark,
} from "./present";
import { holdingValueContext } from "./value-label";

const unpriced = { status: "unpriced" as const, reason: "price-unavailable" as const };

function presentedRows(snapshot: BalancesSnapshot) {
  return presentBalances({ status: "ready", snapshot, error: null }, { showSmallBalances: true }).rows;
}

describe("focused investment presentation", () => {
  test.each([
    { status: "complete" as const, expected: { status: "complete", value: "$12.34" } },
    { status: "partial" as const, expected: { status: "partial", value: "$12.34" } },
    { status: "unavailable" as const, expected: { status: "unavailable", value: null } },
  ])("preserves $status investment totals without presenting holdings", ({ status, expected }) => {
    const snapshot = buildBalancesSnapshotFixture();
    snapshot.totals.investments = { status, value: { atoms: "1234", scale: 2 }, currency: "USD" };
    Object.defineProperty(snapshot, "holdings", { get: () => { throw new Error("Totals must not walk holdings"); } });
    expect(presentInvestmentTotal(snapshot)).toEqual(expected);
  });

  test("preserves image, native and symbol mark priority", () => {
    const holding = walletHolding(FIXTURE_WALLET_TOKEN, "1", unpriced);
    expect(presentHoldingMark({ ...holding, imageUrl: "https://example.com/token.png" }))
      .toEqual({ kind: "image", url: "https://example.com/token.png", fallbackSymbol: holding.symbol });
    expect(presentHoldingMark({ ...holding, imageUrl: undefined, kind: "native" })).toEqual({ kind: "eth" });
    expect(presentHoldingMark({ ...holding, imageUrl: undefined })).toEqual({ kind: "symbol", symbol: holding.symbol });
  });
});

function validatedPresentationSnapshot(options: BalancesFixtureOptions): BalancesSnapshot {
  const snapshot = buildBalancesSnapshotFixture(options);
  expect(JSON.parse(JSON.stringify(parseBalancesSnapshot(snapshot, {
    subject: "cdp:test",
    smartAccountAddress: snapshot.owner.address,
    chainId: snapshot.owner.chainId,
  }, snapshot.region)))).toEqual(snapshot);
  return snapshot;
}

describe("balance presentation precision", () => {
  test("renders MSFTc at stock precision in priced and unpriced balance rows", () => {
    const asset = stockAssets.find((stock) => stock.id === "msftc");
    if (!asset) throw new Error("Microsoft asset missing");
    const baseUnits = (BigInt(12345) * BigInt(10) ** BigInt(asset.representation.decimals - 4)).toString();
    const pricedRow = presentedRows(validatedPresentationSnapshot({
      registry: { msftc: { balance: ready(baseUnits), value: priced("USD", "200") } },
    })).find((row) => row.name === asset.displayName);
    const unpricedRow = presentedRows(validatedPresentationSnapshot({
      registry: { msftc: { balance: ready(baseUnits), value: unpriced } },
    })).find((row) => row.name === asset.displayName);
    expect(pricedRow?.secondary).toBe("1.2345 MSFTc");
    expect(unpricedRow).toMatchObject({ primary: "1.2345 MSFTc", secondary: null });
  });

  test("formats every configured stock balance and symbol-only quantity at four digits", () => {
    for (const asset of stockAssets) {
      const { tokenSymbol, decimals } = asset.representation;
      const baseUnits = (BigInt(12345) * BigInt(10) ** BigInt(decimals - 4)).toString();
      const row = presentedRows(validatedPresentationSnapshot({
        registry: { [asset.id]: { balance: ready(baseUnits), value: priced("USD", "200") } },
      })).find((entry) => entry.name === asset.displayName);
      expect(row?.secondary).toBe(`1.2345 ${tokenSymbol}`);
      expect(presentationAssetClass({ symbol: tokenSymbol.toLowerCase() })).toBe("major");
      expect(formatPresentationTokenAmount(baseUnits, decimals, tokenSymbol)).toBe(`1.2345 ${tokenSymbol}`);
    }
  });

  test("formats an unconfigured wallet stock contract by its configured symbol", () => {
    const asset = stockAssets.find((stock) => stock.id === "msftc");
    if (!asset) throw new Error("Microsoft asset missing");
    const baseUnits = (BigInt(12345) * BigInt(10) ** BigInt(asset.representation.decimals - 4)).toString();
    const holding = walletHolding({
      address: "0x4444444444444444444444444444444444444444",
      name: asset.displayName,
      symbol: asset.representation.tokenSymbol,
      decimals: asset.representation.decimals,
    }, baseUnits, unpriced);
    const snapshot = validatedPresentationSnapshot({ catalog: [holding] });
    expect(presentedRows(snapshot).find((row) => row.key === holding.key)?.primary)
      .toBe("1.2345 MSFTc");
  });

  test("formats configured crypto via registry and leaves unknown wallet tokens on symbol fallback", () => {
    const assets = cryptoAssets.filter((asset) => ["cbhype", "cbzec", "cbmega"].includes(asset.id));
    expect(assets).toHaveLength(3);
    const registry = Object.fromEntries(assets.map((asset) => [
      asset.id,
      {
        balance: ready((BigInt(12345) * BigInt(10) ** BigInt(asset.representation.decimals - 4)).toString()),
        value: unpriced,
      },
    ]));
    const unknown = walletHolding({ ...FIXTURE_WALLET_TOKEN, symbol: "UNKNOWN" },
      "1234500000000000000", unpriced);
    const rows = presentedRows(validatedPresentationSnapshot({ registry, catalog: [unknown] }));
    for (const asset of assets) {
      expect(rows.find((row) => row.name === asset.displayName)?.primary)
        .toBe(`1.2345 ${asset.representation.tokenSymbol}`);
      expect(presentationAssetClass({ symbol: asset.representation.tokenSymbol })).toBe("major");
      expect(formatPresentationTokenAmount((BigInt(12345) * BigInt(10) ** BigInt(asset.representation.decimals - 4)).toString(), asset.representation.decimals, asset.representation.tokenSymbol)).toBe(`1.2345 ${asset.representation.tokenSymbol}`);
    }
    expect(rows.find((row) => row.key === unknown.key)?.primary).toBe("1.23 UNKNOWN");
  });
});

describe("balance presentation", () => {
  test.each([
    { region: "US" as const, unit: { atoms: "1", scale: 0 }, expected: "$20.00" },
    { region: "GB" as const, unit: { atoms: "8", scale: 1 }, expected: "£16.00" },
  ])("prices remaining escrow in $region without changing wallet Cash", ({ region, unit, expected }) => {
    const snapshot = buildBalancesSnapshotFixture({ region });
    const usdc = snapshot.holdings.find(({ id }) => id === "usdc")!;
    const currency = snapshot.quoteCurrency;
    if (!currency) throw new Error("fixture region must resolve a quote currency");
    usdc.unitValue = { currency, amount: unit };
    const escrow = { state: "escrow" as const, baseUnits: "20000000", partial: false };
    const view = presentBalances({ status: "ready", snapshot, error: null }, { showSmallBalances: false, pendingCashout: escrow });
    expect(view.displayTotal).toBe(expected);
    expect(view.totalStatus).toBe("complete");
    expect(view.summary?.cash.value).toBe(region === "US" ? "$0.00" : "£0.00");
    expect(view.breakdown.map(({ id }) => id)).toEqual(["cash", "pending-cash-out", "investments"]);
    expect(view.breakdown.find(({ id }) => id === "pending-cash-out")?.value).toBe(expected);
    expect(presentPendingCashout(snapshot, escrow)?.value).toBe(expected);
  });

  test("known escrow plus an indeterminate order adds only known funds to a partial total", () => {
    const snapshot = buildBalancesSnapshotFixture();
    snapshot.holdings.find(({ id }) => id === "usdc")!.unitValue = { currency: "USD", amount: { atoms: "1", scale: 0 } };
    const state = { status: "ready" as const, snapshot, error: null };
    const before = presentBalances(state);
    const escrow = { state: "escrow" as const, baseUnits: "20000000", partial: true };
    const view = presentBalances(state, { showSmallBalances: false, pendingCashout: escrow });
    expect(before.totalStatus).toBe("complete");
    expect(view.displayTotal).toBe("$20.00");
    expect(view.breakdown.find(({ id }) => id === "pending-cash-out")?.value).toBe("$20.00");
    expect(view.breakdown.find(({ id }) => id === "pending-cash-out")?.status).toBe("partial");
    expect(view.totalStatus).toBe("partial");
    expect(view.statusLabel).toBe("Partial balance");
    expect(view.statusDetails).toContain("Pending cash-out balances could not all be checked.");
    expect(presentPendingCashout(snapshot, escrow)).toEqual({ value: "$20.00" });
    const withoutCurrency = buildBalancesSnapshotFixture({ region: "GLOBAL" });
    const noCurrency = presentBalances({ status: "ready", snapshot: withoutCurrency, error: null },
      { showSmallBalances: false, pendingCashout: escrow });
    expect(noCurrency.totalStatus).toBe("unavailable");
    expect(noCurrency.statusLabel).toBe("Choose a country in Account to set how money is shown");
  });

  test("missing unit price marks a pending escrow partial without adding it", () => {
    const snapshot = buildBalancesSnapshotFixture();
    const before = presentBalances({ status: "ready", snapshot, error: null });
    const view = presentBalances({ status: "ready", snapshot, error: null }, { showSmallBalances: false, pendingCashout: { state: "escrow", baseUnits: "1000000", partial: false } });
    expect(view.displayTotal).toBe(before.displayTotal);
    expect(view.totalStatus).toBe("partial");
    expect(view.statusLabel).toBe("Partial balance");
    expect(view.statusDetails).toEqual(["Pending cash-out value unavailable."]);
    expect(view.breakdown).toEqual(before.breakdown);
    expect(presentPendingCashout(snapshot, { state: "escrow", baseUnits: "1000000", partial: false })).toBeNull();
  });

  test.each(["indeterminate", "unreadable", "loading"] as const)("%s escrow leaves the wallet-only breakdown and marks a priced net partial", (status) => {
    const snapshot = buildBalancesSnapshotFixture();
    snapshot.holdings.find(({ id }) => id === "usdc")!.unitValue = { currency: "USD", amount: { atoms: "1", scale: 0 } };
    const state = { status: "ready" as const, snapshot, error: null };
    const before = presentBalances(state);
    const pendingCashout = { state: status };
    const view = presentBalances(state, { showSmallBalances: false, pendingCashout });
    expect(view.displayTotal).toBe(before.displayTotal);
    expect(view.breakdown).toEqual(before.breakdown);
    expect(view.totalStatus).toBe("partial");
    expect(view.statusLabel).toBe("Partial balance");
    expect(view.statusDetails).toEqual(["Pending cash-out balances could not all be checked."]);
    expect(presentPendingCashout(snapshot, pendingCashout)).toEqual(status === "indeterminate" ? { value: null } : null);
    const withoutCurrency = buildBalancesSnapshotFixture({ region: "GLOBAL" });
    expect(presentBalances({ status: "ready", snapshot: withoutCurrency, error: null },
      { showSmallBalances: false, pendingCashout }).totalStatus).toBe("unavailable");
    expect(presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" },
      { showSmallBalances: false, pendingCashout }).totalStatus).toBe("unavailable");
  });

  test("negative Borrow net crosses zero only when pending escrow exceeds debt", () => {
    const snapshot = buildBalancesSnapshotFixture({ borrow: { coverage: "complete", positions: [borrowPosition({
      collateralBaseUnits: "0", collateralValue: priced("USD", "0"),
      debtBaseUnits: "5000000", debtValue: priced("USD", "500"),
    })] } });
    snapshot.holdings.find(({ id }) => id === "usdc")!.unitValue = { currency: "USD", amount: { atoms: "1", scale: 0 } };
    const state = { status: "ready" as const, snapshot, error: null };
    expect(presentBalances(state, { showSmallBalances: false, pendingCashout: { state: "escrow", baseUnits: "3000000", partial: false } }).displayTotal).toBe("−$2.00");
    expect(presentBalances(state, { showSmallBalances: false, pendingCashout: { state: "escrow", baseUnits: "7000000", partial: false } }).displayTotal).toBe("$2.00");
  });

  test("absent and zero escrow preserve the original presentation", () => {
    const snapshot = buildBalancesSnapshotFixture();
    const state = { status: "ready" as const, snapshot, error: null };
    expect(presentBalances(state, { showSmallBalances: false, pendingCashout: null }))
      .toEqual(presentBalances(state, { showSmallBalances: false }));
    expect(presentBalances(state, { showSmallBalances: false, pendingCashout: { state: "escrow", baseUnits: "0", partial: false } }))
      .toEqual(presentBalances(state, { showSmallBalances: false }));
  });

  test("cash and pending limitations do not contaminate complete Investments or counts", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: unavailableBalance },
      eth: { balance: ready("1000000000000000000"), value: priced("USD", "5000") },
    } });
    const view = presentBalances({ status: "ready", snapshot, error: null }, { showSmallBalances: false, pendingCashout: { state: "unreadable" } });
    expect(view.summary?.investments).toEqual({ status: "complete", value: "$50.00", assetCount: 1, ownedCount: 1 });
    expect(view.summary?.cash.status).toBe("unavailable");
    expect(view.statusDetails).toEqual(["Some quantities unavailable", "Pending cash-out balances could not all be checked."]);
  });

  test("distinguishes price delay from quantity and inventory limitations", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
      cbbtc: { balance: ready("100000000"), value: { status: "unpriced", reason: "price-stale" } },
    }, coverage: { catalog: "incomplete" } });
    const view = presentBalances({ status: "ready", snapshot, error: null });
    expect(view.statusDetails).toEqual(["Price delayed", "The full investment inventory could not be checked."]);
    expect(view.statusDetails).not.toContain("Some quantities unavailable");
    expect(view.summary?.cash).toEqual({ status: "complete", value: "$1.00" });
  });

  test("keeps known zero complete without a breakdown", () => {
    const view = presentBalances({ status: "ready", snapshot: buildBalancesSnapshotFixture(), error: null });
    expect(view).toMatchObject({ displayTotal: "$0.00", totalStatus: "complete", breakdown: [] });
    expect(view.summary?.cash).toEqual({ status: "complete", value: "$0.00" });
    expect(view.summary?.investments).toMatchObject({ status: "complete", value: "$0.00", ownedCount: 0 });
    expect(view.groups[0]?.subtotal).toEqual({ status: "complete", value: "$0.00" });
  });

  test("preserves priced rows and marks a mixed registry read partial", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
      eth: { balance: ready("1000000000000000000"), value: priced("USD", "5000") },
      cbbtc: { balance: unavailableBalance, value: { status: "unavailable" } },
    } });
    const view = presentBalances({ status: "ready", snapshot, error: null });
    expect(view).toMatchObject({ displayTotal: "$62.34", totalStatus: "partial", statusLabel: "Partial balance", statusDetails: ["Some quantities unavailable"] });
    expect(view.summary?.investments).toMatchObject({ status: "partial", value: "$50.00" });
    expect(view.groups.find((group) => group.id === "investments")?.subtotal).toEqual({ status: "partial", value: "$50.00" });
    expect(view.groups[0]?.subtotal).toEqual({ status: "complete", value: "$12.34" });
    expect(view.rows.find((row) => row.name === "Ethereum")?.primary).toBe("$50.00");
    expect(view.rows.find((row) => row.name === "US dollar")?.primary).toBe("$12.34");
  });

  test("never presents unavailable holdings and catalog coverage as zero", () => {
    const registry = Object.fromEntries(buildBalancesSnapshotFixture().holdings.map((holding) => [
      holding.id, { balance: unavailableBalance, value: { status: "unavailable" as const }, cashValue: { status: "unavailable" as const } },
    ]));
    const snapshot = buildBalancesSnapshotFixture({ registry, coverage: { catalog: "unavailable" } });
    const view = presentBalances({ status: "ready", snapshot, error: null });
    expect(view).toMatchObject({ displayTotal: "—", totalStatus: "unavailable", statusLabel: "Balance unavailable", breakdown: [] });
    expect(view.summary?.cash).toEqual({ status: "unavailable", value: null });
    expect(view.summary?.investments).toMatchObject({ status: "unavailable", value: null });
    expect(view.groups[0]?.subtotal).toEqual({ status: "unavailable", value: null });
    expect(view.groups.find((group) => group.id === "investments")?.subtotal).toEqual({ status: "unavailable", value: null });
    expect(JSON.stringify([view.displayTotal, view.summary, view.groups.map((group) => group.subtotal)])).not.toContain("$0.00");
  });

  test("renders the Investments figure when catalog coverage is incomplete without investment rows", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: ready("0"), cashValue: pricedCash("USD", "0") },
        eth: { balance: ready("0"), value: priced("USD", "0") },
      },
      coverage: { catalog: "incomplete" },
    });
    expect(snapshot.totals.investments).toEqual({ status: "unavailable", value: null, currency: "USD" });
    const view = presentBalances({ status: "ready", snapshot, error: null });
    expect(view.groups.map((group) => [group.id, group.subtotal])).toEqual([
      ["cash", { status: "complete", value: "$0.00" }],
      ["investments", { status: "unavailable", value: null }],
    ]);
    expect(view.groups.find((group) => group.id === "investments")?.rows).toEqual([]);
  });

  test("renders both figures unavailable without a quote currency only when a read is incomplete", () => {
    const unreadable = presentBalances({
      status: "ready",
      snapshot: buildBalancesSnapshotFixture({
        region: "GLOBAL",
        registry: { usdc: { balance: ready("0") }, eth: { balance: ready("0") } },
        coverage: { catalog: "unavailable" },
      }),
      error: null,
    });
    expect(unreadable.groups.map((group) => [group.id, group.subtotal])).toEqual([
      ["cash", { status: "unavailable", value: null }],
      ["investments", { status: "unavailable", value: null }],
    ]);
    const complete = presentBalances({
      status: "ready",
      snapshot: buildBalancesSnapshotFixture({
        region: "GLOBAL",
        registry: { usdc: { balance: ready("0") }, eth: { balance: ready("0") } },
      }),
      error: null,
    });
    expect(complete.groups.map((group) => [group.id, group.subtotal])).toEqual([
      ["cash", { status: "unavailable", value: null }],
    ]);
  });


  test("keeps an unreadable cash holding listed and labels its subtotal partial", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
      eurc: { balance: unavailableBalance, value: { status: "unavailable" }, cashValue: { status: "unavailable" } },
    } });
    const view = presentBalances({ status: "ready", snapshot, error: null });
    const eurc = snapshot.holdings.find((holding) => holding.id === "eurc")!;
    expect(view.rows.find((row) => row.key === eurc.key)).toMatchObject({ primary: "Unavailable", tone: "error" });
    expect(view.groups[0]?.subtotal).toEqual({ status: "partial", value: "$12.34" });
    expect(view.summary?.cash).toEqual({ status: "partial", value: "$12.34", statusLabel: "Some quantities unavailable" });
  });

  test("marks a group subtotal incomplete for an unnameable unreadable holding with no row", () => {
    const base = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
      eth: { balance: ready("1000000000000000000"), value: priced("USD", "5000") },
      idrx: { balance: unavailableBalance },
      cbbtc: { balance: unavailableBalance },
    } });
    const nameless = new Set(["idrx", "cbbtc"]);
    const snapshot = {
      ...base,
      holdings: base.holdings.map((holding) => nameless.has(holding.id)
        ? { ...holding, name: " ", symbol: " " }
        : holding),
    };
    const view = presentBalances({ status: "ready", snapshot, error: null });
    const hiddenKeys = new Set<string>(snapshot.holdings.filter((holding) => nameless.has(holding.id)).map((holding) => holding.key));
    expect(view.rows.some((row) => hiddenKeys.has(row.key))).toBeFalse();
    expect(view.groups.map((group) => [group.id, group.subtotal])).toEqual([
      ["cash", { status: "partial", value: "$12.34" }],
      ["investments", { status: "partial", value: "$50.00" }],
    ]);
  });

  test("does not show a known loan's unpriceable net as an amount", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
    }, borrow: { coverage: "complete", positions: [borrowPosition({
      collateralBaseUnits: "100000", collateralValue: priced("USD", "5000"),
      debtBaseUnits: "30010000", debtValue: { status: "unavailable" },
    })] } });
    const view = presentBalances({ status: "ready", snapshot, error: null });
    expect(view).toMatchObject({ displayTotal: "—", totalStatus: "unavailable", statusLabel: "Balance unavailable" });
    expect(view.breakdown).toEqual([
      { id: "borrow", label: "Borrow", status: "unavailable", value: null, weight: 0 },
      expect.objectContaining({ id: "cash", status: "complete", value: "$12.34" }),
      expect.objectContaining({ id: "investments", status: "complete", value: "$50.00" }),
    ]);
  });

  test("forces partial net on unknown loan existence even for a complete upstream total", () => {
    const base = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
    }, borrow: { coverage: "partial", positions: [] } });
    const snapshot = { ...base, totals: { ...base.totals, net: { ...base.totals.net, status: "complete" as const } } };
    const view = presentBalances({ status: "ready", snapshot, error: null });
    expect(view).toMatchObject({ displayTotal: "$1.00", totalStatus: "partial", statusLabel: "Partial balance", statusDetails: ["Home could not check whether you have a loan."] });
    expect(view.breakdown.some((item) => item.id === "borrow")).toBeFalse();
  });

  test("returns no breakdown when every magnitude is unknown or zero", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: { usdc: { balance: unavailableBalance } } });
    expect(presentBalances({ status: "ready", snapshot, error: null }).breakdown).toEqual([]);
  });


  test("a successful post-action refetch keeps Borrow visible while a genuine empty failure is unavailable", () => {
    const position = borrowPosition({
      collateralBaseUnits: "100000", collateralValue: priced("USD", "5000"),
      debtBaseUnits: "30010000", debtValue: priced("USD", "3001"),
    });
    const refreshed = buildBalancesSnapshotFixture({
      fetchedAt: "2026-09-13T12:00:30.000Z",
      borrow: { coverage: "complete", positions: [position] },
    });
    const failed = buildBalancesSnapshotFixture({ borrow: { coverage: "partial", positions: [] } });
    expect(presentBalances({ status: "ready", snapshot: refreshed, error: null }, { showSmallBalances: false }).summary?.borrow)
      .toMatchObject({ kind: "position", value: "$30.01" });
    expect(presentBalances({ status: "ready", snapshot: failed, error: null }, { showSmallBalances: false }).summary?.borrow)
      .toEqual({ kind: "unavailable" });
  });
  test("keeps cash truth, hides noncash zero and vault shares, and includes unreadable named assets", () => {
    const rows = presentedRows(balancesSnapshotFixture);
    expect(rows.map((row) => row.name)).toEqual([
      "US dollar",
      "Ethereum",
      "Aerodrome",
      "Bitcoin",
      "Quiet Token",
      "Thin Market Token",
      "Toshi",
    ]);
    expect(rows.some((row) => row.name.includes("vault"))).toBeFalse();
    expect(rows.find((row) => row.name === "Toshi")).toMatchObject({ primary: "Unavailable", secondary: null, tone: "error" });
    expect(presentBalances({ status: "ready", snapshot: balancesSnapshotFixture, error: null }, { showSmallBalances: true }).groups.map((group) => ({
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
    expect(presentedRows(snapshot).map((row) => row.name)).toEqual([
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
      holding: catalogHolding(FIXTURE_CATALOG.priced, "1000000000000000000", priced("USD", "9", 3)),
      group: null,
      hiddenCount: 1,
    },
    {
      name: "unpriced wallet",
      holding: walletHolding(FIXTURE_WALLET_TOKEN, "1000000000000000000", {
        status: "unpriced" as const,
        reason: "below-market-gate" as const,
      }),
      group: "unpriced",
      hiddenCount: 0,
    },
    {
      name: "unpriced catalog",
      holding: catalogHolding(FIXTURE_CATALOG.priceMissing, "1000000", {
        status: "unpriced" as const,
        reason: "price-unavailable" as const,
      }),
      group: "investments",
      hiddenCount: 0,
    },
    {
      name: "priced at one cent",
      holding: catalogHolding(FIXTURE_CATALOG.priced, "1000000000000000000", priced("USD", "1", 2)),
      group: "investments",
      hiddenCount: 0,
    },
  ])("partitions $name by price and source", ({ holding, group, hiddenCount }) => {
    const snapshot = buildBalancesSnapshotFixture({ catalog: [holding] });
    const presentation = presentBalances(
      { status: "ready", snapshot, error: null },
      { showSmallBalances: false },
    );

    expect(presentation.hiddenCount).toBe(hiddenCount);
    expect(presentation.hiddenRows.map((row) => row.name)).toEqual(hiddenCount ? [holding.name] : []);
    if (group === "unpriced") {
      expect(presentation.groups.map((entry) => entry.id)).toEqual(["cash", "unpriced"]);
    }
    if (group === null) {
      expect(presentation.rows.some((row) => row.name === holding.name)).toBeFalse();
    } else {
      expect(presentation.groups.find((entry) => entry.id === group)?.rows).toContainEqual(
        expect.objectContaining({ name: holding.name }),
      );
    }
    if (holding.value.status !== "priced") {
      if (group === "investments") {
        expect(presentation.groups.find((entry) => entry.id === "investments")?.subtotal).toEqual({ status: "unavailable", value: null });
      }
      expect(presentation.rows.find((row) => row.name === holding.name)).toMatchObject({
        primary: holding.source === "wallet" ? "1.00 DISC" : "1.00 QUIET",
        secondary: null,
        tone: "default",
        valueContext: "— · Value unavailable",
      });
    }
  });

  test("keeps wallet-only unpriced rows below priced investments without valuing or counting them", () => {
    const pricedHolding = catalogHolding(FIXTURE_CATALOG.priced, "1000000000000000000", priced("USD", "2500"));
    const dust = catalogHolding(FIXTURE_CATALOG.belowGate, "1000000000000000000", priced("USD", "9", 3));
    const walletTokens = [
      walletHolding({ ...FIXTURE_WALLET_TOKEN, name: "Zebra Token" }, "1000000000000000000", { status: "unpriced", reason: "below-market-gate" }),
      walletHolding({ ...FIXTURE_WALLET_TOKEN, address: "0x6666666666666666666666666666666666666666", name: "Alpha Token" }, "2000000000000000000", { status: "unpriced", reason: "price-unavailable" }),
    ];
    const base = buildBalancesSnapshotFixture({ catalog: [pricedHolding, dust] });
    const snapshot = buildBalancesSnapshotFixture({ catalog: [pricedHolding, dust, ...walletTokens] });
    const baseline = presentBalances({ status: "ready", snapshot: base, error: null });

    for (const showSmallBalances of [false, true]) {
      const presentation = presentBalances({ status: "ready", snapshot, error: null }, { showSmallBalances });
      expect(presentation.groups.map((group) => [group.id, group.label, group.subtotal])).toEqual([
        ["cash", "Cash", { status: "complete", value: "$0.00" }],
        ["investments", "Investments", { status: "complete", value: "$25.01" }],
        ["unpriced", "Unpriced", null],
      ]);
      expect(presentation.groups[2]?.rows.map((row) => [row.name, row.primary, row.secondary, row.tone])).toEqual([
        ["Alpha Token", "2.00 DISC", null, "default"],
        ["Zebra Token", "1.00 DISC", null, "default"],
      ]);
      expect(presentation.hiddenCount).toBe(1);
      expect(presentation.hiddenRows.map((row) => row.name)).toEqual(["Thin Market Token"]);
      expect(presentation.groups[1]?.rows.map((row) => row.name)).toEqual(
        showSmallBalances ? ["Aerodrome", "Thin Market Token"] : ["Aerodrome"],
      );
      expect(presentation.summary?.investments).toMatchObject({
        value: baseline.summary?.investments.value,
        assetCount: baseline.summary?.investments.assetCount,
        status: "partial",
      });
    }
    expect(presentBalances({ status: "ready", snapshot, error: null }, { showSmallBalances: true }).groups.at(-1)?.id).toBe("unpriced");
    expect(presentedRows(snapshot).at(-1)?.name).toBe("Zebra Token");
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

  test("shows unreadable cash and investments without changing Home investment counts", () => {
    const baseline = buildBalancesSnapshotFixture({
      registry: { usdc: { balance: ready("1000000") }, eth: { balance: ready("1000000000000000000"), value: priced("USD", "300") } },
    });
    const unread = walletHolding(FIXTURE_WALLET_TOKEN, "1", { status: "unavailable" });
    const snapshot = buildBalancesSnapshotFixture({
      registry: { usdc: { balance: ready("1000000") }, eurc: { balance: unavailableBalance }, eth: { balance: ready("1000000000000000000"), value: priced("USD", "300") }, cbbtc: { balance: unavailableBalance } },
      catalog: [{ ...unread, balance: unavailableBalance }],
      coverage: { catalog: "incomplete" },
    });
    const rows = presentedRows(snapshot);
    expect(rows.find((row) => row.name === "Euro")).toMatchObject({ primary: "Unavailable", secondary: null, tone: "error" });
    expect(rows.filter((row) => row.group === "asset" && row.primary === "Unavailable").map((row) => row.name)).toEqual(["Bitcoin", "Discovered Token"]);
    expect(rows.every((row) => row.primary !== "$0.00" || row.name === "US dollar")).toBe(true);
    expect(presentBalances({ status: "ready", snapshot, error: null }).summary?.investments).toMatchObject({
      assetCount: presentBalances({ status: "ready", snapshot: baseline, error: null }).summary?.investments.assetCount,
      ownedCount: presentBalances({ status: "ready", snapshot: baseline, error: null }).summary?.investments.ownedCount,
    });
  });
  test("never hides an unreadable holding with a stale sub-cent valuation", () => {
    const holding = { ...walletHolding(FIXTURE_WALLET_TOKEN, "1", priced("USD", "1", 3)), balance: unavailableBalance };
    const snapshot = buildBalancesSnapshotFixture({ catalog: [holding] });
    const presentation = presentBalances({ status: "ready", snapshot, error: null });
    expect(presentation.hiddenRows).toEqual([]);
    expect(presentation.rows.find((row) => row.name === holding.name)).toMatchObject({ primary: "Unavailable", tone: "error" });
    const symbolOnly = { ...walletHolding({ ...FIXTURE_WALLET_TOKEN, name: " ", symbol: "DISC" }, "1", { status: "unavailable" as const }), balance: unavailableBalance };
    expect(presentedRows(buildBalancesSnapshotFixture({ catalog: [symbolOnly] })).find((row) => row.group === "asset")).toMatchObject({ name: "DISC", primary: "Unavailable", tone: "error" });
  });

  test("keeps a ready unpriced investment's quantity while its price is delayed", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: { cbbtc: { balance: ready("100000000"), value: { status: "unpriced", reason: "price-stale" } } } });
    expect(presentedRows(snapshot).find((row) => row.name === "Bitcoin")).toMatchObject({ primary: "1.0000 cbBTC", tone: "default", valueContext: "— · Price delayed" });
    expect(presentBalances({ status: "ready", snapshot, error: null }).summary?.investments.status).toBe("unavailable");
    expect(holdingValueContext(snapshot.holdings.find((holding) => holding.id === "cbbtc")!.value)).toBe("Price delayed");
  });

  test("cash always renders and distinguishes unavailable from successful zero", () => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: {
        usdc: { balance: unavailableBalance, value: { status: "unavailable" }, cashValue: { status: "unavailable" } },
      },
      total: { status: "unavailable", value: null },
    });
    expect(presentedRows(snapshot)[0]).toMatchObject({
      name: "US dollar",
      primary: "Unavailable",
      tone: "error",
    });
    expect(presentBalances({ status: "ready", snapshot, error: null }, { showSmallBalances: true }).groups[0]?.subtotal).toEqual({ status: "unavailable", value: null });
  });

  test("keeps an unverified local currency visible without inventing a balance or affecting totals", () => {
    const snapshot = buildBalancesSnapshotFixture({
      region: "MX",
      registry: {
        usdc: { balance: ready("5000000"), value: priced("MXN", "2500"), cashValue: pricedCash("USD", "500") },
      },
    });
    const presentation = presentBalances({ status: "ready", snapshot, error: null });
    const cash = presentation.groups.find((group) => group.id === "cash");
    const unsupported = cash?.rows.find((row) => row.key === "cash:unsupported:MXN");

    expect(unsupported).toMatchObject({
      name: "Mexican peso",
      mark: { kind: "flag", currency: "MXN" },
      primary: "Verification pending",
      secondary: null,
      tone: "muted",
    });
    expect(`${unsupported?.primary}${unsupported?.secondary ?? ""}`).not.toMatch(/[0-9]/);
    expect(cash?.subtotal).toEqual({ status: "complete", value: "$25.00" });
    expect(presentation.displayTotal).toBe("$25.00");
    expect(presentation.summary?.cash.value).toBe("$25.00");
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
    const idrRows = presentedRows(snapshot).filter(
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

    const idrx = presentedRows(snapshot).find((row) => row.name === "Rupiah");
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
    const usd = presentedRows(snapshot).find((row) => row.name === "US dollar");
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
    const rows = presentedRows(snapshot);

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
    expect(presentedRows(snapshot).find((row) => row.name === "Bitcoin")?.mark).toEqual({
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
      statusLabel: "Partial balance",
      breakdown: [
        { id: "cash", label: "Cash", status: "complete", value: "$2,234.68", weight: 580 },
        { id: "investments", label: "Investments", status: "partial", value: "$1,618.20", weight: 420 },
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
      investments: { status: "complete", value: "$78.21", assetCount: 1, ownedCount: 1 },
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
    expect(presentation.statusLabel).toBe("Partial balance");
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
    expect(presentation.statusLabel).toBe("Partial balance");
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

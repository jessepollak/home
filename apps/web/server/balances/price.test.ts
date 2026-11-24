import { present } from "@/tests/helpers/async";
import { expect, test } from "bun:test";
import { buildBalancesSnapshotFixture, ready, requiredLocalCashAsset, walletHolding } from "@/shared/balances/fixtures";
import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import { selectCash, selectMoneyGroups } from "@/shared/balances/select";
import type { Holding } from "@/shared/balances/types";
import { MemoryPriceObservationStore } from "./memory-price-observation-store";
import { createBalancesPricer } from "./price";
import { assembleBalancesSnapshot } from "./snapshot";
import type { BalancesRead, ReadHolding } from "./types";

function withoutValue({ value: _value, ...holding }: Holding): ReadHolding {
  return holding;
}

test("cached valuation serves stored prices and truthful missing values across a large inventory while the provider never settles", async () => {
  const fixture = buildBalancesSnapshotFixture({
    catalog: [],
    registry: { usdc: { balance: ready("2000000") } },
  });
  const registry = fixture.holdings.map(withoutValue);
  const wallets: ReadHolding[] = Array.from({ length: 4_000 }, (_, index) => ({
    ...withoutValue(walletHolding({
      address: `0x${(index + 1_000).toString(16).padStart(40, "0")}`,
      name: "Synthetic token",
      symbol: "SYN",
      decimals: 6,
    }, index === 3_999 ? "0" : "2500000", { status: "unpriced", reason: "price-unavailable" })),
    marketDataResolved: true,
    liquidityUsd: { atoms: "50000", scale: 0 },
  }));
  const priceStore = new MemoryPriceObservationStore();
  await priceStore.putMany([
    ...wallets.slice(0, 1_000).map(({ key }) => ({
      assetKey: key,
      unitPrice: { atoms: "125", scale: 2 },
      asOf: "2026-09-13T12:00:00.000Z",
      fetchedAt: "2026-09-13T12:00:00.000Z",
    })),
    {
      assetKey: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      unitPrice: { atoms: "1", scale: 0 },
      asOf: "2026-09-13T12:00:00.000Z",
      fetchedAt: "2026-09-13T12:00:00.000Z",
    },
  ]);
  let providerStarted = false;
  const price = createBalancesPricer({
    priceStore,
    now: () => new Date("2026-09-13T12:00:00.000Z"),
    nowMs: () => 0,
    readPrices: () => {
      providerStarted = true;
      return new Promise(() => {});
    },
    readExchangeRates: () => new Promise(() => {}),
    schedule: (task) => { void (typeof task === "function" ? task() : task); },
  });
  const result = await price({
    block: fixture.block,
    observedAt: fixture.fetchedAt,
    coverage: { registry: "complete", catalog: "complete" },
    holdings: [...registry, ...wallets],
  }, "US", "cached");

  expect(providerStarted).toBe(true);
  expect(result.revalidating).toBe(true);
  expect(result.holdings.find(({ id }) => id === "usdc")?.value).toEqual({
    status: "priced", currency: "USD", amount: { atoms: "2000000000000000000", scale: 18 },
    asOf: "2026-09-13T12:00:00.000Z",
  });
  const pricedWallets = result.holdings.filter(({ source }) => source === "wallet");
  expect(pricedWallets).toHaveLength(4_000);
  for (const holding of pricedWallets.slice(0, 1_000)) {
    expect(holding.value).toEqual({
      status: "priced", currency: "USD", amount: { atoms: "3125000000000000000", scale: 18 },
      asOf: "2026-09-13T12:00:00.000Z",
    });
  }
  for (const holding of pricedWallets.slice(1_000, 3_999)) {
    expect(holding.value).toEqual({ status: "unpriced", reason: "price-unavailable" });
  }
  expect(pricedWallets[3_999]?.value).toEqual({
    status: "priced", currency: "USD", amount: { atoms: "0", scale: 18 },
    asOf: "2026-09-13T12:00:00.000Z",
  });
});


const DISPLAY_AS_OF = "2026-09-13T12:00:00.000Z";
const localBrl = requiredLocalCashAsset("BRL");
const displayFixture = buildBalancesSnapshotFixture({
  region: "BR",
  registry: {
    usdc: { balance: ready("1234567") },
    [localBrl.id]: { balance: ready((BigInt(2) * BigInt(10) ** BigInt(localBrl.decimals)).toString()) },
    eth: { balance: ready("125000000000000000") },
    "morpho-steakhouse-usdc": { balance: ready("1000000000000000000"), underlyingBalance: ready("3456789") },
  },
});
const displayRead: BalancesRead = {
  block: displayFixture.block, observedAt: DISPLAY_AS_OF,
  holdings: displayFixture.holdings.map(withoutValue), coverage: { registry: "complete", catalog: "complete" },
};

async function displayPricer(missingEur = false) {
  const priceStore = new MemoryPriceObservationStore();
  const usdc = present(displayRead.holdings.find((holding) => holding.id === "usdc"));
  await priceStore.putMany([
    { assetKey: usdc.key, unitPrice: { atoms: "10025", scale: 4 }, asOf: DISPLAY_AS_OF, fetchedAt: DISPLAY_AS_OF },
    { assetKey: localBrl.assetKey, unitPrice: { atoms: "1875", scale: 4 }, asOf: DISPLAY_AS_OF, fetchedAt: DISPLAY_AS_OF },
  ]);
  const source = {
    provider: "Coinbase Exchange Rates" as const, method: "fixture", fetchedAt: DISPLAY_AS_OF,
    asOf: DISPLAY_AS_OF, timeBasis: "provider-as-of" as const,
  };
  return createBalancesPricer({
    priceStore, stockAssets: [], now: () => new Date(DISPLAY_AS_OF), schedule: () => {},
    readPrices: async () => [],
    readExchangeRates: async () => ({
      fetchedAt: DISPLAY_AS_OF,
      quotes: [
        { baseCurrency: "USD", quoteCurrency: "BRL", quoteUnitsPerUsd: { atoms: "5125", scale: 3 }, sourceValue: "5.125", status: "fresh", source },
        { baseCurrency: "USD", quoteCurrency: "EUR", quoteUnitsPerUsd: missingEur ? null : { atoms: "925", scale: 3 }, sourceValue: missingEur ? null : "0.925", status: missingEur ? "unavailable" : "fresh", source },
      ],
      nativeEthQuote: { baseCurrency: "USD", assetSymbol: "ETH", assetUnitsPerUsd: { atoms: "4", scale: 4 }, sourceValue: "0.0004", status: "fresh", source },
    }),
  });
}

async function displaySnapshot(region: RegionId, currency: FiatCurrencyCode | null, missingEur = false) {
  const price = await displayPricer(missingEur);
  const result = await price(displayRead, region, "bootstrap", undefined, undefined, currency);
  return assembleBalancesSnapshot({ owner: displayFixture.owner.address, region, quoteCurrency: currency, read: displayRead, ...result });
}

function expectedDisplayAtoms(id: string, fxPerThousand: bigint): string {
  const scale = BigInt(10) ** BigInt(18);
  const usdAtoms: Record<string, bigint> = {
    usdc: BigInt(1234567) * BigInt(10025) * scale / BigInt(10_000_000_000),
    [localBrl.id]: BigInt(2) * BigInt(1875) * scale / BigInt(10000),
    eth: BigInt(125) * BigInt(2500) * scale / BigInt(1000),
    "morpho-steakhouse-usdc": BigInt(3456789) * BigInt(10025) * scale / BigInt(10_000_000_000),
  };
  return ((usdAtoms[id] ?? BigInt(0)) * fxPerThousand / BigInt(1000)).toString();
}

test.each([["BRL", BigInt(5125)], ["USD", BigInt(1000)], ["EUR", BigInt(925)]] as const)("Brazilian holdings use exact %s display valuation, preserving local cash and held units", async (currency, fx) => {
  const snapshot = await displaySnapshot("BR", currency);
  expect(parseBalancesSnapshot(snapshot, { subject: "fixture", smartAccountAddress: snapshot.owner.address, chainId: 8453 }, "BR", currency)).toEqual(snapshot);
  expect(snapshot.holdings.map(({ id, balance, underlyingBalance }) => ({ id, balance, underlyingBalance })))
    .toEqual(displayFixture.holdings.map(({ id, balance, underlyingBalance }) => ({ id, balance, underlyingBalance })));
  for (const id of ["usdc", localBrl.id, "eth", "morpho-steakhouse-usdc"]) {
    const holding = present(snapshot.holdings.find((entry) => entry.id === id));
    expect(holding.value).toMatchObject({ status: "priced", currency, amount: { atoms: expectedDisplayAtoms(id, fx), scale: 18 } });
    if (id !== "morpho-steakhouse-usdc") {
      const unitUsdPerTenThousand = id === "eth" ? BigInt(25_000_000) : id === "usdc" ? BigInt(10025) : BigInt(1875);
      const unit = present(holding.unitValue);
      expect(unit.currency).toBe(currency);
      expect(BigInt(unit.amount.atoms) * BigInt(10_000_000)).toBe(unitUsdPerTenThousand * fx * BigInt(10) ** BigInt(unit.amount.scale));
    }
  }
  const usdc = present(snapshot.holdings.find(({ id }) => id === "usdc"));
  expect(usdc.cashValue).toEqual({ status: "priced", currency: "USD", amount: { atoms: expectedDisplayAtoms("usdc", BigInt(1000)), scale: 18 } });
  expect(snapshot.holdings.find(({ id }) => id === localBrl.id)?.cashValue).toEqual({ status: "priced", currency: "BRL", amount: { atoms: expectedDisplayAtoms(localBrl.id, BigInt(5125)), scale: 18 } });
  const groups = selectMoneyGroups(snapshot);
  expect(groups.cash.filter((entry) => entry.kind === "holding").map((entry) => entry.holding.id)).toEqual([localBrl.id, "usdc"]);
  expect(groups.investments.map(({ id }) => id)).toEqual(["eth"]);
  const cashAtoms = ["usdc", localBrl.id, "morpho-steakhouse-usdc"].reduce((sum, id) => sum + BigInt(expectedDisplayAtoms(id, fx)), BigInt(0));
  expect(snapshot.totals.cash).toEqual({ status: "complete", currency, value: { atoms: cashAtoms.toString(), scale: 18 } });
  expect(snapshot.totals.investments).toEqual({ status: "complete", currency, value: { atoms: expectedDisplayAtoms("eth", fx), scale: 18 } });
  expect(snapshot.totals.net).toMatchObject({ currency, value: { atoms: (cashAtoms + BigInt(expectedDisplayAtoms("eth", fx))).toString(), scale: 18 }, negative: false });
  const unsupported = selectCash(snapshot, { localCashAsset: () => null })[0];
  expect(unsupported).toMatchObject({ kind: "unsupported", currency: "BRL", key: "cash:unsupported:BRL" });
});

test("unavailable requested FX never falls back to USD or changes native cash valuation", async () => {
  const snapshot = await displaySnapshot("BR", "EUR", true);
  for (const id of ["usdc", localBrl.id, "eth", "morpho-steakhouse-usdc"]) {
    const holding = present(snapshot.holdings.find((entry) => entry.id === id));
    expect(holding.value).toEqual({ status: "unpriced", reason: "fx-unavailable" });
    expect(holding.unitValue).toBeUndefined();
  }
  expect(snapshot.holdings.find(({ id }) => id === "usdc")?.cashValue).toMatchObject({ status: "priced", currency: "USD" });
  expect(snapshot.holdings.find(({ id }) => id === localBrl.id)?.cashValue).toMatchObject({ status: "priced", currency: "BRL" });
  const excludedTotal = { status: "complete", currency: "EUR", value: { atoms: "0", scale: 18 } } as const;
  expect(snapshot.total).toEqual(excludedTotal);
  expect(snapshot.totals).toEqual({ cash: excludedTotal, investments: excludedTotal, borrow: excludedTotal, net: { ...excludedTotal, negative: false } });
  expect(parseBalancesSnapshot(snapshot, { subject: "fixture", smartAccountAddress: snapshot.owner.address, chainId: 8453 }, "BR", "EUR")).toEqual(snapshot);
});

test("GLOBAL plus explicit USD is priced while its country default remains unquoted", async () => {
  const explicit = await displaySnapshot("GLOBAL", "USD");
  const defaultSnapshot = await displaySnapshot("GLOBAL", null);
  expect(explicit.holdings.find(({ id }) => id === "usdc")?.value).toMatchObject({ status: "priced", currency: "USD", amount: { atoms: expectedDisplayAtoms("usdc", BigInt(1000)), scale: 18 } });
  expect(defaultSnapshot.holdings.every(({ value }) => value.status === "unpriced" && value.reason === "no-quote-currency")).toBe(true);
  expect(defaultSnapshot.total).toEqual({ status: "no-quote-currency", value: null, currency: null });
  expect(defaultSnapshot.totals.net).toEqual({ status: "no-quote-currency", value: null, currency: null, negative: false });
  expect(defaultSnapshot.holdings.map(({ id, balance }) => ({ id, balance }))).toEqual(explicit.holdings.map(({ id, balance }) => ({ id, balance })));
});

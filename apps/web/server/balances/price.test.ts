import { expect, test } from "bun:test";
import { buildBalancesSnapshotFixture, ready, walletHolding } from "@/shared/balances/fixtures";
import type { Holding } from "@/shared/balances/types";
import { MemoryPriceObservationStore } from "./memory-price-observation-store";
import { createBalancesPricer } from "./price";
import type { ReadHolding } from "./types";

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
    coverage: fixture.coverage,
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

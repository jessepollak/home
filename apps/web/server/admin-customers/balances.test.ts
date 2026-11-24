import { expect, test } from "bun:test";
import { buildBalancesSnapshotFixture, ready, walletHolding } from "@/shared/balances/fixtures";
import type { Holding } from "@/shared/balances/types";
import { MemoryBalanceSnapshotStore } from "@/server/balances/memory-snapshot-store";
import { MemoryPriceObservationStore } from "@/server/balances/memory-price-observation-store";
import { createBalancesPricer } from "@/server/balances/price";
import type { BorrowMarketRead, ReadHolding } from "@/server/balances/types";
import { requireAddress } from "@/shared/chain/hex";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { createSnapshotBalanceReader } from "./balances";

const owner = requireAddress("0x00000000000000000000000000000000000000a1");
const empty = requireAddress("0x00000000000000000000000000000000000000a2");
const now = "2026-09-13T12:00:00.000Z";
const usdcKey = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function withoutValue({ value: _value, ...holding }: Holding): ReadHolding {
  return holding;
}

async function reader(holdings: ReadHolding[], options: { borrowObserved?: boolean; borrowBlock?: string; staleAt?: string; ageMs?: number } = {}) {
  const fixture = buildBalancesSnapshotFixture({ catalog: [], registry: { usdc: { balance: ready("2000000") } } });
  const store = new MemoryBalanceSnapshotStore();
  await store.putObservation({
    chainId: 8453, address: owner, blockNumber: fixture.block.number, blockHash: fixture.block.hash, blockTimestamp: fixture.block.timestamp,
    observedAt: now, holdings: [...fixture.holdings.map(withoutValue), ...holdings], coverage: { registry: "complete", catalog: "complete" },
    borrow: options.borrowObserved === false ? null : { markets: BORROW_MARKETS.map((market): BorrowMarketRead => ({
      marketId: `0x${market.marketId.slice(2).toLowerCase()}`, status: "ready", blockNumber: options.borrowBlock ?? fixture.block.number, collateralRaw: "0", debtAssetsRaw: "0", borrowAprWad: "0",
    })) },
  });
  if (options.staleAt) await store.markStale(8453, owner, new Date(options.staleAt));
  const priceStore = new MemoryPriceObservationStore();
  await priceStore.putMany([{ assetKey: usdcKey, unitPrice: { atoms: "1", scale: 0 }, asOf: now, fetchedAt: now }]);
  let providerCalls = 0;
  const provider = () => { providerCalls += 1; return new Promise<never>(() => {}); };
  const pricer = createBalancesPricer({ priceStore, now: () => new Date(now), nowMs: () => 0, readPrices: provider, readExchangeRates: provider, schedule: () => {} });
  return { read: createSnapshotBalanceReader(store, pricer, () => Date.parse(now) + (options.ageMs ?? 60_000)), calls: () => providerCalls };
}

test("a fully valued snapshot reports totals from stored prices without calling a price provider", async () => {
  const { read, calls } = await reader([]);
  const [wallet, missing] = await read([owner, empty]);
  expect(wallet?.snapshot?.complete).toBe(true);
  expect(wallet?.snapshot?.cash).toBe("2");
  expect(wallet?.snapshot?.net).toBe("2");
  expect(wallet?.snapshot?.holdings.find((holding) => holding.symbol === "USDC")).toMatchObject({ category: "cash", amount: "2", value: "2" });
  expect(missing).toEqual({ address: empty, snapshot: null });
  expect(calls()).toBe(0);
});

test("an unpriced holding makes the snapshot partial and withholds totals instead of reporting a smaller sum", async () => {
  const token = { ...withoutValue(walletHolding({ address: "0x00000000000000000000000000000000000000b1", name: "Synthetic token", symbol: "SYN", decimals: 6 }, "2500000", { status: "unpriced", reason: "price-unavailable" })), marketDataResolved: true as const, liquidityUsd: { atoms: "50000", scale: 0 } };
  const { read, calls } = await reader([token]);
  const [wallet] = await read([owner]);
  expect(wallet?.snapshot?.complete).toBe(false);
  expect([wallet?.snapshot?.cash, wallet?.snapshot?.investments, wallet?.snapshot?.net]).toEqual([null, null, null]);
  expect(wallet?.snapshot?.holdings.find((holding) => holding.symbol === "SYN")).toMatchObject({ category: "investment", amount: "2.5", value: null });
  expect(calls()).toBe(0);
});

test("a missing or carried-forward Borrow observation withholds debt and net instead of reporting zero", async () => {
  for (const options of [{ borrowObserved: false }, { borrowBlock: "1" }]) {
    const [wallet] = await (await reader([], options)).read([owner]);
    expect(wallet?.snapshot?.complete).toBe(false);
    expect([wallet?.snapshot?.debt, wallet?.snapshot?.net]).toEqual([null, null]);
  }
});

test("a snapshot is stale only when invalidated after it was observed or older than the backstop", async () => {
  expect((await (await reader([], { staleAt: "2026-09-13T11:59:00.000Z" })).read([owner]))[0]?.snapshot?.stale).toBe(false);
  expect((await (await reader([], { staleAt: "2026-09-13T12:00:30.000Z" })).read([owner]))[0]?.snapshot?.stale).toBe(true);
  expect((await (await reader([], { ageMs: 10 * 60_000 })).read([owner]))[0]?.snapshot?.stale).toBe(true);
});

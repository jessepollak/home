import { expect, test } from "bun:test";
import { stockAssets } from "@/config/invest-assets";
import type { TokenizedEquityReference } from "@/server/market-data/tokenized-equity/reader";
import type { PriceQuote } from "@/shared/balances/quotes";
import { MemoryPriceObservationStore } from "./memory-price-observation-store";
import { createBalancesPricer } from "./price";
import { assembleBalancesSnapshot } from "./snapshot";
import type { BalancesRead, ReadHolding } from "./types";

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const AS_OF = "2026-09-01T12:00:00.000Z";
const NOW = "2026-09-13T12:00:00.000Z";
const holding: ReadHolding = {
  key: "eip155:8453/erc20:0x1111111111111111111111111111111111111111", id: "token", kind: "erc20", source: "registry",
  name: "Token", symbol: "TOKEN", decimals: 6, contractAddress: "0x1111111111111111111111111111111111111111", cashCurrency: "USD",
  balance: { status: "ready", baseUnits: "2000000" },
};
function inventory(holdings = [holding]): BalancesRead {
  return { block: { number: "100", hash: `0x${"1".repeat(64)}`, timestamp: "0" }, observedAt: NOW, holdings, coverage: { registry: "complete", catalog: "complete" } };
}

for (const outcome of ["throws", "stale", "unavailable"] as const) {
  test(`a ${outcome} Codex refresh keeps an observation older than 24 hours, its cash value and its original asOf`, async () => {
    const store = new MemoryPriceObservationStore();
    const observation = { assetKey: holding.key, unitPrice: { atoms: "25", scale: 1 }, asOf: AS_OF, fetchedAt: AS_OF };
    await store.putMany([observation]);
    const tasks: Array<() => Promise<unknown>> = [];
    const price = createBalancesPricer({
      priceStore: store, stockAssets: [], now: () => new Date(NOW),
      schedule: (task) => tasks.push(typeof task === "function" ? task : () => task),
      readPrices: async (inputs): Promise<PriceQuote[]> => {
        if (outcome === "throws") throw new Error("Codex down");
        return inputs.map((input) => ({
          assetKey: input.assetKey, contractAddress: input.address, quoteCurrency: "USD", unitPrice: { atoms: "999", scale: 0 },
          sourceValue: "999", status: outcome, source: { provider: "Codex", method: "fake", fetchedAt: NOW, asOf: AS_OF, timeBasis: "provider-as-of" },
        }));
      },
    });
    const neverPriced = { ...holding, key: "eip155:8453/erc20:0x2222222222222222222222222222222222222222" as const, id: "never", contractAddress: "0x2222222222222222222222222222222222222222" as const };
    const read = inventory([holding, neverPriced]);
    const first = await price(read, "US");
    expect(first.holdings[0].value).toEqual({ status: "priced", currency: "USD", amount: { atoms: "5000000000000000000", scale: 18 }, asOf: AS_OF });
    expect(first.holdings[0].cashValue).toEqual({ status: "priced", currency: "USD", amount: { atoms: "5000000000000000000", scale: 18 } });
    if (outcome === "throws") {
      expect(first.holdings[1].value).toEqual({ status: "unpriced", reason: "price-unavailable" });
      const snapshot = assembleBalancesSnapshot({ owner: OWNER, region: "US", read, ...first });
      expect(snapshot.total).toEqual({ status: "complete", value: { atoms: "5000000000000000000", scale: 18 }, currency: "USD" });
    }
    for (const task of tasks.splice(0)) await task();
    const afterFailure = await price(read, "US", "cached");
    expect(afterFailure.holdings[0]).toEqual(first.holdings[0]);
    expect(await store.getMany([holding.key])).toEqual([observation]);
  });
}

test("a failed FX refresh keeps old token and native-currency exchange observations usable", async () => {
  const store = new MemoryPriceObservationStore();
  await store.putMany([
    { assetKey: holding.key, unitPrice: { atoms: "25", scale: 1 }, asOf: AS_OF, fetchedAt: AS_OF },
    { assetKey: "fx:USD:EUR", unitPrice: { atoms: "9", scale: 1 }, asOf: AS_OF, fetchedAt: AS_OF },
    { assetKey: "fx:USD:ETH", unitPrice: { atoms: "5", scale: 4 }, asOf: AS_OF, fetchedAt: AS_OF },
  ]);
  const tasks: Array<() => Promise<unknown>> = [];
  const price = createBalancesPricer({
    priceStore: store, stockAssets: [], now: () => new Date(NOW),
    schedule: (task) => tasks.push(typeof task === "function" ? task : () => task),
    readPrices: async () => { throw new Error("Codex down"); },
    readExchangeRates: async () => { throw new Error("Coinbase down"); },
  });
  const native: ReadHolding = { ...holding, id: "eth", key: "eip155:8453/native", kind: "native", symbol: "ETH", decimals: 18, contractAddress: null, cashCurrency: null, balance: { status: "ready", baseUnits: "1000000000000000000" } };
  const read = inventory([holding, native]);
  const first = await price(read, "DE");
  expect(first.holdings[0].value).toEqual({ status: "priced", currency: "EUR", amount: { atoms: "4500000000000000000", scale: 18 }, asOf: AS_OF });
  expect(first.holdings[1].value).toEqual({ status: "priced", currency: "EUR", amount: { atoms: "1800000000000000000000", scale: 18 }, asOf: AS_OF });
  for (const task of tasks.splice(0)) await task();
  expect((await price(read, "DE", "cached")).holdings).toEqual(first.holdings);
});

test.each(["unavailable", "stale"] as const)("stock references retain their last closed value at any age after a %s read but honor a pause", async (status) => {
  const asset = stockAssets[0];
  let time = Date.parse(NOW);
  const block = { number: "100", timestamp: NOW };
  let reference: TokenizedEquityReference = { assetId: asset.id, status: "closed", price: { atoms: "123", scale: 0 }, updatedAt: AS_OF, roundId: "1", multiplierWad: "1", block };
  const price = createBalancesPricer({
    priceStore: new MemoryPriceObservationStore(), stockAssets: [asset], now: () => new Date(time), nowMs: () => time,
    readStockReferences: async () => [reference],
    schedule: () => {},
  });
  const stock: ReadHolding = { ...holding, id: asset.id, key: `eip155:8453/erc20:${asset.contractAddress.toLowerCase()}`, contractAddress: asset.contractAddress, decimals: 8, cashCurrency: null, balance: { status: "ready", baseUnits: "100000000" } };
  const first = await price(inventory([stock]), "US");
  expect(first.holdings[0].value).toEqual({ status: "priced", currency: "USD", amount: { atoms: "123000000000000000000", scale: 18 }, asOf: AS_OF, reference: { kind: "tokenized-equity", session: "closed" } });
  time += 10 * 86_400_000;
  reference = status === "unavailable"
    ? { assetId: asset.id, status, reason: "read-failed", block }
    : { assetId: asset.id, status, lastPrice: { atoms: "999", scale: 0 }, updatedAt: NOW, multiplierWad: "1", block };
  expect((await price(inventory([stock]), "US")).holdings[0].value).toEqual(first.holdings[0].value);
  time += 60_000;
  reference = { assetId: asset.id, status: "paused", lastPrice: null, updatedAt: null, multiplierWad: "1", block };
  expect((await price(inventory([stock]), "US")).holdings[0].value).toEqual({ status: "unpriced", reason: "price-paused" });
});

test.each(["balance", "underlyingBalance", "withdrawableBalance"] as const)("pricing rejects a surviving unavailable %s at the wire boundary", async (field) => {
  const price = createBalancesPricer({ priceStore: new MemoryPriceObservationStore(), schedule: () => {} });
  const invalid: ReadHolding = { ...holding, [field]: { status: "unavailable", baseUnits: null } };
  await expect(price(inventory([invalid]), "US", "cached")).rejects.toThrow("balances-unavailable-read");
});

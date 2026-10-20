import { expect, test } from "bun:test";
import { encodeFunctionResult } from "viem";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import { PORTFOLIO_USDC_ADDRESS } from "@/config/portfolio-assets";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { erc20Abi, multicallAbi, vaultAbi } from "./abi";
import { createBalancesService } from "./coalesce";
import { MemoryBalanceSnapshotStore } from "./memory-snapshot-store";
import type { BalanceObservation, BalanceSnapshotRevision } from "./snapshot-store";
import { MemoryPriceObservationStore } from "./memory-price-observation-store";
import { createBalancesPricer } from "./price";
import { createBalancesReader } from "./read";
import { createBalancesResolver } from "./resolve";
import { registryEntries } from "./universe";
import type { BalancesEnumeration, BorrowRead, UniverseEntry } from "./types";

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const AT = "2026-09-13T12:00:00.000Z";
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const CATALOG = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;
const entry: UniverseEntry = {
  key: `eip155:8453/erc20:${TOKEN}`, id: "token", kind: "erc20", source: "registry",
  name: "Token", symbol: "TOKEN", decimals: 6, contractAddress: TOKEN, cashCurrency: null,
};

async function fixture(vault = false, contractValid = false, store = new MemoryBalanceSnapshotStore()) {
  const entries = contractValid ? registryEntries() : [vault ? { ...entry, kind: "vault-share" as const, underlying: { key: `eip155:8453/erc20:${CATALOG}` as const, symbol: "USDC" as const, decimals: 6 as const } } : entry];
  const vaultEntry = entries.find((holding) => holding.kind === "vault-share");
  if (vault && !vaultEntry) throw new Error("Expected a vault registry entry");
  const activeEntry = vault && vaultEntry ? vaultEntry : entry;
  const state: {
    time: number; block: number; fail: boolean; borrowFail: boolean; vaultRaw: number;
    tokenRaw: number; catalogFail: boolean; catalogOmits: boolean; catalogRaw: string;
    vaultReadFail: "underlying" | "withdrawable" | null; enumeration: BalancesEnumeration["status"];
    enumerationRows: BalancesEnumeration["rows"] | null;
    onEnumerate: ((cursor: string | null | undefined) => Promise<void>) | null;
  } = { time: Date.parse(AT), block: 100, fail: false, borrowFail: false, vaultRaw: 3_000_000, vaultReadFail: null, enumeration: "complete", tokenRaw: 2_000_000, catalogFail: false, catalogOmits: false, catalogRaw: "3000000", enumerationRows: null, onEnumerate: null };
  const prices = new MemoryPriceObservationStore();
  await prices.putMany([TOKEN, CATALOG, OTHER, PORTFOLIO_USDC_ADDRESS, ...BORROW_MARKETS.map((market) => market.collateralToken.address), BORROW_MARKETS[0].loanToken.address].map((address) => ({
    assetKey: `eip155:8453/erc20:${address.toLowerCase()}`, unitPrice: { atoms: "1", scale: 0 }, asOf: AT, fetchedAt: AT,
  })));
  const tasks: Array<() => Promise<unknown>> = [];
  const block = () => ({ number: `0x${state.block.toString(16)}`, hash: `0x${"1".repeat(64)}`, timestamp: "0x20" });
  const read = createBalancesReader({
    rpc: {
      assertBaseChain: async () => {},
      request: async (method) => {
        if (method === "eth_getBlockByNumber") return block();
        if (method === "eth_getBalance") return "0x0";
        if (state.fail) throw new Error("registry chunk failed");
        return encodeFunctionResult({ abi: multicallAbi, functionName: "aggregate3", result: entries.filter((holding) => holding.contractAddress !== null).map((holding) => ({
          success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: BigInt(holding.id === activeEntry.id ? state.tokenRaw : 0) }),
        })) });
      },
      batch: async () => vault ? [
        state.vaultReadFail === "underlying" ? null : encodeFunctionResult({ abi: vaultAbi, functionName: "convertToAssets", result: BigInt(state.vaultRaw) }),
        state.vaultReadFail === "withdrawable" ? null : encodeFunctionResult({ abi: vaultAbi, functionName: "maxWithdraw", result: BigInt(state.vaultRaw - 500_000) }),
        block(),
      ] : [block()],
    },
    hosted: () => false,
    resolvedRpcUrl: () => "https://carry-forward.test",
    now: () => new Date(state.time),
  });
  const service = createBalancesService({
    store, readUniverse: async () => ({ entries }), readBalances: read,
    registryHoldingsMatch: () => true,
    enumerateBalances: async (_owner, _signal, cursor) => {
      await state.onEnumerate?.(cursor);
      return {
        status: state.enumeration, rows: state.enumerationRows ?? (state.enumeration === "complete" ? [{ contractAddress: CATALOG, amountBaseUnits: state.catalogRaw }] : []),
        nextCursor: state.enumeration === "incomplete" ? "next" : null, pagesRead: 1, durationMs: 0,
      };
    },
    resolveBalances: createBalancesResolver({
      readAssetIcons: async () => ({}), lookupTokens: async () => new Map(),
      readCatalog: async () => state.catalogFail ? { status: "incomplete", entries: [] } : ({ status: "complete", entries: [CATALOG, OTHER].filter((address) => !(state.catalogOmits && address === CATALOG)).map((address) => ({ address, name: "Catalog", symbol: "CAT", decimals: 6, liquidityUsd: { atoms: "50000", scale: 0 } })) }),
    }),
    readBorrow: async (): Promise<BorrowRead> => ({ markets: BORROW_MARKETS.map((market, index) => state.borrowFail
      ? { marketId: market.marketId, status: "unavailable" }
      : { marketId: market.marketId, status: "ready", blockNumber: String(state.block), collateralRaw: index === 0 ? "1000000" : "0", debtAssetsRaw: index === 0 ? "500000" : "0", borrowAprWad: "1" }) }),
    priceBalances: createBalancesPricer({ priceStore: prices, stockAssets: [], now: () => new Date(state.time), readPrices: async () => { throw new Error("Codex down"); }, schedule: () => {} }),
    now: () => new Date(state.time), nowMs: () => state.time, log: () => {},
    schedule: (task) => tasks.push(typeof task === "function" ? task : () => task),
  });
  const advance = () => { state.time += 3_600_000; state.block += 1_800; };
  const get = () => service(OWNER, "US");
  const runNextTask = async () => {
    const task = tasks.shift();
    if (!task) throw new Error("Expected a scheduled balances task");
    await task();
  };
  return { state, store, tasks, advance, get, runNextTask, holdingId: activeEntry.id };
}

test("registry chunk failure carries previous balances through a background full observation", async () => {
  const f = await fixture();
  const good = await f.get();
  f.advance();
  f.state.fail = true;
  expect(await f.get()).toMatchObject({ stale: true, holdings: good.holdings, total: good.total });
  await f.runNextTask();
  const row = await f.store.get(8453, OWNER);
  expect(row?.coverage.registry).toBe("partial");
  expect(row?.holdings.find(({ id }) => id === "token")?.balance).toEqual({ status: "ready", baseUnits: "2000000" });
  expect(await f.get()).toMatchObject({ stale: true, holdings: good.holdings, total: good.total });
});

test("a first failed registry observation throws and persists nothing", async () => {
  const f = await fixture();
  f.state.fail = true;
  await expect(f.get()).rejects.toThrow("balances-registry-unavailable");
  expect(await f.store.get(8453, OWNER)).toBeNull();
});

test("legacy unavailable registry balances require a synchronous full repair even on a hot row", async () => {
  const f = await fixture();
  await f.get();
  const row = await f.store.get(8453, OWNER);
  if (!row) throw new Error("Expected a stored balances observation");
  f.advance();
  await f.store.putObservation({ ...row, blockNumber: String(f.state.block), observedAt: new Date(f.state.time).toISOString(), holdings: row.holdings.map((holding) => holding.source === "registry" ? { ...holding, balance: { status: "unavailable", baseUnits: null } } : holding) });
  await f.store.markHot(8453, OWNER, new Date(f.state.time + 60_000));
  f.state.time += 1_000;
  f.state.block += 1;
  const repaired = await f.get();
  expect(repaired.holdings.find(({ id }) => id === "token")?.balance).toEqual({ status: "ready", baseUnits: "2000000" });
  expect((await f.store.get(8453, OWNER))?.blockNumber).toBe(String(f.state.block));
  expect(f.tasks).toHaveLength(0);
});

test("an unusable legacy row is not a fallback when the synchronous repair also fails", async () => {
  const f = await fixture();
  await f.get();
  const row = await f.store.get(8453, OWNER);
  if (!row) throw new Error("Expected a stored balances observation");
  f.advance();
  await f.store.putObservation({ ...row, blockNumber: String(f.state.block), observedAt: new Date(f.state.time).toISOString(), holdings: row.holdings.map((holding) => ({ ...holding, balance: { status: "unavailable", baseUnits: null } })) });
  f.state.fail = true;
  await expect(f.get()).rejects.toThrow("balances-registry-unavailable");
});

test("hot registry-only observations carry ready balances instead of erasing them", async () => {
  const f = await fixture();
  const good = await f.get();
  f.advance();
  await f.store.markHot(8453, OWNER, new Date(f.state.time + 60_000));
  f.state.fail = true;
  const snapshot = await f.get();
  expect(snapshot).toMatchObject({ stale: true, holdings: good.holdings, total: good.total });
  expect((await f.store.get(8453, OWNER))?.coverage.registry).toBe("partial");
});

test.each(["unavailable", "incomplete"] as const)("%s enumeration retains prior catalog holdings and totals", async (status) => {
  const f = await fixture();
  const good = await f.get();
  f.advance();
  f.state.enumeration = status;
  await f.get();
  await f.runNextTask();
  const carried = await f.get();
  expect(carried.holdings).toEqual(good.holdings);
  expect(carried.total).toEqual(good.total);
  expect(carried.totals).toEqual(good.totals);
});

test("incomplete catalog resolution retains the prior catalog holding until a complete sold-token scan", async () => {
  const f = await fixture();
  const good = await f.get();
  const catalog = good.holdings.find((holding) => holding.source === "catalog");
  expect(catalog?.balance.baseUnits).toBe("3000000");
  f.advance();
  f.state.catalogFail = true;
  await f.get();
  await f.runNextTask();
  const carried = await f.get();
  expect((await f.store.get(8453, OWNER))?.coverage.catalog).toBe("incomplete");
  expect(carried.holdings.find((holding) => holding.key === catalog?.key)).toEqual(catalog);
  expect(carried.total).toEqual(good.total);
  expect(carried.totals).toEqual(good.totals);
  f.advance();
  f.state.catalogFail = false;
  f.state.catalogRaw = "0";
  await f.get();
  await f.runNextTask();
  const sold = await f.get();
  expect((await f.store.get(8453, OWNER))?.coverage.catalog).toBe("complete");
  expect(sold.holdings.some((holding) => holding.key === catalog?.key)).toBe(false);
});

test("a complete scan drops sold tokens despite incomplete resolution and retains unresolved positive holdings", async () => {
  const f = await fixture();
  f.state.enumerationRows = [
    { contractAddress: CATALOG, amountBaseUnits: "3000000" },
    { contractAddress: OTHER, amountBaseUnits: "2000000" },
  ];
  const good = await f.get();
  const retained = good.holdings.find((holding) => holding.contractAddress === CATALOG);
  expect(good.holdings.some((holding) => holding.contractAddress === OTHER)).toBe(true);
  f.advance();
  f.state.catalogFail = true;
  f.state.enumerationRows = [{ contractAddress: CATALOG, amountBaseUnits: "3000000" }];
  await f.get();
  await f.runNextTask();
  const snapshot = await f.get();
  expect((await f.store.get(8453, OWNER))?.coverage.catalog).toBe("incomplete");
  expect(snapshot.holdings.some((holding) => holding.contractAddress === OTHER)).toBe(false);
  expect(snapshot.holdings.find((holding) => holding.contractAddress === CATALOG)).toEqual(retained);
  expect(snapshot.total).toEqual({ status: "complete", value: { atoms: "5000000000000000000", scale: 18 }, currency: "USD" });
});

test("a resumed tail scan retains earlier pages when another instance clears the stored cursor", async () => {
  const f = await fixture();
  const good = await f.get();
  const row = await f.store.get(8453, OWNER);
  if (!row) throw new Error("Expected a stored balances observation");
  f.state.time += 1;
  await f.store.putObservation({ ...row, observedAt: new Date(f.state.time).toISOString(), enumerationCursor: "next" });
  await f.get();
  expect(f.tasks).toHaveLength(1);
  f.advance();
  f.state.enumerationRows = [{ contractAddress: OTHER, amountBaseUnits: "2000000" }];
  f.state.onEnumerate = async (cursor) => {
    expect(cursor).toBe("next");
    await f.store.putObservation({ ...row, observedAt: new Date(Date.parse(row.observedAt) + 2).toISOString(), enumerationCursor: null });
    expect((await f.store.get(8453, OWNER))?.enumerationCursor).toBeNull();
  };
  await f.runNextTask();
  const snapshot = await f.get();
  expect(snapshot.holdings.find((holding) => holding.contractAddress === CATALOG)).toEqual(good.holdings.find((holding) => holding.contractAddress === CATALOG));
  expect(snapshot.holdings.find((holding) => holding.contractAddress === OTHER)?.balance.baseUnits).toBe("2000000");
  expect(snapshot.total).toEqual({ status: "complete", value: { atoms: "7000000000000000000", scale: 18 }, currency: "USD" });
  expect((await f.store.get(8453, OWNER))?.enumerationCursor).toBeNull();
});

test("failed catalog and token lookups preserve catalog pricing metadata while refreshing the quantity", async () => {
  const f = await fixture();
  const good = await f.get();
  const row = await f.store.get(8453, OWNER);
  const catalog = row?.holdings.find((holding) => holding.contractAddress === CATALOG);
  expect(good.holdings.find((holding) => holding.contractAddress === CATALOG)?.value.status).toBe("priced");
  if (!catalog) throw new Error("Expected a stored catalog holding");
  f.advance();
  f.state.catalogFail = true;
  f.state.enumerationRows = [{ contractAddress: CATALOG, amountBaseUnits: "4000000", name: "Fallback", symbol: "FALL", decimals: 6 }];
  await f.get();
  await f.runNextTask();
  expect((await f.store.get(8453, OWNER))?.holdings.find((holding) => holding.key === catalog.key)).toEqual({ ...catalog, balance: { status: "ready", baseUnits: "4000000" } });
  const snapshot = await f.get();
  expect(snapshot.holdings.find((holding) => holding.key === catalog.key)?.value).toMatchObject({ status: "priced", amount: { atoms: "4000000000000000000", scale: 18 } });
  expect(snapshot.total).toEqual({ status: "complete", value: { atoms: "6000000000000000000", scale: 18 }, currency: "USD" });
});

test("a complete catalog read that no longer enriches a held token keeps its prior pricing metadata and marks the catalog incomplete", async () => {
  const f = await fixture();
  await f.get();
  const catalog = (await f.store.get(8453, OWNER))?.holdings.find((holding) => holding.contractAddress === CATALOG);
  if (!catalog) throw new Error("Expected a stored catalog holding");
  f.advance();
  f.state.catalogOmits = true;
  f.state.enumerationRows = [{ contractAddress: CATALOG, amountBaseUnits: "4000000", name: "Fallback", symbol: "FALL", decimals: 6 }];
  await f.get();
  await f.runNextTask();
  const stored = await f.store.get(8453, OWNER);
  expect(stored?.holdings.find((holding) => holding.key === catalog.key)).toEqual({ ...catalog, balance: { status: "ready", baseUnits: "4000000" } });
  expect(stored?.coverage.catalog).toBe("incomplete");
});

test("a failed background observation cannot resurrect a balance zeroed by a newer hot read", async () => {
  const f = await fixture();
  expect((await f.get()).holdings.find(({ id }) => id === "token")?.balance.baseUnits).toBe("2000000");
  f.advance();
  await f.get();
  expect(f.tasks).toHaveLength(1);
  await f.store.markHot(8453, OWNER, new Date(f.state.time + 60_000));
  f.state.tokenRaw = 0;
  await f.get();
  expect((await f.store.get(8453, OWNER))?.holdings.find(({ id }) => id === "token")?.balance.baseUnits).toBe("0");
  f.state.time += 1_000;
  f.state.block += 1;
  f.state.fail = true;
  await f.runNextTask();
  const stored = await f.store.get(8453, OWNER);
  expect(stored?.blockNumber).toBe(String(f.state.block));
  expect(stored?.coverage.registry).toBe("partial");
  expect(stored?.holdings.find(({ id }) => id === "token")?.balance).toEqual({ status: "ready", baseUnits: "0" });
  expect((await f.get()).holdings.find(({ id }) => id === "token")?.balance.baseUnits).toBe("0");
});

test("a carried observation cannot overwrite a successful zero written after its basis read", async () => {
  let beforeWrite: (() => Promise<void>) | null = null;
  const store = new class extends MemoryBalanceSnapshotStore {
    override async putObservation(row: BalanceObservation, expected?: BalanceSnapshotRevision | null): Promise<boolean> {
      const interleave = beforeWrite;
      beforeWrite = null;
      await interleave?.();
      return super.putObservation(row, expected);
    }
  }();
  const f = await fixture(false, false, store);
  expect((await f.get()).holdings.find(({ id }) => id === "token")?.balance.baseUnits).toBe("2000000");
  const basis = await store.get(8453, OWNER);
  if (!basis) throw new Error("Expected a stored balances observation");
  const zero: BalanceObservation = {
    ...basis,
    blockNumber: "101",
    observedAt: new Date(f.state.time + 500).toISOString(),
    holdings: basis.holdings.map((holding) => holding.id === "token"
      ? { ...holding, balance: { status: "ready", baseUnits: "0" } }
      : holding),
  };
  f.state.time += 1_000;
  f.state.block = 102;
  f.state.fail = true;
  await store.markHot(8453, OWNER, new Date(f.state.time + 60_000));
  beforeWrite = async () => { expect(await store.putObservation(zero)).toBeTrue(); };
  const snapshot = await f.get();
  expect(await store.get(8453, OWNER)).toMatchObject({ ...zero, hotUntil: new Date(f.state.time + 60_000).toISOString() });
  expect(snapshot.block.number).toBe("101");
  expect(snapshot.holdings.find(({ id }) => id === "token")?.balance).toEqual({ status: "ready", baseUnits: "0" });
});

test.each([false, true])("a lower vault conversion clamps carried withdrawals and remains contract-valid (hot=%s)", async (hot) => {
  const f = await fixture(true, true);
  const good = await f.get();
  expect(good.holdings.find(({ id }) => id === f.holdingId)?.withdrawableBalance?.baseUnits).toBe("2500000");
  f.advance();
  f.state.vaultRaw = 1_000_000;
  f.state.vaultReadFail = "withdrawable";
  if (hot) await f.store.markHot(8453, OWNER, new Date(f.state.time + 60_000));
  await f.get();
  if (!hot) await f.runNextTask();
  const snapshot = await f.get();
  const parsed = parseBalancesSnapshot(snapshot, { subject: "fixture", smartAccountAddress: OWNER, chainId: 8453 }, "US");
  const holding = parsed.holdings.find(({ id }) => id === f.holdingId);
  expect(holding?.underlyingBalance).toEqual({ status: "ready", baseUnits: "1000000" });
  expect(holding?.withdrawableBalance).toEqual({ status: "ready", baseUnits: "1000000" });
  expect(parsed).toEqual(snapshot);
});

test("borrow positions survive thousands of blocks and an hour of failed market reads", async () => {
  const f = await fixture();
  const good = await f.get();
  f.advance();
  f.state.borrowFail = true;
  await f.get();
  await f.runNextTask();
  const carried = await f.get();
  expect(carried.borrow.positions).toEqual(good.borrow.positions);
  expect((await f.store.get(8453, OWNER))?.borrow?.markets[0]).toMatchObject({ status: "ready", blockNumber: "100" });
  expect(carried.stale).toBe(true);
  f.state.time += 30_001;
  expect(await f.get()).toMatchObject({ stale: true, borrow: good.borrow });
});

test.each([false, true])("vault carry-forward keeps failed fields and accepts fresh fields (hot=%s)", async (hot) => {
  const f = await fixture(true);
  const good = await f.get();
  const original = good.holdings.find(({ id }) => id === f.holdingId);
  if (!original) throw new Error("Expected the original vault holding");
  f.advance();
  f.state.vaultRaw = 4_000_000;
  f.state.vaultReadFail = "withdrawable";
  if (hot) await f.store.markHot(8453, OWNER, new Date(f.state.time + 60_000));
  await f.get();
  if (!hot) await f.runNextTask();
  const carried = await f.get();
  expect(carried.stale).toBe(true);
  const next = carried.holdings.find(({ id }) => id === f.holdingId);
  if (!next) throw new Error("Expected the retained vault holding");
  expect(next.balance).toEqual(original.balance);
  expect(next.underlyingBalance).toEqual({ status: "ready", baseUnits: "4000000" });
  expect(next.withdrawableBalance).toEqual(original.withdrawableBalance);
  expect((await f.store.get(8453, OWNER))?.coverage.registry).toBe("partial");
});

test("a failed vault conversion preserves the last underlying balance and its priced value", async () => {
  const f = await fixture(true);
  const good = await f.get();
  f.advance();
  f.state.vaultReadFail = "underlying";
  await f.get();
  await f.runNextTask();
  expect(await f.get()).toMatchObject({ stale: true, holdings: good.holdings, total: good.total });
});

test("market failures with no prior observation omit borrow positions", async () => {
  const f = await fixture();
  f.state.borrowFail = true;
  const snapshot = await f.get();
  expect(snapshot.borrow.positions).toEqual([]);
  expect(snapshot.totals.borrow.value?.atoms).toBe("0");
});

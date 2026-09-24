import { describe, expect, test } from "bun:test";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import {
  borrowPosition,
  buildBalancesSnapshotFixture,
  priced as fixturePriced,
  ready,
} from "@/shared/balances/fixtures";
import type { BalancesBorrow, Holding } from "@/shared/balances/types";
import { createBalancesService } from "./coalesce";
import { MemoryBalanceSnapshotStore } from "./memory-snapshot-store";
import type { BalanceObservation } from "./snapshot-store";
import { borrowReadComplete } from "./borrow";
import type { BalancesEnumeration, BalancesRead, BorrowRead, ReadHolding } from "./types";

const borrowMarketId = BORROW_MARKETS[0].marketId.toLowerCase() as `0x${string}`;
function readyBorrow(): BorrowRead {
  return {
    markets: BORROW_MARKETS.map((market) => ({
      marketId: market.marketId.toLowerCase() as `0x${string}`,
      status: "ready" as const,
      blockNumber: "11",
      collateralRaw: "0",
      debtAssetsRaw: "0",
      borrowAprWad: "0",
    })),
  };
}

function unavailableBorrow(): BorrowRead {
  return { markets: readyBorrow().markets.map((market) => market.marketId === borrowMarketId
    ? { marketId: borrowMarketId, status: "unavailable" as const }
    : market) };
}

const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const observedAt = "2026-09-13T12:00:00.000Z";
const registry: ReadHolding = {
  key: "eip155:8453/native",
  id: "eth",
  kind: "native",
  source: "registry",
  name: "Ethereum",
  symbol: "ETH",
  decimals: 18,
  contractAddress: null,
  cashCurrency: null,
  balance: { status: "ready", baseUnits: "1" },
};
const catalog: ReadHolding = {
  key: "eip155:8453/erc20:0x1111111111111111111111111111111111111111",
  id: "catalog:0x1111111111111111111111111111111111111111",
  kind: "erc20",
  source: "catalog",
  name: "Catalog",
  symbol: "CAT",
  decimals: 18,
  contractAddress: "0x1111111111111111111111111111111111111111",
  cashCurrency: null,
  balance: { status: "ready", baseUnits: "2" },
};
/** A holding beyond page one of a bounded enumeration. */
const laterPageCatalog: ReadHolding = {
  key: "eip155:8453/erc20:0x2222222222222222222222222222222222222222",
  id: "catalog:0x2222222222222222222222222222222222222222",
  kind: "erc20",
  source: "catalog",
  name: "Later",
  symbol: "LATE",
  decimals: 18,
  contractAddress: "0x2222222222222222222222222222222222222222",
  cashCurrency: null,
  balance: { status: "ready", baseUnits: "7" },
};

function read(number = "10", at = observedAt, holdings: ReadHolding[] = [registry, catalog]): BalancesRead {
  return {
    block: { number, hash: `0x${number.padStart(64, "0")}`, timestamp: number },
    observedAt: at,
    holdings,
    coverage: { registry: "complete", catalog: "complete" },
  };
}

function observation(overrides: Partial<BalanceObservation> = {}): BalanceObservation {
  const value = read();
  return {
    chainId: 8453,
    address: owner,
    blockNumber: value.block.number,
    blockHash: value.block.hash,
    blockTimestamp: value.block.timestamp,
    observedAt: value.observedAt,
    holdings: value.holdings,
    coverage: value.coverage,
    borrow: readyBorrow(),
    ...overrides,
  };
}

function priced(rows: BalancesRead["holdings"]): Holding[] {
  return rows.map((holding) => ({
    key: holding.key,
    id: holding.id,
    kind: holding.kind,
    source: holding.source,
    name: holding.name,
    symbol: holding.symbol,
    decimals: holding.decimals,
    contractAddress: holding.contractAddress,
    cashCurrency: holding.cashCurrency,
    balance: holding.balance,
    value: { status: "unpriced", reason: "price-unavailable" },
  }));
}

function setup(options: {
  store?: MemoryBalanceSnapshotStore;
  now?: string | (() => Date);
  registryRead?: () => Promise<BalancesRead>;
  enumerate?: (cursor?: string | null) => Promise<BalancesEnumeration>;
  price?: (read: BalancesRead) => Holding[];
  pricedBorrow?: BalancesBorrow;
  readBorrow?: (at: BalancesRead["block"]) => Promise<BorrowRead>;
}) {
  const store = options.store ?? new MemoryBalanceSnapshotStore();
  const configuredNow = options.now;
  const events: unknown[] = [];
  let reads = 0;
  let enumerations = 0;
  let borrowReads = 0;
  const borrowPins: Array<BalancesRead["block"]> = [];
  let clock = 0;
  const scheduled: Array<() => Promise<unknown>> = [];
  const service = createBalancesService({
    store,
    now: typeof configuredNow === "function"
      ? configuredNow
      : () => new Date(configuredNow ?? "2026-09-13T12:00:30.000Z"),
    nowMs: () => clock++,
    log: (event) => events.push(event),
    schedule: (task) => scheduled.push(typeof task === "function" ? task : () => task),
    readUniverse: async () => ({ entries: [] }),
    readBalances: async () => {
      reads += 1;
      return options.registryRead?.() ?? read("11", "2026-09-13T12:00:30.000Z", [registry]);
    },
    enumerateBalances: async (_owner, _signal, cursor) => {
      enumerations += 1;
      return options.enumerate?.(cursor) ?? { status: "complete", rows: [], nextCursor: null, pagesRead: 1, durationMs: 1 };
    },
    resolveBalances: async (registryRead, enumeration) => ({
      ...registryRead,
      holdings: enumeration.status === "unavailable"
        ? registryRead.holdings
        : [
            ...registryRead.holdings,
            ...(enumeration.rows.length === 0
              ? [catalog]
              : enumeration.rows.map((row) => ({
                  ...catalog,
                  key: `eip155:8453/erc20:${row.contractAddress}` as const,
                  id: `catalog:${row.contractAddress}`,
                  contractAddress: row.contractAddress,
                  balance: { status: "ready" as const, baseUnits: row.amountBaseUnits },
                }))),
          ],
      coverage: {
        registry: registryRead.coverage.registry,
        catalog: enumeration.status === "unavailable"
          ? "unavailable"
          : enumeration.status === "incomplete"
            ? "incomplete"
            : "complete",
      },
    }),
    readBorrow: async (_owner, at) => {
      borrowReads += 1;
      borrowPins.push(at);
      return options.readBorrow?.(at) ?? readyBorrow();
    },
    priceBalances: async (value) => ({
      holdings: options.price?.(value) ?? priced(value.holdings),
      borrow: options.pricedBorrow ?? { coverage: borrowReadComplete(value.borrow) ? "complete" : "partial", positions: [] },
      revalidating: false,
      durationMs: { store: 0, codex: 0, coinbase: 0 },
    } as never),
  });
  return {
    store,
    service,
    events,
    reads: () => reads,
    enumerations: () => enumerations,
    borrowReads: () => borrowReads,
    borrowPins: () => borrowPins,
    pending: () => scheduled.length,
    flush: async () => { await Promise.all(scheduled.splice(0).map((task) => task())); },
  };
}

describe("balance observations", () => {
  test("serves a fresh row with fetchedAt equal to observedAt", async () => {
    const fixture = setup({});
    await fixture.store.putObservation(observation());
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.fetchedAt).toBe(observedAt);
    expect(snapshot.stale).toBeUndefined();
    expect(fixture.reads()).toBe(0);
    expect(fixture.enumerations()).toBe(0);
  });

  test("emits one balances-read event with stage durations and coverage", async () => {
    const fixture = setup({});
    await fixture.store.putObservation(observation());
    await fixture.service(owner, "US");
    expect(fixture.events).toEqual([{
      kind: "balances-read",
      route: "/api/balances",
      outcome: "served-row",
      durationMs: {
        "store-read": 1,
        enumerate: 0,
        "registry-read": 0,
        resolve: 0,
        price: 1,
        "valuation-store": 0,
        codex: 0,
        coinbase: 0,
        "store-write": 0,
        total: expect.any(Number),
      },
      coverage: { registry: "complete", catalog: "complete" },
      incomplete: {
        registry: 0, catalog: 0, borrow: 0, balanceUnavailable: 0, valueUnavailable: 0,
        priceUnavailable: 2, priceStale: 0, fxUnavailable: 0, belowMarketGate: 0, noQuoteCurrency: 0,
      },
    }]);
  });

  test("counts final snapshot coverage and positive holding and Borrow valuation gaps", async () => {
    const unavailable = {
      ...catalog,
      id: "unavailable",
      key: "eip155:8453/erc20:0x3333333333333333333333333333333333333333" as const,
      balance: { status: "unavailable" as const, baseUnits: null },
    };
    const noQuote = {
      ...catalog,
      id: "no-quote",
      key: "eip155:8453/erc20:0x4444444444444444444444444444444444444444" as const,
    };
    const zero = { ...catalog, id: "zero", balance: { status: "ready" as const, baseUnits: "0" } };
    const borrow = borrowPosition({
      collateralBaseUnits: "100000",
      collateralValue: { status: "unpriced", reason: "fx-unavailable" },
      debtBaseUnits: "1000000",
      debtValue: { status: "unpriced", reason: "below-market-gate" },
    });
    const fixture = setup({
      store: new MemoryBalanceSnapshotStore(),
      pricedBorrow: { coverage: "partial", positions: [borrow] },
      price: (value) => value.holdings.map((holding) => ({
        ...holding,
        value: holding.id === "eth"
          ? { status: "unpriced", reason: "price-stale" }
          : holding.id === "unavailable"
            ? { status: "unavailable" }
            : holding.id === "no-quote"
              ? { status: "unpriced", reason: "no-quote-currency" }
              : { status: "unpriced", reason: "price-unavailable" },
      })),
    });
    await fixture.store.putObservation(observation({
      holdings: [registry, catalog, unavailable, noQuote, zero],
      coverage: { registry: "partial", catalog: "incomplete" },
    }));

    await fixture.service(owner, "US");
    expect(fixture.events).toContainEqual(expect.objectContaining({
      outcome: "revalidating",
      incomplete: {
        registry: 1, catalog: 1, borrow: 1, balanceUnavailable: 1, valueUnavailable: 0,
        priceUnavailable: 1, priceStale: 1, fxUnavailable: 1, belowMarketGate: 1, noQuoteCurrency: 1,
      },
    }));
  });

  test("a failed read emits zero incompleteness", async () => {
    const fixture = setup({ registryRead: async () => { throw new Error("rpc unavailable"); } });
    await expect(fixture.service(owner, "US")).rejects.toThrow("rpc unavailable");
    expect(fixture.events).toContainEqual(expect.objectContaining({
      outcome: "error",
      incomplete: {
        registry: 0, catalog: 0, borrow: 0, balanceUnavailable: 0, valueUnavailable: 0,
        priceUnavailable: 0, priceStale: 0, fxUnavailable: 0, belowMarketGate: 0, noQuoteCurrency: 0,
      },
    }));
  });

  test("a fresh partial row with a cursor is served without foreground enumeration", async () => {
    const fixture = setup({});
    await fixture.store.putObservation(observation({
      enumerationCursor: "page-two",
      coverage: { registry: "complete", catalog: "incomplete" },
    }));

    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.coverage.catalog).toBe("incomplete");
    expect(fixture.reads()).toBe(0);
    expect(fixture.enumerations()).toBe(0);
    expect(fixture.events).toContainEqual(expect.objectContaining({ outcome: "served-row" }));
    expect((await fixture.store.get(8453, owner))?.enumerationCursor).toBe("page-two");
  });

  test("the backstop resumes a bounded enumeration, merges stored rows, and clears the cursor", async () => {
    const nextAddress = "0x2222222222222222222222222222222222222222" as const;
    const cursors: Array<string | null | undefined> = [];
    const fixture = setup({
      now: "2026-09-13T12:02:01.000Z",
      enumerate: async (cursor) => {
        cursors.push(cursor);
        return {
          status: "complete",
          rows: [{ contractAddress: nextAddress, amountBaseUnits: "3" }],
          nextCursor: null,
          pagesRead: 1,
          durationMs: 5,
        };
      },
    });
    await fixture.store.putObservation(observation({ enumerationCursor: "page-two" }));

    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeTrue();
    expect(cursors).toEqual([]);
    expect(snapshot.holdings.map(({ contractAddress }) => contractAddress)).toContain(
      catalog.contractAddress,
    );
    await fixture.flush();
    expect(cursors).toEqual(["page-two"]);
    expect((await fixture.store.get(8453, owner))?.holdings.map(({ contractAddress }) => contractAddress)).toContain(nextAddress);
    expect((await fixture.store.get(8453, owner))?.enumerationCursor).toBeNull();

    await fixture.service(owner, "DE");
    expect(fixture.enumerations()).toBe(1);
  });

  test("hot rows with a cursor re-read registry only and preserve catalog progress", async () => {
    const fixture = setup({});
    await fixture.store.putObservation(observation({ enumerationCursor: "page-two" }));
    await fixture.store.markHot(8453, owner, new Date("2026-09-13T12:01:00.000Z"));
    const snapshot = await fixture.service(owner, "US");
    expect(fixture.reads()).toBe(1);
    expect(fixture.enumerations()).toBe(0);
    expect(snapshot.holdings.map((holding) => holding.source)).toEqual(["registry", "catalog"]);
    expect(snapshot.fetchedAt).toBe(observedAt);
    expect((await fixture.store.get(8453, owner))?.observedAt).toBe(observedAt);
    expect((await fixture.store.get(8453, owner))?.enumerationCursor).toBe("page-two");
    expect(fixture.events).toContainEqual(expect.objectContaining({ outcome: "registry-only" }));
  });

  test("continuous hot reads still run a full observation after 120 seconds", async () => {
    let current = new Date("2026-09-13T12:00:30.000Z");
    const fixture = setup({
      now: () => current,
      registryRead: async () => read("11", current.toISOString(), [registry]),
    });
    await fixture.store.putObservation(observation());
    await fixture.store.markHot(8453, owner, new Date("2026-09-13T12:05:00.000Z"));

    await fixture.service(owner, "US");
    current = new Date("2026-09-13T12:01:30.000Z");
    await fixture.service(owner, "US");
    expect((await fixture.store.get(8453, owner))?.observedAt).toBe(observedAt);
    expect(fixture.enumerations()).toBe(0);

    current = new Date("2026-09-13T12:02:01.000Z");
    const stale = await fixture.service(owner, "US");
    expect(stale.stale).toBeTrue();
    await fixture.flush();
    expect(fixture.enumerations()).toBe(1);
  });

  test("a stale mark causes a full re-observe", async () => {
    const fixture = setup({});
    await fixture.store.putObservation(observation());
    await fixture.store.markStale(8453, owner, new Date("2026-09-13T12:00:20.000Z"));
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeTrue();
    expect(fixture.reads()).toBe(0);
    expect(fixture.enumerations()).toBe(0);
    await fixture.flush();
    expect(fixture.reads()).toBe(1);
    expect(fixture.enumerations()).toBe(1);
  });

  test("a stale mark during a hot window still forces a full re-observe", async () => {
    const fixture = setup({});
    await fixture.store.putObservation(observation());
    await fixture.store.markHot(8453, owner, new Date("2026-09-13T12:01:00.000Z"));
    await fixture.store.markStale(8453, owner, new Date("2026-09-13T12:00:20.000Z"));
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeTrue();
    expect(fixture.reads()).toBe(1);
    expect(fixture.enumerations()).toBe(0);
    await fixture.flush();
    expect(fixture.reads()).toBe(2);
    expect(fixture.enumerations()).toBe(1);
  });

  test("degraded catalog coverage forces a full re-observe", async () => {
    const fixture = setup({});
    await fixture.store.putObservation({
      ...observation(),
      coverage: { registry: "complete", catalog: "unavailable" },
    });
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeTrue();
    expect(fixture.enumerations()).toBe(0);
    await fixture.flush();
    expect(fixture.enumerations()).toBe(1);
  });

  test("partial registry coverage is served stale and revalidated in the background", async () => {
    const fixture = setup({});
    await fixture.store.putObservation({
      ...observation(),
      coverage: { registry: "partial", catalog: "complete" },
    });
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeTrue();
    expect(fixture.reads()).toBe(0);
    expect(fixture.enumerations()).toBe(0);
    await fixture.flush();
    expect(fixture.reads()).toBe(1);
    expect(fixture.enumerations()).toBe(1);
  });

  test("a full observation reads and persists Borrow positions alongside holdings", async () => {
    const fixture = setup({});
    const snapshot = await fixture.service(owner, "US");
    expect(fixture.borrowReads()).toBe(1);
    expect(snapshot.borrow.coverage).toBe("complete");
    expect(fixture.borrowPins()).toEqual([read("11").block]);
    expect((await fixture.store.get(8453, owner))?.borrow).toEqual(readyBorrow());
  });

  test("a failed Borrow read marks Borrow partial, persists no zero, and retries after the interval", async () => {
    let failing = true;
    let current = new Date("2026-09-13T12:00:30.000Z");
    const fixture = setup({
      now: () => current,
      registryRead: async () => read("11", current.toISOString(), [registry]),
      readBorrow: async () => failing ? unavailableBorrow() : readyBorrow(),
    });
    const first = await fixture.service(owner, "US");
    expect(first.borrow.coverage).toBe("partial");
    expect(first.totals.net.status).not.toBe("complete");
    expect((await fixture.store.get(8453, owner))?.borrow?.markets[0]?.status).toBe("unavailable");

    failing = false;
    current = new Date("2026-09-13T12:00:50.000Z");
    const within = await fixture.service(owner, "US");
    expect(within.stale).toBeUndefined();
    expect(within.borrow.coverage).toBe("partial");
    expect(within.totals.net.status).not.toBe("complete");
    expect(fixture.pending()).toBe(0);

    current = new Date("2026-09-13T12:01:00.000Z");
    const due = await fixture.service(owner, "US");
    expect(due.stale).toBeTrue();
    expect(due.borrow.coverage).toBe("partial");
    await fixture.flush();
    expect(fixture.borrowReads()).toBe(2);
    expect((await fixture.store.get(8453, owner))?.borrow).toEqual(readyBorrow());
  });

  test("a Borrow outage across consecutive full observations waits the retry interval before another", async () => {
    let current = new Date("2026-09-13T12:01:00.000Z");
    let block = 11;
    const fixture = setup({
      now: () => current,
      registryRead: async () => read(String(block++), current.toISOString(), [registry]),
      readBorrow: async () => unavailableBorrow(),
    });
    await fixture.store.putObservation(observation({ borrow: unavailableBorrow() }));

    const first = await fixture.service(owner, "US");
    expect(first.stale).toBeTrue();
    expect(fixture.pending()).toBe(1);
    await fixture.flush();
    expect(fixture.reads()).toBe(1);
    expect((await fixture.store.get(8453, owner))?.observedAt).toBe("2026-09-13T12:01:00.000Z");

    current = new Date("2026-09-13T12:01:20.000Z");
    const second = await fixture.service(owner, "US");
    expect(second.stale).toBeUndefined();
    expect(second.borrow.coverage).toBe("partial");
    expect(second.totals.net.status).not.toBe("complete");
    expect(fixture.pending()).toBe(0);
    expect(fixture.reads()).toBe(1);

    current = new Date("2026-09-13T12:01:30.000Z");
    const third = await fixture.service(owner, "US");
    expect(third.stale).toBeTrue();
    expect(fixture.pending()).toBe(1);
  });

  test("a hot-window Borrow failure is flagged stale from the fresh read, subject to the interval", async () => {
    const due = setup({ now: "2026-09-13T12:00:45.000Z", readBorrow: async () => unavailableBorrow() });
    await due.store.putObservation(observation());
    await due.store.markHot(8453, owner, new Date("2026-09-13T12:01:00.000Z"));
    const flagged = await due.service(owner, "US");
    expect(due.reads()).toBe(1);
    expect(flagged.stale).toBeTrue();
    expect(flagged.borrow.coverage).toBe("partial");
    expect(due.pending()).toBe(1);

    const recent = setup({ now: "2026-09-13T12:00:45.000Z", readBorrow: async () => unavailableBorrow() });
    await recent.store.putObservation(observation({ observedAt: "2026-09-13T12:00:30.000Z" }));
    await recent.store.markHot(8453, owner, new Date("2026-09-13T12:01:00.000Z"));
    const waiting = await recent.service(owner, "US");
    expect(waiting.stale).toBeUndefined();
    expect(waiting.borrow.coverage).toBe("partial");
    expect(waiting.totals.net.status).not.toBe("complete");
    expect(recent.pending()).toBe(0);
  });

  test("a stored row observed before Borrow was tracked is served stale and revalidated", async () => {
    const fixture = setup({});
    await fixture.store.putObservation({ ...observation(), borrow: null });
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeTrue();
    expect(snapshot.borrow.coverage).toBe("partial");
    await fixture.flush();
    expect(fixture.borrowReads()).toBe(1);
  });

  test("a hot row re-reads Borrow with the registry after an action", async () => {
    const fixture = setup({});
    await fixture.store.putObservation(observation());
    await fixture.store.markHot(8453, owner, new Date("2026-09-13T12:01:00.000Z"));
    await fixture.service(owner, "US");
    expect(fixture.reads()).toBe(1);
    expect(fixture.borrowReads()).toBe(1);
    expect(fixture.enumerations()).toBe(0);
    expect(fixture.borrowPins()).toEqual([read("11").block]);
  });

  test("the 120 second backstop causes a full re-observe", async () => {
    const fixture = setup({ now: "2026-09-13T12:02:01.000Z" });
    await fixture.store.putObservation(observation());
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeTrue();
    expect(fixture.reads()).toBe(0);
    await fixture.flush();
    expect(fixture.reads()).toBe(1);
    expect(fixture.enumerations()).toBe(1);
  });

  test("failed required re-observe serves the prior row stale with unchanged coverage", async () => {
    const fixture = setup({
      registryRead: async () => { throw new Error("rpc unavailable"); },
    });
    await fixture.store.putObservation({
      ...observation(),
      coverage: { registry: "partial", catalog: "incomplete" },
    });
    await fixture.store.markStale(8453, owner, new Date("2026-09-13T12:00:20.000Z"));
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeTrue();
    expect(snapshot.coverage).toEqual({ registry: "partial", catalog: "incomplete" });
    expect(snapshot.fetchedAt).toBe(observedAt);
    await fixture.flush();
    expect(fixture.events).toContainEqual(expect.objectContaining({ outcome: "background-error" }));
  });

  test("a snapshot read failure falls through to a fresh observation", async () => {
    const memory = new MemoryBalanceSnapshotStore();
    const fixture = setup({
      store: Object.assign(memory, {
        get: async () => { throw new Error("database unavailable"); },
      }),
    });
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeUndefined();
    expect(fixture.reads()).toBe(1);
  });

  test("an observation write failure still returns the fresh read", async () => {
    const memory = new MemoryBalanceSnapshotStore();
    const fixture = setup({
      store: Object.assign(memory, {
        putObservation: async () => { throw new Error("database unavailable"); },
      }),
    });
    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.stale).toBeUndefined();
    expect(snapshot.fetchedAt).toBe("2026-09-13T12:00:30.000Z");
  });

  test("serves the winning row when the observation loses its conditional write", async () => {
    const memory = new MemoryBalanceSnapshotStore();
    await memory.putObservation(observation({
      blockNumber: "12",
      blockHash: `0x${"12".padStart(64, "0")}`,
      blockTimestamp: "12",
      observedAt: "2026-09-13T12:00:31.000Z",
    }));
    const winner = await memory.get(8453, owner);
    let reads = 0;
    const fixture = setup({
      store: Object.assign(memory, {
        get: async () => {
          reads += 1;
          return reads === 1 ? null : winner;
        },
        putObservation: async () => false,
      }),
    });

    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.fetchedAt).toBe("2026-09-13T12:00:31.000Z");
    expect(snapshot.block.number).toBe("12");
  });

  test("an unavailable enumeration preserves prior non-registry holdings and the full-observation pin", async () => {
    const freshRegistry = {
      ...registry,
      balance: { status: "ready" as const, baseUnits: "9" },
    };
    const fixture = setup({
      now: "2026-09-13T12:02:01.000Z",
      registryRead: async () => read(
        "11",
        "2026-09-13T12:02:01.000Z",
        [freshRegistry],
      ),
      enumerate: async () => ({
        status: "unavailable",
        rows: [],
        nextCursor: null,
        pagesRead: 0,
        durationMs: 1,
      }),
    });
    await fixture.store.putObservation(observation());

    const first = await fixture.service(owner, "US");
    expect(first.stale).toBeTrue();
    expect(first.holdings[0]?.balance).toEqual({ status: "ready", baseUnits: "1" });
    await fixture.flush();
    expect(await fixture.store.get(8453, owner)).toMatchObject({
      observedAt,
      enumerationCursor: null,
    });

    await fixture.service(owner, "US");
    await fixture.flush();
    expect(fixture.enumerations()).toBe(2);
  });

  test("a completed resume preserves prior incompleteness until a complete page-one scan", async () => {
    const cursors: Array<string | null | undefined> = [];
    let fromStartScans = 0;
    let registryReads = 0;
    const fixture = setup({
      now: "2026-09-13T12:02:01.000Z",
      registryRead: async () => {
        registryReads += 1;
        return read("11", `2026-09-13T12:00:3${registryReads}.000Z`, [registry]);
      },
      enumerate: async (cursor) => {
        cursors.push(cursor);
        if (cursor === "page-two") {
          return {
            status: "complete",
            rows: [{
              contractAddress: "0x2222222222222222222222222222222222222222",
              amountBaseUnits: "7",
            }],
            nextCursor: null,
            pagesRead: 1,
            durationMs: 5,
          };
        }
        fromStartScans += 1;
        return fromStartScans === 1
          ? {
              status: "incomplete",
              rows: [{
                contractAddress: "0x1111111111111111111111111111111111111111",
                amountBaseUnits: "2",
              }],
              nextCursor: "page-two",
              pagesRead: 1,
              durationMs: 5,
            }
          : {
              status: "complete",
              rows: [{
                contractAddress: "0x1111111111111111111111111111111111111111",
                amountBaseUnits: "2",
              }],
              nextCursor: null,
              pagesRead: 2,
              durationMs: 5,
            };
      },
    });
    await fixture.store.putObservation(observation({
      holdings: [registry, catalog, laterPageCatalog],
    }));
    await fixture.store.markStale(8453, owner, new Date("2026-09-13T12:00:20.000Z"));

    const served = await fixture.service(owner, "US");
    expect(served.stale).toBeTrue();
    expect(cursors).toEqual([]);
    await fixture.flush();

    expect(cursors).toEqual([null]);
    const afterFirstPage = await fixture.store.get(8453, owner);
    expect(afterFirstPage?.holdings.map(({ id }) => id)).toEqual([
      registry.id,
      catalog.id,
      laterPageCatalog.id,
    ]);
    expect(afterFirstPage?.enumerationCursor).toBe("page-two");
    expect(afterFirstPage?.coverage.catalog).toBe("incomplete");

    const resumed = await fixture.service(owner, "US");
    expect(resumed.stale).toBeUndefined();
    await fixture.flush();

    expect(cursors).toEqual([null, "page-two"]);
    const afterResume = await fixture.store.get(8453, owner);
    expect(afterResume?.enumerationCursor).toBeNull();
    expect(afterResume?.coverage.catalog).toBe("incomplete");
    expect(afterResume?.holdings.map(({ id }) => id)).toEqual([
      registry.id,
      catalog.id,
      laterPageCatalog.id,
    ]);

    await fixture.store.markStale(8453, owner, new Date("2026-09-13T12:01:00.000Z"));
    expect((await fixture.service(owner, "US")).stale).toBeTrue();
    await fixture.flush();

    expect(cursors).toEqual([null, "page-two", null]);
    const converged = await fixture.store.get(8453, owner);
    expect(converged?.enumerationCursor).toBeNull();
    expect(converged?.coverage.catalog).toBe("complete");
    expect(converged?.holdings.map(({ id }) => id)).toEqual([registry.id, catalog.id]);
  });

  test("a fresh registry holding displaces a stored non-registry row with the same key", async () => {
    const fixtureSnapshot = buildBalancesSnapshotFixture({
      registry: {
        cbbtc: {
          balance: ready("100000"),
          value: fixturePriced("USD", "1000", 2),
        },
      },
    });
    const registryRows: ReadHolding[] = fixtureSnapshot.holdings.map((holding) => ({
      ...holding,
    }));
    const freshRegistry = registryRows.find((holding) => holding.id === "cbbtc");
    if (!freshRegistry?.contractAddress) throw new Error("Missing cbBTC registry fixture.");
    const storedWallet: ReadHolding = {
      ...freshRegistry,
      id: `wallet:${freshRegistry.contractAddress}`,
      source: "wallet",
    };
    const fixture = setup({
      registryRead: async () => read(
        "11",
        "2026-09-13T12:00:30.000Z",
        registryRows,
      ),
      enumerate: async () => ({
        status: "incomplete",
        rows: [],
        nextCursor: "page-three",
        pagesRead: 1,
        durationMs: 5,
      }),
      price: (balanceRead) => balanceRead.holdings.map((holding) => {
        if (holding.source === "registry") {
          const fixtureHolding = fixtureSnapshot.holdings.find(
            (candidate) => candidate.id === holding.id,
          );
          if (!fixtureHolding) throw new Error(`Missing registry fixture ${holding.id}.`);
          return { ...fixtureHolding, balance: holding.balance };
        }
        return {
          ...holding,
          value: holding.key === freshRegistry.key
            ? fixturePriced("USD", "1000", 2)
            : { status: "unpriced", reason: "price-unavailable" },
        };
      }),
    });
    await fixture.store.putObservation(observation({
      enumerationCursor: "page-two",
      holdings: [...registryRows, storedWallet],
      coverage: { registry: "complete", catalog: "incomplete" },
    }));

    await fixture.service(owner, "US");
    await fixture.flush();

    const stored = await fixture.store.get(8453, owner);
    expect(stored?.holdings.filter(({ key }) => key === freshRegistry.key)).toEqual([
      expect.objectContaining({ id: "cbbtc", source: "registry" }),
    ]);

    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.holdings.filter(({ key }) => key === freshRegistry.key)).toEqual([
      expect.objectContaining({ id: "cbbtc", source: "registry" }),
    ]);
    expect(snapshot.total).toEqual({
      status: "partial",
      value: { atoms: "10000000000000000000", scale: 18 },
      currency: "USD",
    });
    expect(parseBalancesSnapshot(snapshot, {
      subject: "fixture",
      smartAccountAddress: owner,
      chainId: 8453,
    }, "US")).toEqual(snapshot);
  });

  test("a genuinely complete re-observe replaces stored non-registry holdings", async () => {
    const fixture = setup({
      now: "2026-09-13T12:02:01.000Z",
      enumerate: async () => ({
        status: "complete",
        rows: [{
          contractAddress: "0x1111111111111111111111111111111111111111",
          amountBaseUnits: "2",
        }],
        nextCursor: null,
        pagesRead: 2,
        durationMs: 5,
      }),
    });
    await fixture.store.putObservation(observation({
      holdings: [registry, catalog, laterPageCatalog],
    }));
    await fixture.store.markStale(8453, owner, new Date("2026-09-13T12:00:20.000Z"));

    await fixture.service(owner, "US");
    await fixture.flush();

    const stored = await fixture.store.get(8453, owner);
    expect(stored?.holdings.map(({ id }) => id)).toEqual([registry.id, catalog.id]);
    expect(stored?.enumerationCursor).toBeNull();
    expect(stored?.coverage.catalog).toBe("complete");
  });

  test("an unavailable enumeration resume preserves the stored cursor", async () => {
    const fixture = setup({
      enumerate: async () => ({
        status: "unavailable",
        rows: [],
        nextCursor: null,
        pagesRead: 0,
        durationMs: 1,
      }),
    });
    await fixture.store.putObservation(observation({ enumerationCursor: "page-two" }));
    await fixture.store.markStale(8453, owner, new Date("2026-09-13T12:00:20.000Z"));

    const snapshot = await fixture.service(owner, "US");
    expect(snapshot.holdings.map(({ id }) => id)).toContain(catalog.id);
    await fixture.flush();
    expect((await fixture.store.get(8453, owner))?.enumerationCursor).toBe("page-two");
  });

  test("failed initial observation rejects so the route can return 502", async () => {
    const fixture = setup({
      registryRead: async () => { throw new Error("rpc unavailable"); },
    });
    await expect(fixture.service(owner, "US")).rejects.toThrow("rpc unavailable");
  });

  test("dropping a row makes the next read re-observe", async () => {
    const fixture = setup({});
    await fixture.store.putObservation(observation());
    await fixture.service(owner, "US");
    fixture.store.deleteForTests(8453, owner);
    await fixture.service(owner, "US");
    expect(fixture.reads()).toBe(1);
    expect(fixture.enumerations()).toBe(1);
  });

  test("shares one in-flight observation across regions", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fixture = setup({
      registryRead: async () => { await gate; return read("11", "2026-09-13T12:00:30.000Z", [registry]); },
    });
    const first = fixture.service(owner, "US");
    const second = fixture.service(owner, "DE");
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(fixture.reads()).toBe(1);
    expect(fixture.enumerations()).toBe(1);
  });
});

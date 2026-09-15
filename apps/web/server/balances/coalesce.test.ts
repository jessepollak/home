import { describe, expect, test } from "bun:test";
import type { Holding } from "@/shared/balances/types";
import { createBalancesService } from "./coalesce";
import { MemoryBalanceSnapshotStore } from "./memory-snapshot-store";
import type { BalanceObservation } from "./snapshot-store";
import type { BalancesEnumeration, BalancesRead, ReadHolding } from "./types";

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
}) {
  const store = options.store ?? new MemoryBalanceSnapshotStore();
  const configuredNow = options.now;
  const events: unknown[] = [];
  let reads = 0;
  let enumerations = 0;
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
        catalog: enumeration.status === "unavailable" ? "unavailable" : "complete",
      },
    }),
    priceBalances: async (value) => ({
      holdings: priced(value.holdings),
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
    }]);
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

import { describe, expect, test } from "bun:test";
import { createBalancesService } from "./coalesce";
import type { BalancesRead } from "./types";

const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const otherOwner = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const thirdOwner = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
const read: BalancesRead = {
  block: {
    number: "1",
    hash: `0x${"1".repeat(64)}`,
    timestamp: "1",
  },
  holdings: [],
  coverage: {
    registry: "complete",
    catalog: "unavailable",
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function serviceWithRead(
  readBalances: () => Promise<BalancesRead>,
  options: {
    now?: () => Date;
    ttlMs?: number;
    maxOwners?: number;
  } = {},
) {
  return createBalancesService({
    readUniverse: async () => ({ entries: [] }),
    enumerateBalances: async () => ({ status: "unavailable", rows: [] }),
    readBalances,
    resolveBalances: async (registryRead) => registryRead,
    priceBalances: async () => [],
    ...options,
  });
}

describe("balances composition and read coalescing", () => {
  test("starts enumeration and registry read concurrently", async () => {
    const readGate = deferred<BalancesRead>();
    const enumerationGate = deferred<{
      status: "unavailable";
      rows: [];
    }>();
    let readStarted = false;
    let enumerationStarted = false;
    const service = createBalancesService({
      readUniverse: async () => ({ entries: [] }),
      readBalances: async () => {
        readStarted = true;
        return readGate.promise;
      },
      enumerateBalances: async () => {
        enumerationStarted = true;
        return enumerationGate.promise;
      },
      resolveBalances: async (registryRead) => registryRead,
      priceBalances: async () => [],
    });

    const pending = service(owner, "US");
    await Promise.resolve();
    expect(readStarted).toBeTrue();
    expect(enumerationStarted).toBeTrue();
    readGate.resolve(read);
    enumerationGate.resolve({ status: "unavailable", rows: [] });
    await pending;
  });

  test("shares one in-flight registry read and reuses it across regions", async () => {
    let count = 0;
    const gate = deferred<void>();
    const service = serviceWithRead(async () => {
      count += 1;
      await gate.promise;
      return read;
    }, {
      now: () => new Date("2026-09-13T12:00:00.000Z"),
    });

    const first = service(owner, "US");
    const second = service(owner, "US");
    gate.resolve();

    await Promise.all([first, second]);
    await service(owner, "DE");
    expect(count).toBe(1);
  });

  test("keeps registry and enumeration work alive when the first caller aborts", async () => {
    const readGate = deferred<BalancesRead>();
    const enumerationGate = deferred<{
      status: "unavailable";
      rows: [];
    }>();
    let readSignal: AbortSignal | undefined;
    let enumerationSignal: AbortSignal | undefined;
    const service = createBalancesService({
      readUniverse: async () => ({ entries: [] }),
      readBalances: async (_universe, _owner, signal) => {
        readSignal = signal;
        return readGate.promise;
      },
      enumerateBalances: async (_owner, signal) => {
        enumerationSignal = signal;
        return enumerationGate.promise;
      },
      resolveBalances: async (registryRead) => registryRead,
      priceBalances: async () => [],
    });
    const controller = new AbortController();

    const first = service(owner, "US", controller.signal);
    const second = service(owner, "DE");
    controller.abort();
    readGate.resolve(read);
    enumerationGate.resolve({ status: "unavailable", rows: [] });

    await expect(first).resolves.toMatchObject({ region: "US" });
    await expect(second).resolves.toMatchObject({ region: "DE" });
    expect(readSignal).toBeUndefined();
    expect(enumerationSignal).toBeUndefined();
  });

  test("CDP unavailable still yields the registry snapshot", async () => {
    const service = createBalancesService({
      readUniverse: async () => ({ entries: [] }),
      readBalances: async () => read,
      enumerateBalances: async () => ({ status: "unavailable", rows: [] }),
      resolveBalances: async (registryRead, enumeration) => ({
        ...registryRead,
        coverage: {
          ...registryRead.coverage,
          catalog: enumeration.status === "unavailable"
            ? "unavailable"
            : "complete",
        },
      }),
      priceBalances: async () => [],
    });

    await expect(service(owner, "US")).resolves.toMatchObject({
      holdings: [],
      coverage: { registry: "complete", catalog: "unavailable" },
    });
  });

  test("starts a new registry read after the 2s TTL expires", async () => {
    let count = 0;
    let current = Date.parse("2026-09-13T12:00:00.000Z");
    const service = serviceWithRead(async () => {
      count += 1;
      return read;
    }, {
      now: () => new Date(current),
      ttlMs: 2_000,
    });

    await service(owner, "US");
    current += 2_001;
    await service(owner, "US");
    expect(count).toBe(2);
  });

  test("evicts the least recently used owner at maxOwners", async () => {
    const counts = new Map<string, number>();
    const service = createBalancesService({
      readUniverse: async () => ({ entries: [] }),
      enumerateBalances: async () => ({ status: "unavailable", rows: [] }),
      readBalances: async (_universe, address) => {
        counts.set(address, (counts.get(address) ?? 0) + 1);
        return read;
      },
      resolveBalances: async (registryRead) => registryRead,
      priceBalances: async () => [],
      maxOwners: 2,
    });

    await service(owner, "US");
    await service(otherOwner, "US");
    await service(owner, "DE");
    await service(thirdOwner, "US");
    await service(otherOwner, "US");

    expect(counts.get(owner)).toBe(1);
    expect(counts.get(otherOwner)).toBe(2);
    expect(counts.get(thirdOwner)).toBe(1);
  });
});

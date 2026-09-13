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
  return {
    promise,
    resolve,
  };
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
    readUniverse: async () => ({
      entries: [],
      catalogStatus: "unavailable",
    }),
    readBalances,
    priceBalances: async () => [],
    ...options,
  });
}

describe("balances read coalescing", () => {
  test("shares one in-flight owner read and reuses it across regions", async () => {
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

  test("keeps the shared read alive when the first caller aborts", async () => {
    const gate = deferred<BalancesRead>();
    let receivedSignal: AbortSignal | undefined;
    const service = createBalancesService({
      readUniverse: async (signal) => {
        receivedSignal = signal;
        return {
          entries: [],
          catalogStatus: "unavailable",
        };
      },
      readBalances: async (_universe, _owner, signal) => {
        receivedSignal = signal;
        return gate.promise;
      },
      priceBalances: async () => [],
    });
    const controller = new AbortController();

    const first = service(owner, "US", controller.signal);
    const second = service(owner, "DE");
    controller.abort();
    gate.resolve(read);

    await expect(first).resolves.toMatchObject({ region: "US" });
    await expect(second).resolves.toMatchObject({ region: "DE" });
    expect(receivedSignal).toBeUndefined();
  });

  test("clears a failed entry so the next call starts a new read", async () => {
    let count = 0;
    const service = serviceWithRead(async () => {
      count += 1;
      if (count === 1) {
        throw new Error("down");
      }
      return read;
    });

    await expect(service(owner, "US")).rejects.toThrow("down");
    await expect(service(owner, "US")).resolves.toMatchObject({ region: "US" });
    expect(count).toBe(2);
  });

  test("starts a new read after the TTL expires", async () => {
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
      readUniverse: async () => ({
        entries: [],
        catalogStatus: "unavailable",
      }),
      readBalances: async (_universe, address) => {
        counts.set(address, (counts.get(address) ?? 0) + 1);
        return read;
      },
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

import { describe, expect, test } from "bun:test";
import { CdpTokenBalancesError } from "./enumerate-cdp";
import { createBalancesEnumerator } from "./enumerate";

const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const row = {
  contractAddress: "0x1111111111111111111111111111111111111111" as const,
  amountBaseUnits: "7",
  name: "Token",
  symbol: "TKN",
  decimals: 18,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("balances enumeration cache", () => {
  test("dedupes in-flight enumeration and keeps it alive after the first caller aborts", async () => {
    const gate = deferred<{ balances: [typeof row]; complete: true }>();
    let calls = 0;
    let receivedSignal: AbortSignal | undefined;
    const enumerate = createBalancesEnumerator({
      listBalances: async ({ signal }) => {
        calls += 1;
        receivedSignal = signal;
        return gate.promise;
      },
    });
    const controller = new AbortController();

    const first = enumerate(owner, controller.signal);
    const waiter = enumerate(owner);
    controller.abort();
    expect(receivedSignal?.aborted).toBeFalse();
    gate.resolve({ balances: [row], complete: true });

    await expect(first).resolves.toMatchObject({ status: "complete" });
    await expect(waiter).resolves.toMatchObject({ status: "complete" });
    expect(calls).toBe(1);
  });

  test("uses a 60s owner TTL independently of registry read refreshes", async () => {
    let current = 0;
    let calls = 0;
    const enumerate = createBalancesEnumerator({
      now: () => current,
      listBalances: async () => {
        calls += 1;
        return { balances: [row], complete: true };
      },
    });

    await enumerate(owner);
    current += 2_001;
    await enumerate(owner);
    expect(calls).toBe(1);
    current += 58_000;
    await enumerate(owner);
    expect(calls).toBe(2);
  });

  test("does not cache unavailable CDP enumeration", async () => {
    const events: unknown[] = [];
    let calls = 0;
    const enumerate = createBalancesEnumerator({
      listBalances: async () => {
        calls += 1;
        throw new CdpTokenBalancesError(
          "not-configured",
          "missing credentials",
        );
      },
      log: (event) => events.push(event),
    });

    await expect(enumerate(owner)).resolves.toEqual({
      status: "unavailable",
      rows: [],
    });
    await expect(enumerate(owner)).resolves.toEqual({
      status: "unavailable",
      rows: [],
    });
    expect(calls).toBe(2);
    expect(events).toEqual(Array(2).fill({
      kind: "portfolio-balance-source",
      route: "/api/balances",
      source: "cdp-token-balances",
      stage: "inventory",
      outcome: "unavailable",
      reason: "not-configured",
    }));
  });

  test("caches incomplete enumeration for the same 60s TTL", async () => {
    const events: unknown[] = [];
    let calls = 0;
    let current = 0;
    const enumerate = createBalancesEnumerator({
      now: () => current,
      listBalances: async () => {
        calls += 1;
        return { balances: [row], complete: false };
      },
      log: (event) => events.push(event),
    });

    await expect(enumerate(owner)).resolves.toMatchObject({ status: "incomplete" });
    current += 60_000;
    await expect(enumerate(owner)).resolves.toMatchObject({ status: "incomplete" });
    expect(calls).toBe(1);
    expect(events).toMatchObject([{
      source: "cdp-token-balances",
      outcome: "incomplete",
      reason: "partial",
    }]);
  });

  test("evicts the least recently used owner after 256 cached owners", async () => {
    const calls = new Map<string, number>();
    const enumerate = createBalancesEnumerator({
      listBalances: async ({ address }) => {
        calls.set(address, (calls.get(address) ?? 0) + 1);
        return { balances: [], complete: true };
      },
    });
    const owners = Array.from({ length: 257 }, (_, index) =>
      `0x${(index + 1).toString(16).padStart(40, "0")}` as const);

    for (const address of owners.slice(0, 256)) await enumerate(address);
    await enumerate(owners[0]);
    await enumerate(owners[256]);
    await enumerate(owners[1]);

    expect(calls.get(owners[0])).toBe(1);
    expect(calls.get(owners[1])).toBe(2);
    expect(calls.get(owners[256])).toBe(1);
  });
});

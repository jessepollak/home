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
  native: false as const,
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

  test("maps unavailable CDP to one source event", async () => {
    const events: unknown[] = [];
    const enumerate = createBalancesEnumerator({
      listBalances: async () => {
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
    expect(events).toEqual([{
      kind: "portfolio-balance-source",
      route: "/api/balances",
      source: "cdp-token-balances",
      stage: "inventory",
      outcome: "unavailable",
      reason: "not-configured",
    }]);
  });

  test("deadline returns collected rows as incomplete and emits partial", async () => {
    const events: unknown[] = [];
    const enumerate = createBalancesEnumerator({
      deadlineMs: 0,
      listBalances: ({ signal }) => new Promise((resolve) => {
        signal?.addEventListener("abort", () => resolve({
          balances: [row],
          complete: false,
        }), { once: true });
      }),
      log: (event) => events.push(event),
    });

    await expect(enumerate(owner)).resolves.toEqual({
      status: "incomplete",
      rows: [{
        contractAddress: row.contractAddress,
        amountBaseUnits: "7",
        name: "Token",
        symbol: "TKN",
        decimals: 18,
      }],
    });
    expect(events).toMatchObject([{
      source: "cdp-token-balances",
      outcome: "incomplete",
      reason: "partial",
    }]);
  });
});

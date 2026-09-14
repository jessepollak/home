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
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("balances enumeration in-flight dedupe", () => {
  test("dedupes in-flight enumeration and keeps it alive after caller abort", async () => {
    const gate = deferred<{
      balances: [typeof row];
      complete: true;
      nextPageToken: null;
      pagesRead: number;
      durationMs: number;
    }>();
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
    gate.resolve({ balances: [row], complete: true, nextPageToken: null, pagesRead: 1, durationMs: 1 });
    await expect(first).resolves.toMatchObject({ status: "complete" });
    await expect(waiter).resolves.toMatchObject({ status: "complete" });
    expect(calls).toBe(1);
  });

  test("does not retain a TTL value after an enumeration finishes", async () => {
    let calls = 0;
    const enumerate = createBalancesEnumerator({
      listBalances: async () => {
        calls += 1;
        return { balances: [row], complete: true, nextPageToken: null, pagesRead: 1, durationMs: 1 };
      },
    });
    await enumerate(owner);
    await enumerate(owner);
    expect(calls).toBe(2);
  });

  test("maps unavailable and incomplete results without caching either", async () => {
    const events: unknown[] = [];
    let unavailable = true;
    let calls = 0;
    const enumerate = createBalancesEnumerator({
      listBalances: async () => {
        calls += 1;
        if (unavailable) {
          unavailable = false;
          throw new CdpTokenBalancesError("not-configured", "missing credentials");
        }
        return { balances: [row], complete: false, nextPageToken: "page-two", pagesRead: 1, durationMs: 1 };
      },
      log: (event) => events.push(event),
    });
    await expect(enumerate(owner)).resolves.toMatchObject({ status: "unavailable", rows: [], pagesRead: 0 });
    await expect(enumerate(owner)).resolves.toMatchObject({ status: "incomplete" });
    expect(calls).toBe(2);
    expect(events).toMatchObject([
      {
        outcome: "unavailable",
        reason: "not-configured",
        pageCount: 0,
      },
      {
        outcome: "incomplete",
        reason: "partial",
        pageCount: 1,
        durationMs: 1,
      },
    ]);
  });
});

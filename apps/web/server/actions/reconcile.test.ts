import { describe, expect, test } from "bun:test";
import type { ActionRow } from "./store";
import { createActionHandleResolver, type HandleResolution } from "./reconcile";

const ID = "11111111-1111-4111-8111-111111111111";
const HANDLE = "bundle:base-account:fixture";
const HASH = `0x${"AB".repeat(32)}` as `0x${string}`;

function action(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: ID,
    owner_key: "fixture",
    provider: "base-account",
    kind: "send",
    summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2026-09-13T12:30:00.000Z" },
    pending: null,
    created_at: "2026-09-13T12:00:00.000Z",
    confirmed_at: "2026-09-13T12:01:00.000Z",
    provider_handle: HANDLE,
    transaction_hash: null,
    handle_recorded_at: null,
    ...overrides,
  };
}

function rpcResult(handle: string, overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      id: handle,
      version: "2.0.0",
      chainId: "0x2105",
      atomic: true,
      status: 100,
      ...overrides,
    },
  });
}

function fixtureFetch(response: (handle: string) => Response | Promise<Response>) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    const body = JSON.parse(String(init?.body)) as { params: [string] };
    return await response(body.params[0]);
  };
  return { calls, fetchImpl };
}

describe("Base Account handle reconciliation", () => {
  const resultCases: Array<{
    name: string;
    overrides: Record<string, unknown>;
    expected: HandleResolution;
  }> = [
    { name: "pending", overrides: { status: 100 }, expected: { status: "pending" } },
    {
      name: "complete and lowercases the receipt hash",
      overrides: { status: 200, receipts: [{ transactionHash: HASH }] },
      expected: { status: "complete", transactionHash: HASH.toLowerCase() as `0x${string}` },
    },
    ...[400, 500, 600].map((status): {
      name: string;
      overrides: Record<string, unknown>;
      expected: HandleResolution;
    } => ({
      name: `failed ${status} without a hash`,
      overrides: { status, receipts: [{ transactionHash: HASH }] },
      expected: { status: "failed" },
    })),
    { name: "mismatched result id", overrides: { id: "other" }, expected: { status: "unavailable" } },
    { name: "wrong chain", overrides: { chainId: 1 }, expected: { status: "unavailable" } },
    { name: "non-atomic result", overrides: { atomic: false }, expected: { status: "unavailable" } },
    { name: "missing receipts", overrides: { status: 200 }, expected: { status: "unavailable" } },
    {
      name: "different receipt hashes",
      overrides: {
        status: 200,
        receipts: [
          { transactionHash: HASH },
          { transactionHash: `0x${"cd".repeat(32)}` },
        ],
      },
      expected: { status: "unavailable" },
    },
  ];

  for (const fixture of resultCases) {
    test(fixture.name, async () => {
      const { calls, fetchImpl } = fixtureFetch((handle) => rpcResult(handle, fixture.overrides));
      const resolver = createActionHandleResolver({ fetchImpl });

      expect(await resolver(action())).toEqual(fixture.expected);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.input).toBe("https://rpc.wallet.coinbase.com");
      expect(calls[0]?.init).toMatchObject({
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "X-Cbw-Sdk-Version": "2.5.10",
          "X-Cbw-Sdk-Platform": "@base-org/account",
        },
      });
    });
  }

  test("backs off unknown JSON-RPC handles for five minutes", async () => {
    let currentTime = 1_000;
    const { calls, fetchImpl } = fixtureFetch(() => Response.json({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32602, message: "unknown id" },
    }));
    const resolver = createActionHandleResolver({ fetchImpl, now: () => currentTime });

    expect(await resolver(action())).toEqual({ status: "unavailable" });
    currentTime += 299_999;
    expect(await resolver(action())).toEqual({ status: "unavailable" });
    expect(calls).toHaveLength(1);
  });

  test("opens the circuit after HTTP 500 and retries after 60 seconds", async () => {
    let currentTime = 1_000;
    let responseCount = 0;
    const { calls, fetchImpl } = fixtureFetch((handle) => {
      responseCount += 1;
      return responseCount === 1
        ? new Response("upstream", { status: 500 })
        : rpcResult(handle, { status: 100 });
    });
    const resolver = createActionHandleResolver({ fetchImpl, now: () => currentTime });

    expect(await resolver(action())).toEqual({ status: "unavailable" });
    expect(await resolver(action({ provider_handle: "different-handle" }))).toEqual({ status: "unavailable" });
    expect(calls).toHaveLength(1);
    currentTime += 60_000;
    expect(await resolver(action({ provider_handle: "different-handle" }))).toEqual({ status: "pending" });
    expect(calls).toHaveLength(2);
  });

  test("opens the circuit when its own timeout aborts a hanging request", async () => {
    const currentTime = 1_000;
    let fetchCalls = 0;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      fetchCalls += 1;
      const signal = init?.signal;
      if (!signal) throw new Error("missing signal");
      return await new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => {
          expect(signal.reason).toBeInstanceOf(DOMException);
          expect((signal.reason as DOMException).name).toBe("TimeoutError");
          reject(signal.reason);
        };
        signal.addEventListener("abort", rejectOnAbort, { once: true });
        if (signal.aborted) rejectOnAbort();
      });
    };
    const resolver = createActionHandleResolver({
      fetchImpl,
      now: () => currentTime,
      timeoutMs: 5,
    });

    expect(await resolver(action())).toEqual({ status: "unavailable" });
    expect(await resolver(action({ provider_handle: "different-handle" }))).toEqual({ status: "unavailable" });
    expect(fetchCalls).toBe(1);
  });

  test("backs off terminal failed handles for five minutes", async () => {
    let currentTime = 1_000;
    const { calls, fetchImpl } = fixtureFetch((handle) => rpcResult(handle, { status: 500 }));
    const resolver = createActionHandleResolver({ fetchImpl, now: () => currentTime });

    expect(await resolver(action())).toEqual({ status: "failed" });
    currentTime += 299_999;
    expect(await resolver(action())).toEqual({ status: "unavailable" });
    expect(await resolver(action({ provider_handle: "different-handle" }))).toEqual({ status: "failed" });
    expect(calls).toHaveLength(2);
  });

  test("a caller abort returns unavailable without opening the circuit", async () => {
    const controller = new AbortController();
    controller.abort();
    let aborted = true;
    const { calls, fetchImpl } = fixtureFetch((handle) => {
      if (aborted) throw new DOMException("aborted", "AbortError");
      return rpcResult(handle, { status: 100 });
    });
    const resolver = createActionHandleResolver({ fetchImpl });

    expect(await resolver(action(), controller.signal)).toEqual({ status: "unavailable" });
    aborted = false;
    expect(await resolver(action())).toEqual({ status: "pending" });
    expect(calls).toHaveLength(2);
  });

  test("skips a legacy UUID handle without fetching", async () => {
    const { calls, fetchImpl } = fixtureFetch((handle) => rpcResult(handle));
    const resolver = createActionHandleResolver({ fetchImpl });

    expect(await resolver(action({ provider_handle: ID }))).toEqual({ status: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  test("skips CDP embedded rows without fetching", async () => {
    const { calls, fetchImpl } = fixtureFetch((handle) => rpcResult(handle));
    const resolver = createActionHandleResolver({ fetchImpl });

    expect(await resolver(action({ provider: "cdp-embedded" }))).toEqual({ status: "unavailable" });
    expect(calls).toHaveLength(0);
  });
});

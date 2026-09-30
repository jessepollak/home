import { describe, expect, test } from "bun:test";
import { PORTFOLIO_USDC_ASSET_KEY } from "@/config/portfolio-assets";
import { BALANCES_PRICE_MAX_AGE_MS } from "@/shared/balances/types";
import {
  CODEX_SHARED_READER_MAX,
  CodexRawQuoteError,
  codexSharedReaderCountForTests,
  createCodexRawQuotesReader,
  getCodexRawQuotes,
  resetCodexSharedReadersForTests,
} from "./raw-quotes";

const ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const NOW = "2026-09-08T12:00:00.000Z";
const NOW_SECONDS = String(Date.parse(NOW) / 1_000);
const input = {
  assetKey: PORTFOLIO_USDC_ASSET_KEY,
  address: ADDRESS,
  networkId: 8453 as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function freshResponse() {
  return new Response(`{"data":{"getTokenPrices":[{"address":"${ADDRESS}","networkId":8453,"priceUsd":1,"timestamp":${NOW_SECONDS}}]}}`);
}

describe("Codex raw quotes", () => {
  test("an already-aborted waiter never starts a fetch", async () => {
    let calls = 0;
    const reader = createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      fetchImpl: async () => { calls += 1; return freshResponse(); },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(reader(controller.signal)).rejects.toBe(controller.signal.reason);
    expect(calls).toBe(0);
  });

  test("a single waiter aborts the fetch and a new call refetches without old cleanup clearing it", async () => {
    const responses = [deferred<Response>(), deferred<Response>()];
    const starts = [deferred<void>(), deferred<void>()];
    const signals: AbortSignal[] = [];
    const reader = createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      fetchImpl: async (_url, init) => {
        signals.push(init!.signal!);
        starts[signals.length - 1]!.resolve();
        return await responses[signals.length - 1]!.promise;
      },
    });
    const controller = new AbortController();
    const aborted = reader(controller.signal);
    await starts[0]!.promise;
    controller.abort();
    expect(signals[0]?.aborted).toBe(true);
    const refetched = reader();
    await starts[1]!.promise;
    await expect(aborted).rejects.toBe(controller.signal.reason);
    responses[0]!.resolve(freshResponse());
    await Promise.resolve();
    const coalesced = reader();
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);
    responses[1]!.resolve(freshResponse());
    expect((await refetched)[0]?.status).toBe("fresh");
    expect((await coalesced)[0]?.status).toBe("fresh");
    expect((await reader())[0]?.status).toBe("fresh");
    expect(signals).toHaveLength(2);
  });

  test.each(["abortable", "non-abortable"])("one coalesced waiter abort leaves the %s waiter and fetch alive", async (kind) => {
    const response = deferred<Response>();
    let calls = 0;
    let fetchSignal: AbortSignal | null | undefined;
    const reader = createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      fetchImpl: async (_url, init) => {
        calls += 1;
        fetchSignal = init?.signal;
        return await response.promise;
      },
    });
    const controller = new AbortController();
    const aborted = reader(controller.signal);
    const survivor = reader(kind === "abortable" ? new AbortController().signal : undefined);
    controller.abort();
    await expect(aborted).rejects.toBe(controller.signal.reason);
    expect(calls).toBe(1);
    expect(fetchSignal?.aborted).toBe(false);
    response.resolve(freshResponse());
    expect((await survivor)[0]?.status).toBe("fresh");
    expect((await reader())[0]?.status).toBe("fresh");
    expect(calls).toBe(1);
  });

  test("bounds shared readers with least-recently-used eviction", async () => {
    const previousKey = process.env.CODEX_API_KEY;
    delete process.env.CODEX_API_KEY;
    resetCodexSharedReadersForTests();
    try {
      for (let index = 1; index <= CODEX_SHARED_READER_MAX + 1; index += 1) {
        const address = `0x${index.toString(16).padStart(40, "0")}` as const;
        await getCodexRawQuotes([{
          assetKey: `eip155:8453/erc20:${address}`,
          address,
          networkId: 8453,
        }]);
      }
      expect(codexSharedReaderCountForTests()).toBe(CODEX_SHARED_READER_MAX); // oxlint-disable-line home/no-self-referential-expectation -- the constant is the specified bound; the assertion tests bounding, not the value
    } finally {
      if (previousKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = previousKey;
      resetCodexSharedReadersForTests();
    }
  });

  test("shared reader hits refresh recency and an API key change clears readers", async () => {
    const previousKey = process.env.CODEX_API_KEY;
    const previousFetch = globalThis.fetch;
    process.env.CODEX_API_KEY = "fixture-key";
    let calls = 0;
    globalThis.fetch = Object.assign(async () => {
      calls++;
      return Response.json({ data: { getTokenPrices: [] } });
    }, { preconnect: previousFetch.preconnect });
    resetCodexSharedReadersForTests();
    const read = (index: number) => {
      const address = `0x${index.toString(16).padStart(40, "0")}` as const;
      return getCodexRawQuotes([{ assetKey: `eip155:8453/erc20:${address}`, address, networkId: 8453 }]);
    };
    try {
      for (let index = 1; index <= CODEX_SHARED_READER_MAX; index++) await read(index);
      await read(1);
      expect(calls).toBe(256);
      await read(CODEX_SHARED_READER_MAX + 1);
      await read(1);
      expect(calls).toBe(257);
      await read(2);
      expect(calls).toBe(258);
      process.env.CODEX_API_KEY = "another-fixture-key";
      await read(1);
      expect(calls).toBe(259);
      expect(codexSharedReaderCountForTests()).toBe(1);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = previousKey;
      resetCodexSharedReadersForTests();
    }
  });

  test("retains the exact raw decimal and exact contract/time provenance", async () => {
    const reader = createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      fetchImpl: (async () =>
        new Response(
          `{"data":{"getTokenPrices":[{"address":"${ADDRESS}","networkId":8453,"priceUsd":1.0000000000000000001,"timestamp":${NOW_SECONDS}}]}}`,
        )),
    });

    expect(await reader()).toEqual([
      expect.objectContaining({
        assetKey: PORTFOLIO_USDC_ASSET_KEY,
        sourceValue: "1.0000000000000000001",
        unitPrice: { atoms: "10000000000000000001", scale: 19 },
        status: "fresh",
        source: expect.objectContaining({
          asOf: NOW,
          timeBasis: "provider-as-of",
        }),
      }),
    ]);
  });

  test.each([
    ["Invest default", undefined, 3 * 60 * 60 * 1_000, "stale"],
    ["balances 3 hours", BALANCES_PRICE_MAX_AGE_MS, 3 * 60 * 60 * 1_000, "fresh"],
    ["balances 30 hours", BALANCES_PRICE_MAX_AGE_MS, 30 * 60 * 60 * 1_000, "stale"],
  ] as const)("applies the %s freshness window", async (_name, freshnessMs, ageMs, status) => {
    const timestamp = String((Date.parse(NOW) - ageMs) / 1_000);
    const row = `{"address":"${ADDRESS}","networkId":8453,"priceUsd":1,"timestamp":${timestamp}}`;
    const result = await createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      ...(freshnessMs === undefined ? {} : { freshnessMs }),
      fetchImpl: (async () =>
        new Response(`{"data":{"getTokenPrices":[${row}]}}`)),
    })();

    expect(result[0]?.status).toBe(status);
    expect(result[0]?.unitPrice).toEqual(
      status === "fresh" ? { atoms: "1", scale: 0 } : null,
    );
  });

  test("marks duplicate exact-contract records unavailable rather than choosing one", async () => {
    const stale = String(Number(NOW_SECONDS) - 301);
    const row = `{"address":"${ADDRESS}","networkId":8453,"priceUsd":1,"timestamp":${stale}}`;
    const duplicate = await createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      fetchImpl: (async () =>
        new Response(`{"data":{"getTokenPrices":[${row},${row}]}}`)),
    })();
    expect(duplicate[0]?.status).toBe("invalid");
    expect(duplicate[0]?.unitPrice).toBeNull();
  });

  test("times out an unresponsive quote request with the quote error class", async () => {
    let aborted = false;
    const reader = createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      timeoutMs: 10,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    });
    const error = await reader().then(() => null, (reason: unknown) => reason);
    expect(aborted).toBe(true);
    expect(error).toBeInstanceOf(CodexRawQuoteError);
    expect((error as Error).message).toBe("Codex quotes timed out.");
  });

  test.each([
    ["HTTP error", () => new Response("unavailable", { status: 503 }), "Codex quotes returned HTTP 503."],
    ["GraphQL error", () => Response.json({ errors: [{ message: "unavailable" }], data: null }), "Codex quotes returned an error."],
    ["missing data", () => Response.json({ data: null }), "Codex quotes returned an invalid price list."],
    ["invalid price list", () => Response.json({ data: { getTokenPrices: {} } }), "Codex quotes returned an invalid price list."],
    ["oversized declared length", () => new Response("{}", { headers: { "content-length": "4000001" } }), "Codex quotes request failed."],
    ["oversized body", () => Response.json({ data: { getTokenPrices: [] }, pad: "x".repeat(4_000_000) }), "Codex quotes request failed."],
  ] as const)("preserves %s wording and class", async (_case, response, message) => {
    const reader = createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      fetchImpl: async () => response(),
    });
    const error = await reader().then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(CodexRawQuoteError);
    expect((error as Error).message).toBe(message);
  });
});

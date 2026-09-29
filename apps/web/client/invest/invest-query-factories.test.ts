import { afterEach, expect, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";
import { createHomeQueryClient, dehydrateOwnerQueries } from "@/client/query/query-client";
import { investDiscoverOptions } from "./use-invest-discover";
import { investSearchOptions } from "./use-invest-search";
import { marketPricesOptions } from "./use-market-prices";
import { marketStatsOptions } from "./use-market-stats";
import { priceHistoryOptions } from "./use-price-history";
import { resolvedAssetOptions } from "./use-resolved-asset";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Scenario = {
  name: string;
  key: readonly unknown[];
  expectedKey: readonly unknown[];
  meta: unknown;
  valid: Record<string, unknown>;
  mismatch?: Record<string, unknown>;
  read: (client: QueryClient, fetchImpl: FetchLike) => Promise<unknown>;
};

const stats = { version: 1, provider: "codex", assetId: "cbbtc", currency: "USD", fetchedAt: null, status: "ready", stats: {} };
const history = { version: 1, provider: "codex", assetId: "cbbtc", range: "1W", currency: "USD", fetchedAt: null, status: "empty", points: [] };
const asset = { version: 1, assetId: "cbbtc", asset: null, source: null, snapshot: null, provider: "ok" };
const discover = { version: 1, provider: "codex", fetchedAt: null, icons: {}, memes: { status: "empty", assets: [], snapshots: [], nextOffset: null, exhausted: true } };
const search = { version: 1, query: "BTC", offset: 0, results: [], snapshots: [], provider: "ok", coverage: "complete", nextOffset: null };

const scenarios: Scenario[] = [
  {
    name: "market prices", key: marketPricesOptions({ endpoint: "/api/test/prices" }).queryKey,
    expectedKey: ["unauthenticated", "market-prices", "/api/test/prices"],
    meta: marketPricesOptions({ endpoint: "/api/test/prices" }).meta,
    valid: { version: 1, provider: "codex", fetchedAt: null, markets: { stock: { status: "unavailable" } } },
    read: (client, fetchImpl) => client.fetchQuery(marketPricesOptions({ endpoint: "/api/test/prices", fetchImpl })),
  },
  {
    name: "market stats", key: marketStatsOptions("cbbtc", true).queryKey,
    expectedKey: ["unauthenticated", "market-stats", "cbbtc"],
    meta: marketStatsOptions("cbbtc", true).meta,
    valid: stats, mismatch: { ...stats, assetId: "cbltc" },
    read: (client) => client.fetchQuery(marketStatsOptions("cbbtc", true)),
  },
  {
    name: "price history", key: priceHistoryOptions("cbbtc", "1W").queryKey,
    expectedKey: ["unauthenticated", "price-history", "cbbtc", "1W"],
    meta: priceHistoryOptions("cbbtc", "1W").meta,
    valid: history, mismatch: { ...history, range: "1D" },
    read: (client) => client.fetchQuery(priceHistoryOptions("cbbtc", "1W")),
  },
  {
    name: "resolved asset", key: resolvedAssetOptions("cbbtc").queryKey,
    expectedKey: ["unauthenticated", "invest-asset", "cbbtc"],
    meta: resolvedAssetOptions("cbbtc").meta,
    valid: asset, mismatch: { ...asset, assetId: "cbltc" },
    read: (client) => client.fetchQuery(resolvedAssetOptions("cbbtc")),
  },
  {
    name: "invest discover", key: investDiscoverOptions({ endpoint: "/api/test/discover" }).queryKey,
    expectedKey: ["unauthenticated", "invest-discover", "/api/test/discover"],
    meta: investDiscoverOptions({ endpoint: "/api/test/discover" }).meta,
    valid: discover,
    read: (client, fetchImpl) => client.fetchInfiniteQuery(investDiscoverOptions({ endpoint: "/api/test/discover", fetchImpl })),
  },
  {
    name: "invest search", key: investSearchOptions({ endpoint: "/api/test/search", active: "BTC", enabled: true }).queryKey,
    expectedKey: ["unauthenticated", "invest-search", "/api/test/search", "BTC"],
    meta: investSearchOptions({ endpoint: "/api/test/search", active: "BTC", enabled: true }).meta,
    valid: search, mismatch: { ...search, query: "ETH" },
    read: (client, fetchImpl) => client.fetchInfiniteQuery(investSearchOptions({ endpoint: "/api/test/search", active: "BTC", enabled: true, fetchImpl })),
  },
];

const originalFetch = globalThis.fetch;
let client: QueryClient | null = null;
afterEach(() => {
  client?.clear();
  client = null;
  globalThis.fetch = originalFetch;
});

function createClient(): QueryClient {
  client = createHomeQueryClient();
  return client;
}

function transport(fetchImpl: FetchLike): FetchLike {
  globalThis.fetch = fetchImpl as typeof fetch;
  return fetchImpl;
}

for (const scenario of scenarios) {
  test(`${scenario.name}: public key, owner fencing, and parsed cache entry`, async () => {
    const queryClient = createClient();
    expect(scenario.key).toEqual(scenario.expectedKey);
    expect(scenario.meta).toBeUndefined();
    expect(scenario.key).not.toContain("owner-a");
    expect(scenario.key).not.toContain("owner-b");
    const fetchImpl = transport(async () => Response.json(scenario.valid));
    const result = await scenario.read(queryClient, fetchImpl);
    expect(result).toBeDefined();
    const cached = queryClient.getQueryData(scenario.key);
    expect(cached).toBeDefined();
    expect(cached).toEqual(result);
    expect(queryClient.getQueryCache().find({ queryKey: scenario.key })?.meta).toBeUndefined();
    expect(dehydrateOwnerQueries(queryClient, "owner-a").queries).toEqual([]);
    expect(dehydrateOwnerQueries(queryClient, "owner-b").queries).toEqual([]);
  });

  for (const [label, payload] of [["malformed", {}], ...(scenario.mismatch ? [["mismatched", scenario.mismatch]] : [])] as const) {
    test(`${scenario.name}: ${label} response rejects without caching unknown`, async () => {
      const queryClient = createClient();
      const fetchImpl = transport(async () => Response.json(payload));
      await expect(scenario.read(queryClient, fetchImpl)).rejects.toThrow();
      expect(queryClient.getQueryData(scenario.key)).toBeUndefined();
    });
  }

  test(`${scenario.name}: pending read is uncached and a failed read is not success`, async () => {
    const queryClient = createClient();
    let rejectRequest: ((error: Error) => void) | undefined;
    const fetchImpl = transport(() => new Promise<Response>((_resolve, reject) => { rejectRequest = reject; }));
    const pending = scenario.read(queryClient, fetchImpl);
    expect(queryClient.getQueryData(scenario.key)).toBeUndefined();
    expect(rejectRequest).toBeDefined();
    rejectRequest?.(new Error("network unavailable"));
    await expect(pending).rejects.toThrow();
    expect(queryClient.getQueryData(scenario.key)).toBeUndefined();
    expect(queryClient.getQueryState(scenario.key)?.status).toBe("error");
  });

  test(`${scenario.name}: abort reaches transport and does not cache`, async () => {
    const queryClient = createClient();
    let receivedSignal: AbortSignal | undefined;
    const fetchImpl = transport((_input, init) => new Promise<Response>((_resolve, reject) => {
      receivedSignal = init?.signal ?? undefined;
      receivedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const pending = scenario.read(queryClient, fetchImpl);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    await queryClient.cancelQueries({ queryKey: scenario.key });
    await expect(pending).rejects.toThrow();
    expect(receivedSignal?.aborted).toBe(true);
    expect(queryClient.getQueryData(scenario.key)).toBeUndefined();
  });
}

test("market prices accepts a parsed partial 502 response only", async () => {
  const queryClient = createClient();
  const partial = scenarios[0]?.valid;
  const options = marketPricesOptions({ fetchImpl: async () => Response.json(partial, { status: 502 }) });
  expect((await queryClient.fetchQuery(options)).markets.stock).toEqual({ status: "unavailable" });
  expect(queryClient.getQueryData(options.queryKey)).toBeDefined();
});

test("resolved asset rejects a null ID even when queryFn is called directly", async () => {
  const options = resolvedAssetOptions(null);
  expect(options.enabled).toBe(false);
  const client = createClient();
  await expect(client.fetchQuery(options)).rejects.toThrow("Missing asset ID");
  expect(client.getQueryData(options.queryKey)).toBeUndefined();
});

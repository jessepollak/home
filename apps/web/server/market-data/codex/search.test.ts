import { describe, expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import { createCodexSearchReader } from "./search";

const a = "0x1111111111111111111111111111111111111111";
const b = "0x2222222222222222222222222222222222222222";
const now = () => new Date("2026-09-26T12:00:00.000Z");
const row = (address: string, name = "Other", symbol = "OTHER", extra = {}) => ({ priceUSD: "0.01", change24: "0.02", lastTransaction: "1788955200", token: { address, name, symbol, decimals: "18", networkId: "8453", info: {} }, ...extra });
const page = (rows: unknown[], offset = 0) => Response.json({ data: { filterTokens: { results: rows, count: rows.length, page: offset } } });
const request = (query: string, offset = 0) => ({ query, offset });

describe("Base Invest search", () => {
  test("matches configured aliases, whitespace, single-character symbols, contract and case", async () => {
    const search = createCodexSearchReader({ apiKey: undefined, isPair: async () => false });
    for (const query of ["Bitcoin", "BTC", "cbBTC", "  bItCoIn  "]) {
      const result = await search(request(query));
      expect(result.results[0]).toMatchObject({ kind: "configured", assetId: "cbbtc", match: "exact" });
    }
    for (const query of ["Apple", "AAPL", "AAPLc"]) expect((await search(request(query))).results[0]).toMatchObject({ assetId: "aaplc", match: "exact" });
    expect((await search(request("a"))).results.some((result) => result.kind === "configured" && result.assetId === "aaplc")).toBe(true);
    expect((await search(request(investAssets[0]!.contractAddress.toUpperCase().replace(/^0X/, "0x")))).results).toEqual([{ kind: "configured", assetId: "nvdac", match: "contract" }]);
  });
  test("removed configured assets remain resolvable but never appear in search discovery", async () => {
    const removed = { ...investAssets[0]!, listing: "removed" as const };
    const search = createCodexSearchReader({ apiKey: undefined, assets: [removed], resolve: async () => ({ version: 1 as const, assetId: removed.id, asset: removed, source: "configured" as const, provider: "ok" as const, snapshot: null }) });
    expect((await search(request(removed.displaySymbol))).results).toEqual([]);
    expect((await search(request(removed.contractAddress))).results).toEqual([]);
    expect(removed.contractAddress).toBe(investAssets[0]!.contractAddress);
  });

  test("sends Base-only phrase search, retains distinct symbols, ranks relevance and drops wrong-chain/configured/duplicate contracts", async () => {
    const checked: string[] = [];
    const search = createCodexSearchReader({ apiKey: "fixture", now, isPair: async (address) => { checked.push(address); return false; }, fetchImpl: async (_, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.query).toContain("filterTokens(phrase: $phrase");
      expect(body.variables).toMatchObject({ phrase: "AAPL", filters: { network: [8453] }, limit: 20, offset: 0 });
      expect(body.variables.filters).toEqual({ network: [8453] });
      return page([row(a, "Zebra", "AAPL"), row(investAssets[2]!.contractAddress, "Apple", "AAPL"), row(b, "AAPL thing", "AAPL"), row(a, "Zebra", "AAPL"), row("0x4444444444444444444444444444444444444444", "Unrelated", "NONE"), row("0x3333333333333333333333333333333333333333", "AAPL", "AAPL", { token: { address: "0x3333333333333333333333333333333333333333", name: "AAPL", symbol: "AAPL", decimals: 18, networkId: 1, info: {} } })]);
    } });
    const result = await search(request("AAPL"));
    expect(result.results.map((value) => value.kind === "configured" ? value.assetId : value.asset.id)).toEqual(["aaplc", `base:${a}`, `base:${b}`]);
    expect(result.snapshots).toHaveLength(2);
    expect(checked).toEqual([a, b]);
  });

  test("phrase search excludes LP tokens and their snapshots", async () => {
    const checked: string[] = [];
    const search = createCodexSearchReader({ apiKey: "fixture", now, fetchImpl: async () => page([row(a, "UNI-V2", "UNI-V2"), row(b, "UNI-V2 Token", "UNI")]), isPair: async (address) => { checked.push(address); return address === a; } });
    const result = await search(request("UNI-V2"));
    expect(result).toMatchObject({ provider: "ok", coverage: "complete" });
    expect(result.results.map((value) => value.kind === "dynamic" ? value.asset.id : value.assetId)).toEqual([`base:${b}`]);
    expect(result.snapshots.map((snapshot) => snapshot.assetId)).toEqual([`base:${b}`]);
    expect(checked).toEqual([a, b]);
  });

  for (const failure of ["null", "throw"] as const) {
    test(`inconclusive phrase pair check (${failure}) keeps verified and configured results but is not cached`, async () => {
      let reads = 0;
      const checked: string[] = [];
      const search = createCodexSearchReader({ apiKey: "fixture", now, fetchImpl: async () => {
        reads++;
        return page([row(a, "Bitcoin Pool", "BTC"), row(b, "Bitcoin Token", "BTC"), ...Array.from({ length: 18 }, () => row(a, "Bitcoin Pool", "BTC"))]);
      }, isPair: async (address) => {
        checked.push(address);
        if (address === a && reads === 1) {
          if (failure === "throw") throw new Error("RPC unavailable");
          return null;
        }
        return false;
      } });
      const inconclusive = await search(request("BTC"));
      expect(inconclusive).toMatchObject({ provider: "error", coverage: "partial", nextOffset: 20 });
      expect(inconclusive.results.map((value) => value.kind === "dynamic" ? value.asset.id : value.assetId)).toEqual(["cbbtc", `base:${b}`]);
      expect(inconclusive.snapshots.map((snapshot) => snapshot.assetId)).toEqual([`base:${b}`]);
      const retried = await search(request("BTC"));
      expect(retried.provider).toBe("ok");
      expect(retried.results.map((value) => value.kind === "dynamic" ? value.asset.id : value.assetId)).toContain(`base:${a}`);
      expect(reads).toBe(2);
      expect(checked).toEqual([a, b, a]);
    });
  }

  test("bounds a full phrase page's pair probes and reuses definitive checks across queries", async () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(`0x${(index + 100).toString(16).padStart(40, "0")}`, "Bitcoin", "BTC"));
    const releases: (() => void)[] = [];
    const reached: (() => void)[] = [];
    const milestones = [8, 16, 20].map(() => new Promise<void>((resolve) => { reached.push(resolve); }));
    let fetches = 0;
    let calls = 0;
    let active = 0;
    let observedMax = 0;
    const search = createCodexSearchReader({ apiKey: "fixture", now, fetchImpl: async () => { fetches++; return page(rows); }, isPair: async () => {
      calls++;
      active++;
      observedMax = Math.max(observedMax, active);
      if (calls === 8) reached[0]!();
      if (calls === 16) reached[1]!();
      if (calls === 20) reached[2]!();
      return new Promise<boolean>((resolve) => { releases.push(() => { active--; resolve(false); }); });
    } });
    const first = search(request("BTC"));
    await milestones[0];
    expect(calls).toBe(8);
    for (const release of releases.splice(0)) release();
    await milestones[1];
    for (const release of releases.splice(0)) release();
    await milestones[2];
    for (const release of releases.splice(0)) release();
    const firstResult = await first;
    expect(firstResult).toMatchObject({ provider: "ok", coverage: "complete", nextOffset: 20 });
    expect(firstResult.results.filter((result) => result.kind === "dynamic")).toHaveLength(20);
    const secondResult = await search(request("Bitcoin"));
    expect(secondResult.results.filter((result) => result.kind === "dynamic")).toHaveLength(20);
    expect(fetches).toBe(2);
    expect(calls).toBe(20);
    expect(active).toBe(0);
    expect(observedMax).toBe(8);
  });

  test("provider rows with missing prices and images have no snapshot or image, not a zero price", async () => {
    const search = createCodexSearchReader({ apiKey: "fixture", now, isPair: async () => false, fetchImpl: async () => page([row(a, "Needle", "NDL", { priceUSD: null })]) });
    const result = await search(request("Needle"));
    expect(result.snapshots).toEqual([]);
    expect(result.results[0]).toMatchObject({ kind: "dynamic", source: "indexed" });
    if (result.results[0]?.kind === "dynamic") expect(result.results[0].asset.imageUrl).toBeUndefined();
  });

  test("exact lookup checks contract equality, falls back to onchain, never shows pool/phrase mismatch", async () => {
    const search = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([row(b, "Wrong", "WRONG")]), isPair: async () => false, onchain: async () => ({ symbol: "Unindexed", decimals: 6 }) });
    const result = await search(request(a.toUpperCase().replace(/^0X/, "0x")));
    expect(result.results).toMatchObject([{ kind: "dynamic", match: "contract", source: "onchain", asset: { id: `base:${a}`, displaySymbol: "Unindexed", representation: { decimals: 6 } } }]);
    expect(result.snapshots).toEqual([]);
    const empty = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([]), isPair: async () => false, onchain: async () => null });
    expect((await empty(request(a))).results).toEqual([]);
    expect((await empty(request("0x111"))).provider).toBe("skipped");
  });

  test("exact indexed lookup is accepted for tokens and rejected for pairs", async () => {
    const token = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([row(a, "Indexed", "IDX")]), isPair: async () => false, onchain: async () => null });
    expect((await token(request(a))).results).toMatchObject([{ kind: "dynamic", match: "contract", source: "indexed", asset: { id: `base:${a}`, displayName: "Indexed" } }]);
    const pair = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([row(a, "Indexed", "IDX")]), isPair: async () => true, onchain: async () => ({ symbol: "UNI-V2", decimals: 18 }) });
    expect((await pair(request(a))).results).toEqual([]);
  });

  test("an inconclusive pair check fails closed and is not cached", async () => {
    let pairChecks = 0;
    const search = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([row(a, "Indexed Pool", "POOL")]), isPair: async () => { pairChecks++; return pairChecks === 1 ? null : false; }, onchain: async () => ({ symbol: "POOL", decimals: 18 }) });
    const inconclusive = await search(request(a));
    expect(inconclusive).toMatchObject({ results: [], provider: "error", coverage: "partial" });
    expect((await search(request(a))).results).toMatchObject([{ kind: "dynamic", match: "contract", source: "indexed" }]);
    const unindexed = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([]), isPair: async () => null, onchain: async () => ({ symbol: "POOL", decimals: 18 }) });
    expect(await unindexed(request(a))).toMatchObject({ results: [], provider: "error" });
  });

  test("an indexed exact contract carries its current price and identity; mismatched rows are not accepted", async () => {
    let variables: Record<string, unknown> = {};
    const priced = createCodexSearchReader({ apiKey: "fixture", now, isPair: async () => false, fetchImpl: async (_, init) => { variables = JSON.parse(String(init?.body)).variables; return page([row(a, "Indexed", "IDX", { token: { address: a, name: "Indexed", symbol: "IDX", decimals: 18, networkId: 8453, info: { imageThumbUrl: "https://example.com/thumb.png", imageSmallUrl: "https://example.com/small.png", imageLargeUrl: "https://example.com/large.png" } } })]); } });
    const result = await priced(request(a));
    expect(variables).toEqual({ tokens: [`${a}:8453`], limit: 1 });
    expect(result).toMatchObject({ provider: "ok", results: [{ kind: "dynamic", source: "indexed", asset: { id: `base:${a}`, displayName: "Indexed", displaySymbol: "IDX", imageUrl: "https://example.com/small.png" } }], snapshots: [{ assetId: `base:${a}`, displayPrice: "$0.01" }] });
    const wrongRow = createCodexSearchReader({ apiKey: "fixture", now, isPair: async () => false, onchain: async () => null, fetchImpl: async () => page([row(b, "Indexed", "IDX")]) });
    expect(await wrongRow(request(a))).toMatchObject({ results: [], snapshots: [], provider: "ok" });
    const wrongNetwork = createCodexSearchReader({ apiKey: "fixture", now, isPair: async () => false, onchain: async () => null, fetchImpl: async () => page([row(a, "Indexed", "IDX", { token: { address: a, name: "Indexed", symbol: "IDX", decimals: 18, networkId: 1, info: {} } })]) });
    expect(await wrongNetwork(request(a))).toMatchObject({ results: [], snapshots: [], provider: "ok" });
    const unpriced = createCodexSearchReader({ apiKey: "fixture", now, isPair: async () => false, fetchImpl: async () => page([row(a, "Unpriced", "RAW", { priceUSD: null })]) });
    expect(await unpriced(request(a))).toMatchObject({ results: [{ kind: "dynamic", source: "indexed", asset: { displayName: "Unpriced", displaySymbol: "RAW" } }], snapshots: [] });
  });

  test("definitive empty exact results use onchain identity", async () => {
    let onchainCalls = 0;
    const search = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([]), isPair: async () => false, onchain: async () => { onchainCalls++; return { symbol: "RAW", decimals: 6 }; } });
    expect(await search(request(a))).toMatchObject({ provider: "ok", coverage: "complete", results: [{ kind: "dynamic", source: "onchain", asset: { displaySymbol: "RAW", representation: { decimals: 6 } } }], snapshots: [] });
    expect(onchainCalls).toBe(1);
  });

  test("a failed onchain identity read is partial and retried", async () => {
    let reads = 0;
    const search = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([]), isPair: async () => false, onchain: async () => { reads++; throw new Error("RPC unavailable"); } });
    expect(await search(request(a))).toMatchObject({ provider: "error", coverage: "partial", results: [] });
    expect(await search(request(a))).toMatchObject({ provider: "error", coverage: "partial", results: [] });
    expect(reads).toBe(2);
  });

  for (const { label, fetchImpl } of [
    { label: "HTTP 5xx", fetchImpl: async () => new Response(null, { status: 503 }) },
    { label: "HTTP 429", fetchImpl: async () => new Response(null, { status: 429 }) },
    { label: "timeout", fetchImpl: async (_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("abort")), { once: true }); }) },
    { label: "malformed body", fetchImpl: async () => Response.json({ data: { filterTokens: { results: "invalid" } } }) },
  ]) {
    test(`exact ${label} returns a retryable provider failure without onchain fallback`, async () => {
      let calls = 0;
      let onchainCalls = 0;
      const search = createCodexSearchReader({ apiKey: "fixture", timeoutMs: 10, fetchImpl: async (input, init) => { calls++; return fetchImpl(input, init); }, isPair: async () => false, onchain: async () => { onchainCalls++; return { symbol: "RAW", decimals: 6 }; } });
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await search(request(a))).toMatchObject({ results: [], snapshots: [], provider: "error", coverage: "partial" });
      }
      expect(calls).toBe(2);
      expect(onchainCalls).toBe(0);
    });
  }

  test("malformed exact token rows do not count as a definitive miss", async () => {
    const search = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([null]), isPair: async () => false, onchain: async () => ({ symbol: "RAW", decimals: 6 }) });
    expect(await search(request(a))).toMatchObject({ results: [], provider: "error", coverage: "partial" });
  });

  test("cached and concurrent case variants answer with each caller's query", async () => {
    let calls = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const search = createCodexSearchReader({ apiKey: "fixture", now, isPair: async () => false, fetchImpl: async () => { calls++; await waiting; return page([row(a, "Orbit", "ORB")]); } });
    const first = search(request("ORB"));
    const concurrent = search(request("orb"));
    release();
    expect((await first).query).toBe("ORB");
    expect((await concurrent).query).toBe("orb");
    const cached = await search(request("Orb"));
    expect(cached.query).toBe("Orb");
    expect(cached.results).toMatchObject([{ kind: "dynamic", asset: { id: `base:${a}` } }]);
    expect(calls).toBe(1);
  });

  test("a provider exact match outranks a weaker configured prefix match", async () => {
    const search = createCodexSearchReader({ apiKey: "fixture", now, isPair: async () => false, fetchImpl: async () => page([row(a, "Aap Token", "AAP")]) });
    const result = await search(request("AAP"));
    expect(result.results.map((value) => value.kind === "configured" ? `${value.assetId}:${value.match}` : `${value.asset.id}:${value.match}`)).toEqual([`base:${a}:exact`, "aaplc:prefix"]);
  });

  test("pagination omits configured later, uses raw provider count, caps last page and keeps page-level dedupe", async () => {
    const seen: number[] = [];
    const search = createCodexSearchReader({ apiKey: "fixture", now, isPair: async () => false, fetchImpl: async (_, init) => {
      const { offset } = JSON.parse(String(init?.body)).variables;
      seen.push(offset);
      return page(Array.from({ length: 20 }, (_, i) => row(i === 0 ? a : `0x${(i + offset + 100).toString(16).padStart(40, "0")}`, "Bitcoin", "BTC")), offset);
    } });
    expect((await search(request("BTC"))).nextOffset).toBe(20);
    const second = await search(request("BTC", 20));
    expect(second.nextOffset).toBe(40);
    expect(second.results.every((result) => result.kind === "dynamic")).toBe(true);
    expect((await search(request("BTC", 100))).nextOffset).toBeNull();
    expect(seen).toEqual([0, 20, 100]);
  });

  for (const { label, ...metadata } of [
    { label: "null count and page", count: null, page: null },
    { label: "missing count", page: "0" },
    { label: "missing page", count: "0" },
    { label: "empty count", count: "", page: "0" },
    { label: "empty page", count: "0", page: "" },
    { label: "fractional count", count: "1.5", page: "0" },
    { label: "fractional page", count: "0", page: "1.5" },
    { label: "negative-zero count", count: "-0", page: "0" },
    { label: "negative-zero page", count: "0", page: "-0" },
    { label: "negative count", count: -1, page: "0" },
    { label: "negative page", count: "0", page: -1 },
    { label: "non-numeric count", count: "none", page: "0" },
    { label: "non-numeric page", count: "0", page: "none" },
    { label: "unsafe count", count: "9007199254740992", page: "0" },
    { label: "unsafe page", count: "0", page: "9007199254740992" },
    { label: "count mismatch", count: "1", page: "0" },
    { label: "page mismatch", count: "0", page: "20" },
  ]) {
    test(`invalid pagination metadata (${label}) returns a partial, uncached provider failure`, async () => {
      let calls = 0;
      const search = createCodexSearchReader({ apiKey: "fixture", isPair: async () => false, fetchImpl: async () => {
        calls++;
        return Response.json({ data: { filterTokens: { results: [], ...metadata } } });
      } });
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await search(request("BTC"))).toMatchObject({ provider: "error", coverage: "partial", results: [{ kind: "configured", assetId: "cbbtc" }] });
      }
      expect(calls).toBe(2);
    });
  }

  test("unusable phrase rows are skipped without failing the rest of the page", async () => {
    const search = createCodexSearchReader({ apiKey: "fixture", isPair: async () => false, fetchImpl: async () => page([null, row(a, "Needle", "NDL", { token: { address: a, name: "Needle", symbol: null, decimals: 18, networkId: 8453 } }), row(b, "Needle Two", "NDL")]) });
    expect(await search(request("Needle"))).toMatchObject({ provider: "ok", coverage: "complete", results: [{ kind: "dynamic", asset: { id: `base:${b}` } }] });
  });

  test("an exact row without a usable identity falls back to onchain identity", async () => {
    const search = createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => page([row(a, "", "", { token: { address: a, name: "", symbol: "", decimals: 18, networkId: 8453 } })]), isPair: async () => false, onchain: async () => ({ symbol: "RAW", decimals: 6 }) });
    expect(await search(request(a))).toMatchObject({ provider: "ok", results: [{ kind: "dynamic", source: "onchain", asset: { displaySymbol: "RAW" } }] });
  });

  test("timeouts, HTTP 429 and malformed upstream preserve configured matches as partial", async () => {
    for (const fetchImpl of [async () => new Response("no", { status: 429 }), async () => page([], 20), async (_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("abort")), { once: true }); })]) {
      const search = createCodexSearchReader({ apiKey: "fixture", fetchImpl, timeoutMs: 10, isPair: async () => false });
      const result = await search(request("BTC"));
      expect(result).toMatchObject({ provider: "error", coverage: "partial", results: [{ kind: "configured", assetId: "cbbtc" }] });
    }
  });

  test("coalesces same query, bounds distinct upstream work and evicts LRU entries", async () => {
    let release!: () => void;
    let calls = 0;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const search = createCodexSearchReader({ apiKey: "fixture", cacheMaxEntries: 1, maxInFlight: 1, isPair: async () => false, fetchImpl: async () => { calls++; await waiting; return page([]); } });
    const first = search(request("BTC"));
    const same = search(request("btc"));
    expect((await search(request("Apple"))).provider).toBe("unavailable");
    release();
    await Promise.all([first, same]);
    expect(calls).toBe(1);
    await search(request("Apple"));
    await search(request("BTC"));
    expect(calls).toBe(3);
  });
});

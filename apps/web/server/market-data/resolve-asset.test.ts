import { expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import { createAssetResolver } from "./resolve-asset";
import { createCodexSearchReader } from "./codex/search";
import { createResolveAssetHandler } from "./handlers/resolve-asset";
import { parseAssetResolutionResponse } from "@/shared/invest/contracts/asset-resolution";

const address = "0x1111111111111111111111111111111111111111";
const id = `base:${address}`;
const exactRow = { priceUSD: "1.25", change24: "0.02", lastTransaction: "1788955200", token: { address, name: "Orbit", symbol: "ORB", decimals: "18", networkId: "8453", info: {} } };
const exact = (rows: unknown[]) => async () => Response.json({ data: { filterTokens: { results: rows } } });
const options = { apiKey: "fixture", now: () => new Date("2026-09-26T00:00:00Z"), isPair: async () => false, fetchImpl: exact([exactRow]) };

test("configured IDs and mixed-case contracts resolve without provider access", async () => {
  let reads = 0;
  const resolve = createAssetResolver({ ...options, fetchImpl: async () => { reads++; return Response.json({}); } });
  const asset = investAssets[0]!;
  for (const identity of [asset.id, asset.contractAddress.toUpperCase().replace("0X", "0x")]) {
    expect(await resolve(identity)).toMatchObject({ assetId: asset.id, asset, source: "configured", provider: "skipped" });
  }
  expect(reads).toBe(0);
});

test("search and detail share resolution for contract and canonical ID", async () => {
  let reads = 0;
  const resolve = createAssetResolver({ ...options, fetchImpl: async () => { reads++; return Response.json({ data: { filterTokens: { results: [exactRow] } } }); } });
  const search = createCodexSearchReader({ apiKey: "fixture", resolve });
  const handler = createResolveAssetHandler(resolve);
  const [found, detail] = await Promise.all([search({ query: address, offset: 0 }), handler(new Request(`https://home.test/api/invest/asset?assetId=${id}`))]);
  const resolved = parseAssetResolutionResponse(await detail.json());
  expect(found.results[0]).toMatchObject({ kind: "dynamic", asset: resolved?.asset });
  expect(resolved).toMatchObject({ assetId: id, source: "indexed", provider: "ok" });
  expect(reads).toBe(1);
});

test("missing metadata is retried instead of cached as unknown", async () => {
  let reads = 0;
  const resolve = createAssetResolver({ ...options, fetchImpl: exact([]), onchain: async () => ++reads === 1 ? null : { symbol: "ORB", decimals: 18 } });
  expect((await resolve(id)).asset).toBeNull();
  expect(await resolve(id)).toMatchObject({ source: "onchain", snapshot: null, asset: { id } });
});

test("asset endpoint rejects invalid IDs and never caches resolver failures", async () => {
  let reads = 0;
  const handler = createResolveAssetHandler(async () => { reads++; throw new Error("offline"); });
  expect((await handler(new Request("https://home.test/api/invest/asset?assetId=BTC"))).status).toBe(400);
  expect(reads).toBe(0);
  const response = await handler(new Request(`https://home.test/api/invest/asset?assetId=${id}`));
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(parseAssetResolutionResponse(await response.json())).toMatchObject({ assetId: id, asset: null, provider: "error" });
});

test("asset contract rejects mismatched identities and onchain prices", async () => {
  const value = await createAssetResolver(options)(id);
  expect(parseAssetResolutionResponse(value)).not.toBeNull();
  expect(parseAssetResolutionResponse({ ...value, assetId: "base:0x2222222222222222222222222222222222222222" })).toBeNull();
  expect(parseAssetResolutionResponse({ ...value, source: "onchain", snapshot: { assetId: id, displayPrice: "$1", asOf: "2026-09-26", sourceLabel: "provider" } })).toBeNull();
});

test("resolver retries errors, joins identical reads, overloads without work, and expires after TTL", async () => {
  let time = 0;
  let calls = 0;
  let release!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const resolve = createAssetResolver({ ...options, now: () => new Date(time), maxInFlight: 1, fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response("offline", { status: 503 }) : calls === 2 ? held : Response.json({ data: { filterTokens: { results: [exactRow] } } });
  } });
  expect((await resolve(id)).provider).toBe("error");
  const first = resolve(id);
  const joined = resolve(address);
  const other = "base:0x2222222222222222222222222222222222222222";
  expect(await resolve(other)).toMatchObject({ provider: "unavailable", asset: null });
  expect(calls).toBe(2);
  release(Response.json({ data: { filterTokens: { results: [exactRow] } } }));
  expect(await first).toEqual(await joined);
  time = 45_000;
  expect((await resolve(id)).provider).toBe("ok");
  expect(calls).toBe(2);
  time = 45_001;
  expect((await resolve(id)).provider).toBe("ok");
  expect(calls).toBe(3);
});

import { expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import { parseAssetResolutionRequest, parseAssetResolutionResponse } from "./asset-resolution";

const address = "0x1111111111111111111111111111111111111111";
const assetId = `base:${address}`;
const asset = {
  id: assetId, category: "meme", displayName: "Orbit", displaySymbol: "ORB", initials: "OR",
  chainId: 8453, contractAddress: address, availability: "informational", descriptor: "Base token",
  representation: { tokenSymbol: "ORB", relationship: "Base token" }, contractUrl: "https://example.test/token",
} as const;
const snapshot = { assetId, displayPrice: "$1.25", asOf: "2026-09-08", sourceLabel: "Codex" };
const response = { version: 1, assetId, asset, source: "indexed", snapshot, provider: "ok" } as const;

for (const provider of [undefined, 1, {}, ["ok"], { toString: () => "ok" }, "unknown"]) {
  test(`rejects malformed asset provider ${JSON.stringify(provider)}`, () => {
    expect(parseAssetResolutionResponse({ ...response, provider })).toBeNull();
  });
}

for (const malformed of [
  null, [], {}, { ...response, version: 2 }, { ...response, assetId: "unknown" },
  { ...response, assetId: "base:0x2222222222222222222222222222222222222222" },
  { ...response, asset: undefined }, { ...response, asset: null }, { ...response, source: null },
  { ...response, snapshot: undefined }, { ...response, snapshot: { ...snapshot, assetId: "unknown" } },
  { ...response, snapshot: { ...snapshot, displayPrice: "" } }, { ...response, source: "onchain" },
  { ...response, asset: { ...asset, representation: {} } },
]) {
  test(`rejects malformed or inconsistent resolution ${JSON.stringify(malformed)}`, () => {
    expect(parseAssetResolutionResponse(malformed)).toBeNull();
  });
}

for (const provider of ["ok", "skipped", "unavailable", "error"] as const) {
  test(`accepts a ${provider} missing-asset envelope without inventing metadata`, () => {
    const absent = { ...response, asset: null, source: null, snapshot: null, provider };
    expect(parseAssetResolutionResponse(absent)).toEqual(absent);
  });
}

test("configured resolution uses local configuration without requiring wire metadata", () => {
  const configured = investAssets.find((candidate) => candidate.id === "cbbtc");
  if (!configured) throw new Error("Missing configured asset");
  expect(parseAssetResolutionResponse({ version: 1, assetId: "cbbtc", source: "configured", snapshot: null, provider: "skipped" })).toEqual({
    version: 1, assetId: "cbbtc", asset: configured, source: "configured", snapshot: null, provider: "skipped",
  });
});

test("indexed resolution preserves prices and omits malformed optional snapshot fields", () => {
  expect(parseAssetResolutionResponse({ ...response, snapshot: { ...snapshot, sourceUrl: 1, changeLabel: null } })).toEqual(response);
  const enrichedSnapshot = { ...snapshot, sourceUrl: "https://example.test", changeLabel: "+2%" };
  expect(parseAssetResolutionResponse({ ...response, snapshot: enrichedSnapshot })?.snapshot).toEqual(enrichedSnapshot);
});

test("onchain metadata without a snapshot remains resolvable", () => {
  expect(parseAssetResolutionResponse({ ...response, source: "onchain", snapshot: null })).toMatchObject({ assetId, source: "onchain", snapshot: null });
});

test("resolution request accepts only configured or canonical dynamic identities", () => {
  expect(parseAssetResolutionRequest(new URLSearchParams({ assetId }))).toBe(assetId);
  expect(parseAssetResolutionRequest(new URLSearchParams({ assetId: "cbbtc" }))).toBe("cbbtc");
  expect(parseAssetResolutionRequest(new URLSearchParams({ assetId: "BTC" }))).toBeNull();
});

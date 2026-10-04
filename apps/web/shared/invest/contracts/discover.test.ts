import { expect, test } from "bun:test";
import { requireAddress } from "@/shared/chain/hex";
import { parseDiscoverResponse } from "./discover";

const address = requireAddress("0x1111111111111111111111111111111111111111");
const asset = {
  id: `base:${address}`, category: "meme", displayName: "Orbit", displaySymbol: "ORB", initials: "OR",
  chainId: 8453, contractAddress: address, availability: "informational", descriptor: "Base token",
  representation: { tokenSymbol: "ORB" }, contractUrl: "https://example.test/token",
} as const;
const snapshot = { assetId: asset.id, displayPrice: "$1.25", asOf: "2026-09-08", sourceLabel: "Codex" };
const page = {
  version: 1, provider: "codex", icons: {},
  memes: { status: "ready", assets: [asset], snapshots: [snapshot], nextOffset: null, exhausted: true },
};

test("discovery preserves omitted and mistyped optional metadata", () => {
  const malformedMetadata = { ...asset, imageUrl: 5, projectUrl: null, representation: { tokenSymbol: "ORB", decimals: "18", relationship: null } };
  expect(parseDiscoverResponse({ ...page, memes: { ...page.memes, assets: [malformedMetadata] } })?.memeAssets).toEqual([{
    ...asset, representation: { tokenSymbol: "ORB", relationship: "Base ERC-20 token." },
  }]);
  expect(parseDiscoverResponse({ ...page, memes: { ...page.memes, snapshots: [{ ...snapshot, sourceUrl: false, changeLabel: 1 }] } })?.memeMarket).toEqual({ status: "ready", snapshots: [snapshot] });
});

for (const status of ["empty", "error", "unavailable"]) {
  test(`${status} discovery tolerates missing or malformed assets but never yields them`, () => {
    for (const metadata of [{}, { assets: [asset], snapshots: [snapshot] }, { assets: 1, snapshots: null }]) {
      expect(parseDiscoverResponse({ ...page, memes: { status, nextOffset: null, exhausted: true, ...metadata } })).toMatchObject({ memeStatus: status, memeAssets: [] });
    }
  });
}

for (const memes of [
  { ...page.memes, assets: undefined },
  { ...page.memes, snapshots: undefined },
  { ...page.memes, assets: [{ ...asset, representation: {} }] },
  { ...page.memes, snapshots: [{ ...snapshot, assetId: "unknown" }] },
  { ...page.memes, snapshots: [{ ...snapshot, displayPrice: "" }] },
  { ...page.memes, exhausted: undefined },
  { ...page.memes, nextOffset: 24 },
  { ...page.memes, exhausted: false },
  { ...page.memes, exhausted: false, nextOffset: -1 },
  { ...page.memes, exhausted: false, nextOffset: 1.5 },
  { ...page.memes, exhausted: false, nextOffset: Number.MAX_SAFE_INTEGER + 1 },
]) {
  test(`rejects malformed discovery memes ${JSON.stringify(memes)}`, () => {
    expect(parseDiscoverResponse({ ...page, memes })).toBeNull();
  });
}

test("discovery retains pagination for a valid non-exhausted page", () => {
  expect(parseDiscoverResponse({ ...page, memes: { ...page.memes, nextOffset: 24, exhausted: false } })?.memePagination).toMatchObject({ nextOffset: 24, exhausted: false });
});

for (const malformed of [null, [], {}, { ...page, version: 2 }, { ...page, provider: "other" }, { ...page, icons: { orbit: 1 } }]) {
  test(`rejects malformed discovery envelope ${JSON.stringify(malformed)}`, () => {
    expect(parseDiscoverResponse(malformed)).toBeNull();
  });
}

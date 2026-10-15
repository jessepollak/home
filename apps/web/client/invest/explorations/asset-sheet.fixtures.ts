import { createBlockedAccountWalletClient, type AccountWalletClient } from "@/client/account/cdp-client";
import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import type { Holding } from "@/shared/balances/types";
import type { MarketDataState, MarketSession } from "@/shared/invest/invest-market";
import { expectedMarketPriceHistorySource, type MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import { formatSignedPercentChange } from "@/shared/formatting";

export const TIME = "2026-09-25T12:00:00.000Z";
const clock = Date.parse(TIME) - 60000;
export const bitcoin = investAssets.find((asset) => asset.id === "cbbtc")!;
export const longNameBitcoin: InvestAsset = { ...bitcoin, displayName: "Coinbase Wrapped Bitcoin Token on Base" };
export const stock = investAssets.find((asset) => asset.id === "nvdac")!;
export type Position = "owned" | "unowned" | "error" | "blocked";
const prices: Record<string, number> = { cbbtc: 122391.18, nvdac: 179.60 };
const periods: Record<MarketPriceRange, number> = { "1D": 86400000, "1W": 604800000, "1M": 2592000000, "3M": 7776000000, "1Y": 31536000000 };
const counts: Record<MarketPriceRange, number> = { "1D": 96, "1W": 168, "1M": 120, "3M": 90, "1Y": 365 };
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = (value + Math.imul(value ^ value >>> 7, 61 | value)) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
export function historyResponse(assetId: string, range: MarketPriceRange, state: "ready" | "empty" | "stale" | "partial" = "ready") {
  const isStock = assetId === "nvdac";
  const base = prices[assetId] ?? prices.cbbtc!;
  const end = clock - (state === "stale" ? 8 * 86400000 : 0);
  const count = isStock ? 32 : counts[range];
  const seed = Array.from(`${assetId}:${range}`).reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619), 2166136261);
  const random = seededRandom(seed);
  const volatility = isStock ? 0.0028 : 0.0016;
  const rangeShift = range === "1W" ? 0 : ((seed >>> 8) % 9 - 4) / 100;
  const startFactor = (isStock ? 1.045 : 0.96) + rangeShift;
  const endFactor = (isStock ? 0.998 : 1.001) + rangeShift * 0.1;
  let walk = 0;
  const offsets = Array.from({ length: count }, (_, index) => {
    if (index > 0) walk += (random() - 0.5) * 2 * volatility;
    return walk;
  });
  const lastOffset = offsets.at(-1) ?? 0;
  const full = state === "empty" ? [] : offsets.map((offset, index) => {
    const progress = index / (count - 1);
    const trend = startFactor + (endFactor - startFactor) * progress;
    const bounce = isStock ? 0.035 * Math.max(0, 1 - Math.abs(progress - 0.55) / 0.13) : 0;
    return { time: new Date(end - periods[range] * (1 - progress)).toISOString(),
      value: (base * Math.max(0.1, trend + offset - lastOffset * progress + bounce)).toPrecision(10) };
  });
  const partial = state === "partial" && isStock;
  const points = partial ? full.filter((_, index) => index < 10 || index > 15) : full;
  return {
    version: 2, provider: isStock ? "chainlink" : "codex", source: expectedMarketPriceHistorySource(assetId),
    assetId, range, currency: "USD", fetchedAt: new Date(clock).toISOString(), status: state === "empty" ? "empty" : "ready",
    ...(isStock ? { coverage: { sampled: state === "empty" ? 0 : count, observed: points.length,
      gaps: partial ? [{ from: full[10]!.time, to: full[15]!.time, reason: "read-failed" }] : [] } } : {}),
    points,
  };
}
export function market(asset: InvestAsset = bitcoin, stale = false, stockSession: MarketSession = "open"): MarketDataState {
  if (stale) return { status: "error", message: "Price snapshot is stale." };
  const points = historyResponse(asset.id, "1D").points;
  return { status: "ready", snapshots: [{ assetId: asset.id, displayPrice: `$${prices[asset.id]}`,
    asOf: new Date(clock - 60000).toISOString(), sourceLabel: asset.category === "stock" ? "Chainlink" : "Codex",
    ...(asset.category === "stock" ? { session: stockSession } : {
      changeLabel: formatSignedPercentChange((Number(points.at(-1)?.value) - Number(points[0]?.value)) / Number(points[0]?.value) * 100) ?? undefined,
    }),
  }] };
}
export const historyControl: { held: Promise<void>; release: () => void } = { held: Promise.resolve(), release: () => {} };
export function resetHistoryControl() {
  historyControl.release();
  historyControl.held = new Promise<void>((resolve) => { historyControl.release = resolve; });
}
function positionSnapshot(position: Position, asset: InvestAsset, stockSession: "open" | "closed") {
  const snapshot = balancesSnapshot("US");
  return { ...snapshot, holdings: snapshot.holdings.map((holding): Holding => {
    if (holding.id !== "cbbtc" && holding.id !== "nvdac") return holding;
    if (position !== "owned" || holding.id !== asset.id) return { ...holding, balance: { status: "ready", baseUnits: "0" } };
    return { ...holding, balance: { status: "ready", baseUnits: asset.id === "nvdac" ? "125000000" : "1234000" },
      value: { status: "priced", currency: "USD", amount: { atoms: asset.id === "nvdac" ? "22450" : "151030", scale: 2 },
        asOf: new Date(clock).toISOString(), ...(asset.id === "nvdac" ? { reference: { kind: "tokenized-equity", session: stockSession } } : {}) } };
  }) };
}
export function createClient(position: Position, asset: InvestAsset = bitcoin, stockSession: "open" | "closed" = "open"): AccountWalletClient {
  const blocked = createBlockedAccountWalletClient("unconfigured");
  if (position === "blocked") return blocked;
  return { ...blocked, status: "verified", verification: "server", ownerKey: "synthetic-asset-sheet-owner", isSignedIn: true, session: {
    user: { subject: "synthetic-asset-sheet-owner" },
    smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "cdp-embedded",
  }, fetchBalances: async () => {
    if (position === "error") throw new Error("Balances unavailable");
    return positionSnapshot(position, asset, stockSession);
  }, fetchAccountResource: async (path) => {
    if (path.startsWith("/api/trades?")) return { version: 2, status: "available", buy: "available",
      token: { assetId: bitcoin.id, address: bitcoin.contractAddress, symbol: "cbBTC", decimals: 8 },
      balanceBaseUnits: position === "owned" ? "1234000" : "0" };
    if (path === "/api/trades/stock-eligibility") return { version: 1, buy: "restricted", sell: "eligible" };
    throw new Error(`Unexpected fixture resource: ${path}`);
  } };
}
export function forceReducedMotion() {
  const original = window.matchMedia;
  window.matchMedia = (query) => query === "(prefers-reduced-motion: reduce)"
    ? { matches: true, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true }
    : original.call(window, query);
  return () => { window.matchMedia = original; };
}

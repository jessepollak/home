import "server-only";

import { BASE_CHAIN_ID, stockAssets } from "@/config/invest-assets";
import { createBoundedCache } from "@/server/cache/bounded";
import { createBaseRpcClient, parseRpcQuantity } from "@/server/chain/rpc";
import { MARKET_HISTORY_WINDOWS } from "@/server/market-data/codex/history";
import { atomicToDecimal } from "@/shared/formatting/atomic";
import {
  expectedMarketPriceHistorySource,
  isMarketPriceRange,
  MARKET_PRICE_HISTORY_VERSION,
  STOCK_HISTORY_MAX_POINTS,
  type MarketPriceHistoryGap,
  type MarketPriceHistoryGapReason,
  type MarketPriceHistoryPoint,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/shared/invest/contracts/market-price-history";
import { readTokenizedEquityReferences, tokenizedEquityFeeds, type TokenizedEquityFeed } from "./reader";

type Rpc = Pick<ReturnType<typeof createBaseRpcClient>, "request" | "batch">;
type FillStats = {
  assetId: string;
  feedProxy: string;
  range: MarketPriceRange;
  sampled: number;
  observed: number;
  methods: number;
  peakInFlight: number;
  durationMs: number;
  outcome: "complete" | "partial" | "deadline" | "budget" | "failed";
  cache: "miss" | "hit" | "coalesced";
};
type Sample = { blockNumber: bigint; time: string; point?: MarketPriceHistoryPoint; reason?: MarketPriceHistoryGapReason };
const feeds = new Map(tokenizedEquityFeeds(stockAssets).map((feed) => [feed.assetId, feed]));
const SAMPLE_METHOD_COST = 4;

export function createTokenizedEquityHistoryReader({
  rpc = createBaseRpcClient({ timeoutMs: 2_500 }),
  now = Date.now,
  deadline = () => AbortSignal.timeout(10_000),
  budget = 256,
  onFill,
}: {
  rpc?: Rpc;
  now?: () => number;
  deadline?: () => AbortSignal;
  budget?: number;
  onFill?: (stats: FillStats) => void;
} = {}) {
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 256) throw new RangeError("Invalid history method budget.");
  const cache = createBoundedCache<MarketPriceHistoryResponse>({
    maxEntries: 64,
    maxInFlight: 2,
    ttlMs: 60_000,
    now,
    retain: (value) => value.status !== "error" && (value.points.length >= 2 || value.status === "empty"),
  });
  const failures = createBoundedCache<MarketPriceHistoryResponse>({
    maxEntries: 64,
    maxInFlight: 2,
    ttlMs: 15_000,
    now,
  });
  const pending = new Set<string>();
  return async (assetId: string, range: string, options: { speculative?: boolean } = {}): Promise<MarketPriceHistoryResponse> => {
    const feed = feeds.get(assetId);
    if (!feed || !isMarketPriceRange(range)) {
      return unavailable(feed ? assetId : null, isMarketPriceRange(range) ? range : null, feed ? "invalid-range" : "unknown-asset");
    }
    const key = `${feed.feedProxy.toLowerCase()}:${range}`;
    const source = expectedMarketPriceHistorySource(assetId);
    const valid = (value: MarketPriceHistoryResponse) => value.assetId === assetId && JSON.stringify(value.source) === JSON.stringify(source);
    const warm = cache.get(key) ?? failures.get(key);
    if (warm && valid(warm)) {
      onFill?.(reuseStats(feed, range, warm, "hit"));
      return warm;
    }
    if (warm) { cache.delete(key); failures.delete(key); }
    if (options.speculative) return unavailable(assetId, range, "overloaded");
    const coalesced = pending.has(key);
    const result = await cache.fetch(key, async () => {
      pending.add(key);
      try {
        const value = await fill(feed, range, { rpc, now, deadline, budget, onFill });
        if (value.status === "error" || value.points.length < 2 && value.status !== "empty") failures.set(key, value);
        return value;
      } finally {
        pending.delete(key);
      }
    });
    if (result.status === "saturated") return unavailable(assetId, range, "overloaded");
    if (!valid(result.value)) return unavailable(assetId, range, "overloaded");
    if (coalesced) onFill?.(reuseStats(feed, range, result.value, "coalesced"));
    return result.value;
  };
}

export const getTokenizedEquityHistory = createTokenizedEquityHistoryReader();

function unavailable(assetId: string | null, range: MarketPriceRange | null, unavailableReason: MarketPriceHistoryResponse["unavailableReason"]): MarketPriceHistoryResponse {
  return {
    version: MARKET_PRICE_HISTORY_VERSION, provider: "chainlink", source: assetId ? expectedMarketPriceHistorySource(assetId) : null,
    assetId, range, currency: "USD", fetchedAt: null, status: "unavailable", points: [], unavailableReason,
  };
}

function reuseStats(feed: TokenizedEquityFeed, range: MarketPriceRange, value: MarketPriceHistoryResponse, cache: "hit" | "coalesced"): FillStats {
  return {
    assetId: feed.assetId, feedProxy: feed.feedProxy, range, sampled: value.coverage?.sampled ?? 0,
    observed: value.points.length, methods: 0, peakInFlight: 0, durationMs: 0,
    outcome: value.status === "error" ? "failed" : value.coverage?.gaps.length ? "partial" : "complete", cache,
  };
}

async function fill(feed: TokenizedEquityFeed, range: MarketPriceRange, deps: {
  rpc: Rpc; now: () => number; deadline: () => AbortSignal; budget: number; onFill?: (stats: FillStats) => void;
}): Promise<MarketPriceHistoryResponse> {
  const start = deps.now();
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, deps.deadline(), AbortSignal.timeout(10_000)]);
  let outcome: FillStats["outcome"] = "complete";
  let methods = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const waiters = new Set<() => void>();
  async function dispatch<T>(cost: number, send: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    while (inFlight >= 4) {
      await new Promise<void>((resolve) => {
        const wake = () => { waiters.delete(wake); signal.removeEventListener("abort", wake); resolve(); };
        waiters.add(wake);
        signal.addEventListener("abort", wake, { once: true });
      });
      signal.throwIfAborted();
    }
    if (methods + cost > deps.budget) {
      outcome = "budget";
      controller.abort();
      throw new Error("History method budget exhausted.");
    }
    methods += cost;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try { return await send(); }
    finally { inFlight -= 1; for (const wake of waiters) wake(); }
  }
  const rpc: Rpc = {
    request: (method, params) => dispatch(1, () => deps.rpc.request(method, params, signal)),
    batch: (calls, _signal, allowPartial) => {
      if (calls.length > 10) throw new RangeError("History RPC batches must contain at most ten calls.");
      return dispatch(calls.length, () => deps.rpc.batch(calls, signal, allowPartial));
    },
  };
  const duration = MARKET_HISTORY_WINDOWS[range].durationSeconds * 1000;
  let samples: Sample[] = Array.from({ length: STOCK_HISTORY_MAX_POINTS }, (_, index) => ({
    blockNumber: BigInt(0), time: new Date(start - duration + duration * index / (STOCK_HISTORY_MAX_POINTS - 1)).toISOString(), reason: "incomplete",
  }));
  async function read(sample: Sample) {
    const [reference] = await readTokenizedEquityReferences([feed], { blockNumber: sample.blockNumber, rpc, signal });
    if (!reference) { sample.reason = "read-failed"; return; }
    if (reference.block) sample.time = reference.block.timestamp;
    if (reference.status === "open" || reference.status === "closed") {
      sample.point = { time: reference.block.timestamp, value: atomicToDecimal(reference.price.atoms, reference.price.scale), session: reference.status };
      sample.reason = undefined;
    } else {
      sample.reason = reference.status === "paused" || reference.status === "stale" ? reference.status
        : reference.status === "unavailable" && reference.reason === "not-deployed" ? "not-deployed" : signal.aborted ? "incomplete" : "read-failed";
    }
    return reference.block;
  }
  async function pass(candidates: Sample[]) {
    for (let offset = 0; offset < candidates.length && !signal.aborted;) {
      const capacity = Math.min(4, Math.floor((deps.budget - methods) / SAMPLE_METHOD_COST), candidates.length - offset);
      if (capacity === 0) { outcome = "budget"; controller.abort(); break; }
      const group = candidates.slice(offset, offset + capacity);
      await Promise.all(group.map(read));
      offset += capacity;
    }
  }
  try {
    const chainId = parseRpcQuantity(await rpc.request("eth_chainId", [], signal), "chain ID");
    if (chainId !== BigInt(BASE_CHAIN_ID)) throw new Error("History RPC chain mismatch.");
    const latest = parseRpcQuantity(await rpc.request("eth_blockNumber", [], signal), "block number");
    const last = samples.at(-1);
    if (!last) throw new Error("History has no samples.");
    last.blockNumber = latest;
    if (deps.budget - methods >= SAMPLE_METHOD_COST && !signal.aborted) {
      let block = await read(last);
      const anchorRetried = !block && !signal.aborted && deps.budget - methods >= SAMPLE_METHOD_COST;
      if (anchorRetried) block = await read(last);
      if (block) {
        const latestTime = Date.parse(block.timestamp);
        const seen = new Set<string>([latest.toString()]);
        samples = samples.filter((sample) => {
          if (sample === last) return true;
          const distance = Math.max(0, Math.round((latestTime - Date.parse(sample.time)) / 2000));
          sample.blockNumber = latest > BigInt(distance) ? latest - BigInt(distance) : BigInt(0);
          if (seen.has(sample.blockNumber.toString())) return false;
          seen.add(sample.blockNumber.toString());
          return true;
        });
        await pass(samples.filter((sample) => sample !== last));
      } else { outcome = "failed"; }
      if (!signal.aborted) await pass(samples.filter((sample) => sample.reason === "read-failed" && (!anchorRetried || sample !== last)));
    } else { outcome = "budget"; controller.abort(); }
  } catch {
    if (!signal.aborted) outcome = "failed";
  }
  if (signal.aborted && outcome !== "budget") outcome = "deadline";
  const ordered = samples.toSorted((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const points: MarketPriceHistoryPoint[] = [];
  for (const sample of ordered) {
    const previousPoint = points.at(-1);
    if (sample.point && (!previousPoint || Date.parse(sample.point.time) > Date.parse(previousPoint.time))) points.push(sample.point);
    else if (sample.point) { sample.point = undefined; sample.reason = "incomplete"; }
  }
  const gaps: MarketPriceHistoryGap[] = [];
  for (let index = 0; index < ordered.length;) {
    const sample = ordered[index];
    if (!sample) break;
    if (sample.point) { index += 1; continue; }
    let end = index;
    while (end + 1 < ordered.length && !ordered[end + 1]?.point && ordered[end + 1]?.reason === sample.reason) end += 1;
    let previous = index - 1;
    while (previous >= 0 && !ordered[previous]?.point) previous -= 1;
    let next = end + 1;
    while (next < ordered.length && !ordered[next]?.point) next += 1;
    gaps.push({ from: ordered[Math.max(0, previous)]?.time ?? sample.time, to: ordered[Math.min(ordered.length - 1, next)]?.time ?? sample.time, reason: sample.reason ?? "incomplete" });
    index = end + 1;
  }
  const status = points.length ? "ready" : samples.every((sample) => sample.reason === "not-deployed") ? "empty" : "error";
  if (outcome === "complete" && gaps.length) outcome = status === "error" ? "failed" : "partial";
  const response: MarketPriceHistoryResponse = {
    version: MARKET_PRICE_HISTORY_VERSION, provider: "chainlink", source: expectedMarketPriceHistorySource(feed.assetId),
    assetId: feed.assetId, range, currency: "USD", fetchedAt: new Date(deps.now()).toISOString(), status, points,
    coverage: { sampled: samples.length, observed: points.length, gaps },
  };
  deps.onFill?.({ assetId: feed.assetId, feedProxy: feed.feedProxy, range, sampled: samples.length, observed: points.length,
    methods, peakInFlight, durationMs: Math.max(0, deps.now() - start), outcome, cache: "miss" });
  return response;
}

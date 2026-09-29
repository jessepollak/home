import { expect, test } from "bun:test";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { classifyTokenizedEquityRound } from "./classify";
import { createTokenizedEquityReader, readTokenizedEquityReferences, TOKENIZED_EQUITY_MAX_IN_FLIGHT, type TokenizedEquityFeed, type TokenizedEquityReference } from "./reader";
import { isClosedAt, openMarketSeconds } from "./session";

const et = (date: string, time: string, offset: string) => Date.parse(`${date}T${time}:00${offset}`) / 1000;
const feed: TokenizedEquityFeed = { assetId: "aaplc", token: "0xb200000000000000000000C2e324d24d7eEcd1fb", feedProxy: "0x787f13dEa48Db0897CbCDD985de77809D837F988", feedDecimals: 8, heartbeatSeconds: 86_400 };
const other: TokenizedEquityFeed = { ...feed, assetId: "nvdac", token: "0xb20000000000000000000078ee7ce2fE4908108C", feedProxy: "0x04689a41629776563E6822F76f2e57D148d28513" };
const thursday = et("2026-09-24", "12:00", "-04:00");
const block = { number: BigInt(123), timestamp: BigInt(thursday) };
const round = { roundId: BigInt(10), answer: BigInt("12345678901"), updatedAt: BigInt(thursday - 100), decimals: 8 };
const registry = { multiplier: BigInt("1000000000000000000"), paused: false };

for (const { name, before, after, wasClosed, nowClosed } of [
  { name: "Friday close", before: et("2026-09-25", "19:59", "-04:00"), after: et("2026-09-25", "20:00", "-04:00"), wasClosed: false, nowClosed: true },
  { name: "Sunday open", before: et("2026-09-27", "19:59", "-04:00"), after: et("2026-09-27", "20:00", "-04:00"), wasClosed: true, nowClosed: false },
  { name: "March DST Sunday", before: et("2026-03-08", "19:59", "-04:00"), after: et("2026-03-08", "20:00", "-04:00"), wasClosed: true, nowClosed: false },
  { name: "November DST Sunday", before: et("2026-11-01", "19:59", "-05:00"), after: et("2026-11-01", "20:00", "-05:00"), wasClosed: true, nowClosed: false },
  { name: "Thanksgiving close", before: et("2026-11-25", "19:59", "-05:00"), after: et("2026-11-25", "20:00", "-05:00"), wasClosed: false, nowClosed: true },
  { name: "Thanksgiving reopen", before: et("2026-11-26", "19:59", "-05:00"), after: et("2026-11-26", "20:00", "-05:00"), wasClosed: true, nowClosed: false },
  { name: "after calendar coverage", before: et("2029-01-03", "19:59", "-05:00"), after: et("2029-01-03", "20:00", "-05:00"), wasClosed: true, nowClosed: true },
]) test(name, () => {
  expect(isClosedAt(before)).toBe(wasClosed);
  expect(isClosedAt(after)).toBe(nowClosed);
  expect(openMarketSeconds(before, after)).toBe(wasClosed ? 0 : 60);
});

test("holiday and DST windows count only open-market seconds", () => {
  expect(openMarketSeconds(et("2026-11-25", "20:00", "-05:00"), et("2026-11-26", "20:00", "-05:00"))).toBe(0);
  expect(openMarketSeconds(et("2026-03-06", "19:59", "-05:00"), et("2026-03-08", "20:01", "-04:00"))).toBe(120);
  expect(openMarketSeconds(et("2026-10-30", "19:59", "-04:00"), et("2026-11-01", "20:01", "-05:00"))).toBe(120);
});


test("the vendored calendar closes a later-year holiday window", () => {
  expect(isClosedAt(et("2028-01-17", "19:00", "-05:00"))).toBe(true);
  expect(isClosedAt(et("2028-01-17", "20:01", "-05:00"))).toBe(false);
  expect(openMarketSeconds(et("2028-01-14", "20:00", "-05:00"), et("2028-01-18", "20:00", "-05:00"))).toBe(86_400);
});

test("a span past the vendored calendar is never counted as open", () => {
  const expired = { holidays: [], coversThrough: "2027-12-31" };
  const monday = et("2028-01-03", "14:00", "-05:00");
  expect(isClosedAt(monday, expired)).toBe(true);
  expect(openMarketSeconds(monday, monday + 4 * 3600, expired)).toBe(0);
});
for (const { name, changes, status, reason } of [
  { name: "fresh open", changes: {}, status: "open" },
  { name: "frozen weekend", changes: { block: { number: BigInt(123), timestamp: BigInt(et("2026-09-27", "19:00", "-04:00")) }, round: { ...round, updatedAt: BigInt(et("2026-09-25", "19:00", "-04:00")) } }, status: "closed" },
  { name: "frozen holiday", changes: { block: { number: BigInt(123), timestamp: BigInt(et("2026-11-26", "19:00", "-05:00")) }, round: { ...round, updatedAt: BigInt(et("2026-11-25", "19:00", "-05:00")) } }, status: "closed" },
  { name: "silent beyond heartbeat and hour", changes: { round: { ...round, updatedAt: BigInt(thursday - 90_001) } }, status: "stale" },
  { name: "ancient update is stale without walking every session", changes: { round: { ...round, updatedAt: BigInt(1) } }, status: "stale" },
  { name: "fresh at heartbeat plus hour", changes: { round: { ...round, updatedAt: BigInt(thursday - 90_000) } }, status: "open" },
  { name: "weekend adds no staleness", changes: { block: { number: BigInt(123), timestamp: BigInt(et("2026-09-28", "00:01", "-04:00")) }, round: { ...round, updatedAt: BigInt(et("2026-09-25", "19:59", "-04:00")) } }, status: "open" },
  { name: "paused positive", changes: { registry: { ...registry, paused: true } }, status: "paused" },
  { name: "paused without price", changes: { registry: { ...registry, paused: true }, round: { ...round, answer: BigInt(0) } }, status: "paused" },
  { name: "zero answer", changes: { round: { ...round, answer: BigInt(0) } }, status: "unavailable", reason: "invalid-answer" },
  { name: "paused without timestamp", changes: { registry: { ...registry, paused: true }, round: { ...round, updatedAt: BigInt(0) } }, status: "paused" },
  { name: "negative answer", changes: { round: { ...round, answer: BigInt(-1) } }, status: "unavailable", reason: "invalid-answer" },
  { name: "missing updatedAt", changes: { round: { ...round, updatedAt: BigInt(0) } }, status: "unavailable", reason: "invalid-answer" },
  { name: "future timestamp", changes: { round: { ...round, updatedAt: BigInt(thursday + 61) } }, status: "unavailable", reason: "future-timestamp" },
  { name: "uint256-sized future timestamp", changes: { round: { ...round, updatedAt: BigInt(2) ** BigInt(255) } }, status: "unavailable", reason: "future-timestamp" },
  { name: "decimals mismatch", changes: { round: { ...round, decimals: 18 } }, status: "unavailable", reason: "decimals-mismatch" },
  { name: "beyond the vendored calendar is never open", changes: { calendar: { holidays: [], coversThrough: "2027-12-31" }, block: { number: BigInt(123), timestamp: BigInt(et("2029-01-03", "14:00", "-05:00")) }, round: { ...round, updatedAt: BigInt(et("2028-12-29", "19:00", "-05:00")) } }, status: "closed" },
  { name: "multiplier zero", changes: { registry: { ...registry, multiplier: BigInt(0) } }, status: "unavailable", reason: "registry-invalid" },
  { name: "large exact answer", changes: { round: { ...round, answer: BigInt(10) ** BigInt(30) } }, status: "open" },
  { name: "nonunit multiplier already in answer", changes: { registry: { ...registry, multiplier: BigInt("1000377118676784179") } }, status: "open" },
] as const) test(name, () => {
  const result = classifyTokenizedEquityRound({ feed, round, registry, block, ...changes });
  expect(result.status).toBe(status);
  if (reason) expect(result).toMatchObject({ reason });
  if (result.status === "open" || result.status === "closed") {
    expect(result.price).toEqual({ atoms: (changes.round?.answer ?? round.answer).toString(), scale: 8 });
  }
  if (result.status === "paused") expect(result.lastPrice?.atoms ?? null).toBe(changes.round?.answer === BigInt(0) ? null : round.answer.toString());
  if (result.status === "paused" && changes.round?.updatedAt === BigInt(0)) expect(result.updatedAt).toBeNull();
});

const words = [
  encodeAbiParameters(parseAbiParameters("uint8"), [8]),
  encodeAbiParameters(parseAbiParameters("uint80, int256, uint256, uint256, uint80"), [BigInt(10), round.answer, BigInt(0), round.updatedAt, BigInt(10)]),
  encodeAbiParameters(parseAbiParameters("uint256, bool"), [registry.multiplier, false]),
];
type Rpc = NonNullable<Parameters<typeof readTokenizedEquityReferences>[1]["rpc"]>;
function mockRpc(result: unknown[] = [...words, ...words]) {
  let batches = 0;
  const tags: unknown[] = [];
  const rpc: Rpc = {
    request: async (method) => method === "eth_blockNumber" ? "0x7b" : { number: "0x7b", timestamp: `0x${thursday.toString(16)}` },
    batch: async (calls) => {
      batches++;
      for (const call of calls) tags.push(call.params[1]);
      return result;
    },
  };
  return { rpc, tags, get batches() { return batches; } };
}

test("one batch reads all assets at the requested block", async () => {
  const mock = mockRpc();
  const result = await readTokenizedEquityReferences([feed, other], { blockNumber: BigInt(123), rpc: mock.rpc });
  expect(mock.batches).toBe(1);
  expect(mock.tags).toEqual(Array(6).fill("0x7b"));
  expect(result.map(({ status }) => status)).toEqual(["open", "open"]);
  expect(result[0]).toMatchObject({ price: { atoms: round.answer.toString(), scale: 8 }, block: { number: "123", timestamp: new Date(thursday * 1000).toISOString() } });
});

for (const { name, result } of [
  { name: "per-call revert", result: [null, ...words.slice(1), ...words] },
  { name: "malformed return word", result: [words[0], "0xdead", words[2], ...words] },
]) test(name, async () => {
  const refs = await readTokenizedEquityReferences([feed, other], { blockNumber: BigInt(123), rpc: mockRpc(result).rpc });
  expect(refs.map(({ status }) => status)).toEqual(["unavailable", "open"]);
  expect(refs[0]).toMatchObject({ reason: "read-failed" });
});

for (const error of [new Error("transport"), new Error("timeout"), new DOMException("aborted", "AbortError")]) test(`batch failure ${error.message} returns all failures`, async () => {
  const rpc = { ...mockRpc().rpc, batch: async () => { throw error; } };
  const refs = await readTokenizedEquityReferences([feed, other], { blockNumber: BigInt(123), rpc });
  expect(refs).toEqual([feed, other].map(({ assetId }) => ({ assetId, status: "unavailable", reason: "read-failed", block: { number: "123", timestamp: new Date(thursday * 1000).toISOString() } })));
});

test("block fetch failure returns all failures without a block", async () => {
  const rpc = { ...mockRpc().rpc, request: async () => { throw new Error("timeout"); } };
  expect(await readTokenizedEquityReferences([feed], { blockNumber: BigInt(123), rpc })).toEqual([{ assetId: feed.assetId, status: "unavailable", reason: "read-failed", block: null }]);
});

test("abort signal is forwarded to the block and batch reads", async () => {
  const controller = new AbortController();
  const signals: (AbortSignal | undefined)[] = [];
  const original = mockRpc().rpc;
  const rpc: Rpc = {
    request: async (method, params, signal) => { signals.push(signal); return original.request(method, params, signal); },
    batch: async (calls, signal, allowPartial) => { signals.push(signal); return original.batch(calls, signal, allowPartial); },
  };
  expect((await readTokenizedEquityReferences([feed, other], { blockNumber: BigInt(123), rpc, signal: controller.signal })).map(({ status }) => status)).toEqual(["open", "open"]);
  expect(signals).toEqual([controller.signal, controller.signal]);
});

test("cached reader coalesces, expires, and does not retain all-failed batches", async () => {
  let now = 0;
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const good: TokenizedEquityReference[] = [{ assetId: feed.assetId, status: "open", price: { atoms: "100", scale: 8 }, updatedAt: new Date(thursday * 1000).toISOString(), roundId: "1", multiplierWad: "1000000000000000000", block: { number: "123", timestamp: new Date(thursday * 1000).toISOString() } }];
  const seen: (bigint | string)[] = [];
  const read: typeof readTokenizedEquityReferences = async (_feeds, opts) => { reads++; seen.push(opts.blockNumber); await gate; return reads === 3 ? [{ assetId: feed.assetId, status: "unavailable", reason: "read-failed", block: null }] : good; };
  const current = createTokenizedEquityReader({ read, rpc: mockRpc().rpc, now: () => now, ttlMs: 100 });
  const first = current([feed]);
  const concurrent = current([feed]);
  release();
  expect(await Promise.all([first, concurrent])).toEqual([good, good]);
  expect(reads).toBe(1);
  expect(await current([feed])).toEqual(good);
  expect(reads).toBe(1);
  now = 100;
  expect(await current([feed])).toEqual(good);
  expect(reads).toBe(1);
  now = 101;
  expect(await current([feed])).toEqual(good);
  expect(reads).toBe(2);
  now = 202;
  expect((await current([feed]))[0]?.status).toBe("unavailable");
  expect(await current([feed])).toEqual(good);
  expect(reads).toBe(4);
  expect(seen).toEqual(Array(4).fill(BigInt(123)));
});

test("cached reader fails closed at the in-flight cap without requesting another block", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  const rpc: Rpc = {
    ...mockRpc().rpc,
    request: async () => { requests++; return "0x7b"; },
  };
  const read: typeof readTokenizedEquityReferences = async (feeds) => {
    await gate;
    return feeds.map(({ assetId }) => ({ assetId, status: "unavailable", reason: "read-failed", block: null }));
  };
  const current = createTokenizedEquityReader({ read, rpc, now: () => 0 });
  expect(await current([])).toEqual([]);
  const pending = Array.from({ length: TOKENIZED_EQUITY_MAX_IN_FLIGHT }, (_, index) =>
    current([{ ...feed, assetId: `asset-${index}` }]));
  expect(await current([{ ...feed, assetId: "overloaded" }])).toEqual([
    { assetId: "overloaded", status: "unavailable", reason: "read-failed", block: null },
  ]);
  expect(requests).toBe(16);
  release();
  await Promise.all(pending);
  expect((await current([{ ...feed, assetId: "overloaded" }]))[0]?.status).toBe("unavailable");
  expect(requests).toBe(17);
});

test("cached reader bounds the latest-block read and the batch with one shared deadline", async () => {
  const signals: (AbortSignal | undefined)[] = [];
  const read: typeof readTokenizedEquityReferences = async (feeds, opts) => {
    signals.push(opts.signal);
    await new Promise<void>((resolve) => opts.signal?.addEventListener("abort", () => resolve(), { once: true }));
    return feeds.map(({ assetId }) => ({ assetId, status: "unavailable" as const, reason: "read-failed" as const, block: null }));
  };
  const current = createTokenizedEquityReader({ read, rpc: mockRpc().rpc, timeoutMs: 1 });
  expect((await current([feed]))[0]?.status).toBe("unavailable");
  expect(signals).toHaveLength(1);
  expect(signals[0]?.aborted).toBeTrue();
});

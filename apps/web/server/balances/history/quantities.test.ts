import { describe, expect, test } from "bun:test";
import { contractHistoryAsset, HISTORY_WETH_ADDRESS } from "./assets";
import { logQuantityAt, resolveBucketQuantities } from "./quantities";
import { deriveTracking } from "./tracking";
import type { BalanceCheckpoint, TrackingMethod } from "./types";

const start = BigInt(100);
const logSegment = [{ fromBlock: start, toBlock: null, method: "transfer-log" as const }];
const archiveSegment = [{ fromBlock: start, toBlock: null, method: "archive-read" as const }];

function quantity(input: {
  blocks: readonly bigint[];
  sums: readonly bigint[];
  anchor?: bigint | null;
  segments?: readonly { fromBlock: bigint; toBlock: bigint | null; method: TrackingMethod }[];
  reads?: ReadonlyMap<bigint, bigint>;
}) {
  return resolveBucketQuantities({
    segments: input.segments ?? logSegment,
    windowStartBlock: start,
    anchor: input.anchor === undefined ? BigInt(0) : input.anchor,
    bucketBlocks: input.blocks,
    cumulativeSums: input.sums,
    archiveReads: input.reads ?? new Map(),
  });
}

describe("resolveBucketQuantities", () => {
  test.each([
    {
      name: "USDC deposit",
      anchor: BigInt(0), blocks: [BigInt(100), BigInt(120), BigInt(140)], sums: [BigInt(0), BigInt(2_000_000), BigInt(2_000_000)],
      values: [BigInt(0), BigInt(2_000_000), BigInt(2_000_000)],
    },
    {
      name: "trade (USDC spent)",
      anchor: BigInt(10_000_000), blocks: [BigInt(120), BigInt(140)], sums: [BigInt(0), -BigInt(3_000_000)],
      values: [BigInt(10_000_000), BigInt(7_000_000)],
    },
    {
      name: "trade (cbBTC received)",
      anchor: BigInt(0), blocks: [BigInt(120), BigInt(140)], sums: [BigInt(0), BigInt(42_000)],
      values: [BigInt(0), BigInt(42_000)],
    },
    {
      name: "sold to zero stays ready",
      anchor: BigInt(42_000), blocks: [BigInt(120), BigInt(140), BigInt(160)], sums: [BigInt(0), -BigInt(42_000), -BigInt(42_000)],
      values: [BigInt(42_000), BigInt(0), BigInt(0)],
    },
    {
      name: "zero account stays ready",
      anchor: BigInt(0), blocks: [BigInt(100), BigInt(120), BigInt(140)], sums: [BigInt(0), BigInt(0), BigInt(0)],
      values: [BigInt(0), BigInt(0), BigInt(0)],
    },
  ])("$name uses anchor plus cumulative transfer deltas", ({ anchor, blocks, sums, values }) => {
    expect(quantity({ blocks, sums, anchor })).toEqual(blocks.map((blockNumber, index) => ({
      blockNumber, status: "ready", baseUnits: values[index],
    })));
  });

  test("WETH wrap ignores transfer logs and uses exact-block archive reads", () => {
    const weth = contractHistoryAsset(HISTORY_WETH_ADDRESS);
    const segments = deriveTracking({
      asset: weth, registry: true, nativeEverHeld: false, windowStartBlock: start,
      checkpoints: [], cumulativeChangeCounts: [],
    });
    expect(quantity({
      blocks: [BigInt(100), BigInt(120), BigInt(140)], sums: [BigInt(0), -BigInt(1), -BigInt(1)], anchor: BigInt(0), segments,
      reads: new Map([[BigInt(120), BigInt("1000000000000000000")], [BigInt(140), BigInt("1000000000000000000")]]),
    })).toEqual([
      { blockNumber: BigInt(100), status: "unavailable", reason: "pending-read" },
      { blockNumber: BigInt(120), status: "ready", baseUnits: BigInt("1000000000000000000") },
      { blockNumber: BigInt(140), status: "ready", baseUnits: BigInt("1000000000000000000") },
    ]);
  });

  test("unknown token promotion uses archive reads before and logs from its second match", () => {
    const asset = contractHistoryAsset("0x1111111111111111111111111111111111111111");
    const checkpoint = (blockNumber: bigint, chainQuantity: bigint, logQuantity: bigint | null): BalanceCheckpoint => ({
      asset, blockNumber, chainQuantity, logQuantity,
      purpose: blockNumber === start ? "window-start" : "reconcile", observedAt: new Date(0),
    });
    const segments = deriveTracking({
      asset, registry: false, nativeEverHeld: false, windowStartBlock: start,
      checkpoints: [checkpoint(start, BigInt(0), null), checkpoint(BigInt(140), BigInt(5), BigInt(5))],
      cumulativeChangeCounts: [0, 1],
    });
    expect(quantity({
      segments, blocks: [BigInt(120), BigInt(140), BigInt(160)], sums: [BigInt(0), BigInt(5), BigInt(7)], anchor: BigInt(0),
      reads: new Map([[BigInt(120), BigInt(0)]]),
    })).toEqual([
      { blockNumber: BigInt(120), status: "ready", baseUnits: BigInt(0) },
      { blockNumber: BigInt(140), status: "ready", baseUnits: BigInt(5) },
      { blockNumber: BigInt(160), status: "ready", baseUnits: BigInt(7) },
    ]);
  });

  test("mismatch demotes retroactively: earlier log buckets remain ready, later need reads", () => {
    const asset = contractHistoryAsset("0x1111111111111111111111111111111111111111");
    const checkpoint = (blockNumber: bigint, chainQuantity: bigint, logQuantity: bigint | null): BalanceCheckpoint => ({
      asset, blockNumber, chainQuantity, logQuantity,
      purpose: blockNumber === start ? "window-start" : "reconcile", observedAt: new Date(0),
    });
    const segments = deriveTracking({
      asset, registry: true, nativeEverHeld: false, windowStartBlock: start,
      checkpoints: [checkpoint(BigInt(180), BigInt(30), BigInt(20)), checkpoint(start, BigInt(0), null), checkpoint(BigInt(140), BigInt(10), BigInt(10))],
      cumulativeChangeCounts: [0, 1, 2],
    });
    expect(quantity({
      segments, blocks: [BigInt(120), BigInt(140), BigInt(160), BigInt(180)], sums: [BigInt(5), BigInt(10), BigInt(15), BigInt(20)], anchor: BigInt(0),
      reads: new Map([[BigInt(180), BigInt(30)]]),
    })).toEqual([
      { blockNumber: BigInt(120), status: "ready", baseUnits: BigInt(5) },
      { blockNumber: BigInt(140), status: "unavailable", reason: "pending-read" },
      { blockNumber: BigInt(160), status: "unavailable", reason: "pending-read" },
      { blockNumber: BigInt(180), status: "ready", baseUnits: BigInt(30) },
    ]);
  });

  test("pending comparison never exposes a log-derived ready bucket, but keeps its pinned chain read", () => {
    const asset = contractHistoryAsset("0x1111111111111111111111111111111111111111");
    const checkpoints: BalanceCheckpoint[] = [
      { asset, blockNumber: start, purpose: "window-start", chainQuantity: BigInt(0), logQuantity: null, observedAt: new Date(0) },
      { asset, blockNumber: BigInt(140), purpose: "reconcile", chainQuantity: BigInt(5), logQuantity: null, observedAt: new Date(0) },
    ];
    const segments = deriveTracking({ asset, registry: true, nativeEverHeld: false, windowStartBlock: start,
      checkpoints, cumulativeChangeCounts: [0, 1] });
    expect(segments).toEqual([{ fromBlock: start, toBlock: null, method: "archive-read" }]);
    expect(quantity({ segments, anchor: BigInt(0), blocks: [BigInt(120), BigInt(140), BigInt(160)],
      sums: [BigInt(0), BigInt(5), BigInt(7)], reads: new Map([[BigInt(140), BigInt(5)]]) })).toEqual([
      { blockNumber: BigInt(120), status: "unavailable", reason: "pending-read" },
      { blockNumber: BigInt(140), status: "ready", baseUnits: BigInt(5) },
      { blockNumber: BigInt(160), status: "unavailable", reason: "pending-read" },
    ]);
  });

  test.each([
    {
      name: "negative running balance", blocks: [BigInt(120), BigInt(140)], sums: [-BigInt(1), BigInt(0)], anchor: BigInt(0),
      expected: [
        { blockNumber: BigInt(120), status: "unavailable", reason: "mismatch" },
        { blockNumber: BigInt(140), status: "ready", baseUnits: BigInt(0) },
      ],
    },
    {
      name: "outside window and no anchor", blocks: [BigInt(99), BigInt(100)], sums: [BigInt(0), BigInt(0)], anchor: null,
      expected: [
        { blockNumber: BigInt(99), status: "outside-window" },
        { blockNumber: BigInt(100), status: "unavailable", reason: "pending-read" },
      ],
    },
  ])("$name is not silently valued as zero", ({ blocks, sums, anchor, expected }) => {
    expect(quantity({ blocks, sums, anchor })).toEqual([...expected]);
  });

  test.each(["archive-read", "position-index", "shares-rate", "unsupported"] as const)(
    "$method applies its quantity source", (method) => {
      const result = quantity({
        blocks: [BigInt(120)], sums: [BigInt(3)], anchor: BigInt(10),
        segments: [{ fromBlock: start, toBlock: null, method }], reads: new Map([[BigInt(120), BigInt(25)]]),
      });
      expect(result).toEqual([method === "unsupported"
        ? { blockNumber: BigInt(120), status: "unavailable", reason: "unsupported" }
        : { blockNumber: BigInt(120), status: "ready", baseUnits: method === "shares-rate" ? BigInt(13) : BigInt(25) }]);
    },
  );

  test("missing window anchor leaves even archive reads pending", () => {
    expect(quantity({
      blocks: [BigInt(120)], sums: [BigInt(0)], anchor: null, segments: archiveSegment, reads: new Map([[BigInt(120), BigInt(7)]]),
    })).toEqual([{ blockNumber: BigInt(120), status: "unavailable", reason: "pending-read" }]);
  });

  test("a bucket absent from its exact-block archive reads is pending", () => {
    expect(quantity({
      blocks: [BigInt(120)], sums: [BigInt(0)], segments: archiveSegment, reads: new Map([[BigInt(119), BigInt(7)]]),
    })).toEqual([{ blockNumber: BigInt(120), status: "unavailable", reason: "pending-read" }]);
  });

  test("validates aligned sums and segment coverage", () => {
    expect(() => quantity({ blocks: [BigInt(120)], sums: [] })).toThrow(RangeError);
    expect(() => quantity({ blocks: [BigInt(120)], sums: [BigInt(0)], segments: [] })).toThrow(RangeError);
  });

  test("logQuantityAt calculates signed reconciliation quantities without rounding", () => {
    expect(logQuantityAt(BigInt(2) ** BigInt(100), -BigInt(3))).toBe(BigInt(2) ** BigInt(100) - BigInt(3));
  });
});

import { describe, expect, test } from "bun:test";
import { erc20AssetKey } from "@/shared/balances/types";
import { contractHistoryAsset, HISTORY_WETH_ADDRESS, morphoHistoryAssets, nativeHistoryAsset } from "./assets";
import { deriveTracking } from "./tracking";
import type { BalanceCheckpoint, HistoryAsset, TrackingMethod } from "./types";

const start = BigInt(100);
const unknown = contractHistoryAsset("0x1111111111111111111111111111111111111111");
const vaultAddress = "0x2222222222222222222222222222222222222222" as const;
const vault: HistoryAsset = {
  key: erc20AssetKey(vaultAddress), kind: "vault-share", contractAddress: vaultAddress, marketId: null,
};
const weth = contractHistoryAsset(HISTORY_WETH_ADDRESS);
const stock = contractHistoryAsset("0xb200000000000000000000000000000000000001");
const [collateral, borrow] = morphoHistoryAssets(`0x${"3".repeat(64)}`);

type Row = readonly [bigint, bigint, bigint | null, number];
type Segment = { fromBlock: bigint; toBlock: bigint | null; method: TrackingMethod };

function checkpoints(asset: HistoryAsset, rows: readonly Row[]): BalanceCheckpoint[] {
  return rows.map(([blockNumber, chainQuantity, logQuantity]) => ({
    asset,
    blockNumber,
    chainQuantity,
    logQuantity,
    purpose: blockNumber === start ? "window-start" : "reconcile",
    observedAt: new Date(0),
  }));
}

function tracking(asset: HistoryAsset, rows: readonly Row[], registry = false, nativeEverHeld = false): Segment[] {
  return deriveTracking({
    asset,
    registry,
    nativeEverHeld,
    windowStartBlock: start,
    checkpoints: checkpoints(asset, rows),
    cumulativeChangeCounts: [...rows].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      .map((row) => row[3]),
  });
}

const windowZero: Row = [start, BigInt(0), null, 0];

describe("deriveTracking", () => {
  test.each([
    { name: "WETH override even when registered", asset: weth, registry: true, method: "archive-read" },
    { name: "B20 stock override", asset: stock, registry: true, method: "archive-read" },
    { name: "Morpho collateral", asset: collateral, registry: false, method: "position-index" },
    { name: "Morpho borrow shares", asset: borrow, registry: false, method: "position-index" },
    { name: "registered ERC-20 without a comparison", asset: unknown, registry: true, method: "archive-read" },
    { name: "vault shares without a comparison", asset: vault, registry: false, method: "archive-read" },
    { name: "unknown ERC-20", asset: unknown, registry: false, method: "archive-read" },
    { name: "zero native ETH", asset: nativeHistoryAsset(), registry: false, method: "transfer-log" },
  ] as const)("$name starts with $method", ({ asset, registry, method }) => {
    expect(tracking(asset, [windowZero], registry)).toEqual([
      { fromBlock: start, toBlock: null, method },
    ]);
  });

  test("a log method is trusted from the window start only after a successful comparison", () => {
    expect(tracking(unknown, [windowZero, [BigInt(140), BigInt(10), BigInt(10), 1]], true)).toEqual([
      { fromBlock: start, toBlock: null, method: "transfer-log" },
    ]);
    expect(tracking(vault, [windowZero, [BigInt(140), BigInt(10), BigInt(10), 1]])).toEqual([
      { fromBlock: start, toBlock: null, method: "shares-rate" },
    ]);
    expect(tracking(unknown, [windowZero, [BigInt(140), BigInt(10), null, 1]], true)).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
  });

  test("unknown token promotes from second match with activity, regardless of checkpoint input order", () => {
    expect(tracking(unknown, [
      [BigInt(160), BigInt(5), BigInt(5), 1],
      windowZero,
      [BigInt(140), BigInt(0), BigInt(0), 0],
    ])).toEqual([
      { fromBlock: start, toBlock: BigInt(160), method: "archive-read" },
      { fromBlock: BigInt(160), toBlock: null, method: "transfer-log" },
    ]);
  });

  test("unknown token without a window checkpoint needs two observed matches with activity", () => {
    expect(tracking(unknown, [[BigInt(130), BigInt(0), BigInt(0), 0], [BigInt(160), BigInt(5), BigInt(5), 1]])).toEqual([
      { fromBlock: start, toBlock: BigInt(160), method: "archive-read" },
      { fromBlock: BigInt(160), toBlock: null, method: "transfer-log" },
    ]);
  });

  test.each([
    { name: "no new changes", rows: [windowZero, [BigInt(130), BigInt(0), BigInt(0), 0], [BigInt(160), BigInt(0), BigInt(0), 0]] },
    { name: "only one match after window mismatch", rows: [windowZero, [BigInt(130), BigInt(4), BigInt(0), 1], [BigInt(160), BigInt(5), BigInt(5), 2]] },
  ] as const)("does not promote with $name", ({ rows }) => {
    expect(tracking(unknown, rows)).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
  });

  test.each([
    { name: "registered ERC-20", asset: unknown, registry: true, method: "transfer-log" },
    { name: "vault shares", asset: vault, registry: false, method: "shares-rate" },
  ] as const)("$name demotes from last match and re-promotes after two NEW matches", ({ asset, registry, method }) => {
    expect(tracking(asset, [
      windowZero,
      [BigInt(140), BigInt(10), BigInt(10), 1],
      [BigInt(180), BigInt(30), BigInt(20), 2],
      [BigInt(200), BigInt(25), BigInt(25), 3],
      [BigInt(220), BigInt(25), BigInt(25), 3],
      [BigInt(240), BigInt(35), BigInt(35), 4],
    ], registry)).toEqual([
      { fromBlock: start, toBlock: BigInt(140), method },
      { fromBlock: BigInt(140), toBlock: BigInt(240), method: "archive-read" },
      { fromBlock: BigInt(240), toBlock: null, method },
    ]);
  });

  test("mismatch erases a previous unknown-token promotion from its last matching checkpoint", () => {
    expect(tracking(unknown, [
      windowZero,
      [BigInt(140), BigInt(10), BigInt(10), 1],
      [BigInt(180), BigInt(30), BigInt(20), 2],
      [BigInt(200), BigInt(25), BigInt(25), 3],
      [BigInt(240), BigInt(35), BigInt(35), 4],
    ])).toEqual([
      { fromBlock: start, toBlock: BigInt(240), method: "archive-read" },
      { fromBlock: BigInt(240), toBlock: null, method: "transfer-log" },
    ]);
  });

  test("pending reconcile comparisons block promotion and every trusted log segment", () => {
    expect(tracking(unknown, [windowZero, [BigInt(140), BigInt(10), BigInt(10), 1],
      [BigInt(180), BigInt(20), null, 2], [BigInt(220), BigInt(25), BigInt(25), 3]])).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
    expect(tracking(unknown, [windowZero, [BigInt(140), BigInt(10), BigInt(10), 1],
      [BigInt(180), BigInt(20), null, 2]], true)).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
    expect(tracking(vault, [windowZero, [BigInt(140), BigInt(10), null, 1]])).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
  });

  test("a negative checkpoint log value demotes to archive-read", () => {
    expect(tracking(unknown, [windowZero, [BigInt(140), BigInt(10), BigInt(10), 1], [BigInt(180), BigInt(0), -BigInt(2), 2]])).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
  });

  test("native ETH uses archive reads for the whole window after any positive checkpoint", () => {
    expect(tracking(nativeHistoryAsset(), [windowZero, [BigInt(140), BigInt(0), null, 0], [BigInt(180), BigInt(7), null, 0]])).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
    expect(tracking(nativeHistoryAsset(), [windowZero, [BigInt(180), BigInt(7), null, 0]])).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
    expect(tracking(nativeHistoryAsset(), [[start, BigInt(1), null, 0]])).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
    expect(tracking(nativeHistoryAsset(), [windowZero, [BigInt(140), BigInt(0), null, 0], [BigInt(180), BigInt(0), null, 0]])).toEqual([
      { fromBlock: start, toBlock: null, method: "transfer-log" },
    ]);
  });

  test("native ETH held in the snapshot uses archive reads even when every checkpoint is zero", () => {
    expect(tracking(nativeHistoryAsset(), [windowZero, [BigInt(140), BigInt(0), null, 0],
      [BigInt(180), BigInt(0), null, 0]], false, true)).toEqual([
      { fromBlock: start, toBlock: null, method: "archive-read" },
    ]);
  });

  test("rejects misaligned cumulative change counts", () => {
    expect(() => deriveTracking({
      asset: unknown, registry: false, nativeEverHeld: false, windowStartBlock: start,
      checkpoints: checkpoints(unknown, [windowZero]), cumulativeChangeCounts: [],
    })).toThrow(RangeError);
  });
});

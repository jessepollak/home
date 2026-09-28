import "server-only";

import { isStaticArchiveRead } from "./assets";
import type { BalanceCheckpoint, HistoryAsset, TrackingMethod } from "./types";

export type TrackingSegment = {
  fromBlock: bigint;
  toBlock: bigint | null;
  method: TrackingMethod;
};

export function deriveTracking(input: {
  asset: HistoryAsset;
  registry: boolean;
  nativeEverHeld: boolean;
  windowStartBlock: bigint;
  checkpoints: readonly BalanceCheckpoint[];
  cumulativeChangeCounts: readonly number[];
}): TrackingSegment[] {
  const { asset, windowStartBlock } = input;
  const checkpoints = [...input.checkpoints].sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0
  );
  if (checkpoints.length !== input.cumulativeChangeCounts.length) {
    throw new RangeError("Every checkpoint needs a cumulative change count");
  }
  if (asset.kind === "native") return [{ fromBlock: windowStartBlock, toBlock: null,
    method: input.nativeEverHeld || checkpoints.some((point) => point.chainQuantity > BigInt(0)) ? "archive-read" : "transfer-log" }];

  const logMethod: TrackingMethod | null = input.registry && asset.kind === "erc20"
    ? "transfer-log"
    : asset.kind === "vault-share"
      ? "shares-rate"
      : null;
  const hasComparison = checkpoints.some((point) => point.blockNumber > windowStartBlock &&
    point.purpose === "reconcile" && point.logQuantity !== null);
  const startingMethod: TrackingMethod = isStaticArchiveRead(asset)
    ? "archive-read"
    : asset.kind === "morpho-collateral" || asset.kind === "morpho-borrow-shares"
      ? "position-index"
      : logMethod !== null && hasComparison
        ? logMethod
        : "archive-read";
  const segments: TrackingSegment[] = [{ fromBlock: windowStartBlock, toBlock: null, method: startingMethod }];
  if (isStaticArchiveRead(asset) || asset.kind.startsWith("morpho-")) return segments;
  if (checkpoints.some((point) => point.purpose === "reconcile" && point.logQuantity === null)) {
    return [{ fromBlock: windowStartBlock, toBlock: null, method: "archive-read" }];
  }

  let lastMatch: bigint | null = null;
  let candidate: { block: bigint; count: number } | null = null;
  for (const [index, checkpoint] of checkpoints.entries()) {
    const block = checkpoint.blockNumber;
    if (block < windowStartBlock) continue;
    const count = input.cumulativeChangeCounts[index];

    if (block === windowStartBlock) {
      lastMatch = block;
      candidate = { block, count };
      continue;
    }
    if (checkpoint.logQuantity === null) continue;
    if (checkpoint.logQuantity < BigInt(0) || checkpoint.chainQuantity !== checkpoint.logQuantity) {
      if (isLogMethod(segments.at(-1)!.method)) {
        transition(segments, lastMatch ?? windowStartBlock, "archive-read");
      }
      candidate = null;
      continue;
    }

    lastMatch = block;
    if (!isLogMethod(segments.at(-1)!.method)) {
      if (candidate !== null && count > candidate.count) {
        transition(segments, block, asset.kind === "vault-share" ? "shares-rate" : "transfer-log");
      } else if (candidate === null) {
        candidate = { block, count };
      }
    }
  }
  return segments;
}

function isLogMethod(method: TrackingMethod): boolean {
  return method === "transfer-log" || method === "shares-rate";
}

function transition(segments: TrackingSegment[], block: bigint, method: TrackingMethod): void {
  while (segments.length > 1 && segments.at(-1)!.fromBlock >= block) segments.pop();
  const previous = segments.at(-1)!;
  if (previous.method === method) {
    previous.toBlock = null;
    return;
  }
  if (previous.fromBlock === block) {
    previous.method = method;
    previous.toBlock = null;
    return;
  }
  previous.toBlock = block;
  segments.push({ fromBlock: block, toBlock: null, method });
}

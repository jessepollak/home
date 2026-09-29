import "server-only";

import type { TrackingSegment } from "./tracking";

type BucketQuantity = { blockNumber: bigint } & (
  | { status: "ready"; baseUnits: bigint }
  | { status: "unavailable"; reason: "pending-read" | "mismatch" | "unsupported" }
  | { status: "outside-window" }
);

export function logQuantityAt(anchor: bigint, cumulative: bigint): bigint {
  return anchor + cumulative;
}

export function resolveBucketQuantities(input: {
  segments: readonly TrackingSegment[];
  windowStartBlock: bigint;
  anchor: bigint | null;
  bucketBlocks: readonly bigint[];
  cumulativeSums: readonly bigint[];
  archiveReads: ReadonlyMap<bigint, bigint>;
}): BucketQuantity[] {
  if (input.bucketBlocks.length !== input.cumulativeSums.length) {
    throw new RangeError("Every bucket needs a cumulative change sum");
  }

  const quantities: BucketQuantity[] = [];
  let segmentIndex = 0;
  for (const [index, blockNumber] of input.bucketBlocks.entries()) {
    if (blockNumber < input.windowStartBlock) {
      quantities.push({ blockNumber, status: "outside-window" });
      continue;
    }
    while (input.segments[segmentIndex]?.toBlock !== null &&
      input.segments[segmentIndex]?.toBlock !== undefined &&
      input.segments[segmentIndex]!.toBlock! <= blockNumber) {
      segmentIndex++;
    }
    const segment = input.segments[segmentIndex];
    if (!segment || blockNumber < segment.fromBlock) {
      throw new RangeError("Tracking segments do not cover the bucket block");
    }
    if (input.anchor === null) {
      quantities.push({ blockNumber, status: "unavailable", reason: "pending-read" });
      continue;
    }
    if (segment.method === "unsupported") {
      quantities.push({ blockNumber, status: "unavailable", reason: "unsupported" });
      continue;
    }
    if (segment.method === "archive-read" || segment.method === "position-index") {
      const read = input.archiveReads.get(blockNumber);
      quantities.push(read === undefined
        ? { blockNumber, status: "unavailable", reason: "pending-read" }
        : { blockNumber, status: "ready", baseUnits: read });
      continue;
    }
    const baseUnits = logQuantityAt(input.anchor, input.cumulativeSums[index]);
    quantities.push(baseUnits < BigInt(0)
      ? { blockNumber, status: "unavailable", reason: "mismatch" }
      : { blockNumber, status: "ready", baseUnits });
  }
  return quantities;
}

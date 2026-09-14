import "server-only";

import { beforeEach, describe, expect, test } from "bun:test";
import type { BalanceObservation, BalanceSnapshotStore } from "./snapshot-store";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

export function balanceSnapshotStoreContract(options: {
  name: string;
  createStore: () => BalanceSnapshotStore;
  reset: () => Promise<void> | void;
}) {
  describe(`${options.name} BalanceSnapshotStore contract`, () => {
    let store: BalanceSnapshotStore;
    beforeEach(async () => {
      await options.reset();
      store = options.createStore();
    });

    test("newer observations never lose to older blocks", async () => {
      expect(await store.putObservation(observation("10", "2026-09-13T12:00:10.000Z"))).toBeTrue();
      expect(await store.putObservation(observation("12", "2026-09-13T12:00:12.000Z"))).toBeTrue();
      expect(await store.putObservation(observation("11", "2026-09-13T12:00:30.000Z"))).toBeFalse();
      expect(await store.get(8453, ADDRESS)).toMatchObject({
        blockNumber: "12",
        observedAt: "2026-09-13T12:00:12.000Z",
      });
    });

    test("enumeration cursor round-trips and a completed scan clears it", async () => {
      await store.putObservation({
        ...observation("10", "2026-09-13T12:00:10.000Z"),
        enumerationCursor: "page-two",
      });
      expect((await store.get(8453, ADDRESS))?.enumerationCursor).toBe("page-two");
      await store.putObservation({
        ...observation("10", "2026-09-13T12:00:11.000Z"),
        enumerationCursor: null,
      });
      expect((await store.get(8453, ADDRESS))?.enumerationCursor).toBeNull();
    });

    test("equal-block observations may replace enrichment without clearing signals", async () => {
      await store.putObservation(observation("10", "2026-09-13T12:00:10.000Z"));
      await store.markStale(8453, ADDRESS, new Date("2026-09-13T12:00:11.000Z"));
      await store.markHot(8453, ADDRESS, new Date("2026-09-13T12:01:10.000Z"));
      expect(await store.putObservation({
        ...observation("10", "2026-09-13T12:00:12.000Z"),
        coverage: { registry: "partial", catalog: "incomplete" },
      })).toBeTrue();
      expect(await store.get(8453, ADDRESS)).toMatchObject({
        staleAt: "2026-09-13T12:00:11.000Z",
        hotUntil: "2026-09-13T12:01:10.000Z",
        coverage: { registry: "partial", catalog: "incomplete" },
      });
    });

    test("preserves milliseconds so a same-second stale mark remains signaled", async () => {
      await store.putObservation(observation("10", "2026-09-13T12:00:10.000Z"));
      await store.markStale(8453, ADDRESS, new Date("2026-09-13T12:00:10.500Z"));
      expect(await store.get(8453, ADDRESS)).toMatchObject({
        observedAt: "2026-09-13T12:00:10.000Z",
        staleAt: "2026-09-13T12:00:10.500Z",
      });
    });

    test("signal writers touch only their column", async () => {
      await store.putObservation(observation("10", "2026-09-13T12:00:10.000Z"));
      const original = (await store.get(8453, ADDRESS))!;
      await store.markStale(8453, ADDRESS, new Date("2026-09-13T12:00:20.000Z"));
      const stale = (await store.get(8453, ADDRESS))!;
      expect(stale).toEqual({ ...original, staleAt: "2026-09-13T12:00:20.000Z" });
      await store.markHot(8453, ADDRESS, new Date("2026-09-13T12:01:20.000Z"));
      expect(await store.get(8453, ADDRESS)).toEqual({
        ...stale,
        hotUntil: "2026-09-13T12:01:20.000Z",
      });
    });

    test("marks multiple addresses stale in one store operation", async () => {
      await store.putObservation(observation("10", "2026-09-13T12:00:10.000Z"));
      await store.putObservation({
        ...observation("10", "2026-09-13T12:00:10.000Z"),
        address: OTHER,
      });
      await store.markStaleMany(8453, [ADDRESS, OTHER], new Date("2026-09-13T12:00:20.000Z"));
      expect((await store.get(8453, ADDRESS))?.staleAt).toBe("2026-09-13T12:00:20.000Z");
      expect((await store.get(8453, OTHER))?.staleAt).toBe("2026-09-13T12:00:20.000Z");
    });

    test("signals no-op when no observation row exists", async () => {
      await store.markStale(8453, OTHER, new Date("2026-09-13T12:00:20.000Z"));
      await store.markHot(8453, OTHER, new Date("2026-09-13T12:01:20.000Z"));
      expect(await store.get(8453, OTHER)).toBeNull();
    });
  });
}

function observation(blockNumber: string, observedAt: string): BalanceObservation {
  return {
    chainId: 8453,
    address: ADDRESS,
    blockNumber,
    blockHash: `0x${blockNumber.padStart(64, "0")}`,
    blockTimestamp: blockNumber,
    observedAt,
    enumerationCursor: null,
    holdings: [],
    coverage: { registry: "complete", catalog: "complete" },
  };
}

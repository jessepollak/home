import "server-only";

import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { SqlQueryOptions } from "@/server/db/sql";
import type { OperatorSettingsStore } from "@/server/operator-settings/store";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import { readFundingOffering } from "./offering";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function stalledStore() {
  const reads: SqlQueryOptions[] = [];
  const store: Pick<OperatorSettingsStore, "read"> = {
    read: (_domain, options = {}) => {
      reads.push(options);
      return new Promise<SettingsEntry>(() => {});
    },
  };
  return { store, reads };
}

const suppliedDeadlines: ReadonlyArray<readonly [number, number]> = [
  [-1, 1],
  [0, 1],
  [NaN, 1],
  [Infinity, 1],
  [-Infinity, 1],
  [20.5, 20],
  [45_000, 45_000],
  [2_147_483_647.5, 1],
  [2_147_483_648, 1],
];

describe("funding settings read failures", () => {
  test("rejects a stalled store at the supplied deadline and aborts its signal", async () => {
    const { store, reads } = stalledStore();
    let settled = false;
    const result = readFundingOffering({ store, providers: [], env: {}, timeoutMs: 20 })
      .finally(() => { settled = true; });
    const failure = result.catch((error: unknown) => error);

    expect(reads[0]?.timeoutMs).toBe(20);
    expect(reads[0]?.signal?.aborted).toBe(false);
    jest.advanceTimersByTime(19);
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    expect(await failure).toMatchObject({ message: "Funding settings read timed out" });
    expect(reads[0]?.signal?.aborted).toBe(true);
  });

  for (const [timeoutMs, expiresAfterMs] of suppliedDeadlines) {
    test(`preserves a supplied ${timeoutMs} timeout as a ${expiresAfterMs} ms deadline`, async () => {
      const { store, reads } = stalledStore();
      let settled = false;
      const result = readFundingOffering({ store, providers: [], env: {}, timeoutMs })
        .finally(() => { settled = true; });
      const failure = result.catch((error: unknown) => error);

      expect(reads[0]?.timeoutMs).toBe(timeoutMs);
      expect(settled).toBe(false);
      if (expiresAfterMs > 1) {
        jest.advanceTimersByTime(expiresAfterMs - 1);
        await Promise.resolve();
        expect(settled).toBe(false);
      }
      jest.advanceTimersByTime(expiresAfterMs > 0 ? 1 : 0);
      expect(reads[0]?.signal?.aborted).toBe(true);
      expect(await failure).toMatchObject({ message: "Funding settings read timed out" });
    });
  }

  test("bounds a stalled store with the default timeout and an abort signal", async () => {
    const { store, reads } = stalledStore();
    const failure = readFundingOffering({ store, providers: [], env: {} }).catch((error: unknown) => error);

    const timeoutMs = reads[0]?.timeoutMs ?? 0;
    expect(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5_000).toBe(true);
    expect(reads[0]?.signal?.aborted).toBe(false);
    jest.advanceTimersByTime(timeoutMs);
    expect(await failure).toMatchObject({ message: "Funding settings read timed out" });
    expect(reads[0]?.signal?.aborted).toBe(true);
  });

  test("rejects an already-aborted parent without waiting or reading the store", async () => {
    const { store, reads } = stalledStore();
    const controller = new AbortController();
    const reason = new Error("Funding request cancelled");
    controller.abort(reason);

    await expect(readFundingOffering({ store, providers: [], env: {}, signal: controller.signal, timeoutMs: 20 }))
      .rejects.toBe(reason);
    expect(reads).toHaveLength(0);
  });

  test("parent cancellation rejects a stalled store immediately and aborts its signal", async () => {
    const { store, reads } = stalledStore();
    const controller = new AbortController();
    const reason = new Error("Funding request cancelled");
    const failure = readFundingOffering({ store, providers: [], env: {}, signal: controller.signal, timeoutMs: 20 })
      .catch((error: unknown) => error);

    controller.abort(reason);
    expect(await failure).toBe(reason);
    expect(reads[0]?.signal?.aborted).toBe(true);
    expect(reads[0]?.signal?.reason).toBe(reason);
  });
});

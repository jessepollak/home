import "server-only";

import { describe, expect, jest, test } from "bun:test";
import type { SqlExecutor } from "@/server/db/sql";
import { REGION_SETTINGS_DEFAULTS, REGIONS_SETTINGS_DOMAIN } from "@/shared/operator-settings/regions";
import { OperatorSettingsStore } from "./store";
import { createRegionPolicyReader, readRegionOfferForRender, readRegionSettingsForPage, REGION_POLICY_TTL_MS, RegionPolicyUnavailableError } from "./regions";

function reader(initial: () => Promise<{ value: { offered: ("BR" | "GB")[]; defaultRegion: "BR" | "GLOBAL" }; source: "stored" } | null>) {
  let time = 0;
  let reads = 0;
  let read = initial;
  const policy = createRegionPolicyReader({ read: () => { reads++; return read(); }, now: () => time });
  return { policy, reads: () => reads, advance(ms: number) { time += ms; }, setRead(next: typeof initial) { read = next; } };
}

describe("region policy reader", () => {
  test("uses code defaults without a saved row", async () => {
    const entry = reader(async () => null);
    expect(await entry.policy.read()).toEqual({ status: "ready", offered: REGION_SETTINGS_DEFAULTS.offered, defaultRegion: "US", source: "default" });
    expect(await entry.policy.isOffered("US")).toBe(true);
  });

  test("a saved row wins over defaults", async () => {
    const entry = reader(async () => ({ value: { offered: ["BR"], defaultRegion: "BR" }, source: "stored" }));
    expect(await entry.policy.isOffered("BR")).toBe(true);
    expect(await entry.policy.isOffered("US")).toBe(false);
  });

  test("caches presentation for a few seconds and refreshes after the window or an invalidation", async () => {
    const entry = reader(async () => ({ value: { offered: ["BR"], defaultRegion: "BR" }, source: "stored" }));
    await entry.policy.read();
    await entry.policy.read();
    expect(entry.reads()).toBe(1);
    entry.setRead(async () => ({ value: { offered: ["GB"], defaultRegion: "GLOBAL" }, source: "stored" }));
    entry.advance(REGION_POLICY_TTL_MS - 1);
    expect(await entry.policy.read()).toMatchObject({ status: "ready", offered: ["BR"] });
    entry.advance(1);
    expect(await entry.policy.read()).toMatchObject({ status: "ready", offered: ["GB"] });
    entry.setRead(async () => ({ value: { offered: ["BR"], defaultRegion: "BR" }, source: "stored" }));
    entry.policy.invalidate();
    expect(await entry.policy.read()).toMatchObject({ status: "ready", offered: ["BR"] });
    expect(entry.reads()).toBe(3);
  });

  test("authorization reads the current offer without waiting for the cache window", async () => {
    const entry = reader(async () => ({ value: { offered: ["BR"], defaultRegion: "BR" }, source: "stored" }));
    expect(await entry.policy.isOffered("BR")).toBe(true);
    expect(await entry.policy.read()).toMatchObject({ status: "ready", offered: ["BR"] });
    entry.setRead(async () => ({ value: { offered: ["GB"], defaultRegion: "GLOBAL" }, source: "stored" }));
    expect(await entry.policy.isOffered("BR")).toBe(false);
    expect(await entry.policy.isOffered("GB")).toBe(true);
    expect(entry.reads()).toBe(3);
  });

  test("presentation keeps its cached offer while authorization reads current settings", async () => {
    const entry = reader(async () => ({ value: { offered: ["BR"], defaultRegion: "BR" }, source: "stored" }));
    expect(await entry.policy.read()).toMatchObject({ status: "ready", offered: ["BR"] });
    entry.setRead(async () => ({ value: { offered: ["GB"], defaultRegion: "GLOBAL" }, source: "stored" }));
    expect(await entry.policy.read()).toMatchObject({ status: "ready", offered: ["BR"] });
    expect(await entry.policy.isOffered("BR")).toBe(false);
    expect(entry.reads()).toBe(2);
  });

  test("a failed authorization read never falls back to a cached offer", async () => {
    const entry = reader(async () => ({ value: { offered: ["BR"], defaultRegion: "BR" }, source: "stored" }));
    expect(await entry.policy.isOffered("BR")).toBe(true);
    entry.setRead(async () => { throw new Error("database unavailable"); });
    await expect(entry.policy.isOffered("BR")).rejects.toBeInstanceOf(RegionPolicyUnavailableError);
  });

  test("authorization reuses an unavailable result until it expires instead of retrying every call", async () => {
    const entry = reader(async () => { throw new Error("database unavailable"); });
    await expect(entry.policy.isOffered("US")).rejects.toBeInstanceOf(RegionPolicyUnavailableError);
    const reads = entry.reads();
    await expect(entry.policy.isOffered("US")).rejects.toBeInstanceOf(RegionPolicyUnavailableError);
    expect(entry.reads()).toBe(reads);
    entry.setRead(async () => null);
    entry.advance(1_000);
    expect(await entry.policy.isOffered("US")).toBe(true);
  });

  test("authorization never joins a read that started before the request", async () => {
    const releases: ((value: { value: { offered: ("BR" | "GB")[]; defaultRegion: "BR" | "GLOBAL" }; source: "stored" }) => void)[] = [];
    const entry = reader(() => new Promise((resolve) => { releases.push(resolve); }));
    const presentation = entry.policy.read();
    const authorization = entry.policy.isOffered("BR");
    expect(entry.reads()).toBe(2);
    releases[1]({ value: { offered: ["GB"], defaultRegion: "GLOBAL" }, source: "stored" });
    releases[0]({ value: { offered: ["BR"], defaultRegion: "BR" }, source: "stored" });
    expect(await authorization).toBe(false);
    expect(await presentation).toMatchObject({ status: "ready", offered: ["BR"] });
    expect(await entry.policy.read()).toMatchObject({ status: "ready", offered: ["GB"] });
  });

  test("shares one in-flight read between concurrent callers", async () => {
    let release: (value: null) => void = () => {};
    const entry = reader(() => new Promise((resolve) => { release = resolve; }));
    const both = Promise.all([entry.policy.read(), entry.policy.read()]);
    release(null);
    await both;
    expect(entry.reads()).toBe(1);
  });

  test("aborts a timed-out authorization read and starts fresh for the next caller", async () => {
    jest.useFakeTimers();
    try {
      let time = 0;
      const signals: AbortSignal[] = [];
      let reads = 0;
      const policy = createRegionPolicyReader({
        read: ({ signal }) => {
          reads++;
          signals.push(signal!);
          return new Promise((_resolve, reject) => { signal!.addEventListener("abort", () => reject(signal!.reason)); });
        },
        deadlineMs: 1,
        now: () => time,
      });
      const first = policy.isOffered("US");
      void jest.advanceTimersByTime(1);
      await expect(first).rejects.toBeInstanceOf(RegionPolicyUnavailableError);
      expect(signals[0]!.aborted).toBe(true);
      time += 2_000;
      const second = policy.isOffered("US");
      void jest.advanceTimersByTime(1);
      await expect(second).rejects.toBeInstanceOf(RegionPolicyUnavailableError);
      expect(reads).toBe(2);
      expect(signals[1]!.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("does not cache a read that started before an invalidation", async () => {
    let release: (value: { value: { offered: ("BR" | "GB")[]; defaultRegion: "BR" | "GLOBAL" }; source: "stored" }) => void = () => {};
    const entry = reader(() => new Promise((resolve) => { release = resolve; }));
    const stale = entry.policy.read();
    entry.policy.invalidate();
    entry.setRead(async () => ({ value: { offered: ["GB"], defaultRegion: "GLOBAL" }, source: "stored" }));
    release({ value: { offered: ["BR"], defaultRegion: "BR" }, source: "stored" });
    await stale;
    expect(await entry.policy.isOffered("GB")).toBe(true);
  });

  test("reports unavailable settings instead of treating them as all or none offered", async () => {
    const entry = reader(async () => { throw new Error("database unavailable"); });
    expect(await entry.policy.read()).toEqual({ status: "unavailable" });
    await expect(entry.policy.isOffered("US")).rejects.toBeInstanceOf(RegionPolicyUnavailableError);
    entry.setRead(async () => null);
    entry.advance(1_000);
    expect(await entry.policy.isOffered("US")).toBe(true);
  });

  test("treats a read that never settles as unavailable after the deadline", async () => {
    jest.useFakeTimers();
    try {
      const policy = createRegionPolicyReader({ read: () => new Promise(() => {}), deadlineMs: 1 });
      const pending = policy.read();
      void jest.advanceTimersByTime(1);
      expect(await pending).toEqual({ status: "unavailable" });
      await expect(policy.isOffered("US")).rejects.toBeInstanceOf(RegionPolicyUnavailableError);
    } finally {
      jest.useRealTimers();
    }
  });

  test("puts the deadline on the underlying read", async () => {
    const seen: number[] = [];
    const policy = createRegionPolicyReader({ read: async ({ timeoutMs }) => { seen.push(timeoutMs); return null; }, deadlineMs: 321 });
    await policy.read();
    expect(seen).toEqual([321]);
  });

  test("does not start another read while a timed-out read is still running", async () => {
    jest.useFakeTimers();
    try {
      let time = 0;
      let reads = 0;
      let release: (value: null) => void = () => {};
      const policy = createRegionPolicyReader({
        read: () => { reads++; return reads === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(null); },
        deadlineMs: 1,
        now: () => time,
      });
      const first = policy.read();
      void jest.advanceTimersByTime(1);
      expect(await first).toEqual({ status: "unavailable" });
      time += 1_000;
      const second = policy.read();
      void jest.advanceTimersByTime(1);
      expect(await second).toEqual({ status: "unavailable" });
      expect(reads).toBe(1);
      release(null);
      await Promise.resolve();
      time += 1_000;
      expect(await policy.read()).toMatchObject({ status: "ready", source: "default" });
      expect(reads).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("the settings store passes the query deadline to the SQL executor", async () => {
    const options: unknown[] = [];
    const sql: SqlExecutor = {
      async query<T>(_text: string, _values?: unknown[], queryOptions?: unknown) { options.push(queryOptions); return { rows: [] as T[], rowCount: 0 }; },
      transaction: async () => { throw new Error("unused"); },
    };
    await new OperatorSettingsStore(sql).read(REGIONS_SETTINGS_DOMAIN, { timeoutMs: 750 });
    expect(options).toEqual([{ timeoutMs: 750 }]);
  });

  test("the admin settings page read carries a bounded deadline", async () => {
    const options: unknown[] = [];
    const sql: SqlExecutor = {
      async query<T>(_text: string, _values?: unknown[], queryOptions?: unknown) { options.push(queryOptions); return { rows: [] as T[], rowCount: 0 }; },
      transaction: async () => { throw new Error("unused"); },
    };
    const entry = await readRegionSettingsForPage(sql);
    expect(entry.settings.source).toBe("default");
    const timeoutMs = (options[0] as { timeoutMs: number }).timeoutMs;
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(5_000);
  });

  test("the admin settings page read times out on a stalled executor", async () => {
    const sql: SqlExecutor = {
      query: () => new Promise(() => {}),
      transaction: async () => { throw new Error("unused"); },
    };
    await expect(readRegionSettingsForPage(sql, 1)).rejects.toBeInstanceOf(RegionPolicyUnavailableError);
  });

  test("render offer falls back to the global presentation when settings are unavailable", async () => {
    expect(await readRegionOfferForRender(async () => ({ status: "unavailable" }))).toEqual({ offered: [], defaultRegion: "GLOBAL" });
    expect(await readRegionOfferForRender(async () => ({ status: "ready", offered: ["BR"], defaultRegion: "BR", source: "stored" }))).toEqual({ offered: ["BR"], defaultRegion: "BR" });
  });
});

import { describe, expect, test } from "bun:test";
import type { SqlQueryOptions } from "@/server/db/sql";
import { INVEST_HIDE_ALL, INVEST_SETTINGS_DEFAULTS } from "@/shared/operator-settings/invest";
import { createInvestVisibilityReader, INVEST_VISIBILITY_TTL_MS, readInvestSettingsEntry } from "./invest";
import { OperatorSettingsStore } from "./store";

const stored = { hiddenCategories: ["stock"] as const, hiddenAssets: ["cbbtc"] };

describe("invest visibility reader", () => {
  test("no database URL reads the built-in defaults without writing", async () => {
    const old = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const reader = createInvestVisibilityReader();
      expect(await reader.read()).toEqual({ status: "ready", source: "default", settings: INVEST_SETTINGS_DEFAULTS });
      expect(await reader.readVisibility()).toEqual({ settings: INVEST_SETTINGS_DEFAULTS, available: true });
    } finally {
      if (old !== undefined) process.env.DATABASE_URL = old;
    }
  });

  test("stored settings win, remain cached for five seconds and invalidate immediately", async () => {
    let now = 100;
    let calls = 0;
    const reader = createInvestVisibilityReader({ now: () => now, read: async () => {
      calls++;
      return { value: calls === 1 ? stored : INVEST_SETTINGS_DEFAULTS, source: "stored" };
    } });
    expect(await reader.read()).toEqual({ status: "ready", settings: stored, source: "stored" });
    now += INVEST_VISIBILITY_TTL_MS - 1;
    expect(await reader.readSettings()).toEqual(stored);
    expect(calls).toBe(1);
    now++;
    expect(await reader.readSettings()).toEqual(INVEST_SETTINGS_DEFAULTS);
    expect(calls).toBe(2);
    reader.invalidate();
    expect(await reader.read()).toEqual({ status: "ready", settings: INVEST_SETTINGS_DEFAULTS, source: "stored" });
    expect(calls).toBe(3);
  });

  test("failed or timed-out reads report unavailable and fail closed without a prior good read", async () => {
    const failure = createInvestVisibilityReader({ read: async () => { throw new Error("unavailable"); } });
    expect(await failure.read()).toEqual({ status: "unavailable" });
    expect(await failure.readSettings()).toEqual(INVEST_HIDE_ALL);
    expect(await failure.readVisibility()).toEqual({ settings: INVEST_HIDE_ALL, available: false });
    const timeout = createInvestVisibilityReader({ read: () => new Promise(() => {}), deadlineMs: 0 });
    expect(await timeout.read()).toEqual({ status: "unavailable" });
    expect(await timeout.readSettings()).toEqual(INVEST_HIDE_ALL);
  });

  test("a failed refresh retains last known good settings and failure cache expires", async () => {
    let now = 0;
    let calls = 0;
    const reader = createInvestVisibilityReader({ now: () => now, read: async () => {
      if (++calls === 1) return { value: stored, source: "stored" };
      throw new Error("database unavailable");
    } });
    expect(await reader.readSettings()).toEqual(stored);
    now += INVEST_VISIBILITY_TTL_MS;
    expect(await reader.read()).toEqual({ status: "unavailable" });
    expect(await reader.readSettings()).toEqual(stored);
    expect(await reader.readVisibility()).toEqual({ settings: stored, available: true });
    expect(calls).toBe(2);
    now += 1_000;
    expect(await reader.read()).toEqual({ status: "unavailable" });
    expect(calls).toBe(3);
  });

  test("invalidation clears last known good so a failed re-read fails closed", async () => {
    let fail = false;
    const reader = createInvestVisibilityReader({ read: async () => {
      if (fail) throw new Error("database unavailable");
      return { value: stored, source: "stored" };
    } });
    expect(await reader.readSettings()).toEqual(stored);
    fail = true;
    reader.invalidate();
    expect(await reader.readVisibility()).toEqual({ settings: INVEST_HIDE_ALL, available: false });
    expect(await reader.readSettings()).toEqual(INVEST_HIDE_ALL);
  });

  test("an invalidated in-flight read cannot overwrite a newer policy", async () => {
    let finish: ((value: { value: typeof stored; source: "stored" }) => void) | undefined;
    let reads = 0;
    const reader = createInvestVisibilityReader({ read: async () => {
      if (++reads === 1) return new Promise((resolve) => { finish = resolve; });
      return { value: INVEST_SETTINGS_DEFAULTS, source: "default" };
    } });
    const pending = reader.read();
    reader.invalidate();
    expect(await reader.readSettings()).toEqual(INVEST_SETTINGS_DEFAULTS);
    finish?.({ value: stored, source: "stored" });
    expect(await pending).toMatchObject({ settings: stored });
    expect(await reader.readSettings()).toEqual(INVEST_SETTINGS_DEFAULTS);
  });

  test("the deadline aborts the underlying read instead of abandoning it", async () => {
    let signal: AbortSignal | undefined;
    let settle: ((value: { value: typeof stored; source: "stored" }) => void) | undefined;
    const reader = createInvestVisibilityReader({ deadlineMs: 5, read: (candidate) => {
      signal = candidate;
      return new Promise((resolve) => { settle = resolve; });
    } });
    expect(await reader.read()).toEqual({ status: "unavailable" });
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(Error);
    settle?.({ value: stored, source: "stored" });
    await Promise.resolve();
    expect(await reader.readSettings()).toEqual(INVEST_HIDE_ALL);
  });

  test("a read that rejects after the deadline stays handled and the reader keeps working", async () => {
    let attempt = 0;
    const reader = createInvestVisibilityReader({ deadlineMs: 5, read: (signal) => {
      if (++attempt === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      }
      return Promise.resolve({ value: stored, source: "stored" });
    } });
    expect(await reader.read()).toEqual({ status: "unavailable" });
    reader.invalidate();
    expect(await reader.read()).toEqual({ status: "ready", settings: stored, source: "stored" });
  });

  test("the store forwards the signal and statement timeout to the executor", async () => {
    const captured: SqlQueryOptions[] = [];
    const store = new OperatorSettingsStore({
      query: async (_text, _values, options) => { captured.push(options ?? {}); return { rows: [], rowCount: 0 }; },
      transaction: async () => { throw new Error("not used"); },
    });
    const controller = new AbortController();
    await store.read("invest", { timeoutMs: 750, signal: controller.signal });
    expect(captured).toEqual([{ timeoutMs: 750, signal: controller.signal }]);
  });


  test("the console entry read is bounded, abortable and canonicalizes stored ids", async () => {
    const captured: SqlQueryOptions[] = [];
    const entry = await readInvestSettingsEntry({
      read: async (options) => {
        captured.push(options);
        return { domain: "invest", settings: { value: { hiddenCategories: ["stock", "stock"], hiddenAssets: ["cbbtc", "retired"] }, revision: 3, source: "stored", updatedAt: "2026-09-26T00:00:00.000Z", updatedBy: "0x1111111111111111111111111111111111111111" } };
      },
    });
    expect(captured).toEqual([{ timeoutMs: 750, signal: expect.any(AbortSignal) }]);
    expect(entry?.settings.value).toEqual({ hiddenCategories: ["stock"], hiddenAssets: ["cbbtc"] });
    expect(entry?.settings.revision).toBe(3);
  });

  test("a stalled console entry read rejects at its deadline and aborts the underlying read", async () => {
    let signal: AbortSignal | undefined;
    const pending = readInvestSettingsEntry({
      deadlineMs: 0,
      read: (options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    });
    await expect(pending).rejects.toThrow("Invest settings read timed out");
    expect(signal?.aborted).toBe(true);
  });

  test("an unreadable console entry value reports no entry instead of defaults", async () => {
    const entry = await readInvestSettingsEntry({
      read: async () => ({ domain: "invest", settings: { value: { hiddenCategories: "stock" }, revision: 1, source: "stored", updatedAt: null, updatedBy: null } }),
    });
    expect(entry).toBeNull();
  });
});

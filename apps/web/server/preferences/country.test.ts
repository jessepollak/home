import { afterEach, describe, expect, jest, test } from "bun:test";
import type { SqlExecutor, SqlQueryOptions, SqlQueryResult } from "@/server/db/sql";
import { CustomerResolver } from "@/server/customers/resolve";
import { CountryPreferenceStore, readCountryPreference, readCountryPreferenceForRender } from "./country";

const session = { accountProvider: "cdp-embedded" as const, user: { subject: "test" }, smartAccount: null };

afterEach(() => { jest.useRealTimers(); });

describe("country preference read", () => {
  test("reads the credential and preference with one bounded query", async () => {
    const calls: Array<{ values: unknown[] | undefined; options: SqlQueryOptions | undefined }> = [];
    const sql: SqlExecutor = {
      query: async <T,>(_text: string, values?: unknown[], options?: SqlQueryOptions): Promise<SqlQueryResult<T>> => {
        calls.push({ values, options });
        return { rows: [{ country_preference: "GB" } as T], rowCount: 1 };
      },
      transaction: async () => { throw new Error("Unexpected transaction"); },
    };
    const store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
    expect(await store.readCountryPreference(session)).toBe("GB");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual(["cdp-embedded", "test"]);
    expect(calls[0]?.options?.timeoutMs).toBe(750);
    expect(calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.options?.signal?.aborted).toBe(false);
  });

  test("throws on a query error and the render reader declines to seed it", async () => {
    const sql: SqlExecutor = {
      query: async () => { throw new Error("database unavailable"); },
      transaction: async () => { throw new Error("Unexpected transaction"); },
    };
    const store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
    await expect(store.readCountryPreference(session)).rejects.toThrow("database unavailable");
    await expect(readCountryPreference(session, store)).rejects.toThrow("database unavailable");
    expect(await readCountryPreferenceForRender(session, store)).toBeNull();
  });

  test("a missing preference or a missing store seeds null", async () => {
    const sql: SqlExecutor = {
      query: async <T,>(): Promise<SqlQueryResult<T>> => ({ rows: [], rowCount: 0 }),
      transaction: async () => { throw new Error("Unexpected transaction"); },
    };
    const store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
    expect(await readCountryPreferenceForRender(session, store)).toEqual({ regionId: null });
    expect(await readCountryPreferenceForRender(session, null)).toEqual({ regionId: null });
    expect(await readCountryPreference(session, null)).toBeNull();
  });

  test("throws at the deadline even when connection acquisition never finishes", async () => {
    jest.useFakeTimers();
    const signals: AbortSignal[] = [];
    const sql: SqlExecutor = {
      query: (_text, _values, options) => {
        if (options?.signal) signals.push(options.signal);
        return new Promise(() => {});
      },
      transaction: async () => { throw new Error("Unexpected transaction"); },
    };
    const store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
    const read = store.readCountryPreference(session);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    void jest.advanceTimersByTime(749);
    expect(signals[0]?.aborted).toBe(false);
    void jest.advanceTimersByTime(1);
    expect(signals[0]?.aborted).toBe(true);
    await expect(read).rejects.toThrow("timed out");
    const renderRead = readCountryPreferenceForRender(session, store);
    void jest.advanceTimersByTime(750);
    expect(await renderRead).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import type { SqlExecutor, SqlQueryOptions, SqlQueryResult } from "@/server/db/sql";
import { OperatorSettingsStore } from "./store";

describe("operator settings store reads", () => {
  test("forwards read options to the SQL executor", async () => {
    const observed: Array<SqlQueryOptions | undefined> = [];
    const sql: SqlExecutor = {
      async query<T>(_text: string, _values?: unknown[], options?: SqlQueryOptions): Promise<SqlQueryResult<T>> {
        observed.push(options);
        return { rows: [], rowCount: 0 };
      },
      async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
        return fn(sql);
      },
    };
    const store = new OperatorSettingsStore(sql);
    await store.read("products", { timeoutMs: 25, signal: AbortSignal.timeout(25) });
    expect(observed).toHaveLength(1);
    expect(observed[0]?.timeoutMs).toBe(25);
    expect(observed[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});

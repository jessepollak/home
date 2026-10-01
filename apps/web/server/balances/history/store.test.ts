import { describe, expect, test } from "bun:test";
import type { SqlExecutor, SqlQueryOptions, SqlQueryResult } from "@/server/db/sql";
import { PostgresHistoryStore } from "./store";

function fakeSql(rowCount: number) {
  const calls: Array<{ text: string; values: unknown[] | undefined; options: SqlQueryOptions | undefined }> = [];
  const sql: SqlExecutor = {
    query: async <T,>(text: string, values?: unknown[], options?: SqlQueryOptions): Promise<SqlQueryResult<T>> => {
      calls.push({ text, values, options });
      return { rows: [], rowCount };
    },
    transaction: async () => { throw new Error("Unexpected transaction"); },
  };
  return { sql, calls };
}

const AT = new Date("2026-09-13T12:00:00.000Z");
const ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;

describe("PostgresHistoryStore.markDirty", () => {
  test("forwards the write deadline to the SQL executor and returns its row count", async () => {
    const { sql, calls } = fakeSql(3);
    const store = new PostgresHistoryStore(sql);

    expect(await store.markDirty(8453, [ADDRESS], AT, { timeoutMs: 2_500 })).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([8453, `{"${ADDRESS}"}`, AT]);
    expect(calls[0]?.options).toEqual({ timeoutMs: 2_500 });
  });

  test("returns zero without issuing a query when no addresses are supplied", async () => {
    const { sql, calls } = fakeSql(3);
    const store = new PostgresHistoryStore(sql);

    expect(await store.markDirty(8453, [], AT)).toBe(0);
    expect(calls).toEqual([]);
  });
});

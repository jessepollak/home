import { afterEach, describe, expect, test } from "bun:test";
import type { SqlExecutor, SqlQueryResult } from "@/server/db/sql";
import { invalidateProductOffering, PRODUCT_OFFERING_TTL_MS, readProductOffering } from "./offering";

let queries = 0;
let failNext = false;
let hold = false;
let release: ((result: SqlQueryResult<never>) => void) | null = null;

const sql = (): SqlExecutor => ({
  async query<T>(_text: string, _values?: unknown[]): Promise<SqlQueryResult<T>> {
    queries += 1;
    if (failNext) throw new Error("settings database unavailable");
    if (hold) return await new Promise<SqlQueryResult<never>>((resolve) => { release = resolve; });
    return { rows: [], rowCount: 0 };
  },
  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return fn(sql());
  },
});

afterEach(() => { invalidateProductOffering(); queries = 0; failNext = false; hold = false; release = null; });

async function withDatabase(run: () => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://settings-unavailable";
  try { await run(); }
  finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

describe("product offering cache", () => {
  test("retains a fail-closed read for the TTL instead of re-reading a stalled store", async () => {
    await withDatabase(async () => {
      failNext = true;
      const first = await readProductOffering({ sql, now: () => 10 });
      expect(first.source).toBe("unavailable");
      expect(queries).toBe(1);
      expect((await readProductOffering({ sql, now: () => 10 + PRODUCT_OFFERING_TTL_MS - 1 })).source).toBe("unavailable");
      expect(queries).toBe(1);
      failNext = false;
      expect((await readProductOffering({ sql, now: () => 10 + PRODUCT_OFFERING_TTL_MS })).source).toBe("deployment");
      expect(queries).toBe(2);
    });
  });

  test("keeps one unsettled store read in flight past the TTL", async () => {
    await withDatabase(async () => {
      hold = true;
      const first = readProductOffering({ sql, now: () => 10 });
      expect(queries).toBe(1);
      const second = readProductOffering({ sql, now: () => 10 + PRODUCT_OFFERING_TTL_MS + 60_000 });
      expect(queries).toBe(1);
      if (!release) throw new Error("Expected a held product settings read.");
      release({ rows: [], rowCount: 0 });
      expect((await first).source).toBe("deployment");
      expect((await second).source).toBe("deployment");
      hold = false;
      expect((await readProductOffering({ sql, now: () => 10 + 2 * PRODUCT_OFFERING_TTL_MS + 60_000 })).source).toBe("deployment");
      expect(queries).toBe(2);
    });
  });

  test("starts a fresh read after a save and ignores the abandoned read settling late", async () => {
    await withDatabase(async () => {
      hold = true;
      const first = readProductOffering({ sql, now: () => 10 });
      expect(queries).toBe(1);
      invalidateProductOffering();
      hold = false;
      expect((await readProductOffering({ sql, now: () => 11 })).source).toBe("deployment");
      expect(queries).toBe(2);
      if (!release) throw new Error("Expected a held product settings read.");
      release({ rows: [], rowCount: 0 });
      expect((await first).source).toBe("deployment");
      expect(queries).toBe(2);
    });
  });
});

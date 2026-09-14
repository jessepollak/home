import { describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor } from "./sql";

type QueryCall = { text: string; values: unknown[] };

function fakePool(multiStatementText?: string) {
  const calls: QueryCall[] = [];
  let ended = false;
  let releases = 0;
  const client = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text === multiStatementText) {
        return [{ rows: [], rowCount: null }, { rows: [], rowCount: null }];
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      releases += 1;
    },
  };
  return {
    calls,
    get ended() {
      return ended;
    },
    get releases() {
      return releases;
    },
    async query(text: string, values: unknown[] = []) {
      return client.query(text, values);
    },
    async connect() {
      return client;
    },
    async end() {
      ended = true;
    },
    on() {
      return this;
    },
  };
}

describe("PostgreSQL executor", () => {
  test("orders BEGIN and COMMIT around a transaction", async () => {
    const pool = fakePool();
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", {
      poolFactory: () => pool,
    });

    await sql.transaction((tx) => tx.query("SELECT $1::text", ["value"]));

    expect(pool.calls).toEqual([
      { text: "BEGIN", values: [] },
      { text: "SELECT $1::text", values: ["value"] },
      { text: "COMMIT", values: [] },
    ]);
    expect(pool.releases).toBe(1);
  });

  test("accepts pg's result array for multi-statement migration files", async () => {
    const migration = "CREATE TABLE one(id int); CREATE TABLE two(id int);";
    const pool = fakePool(migration);
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", {
      poolFactory: () => pool,
    });

    await expect(sql.transaction((tx) => tx.query(migration))).resolves.toEqual({
      rows: [],
      rowCount: 0,
    });
  });

  test("rolls back and releases the client when a transaction throws", async () => {
    const pool = fakePool();
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", {
      poolFactory: () => pool,
    });

    await expect(sql.transaction(async () => {
      throw new Error("transaction failed");
    })).rejects.toThrow("transaction failed");

    expect(pool.calls.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(pool.releases).toBe(1);
  });

  test("sets a local statement timeout and ends the pool on dispose", async () => {
    const pool = fakePool();
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", {
      poolFactory: () => pool,
    });

    await sql.query("SELECT 1", [], { timeoutMs: 2_500 });
    await sql.dispose?.();

    expect(pool.calls).toEqual([
      { text: "BEGIN", values: [] },
      {
        text: "SELECT set_config('statement_timeout', $1, true)",
        values: ["2500ms"],
      },
      { text: "SELECT 1", values: [] },
      { text: "COMMIT", values: [] },
    ]);
    expect(pool.ended).toBe(true);
  });
});

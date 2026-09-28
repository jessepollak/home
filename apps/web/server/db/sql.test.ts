import { describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor } from "./sql";

type QueryCall = { text: string; values: unknown[] };

function fakePool(multiStatementText?: string, deferredConnect = false, hangText?: string) {
  const calls: QueryCall[] = [];
  let ended = false;
  let destroys = 0;
  let releases = 0;
  let resolveConnect: (() => void) | undefined;
  const pending: ((error: Error) => void)[] = [];
  let settleRelease: () => void = () => {};
  const released = new Promise<void>((resolve) => { settleRelease = resolve; });
  let startHang: () => void = () => {};
  const hangStarted = new Promise<void>((resolve) => { startHang = resolve; });
  const client = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text === hangText) {
        startHang();
        return new Promise<{ rows: unknown[]; rowCount: number | null }>((_resolve, reject) => { pending.push(reject); });
      }
      if (text === multiStatementText) {
        return [{ rows: [], rowCount: null }, { rows: [], rowCount: null }];
      }
      return { rows: [], rowCount: 0 };
    },
    release(err?: Error | boolean) {
      if (err === true) {
        destroys += 1;
        for (const reject of pending.splice(0)) reject(new Error("client destroyed"));
        settleRelease();
        return;
      }
      releases += 1;
      settleRelease();
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
    get destroys() {
      return destroys;
    },
    get released() {
      return released;
    },
    get hangStarted() {
      return hangStarted;
    },
    resolveConnect() {
      resolveConnect?.();
    },
    async query(text: string, values: unknown[] = []) {
      return client.query(text, values);
    },
    async connect() {
      if (deferredConnect) await new Promise<void>((resolve) => { resolveConnect = resolve; });
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

  test("destroys an acquisition that resolves after its signal aborted", async () => {
    const pool = fakePool(undefined, true);
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool });
    const controller = new AbortController();
    const pending = sql.query("SELECT 1", [], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    pool.resolveConnect();
    await pool.released;
    expect(pool.calls).toEqual([]);
    expect(pool.destroys).toBe(1);
    expect(pool.releases).toBe(0);
  });

  test("destroys the client and skips rollback when a query is aborted", async () => {
    const pool = fakePool(undefined, false, "SELECT stalled");
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool });
    const controller = new AbortController();
    const pending = sql.query("SELECT stalled", [], { signal: controller.signal });
    await pool.hangStarted;
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(pool.calls.map(({ text }) => text)).toEqual(["BEGIN", "SELECT stalled"]);
    expect(pool.destroys).toBe(1);
    expect(pool.releases).toBe(0);
  });
});

import { describe, expect, jest, spyOn, test } from "bun:test";
import { Pool } from "pg";
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


  test("an aborted acquisition rejects at once and releases the late client without running the statement", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let arrive: ((client: unknown) => void) | undefined;
    const client = {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      connect: () => new Promise((resolve) => { arrive = resolve; }),
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const controller = new AbortController();
    const pending = sql.query("SELECT 1", [], { signal: controller.signal });
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    arrive?.(client);
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toEqual([undefined]);
    expect(calls).toEqual([]);
  });

  test("an abort during BEGIN destroys the client once and runs no statement", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let finishBegin: (() => void) | undefined;
    let markBegan: (() => void) | undefined;
    const began = new Promise<void>((resolve) => { markBegan = resolve; });
    const beginGate = new Promise<void>((resolve) => { finishBegin = resolve; });
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text === "BEGIN") {
          markBegan?.();
          return beginGate.then(() => ({ rows: [], rowCount: 0 }));
        }
        if (text === "ROLLBACK") return beginGate.then(() => ({ rows: [], rowCount: 0 }));
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const controller = new AbortController();
    const pending = sql.query("SELECT 1", [], { signal: controller.signal });
    await began;
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    expect(releases).toEqual([true]);
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN"]);
    finishBegin?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toEqual([true]);
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN"]);
  });

  test("a signal aborted during acquisition still releases the client that arrives later", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let arrive: ((client: unknown) => void) | undefined;
    const controller = new AbortController();
    const client = {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      connect: () => {
        controller.abort(new Error("deadline"));
        return new Promise((resolve) => { arrive = resolve; });
      },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    await expect(sql.query("SELECT 1", [], { signal: controller.signal })).rejects.toThrow("deadline");
    arrive?.(client);
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toEqual([undefined]);
    expect(calls).toEqual([]);
  });

  test("an abort during a statement destroys the client and rejects without waiting for the driver", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let finishSelect: (() => void) | undefined;
    let markSelect: (() => void) | undefined;
    const selected = new Promise<void>((resolve) => { markSelect = resolve; });
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text === "SELECT 1") {
          markSelect?.();
          return new Promise((resolve) => { finishSelect = () => resolve({ rows: [], rowCount: 0 }); });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const controller = new AbortController();
    const pending = sql.query("SELECT 1", [], { signal: controller.signal });
    await selected;
    expect(calls.map(({ text }) => text)).toContain("SELECT 1");
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN", "SELECT 1"]);
    expect(releases).toEqual([true]);
    finishSelect?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toEqual([true]);
  });

  test("an abort while installing the statement timeout destroys the client before the statement runs", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let finishConfig: (() => void) | undefined;
    let markConfig: (() => void) | undefined;
    const configured = new Promise<void>((resolve) => { markConfig = resolve; });
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text.startsWith("SELECT set_config")) {
          markConfig?.();
          return new Promise((resolve) => { finishConfig = () => resolve({ rows: [], rowCount: 0 }); });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const controller = new AbortController();
    const pending = sql.query("SELECT 1", [], { timeoutMs: 750, signal: controller.signal });
    await configured;
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN", "SELECT set_config('statement_timeout', $1, true)"]);
    expect(releases).toEqual([true]);
    finishConfig?.();
    await Promise.resolve();
    expect(releases).toEqual([true]);
  });

  test("an abort during COMMIT destroys the client and rejects", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let markCommit: (() => void) | undefined;
    const committing = new Promise<void>((resolve) => { markCommit = resolve; });
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text === "COMMIT") {
          markCommit?.();
          return new Promise(() => {});
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const controller = new AbortController();
    const pending = sql.query("SELECT 1", [], { signal: controller.signal });
    await committing;
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(releases).toEqual([true]);
  });

  test("an abort during ROLLBACK keeps the transaction error and destroys the client", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let markRollback: (() => void) | undefined;
    const rollingBack = new Promise<void>((resolve) => { markRollback = resolve; });
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text === "SELECT 1") return Promise.reject(new Error("statement failed"));
        if (text === "ROLLBACK") {
          markRollback?.();
          return new Promise(() => {});
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const controller = new AbortController();
    const pending = sql.query("SELECT 1", [], { signal: controller.signal });
    await rollingBack;
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("statement failed");
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN", "SELECT 1", "ROLLBACK"]);
    expect(releases).toEqual([true]);
  });

  test("an abort that lands after acquisition and before BEGIN releases the client without a statement", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    const controller = new AbortController();
    const client = {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const acquired = {
      then(onFulfilled: (value: unknown) => unknown) {
        onFulfilled(client);
        controller.abort(new Error("deadline"));
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      connect: () => acquired,
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    await expect(sql.query("SELECT 1", [], { signal: controller.signal })).rejects.toThrow("deadline");
    expect(calls).toEqual([]);
    expect(releases).toEqual([undefined]);
  });

  test("an abort during the post-BEGIN schema read destroys the client", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let markSchema: (() => void) | undefined;
    const readingSchema = new Promise<void>((resolve) => { markSchema = resolve; });
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text.startsWith("SELECT 1 FROM pg_namespace")) {
          markSchema?.();
          return new Promise(() => {});
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { schema: "operator_test", poolFactory: () => pool as never });
    const controller = new AbortController();
    const pending = sql.query("SELECT 1", [], { signal: controller.signal });
    await readingSchema;
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN", "SELECT 1 FROM pg_namespace WHERE nspname = $1"]);
    expect(releases).toEqual([true]);
  });

  test("applies the schema search path after a successful BEGIN", async () => {
    const calls: QueryCall[] = [];
    const client = {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: text.startsWith("SELECT 1 FROM pg_namespace") ? [{ nspname: "operator_test" }] : [], rowCount: 0 };
      },
      release() {}
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { schema: "operator_test", poolFactory: () => pool as never });
    await expect(sql.query("SELECT 1")).resolves.toEqual({ rows: [], rowCount: 0 });
    expect(calls.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SELECT 1 FROM pg_namespace WHERE nspname = $1",
      "SET LOCAL search_path TO \"operator_test\"",
      "SELECT 1",
      "COMMIT",
    ]);
  });

  test("an already-aborted signal rejects before acquiring a client", async () => {
    let connects = 0;
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { connects += 1; return { async query() { return { rows: [], rowCount: 0 }; }, release() {} }; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const controller = new AbortController();
    controller.abort(new Error("deadline"));
    await expect(sql.query("SELECT 1", [], { signal: controller.signal })).rejects.toThrow("deadline");
    expect(connects).toBe(0);
  });

  test("hands the pool it opens to the platform lifecycle hook with the configured limits", async () => {
    const attached: unknown[] = [];
    const sql = createPostgresSqlExecutor("postgresql://127.0.0.1:1/home", {
      attachPool: (pool) => { attached.push(pool); },
    });

    await expect(sql.query("SELECT 1")).rejects.toThrow();
    expect(attached).toHaveLength(1);
    expect(attached[0]).toBeInstanceOf(Pool);
    expect((attached[0] as Pool).options).toMatchObject({
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    await sql.dispose?.();
  });

  test("keeps a pool usable when the platform hook finds no Fluid runtime", async () => {
    const sql = createPostgresSqlExecutor("postgresql://127.0.0.1:1/home");

    await expect(sql.query("SELECT 1")).rejects.toThrow(/ECONNREFUSED|connect/i);
    await sql.dispose?.();
  });

  test("attaches each pool an executor opens when a process holds several executors", async () => {
    const attached: unknown[] = [];
    const record = (pool: unknown) => { attached.push(pool); };
    const first = createPostgresSqlExecutor("postgresql://127.0.0.1:1/home", { attachPool: record });
    const second = createPostgresSqlExecutor("postgresql://127.0.0.1:1/home", { attachPool: record });

    await expect(first.query("SELECT 1")).rejects.toThrow();
    await expect(second.query("SELECT 1")).rejects.toThrow();
    expect(attached).toHaveLength(2);
    expect(new Set(attached).size).toBe(2);
    await first.dispose?.();
    await second.dispose?.();
  });
});

describe("PostgreSQL executor deadlines", () => {
  test("a deadline during a stalled BEGIN destroys the client and runs no statement", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let markBegin: (() => void) | undefined;
    const beginning = new Promise<void>((resolve) => { markBegin = resolve; });
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text === "BEGIN") {
          markBegin?.();
          return new Promise<{ rows: unknown[]; rowCount: number }>(() => {});
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const pending = sql.query("SELECT 1", [], { timeoutMs: 20 });
    await beginning;
    await expect(pending).rejects.toHaveProperty("name", "TimeoutError");
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN"]);
    expect(releases).toEqual([true]);
  });

  test("a deadline during a saturated pool releases the late client instead of destroying it", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let arrive: ((client: unknown) => void) | undefined;
    const client = {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      connect: () => new Promise((resolve) => { arrive = resolve; }),
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    await expect(sql.query("SELECT 1", [], { timeoutMs: 20 })).rejects.toHaveProperty("name", "TimeoutError");
    arrive?.(client);
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toEqual([undefined]);
    expect(calls).toEqual([]);
  });

  test("a timed-out read frees its pool slot for the next read", async () => {
    const calls: QueryCall[] = [];
    let free = false;
    let serve: (() => void) | undefined;
    const client = {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      release(destroy?: boolean) {
        if (destroy === true) return;
        free = true;
        serve?.();
        serve = undefined;
      },
    };
    let connects = 0;
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() {
        connects += 1;
        if (!free) await new Promise<void>((resolve) => { serve = resolve; });
        free = false;
        return client;
      },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    await expect(sql.query("SELECT 1", [], { timeoutMs: 20 })).rejects.toHaveProperty("name", "TimeoutError");
    expect(connects).toBe(1);
    free = true;
    serve?.();
    serve = undefined;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(free).toBe(true);
    await expect(sql.query("SELECT 1")).resolves.toEqual({ rows: [], rowCount: 0 });
    expect(connects).toBe(2);
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
  });

  test("a deadline during a statement destroys the client without waiting for the driver", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    let markSelected: (() => void) | undefined;
    const selected = new Promise<void>((resolve) => { markSelected = resolve; });
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text === "SELECT 1") {
          markSelected?.();
          return new Promise<{ rows: unknown[]; rowCount: number }>(() => {});
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const pending = sql.query("SELECT 1", [], { timeoutMs: 20 });
    await selected;
    await expect(pending).rejects.toHaveProperty("name", "TimeoutError");
    expect(calls.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SELECT set_config('statement_timeout', $1, true)",
      "SELECT 1",
    ]);
    expect(releases).toEqual([true]);
  });

  test("an abort that lands after BEGIN settled destroys the client instead of returning an open transaction", async () => {
    const calls: QueryCall[] = [];
    const releases: (boolean | undefined)[] = [];
    const controller = new AbortController();
    const client = {
      query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text === "BEGIN") {
          return {
            then(onFulfilled: (value: unknown) => unknown) {
              onFulfilled({ rows: [], rowCount: 0 });
              controller.abort(new Error("deadline"));
              return { then() {} };
            },
          };
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    await expect(sql.query("SELECT 1", [], { signal: controller.signal })).rejects.toThrow("deadline");
    expect(calls.map(({ text }) => text)).toEqual(["BEGIN"]);
    expect(releases).toEqual([true]);
  });

  test("keeps the caller abort reason when a deadline is also set", async () => {
    const releases: (boolean | undefined)[] = [];
    let markBegin: (() => void) | undefined;
    const beginning = new Promise<void>((resolve) => { markBegin = resolve; });
    const client = {
      query(text: string) {
        if (text === "BEGIN") {
          markBegin?.();
          return new Promise<{ rows: unknown[]; rowCount: number }>(() => {});
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release(destroy?: boolean) {
        releases.push(destroy);
      },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    const pending = sql.query("SELECT 1", [], { timeoutMs: 5_000, signal: controller.signal });
    await beginning;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(releases).toEqual([true]);
  });

  test("an invalid timeout rejects before acquiring a client", async () => {
    let connects = 0;
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { connects += 1; return { async query() { return { rows: [], rowCount: 0 }; }, release() {} }; },
      async end() {},
      on() { return this; },
    };
    const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
    await expect(sql.query("SELECT 1", [], { timeoutMs: 0 })).rejects.toThrow(
      "PostgreSQL query timeout must be between 1 and 5000 milliseconds",
    );
    expect(connects).toBe(0);
  });

  test("clears the deadline timer after a successful query", async () => {
    jest.useFakeTimers();
    const cleared = spyOn(globalThis, "clearTimeout");
    try {
      const releases: (boolean | undefined)[] = [];
      const client = {
        async query() { return { rows: [], rowCount: 0 }; },
        release(destroy?: boolean) {
          releases.push(destroy);
        },
      };
      const pool = {
        async query() { return { rows: [], rowCount: 0 }; },
        async connect() { return client; },
        async end() {},
        on() { return this; },
      };
      const sql = createPostgresSqlExecutor("postgresql://example.test/home", { poolFactory: () => pool as never });
      await expect(sql.query("SELECT 1", [], { timeoutMs: 20 })).resolves.toEqual({ rows: [], rowCount: 0 });
      expect(cleared).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(20);
      expect(releases).toEqual([undefined]);
    } finally {
      cleared.mockRestore();
      jest.useRealTimers();
    }
  });
});

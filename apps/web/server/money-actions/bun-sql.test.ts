import { describe, expect, test } from "bun:test";
import {
  createBunSqlExecutor,
  isLoopbackPostgresUrl,
  type BunSqlClient,
} from "./bun-sql";

function rowsWithCount(rows: unknown[], count: number): ArrayLike<unknown> & { count?: number } {
  const result = rows as unknown[] & { count?: number };
  result.count = count;
  return result;
}

describe("local Postgres SQL executor", () => {
  test("recognizes only exact loopback hosts and keeps suffix/trick hosts on the Neon path", () => {
    expect(isLoopbackPostgresUrl("postgresql://home:home@localhost:5432/home")).toBe(true);
    expect(isLoopbackPostgresUrl("postgresql://home:home@127.0.0.1:5432/home")).toBe(true);
    expect(isLoopbackPostgresUrl("postgresql://home:home@[::1]:5432/home")).toBe(true);
    expect(isLoopbackPostgresUrl(
      "postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require",
    )).toBe(false);
    expect(isLoopbackPostgresUrl("postgresql://home:home@localhost.example.com:5432/home")).toBe(false);
    expect(isLoopbackPostgresUrl("postgresql://home:home@notlocalhost:5432/home")).toBe(false);
    expect(isLoopbackPostgresUrl("postgresql://home:home@127.0.0.1.attacker.example:5432/home")).toBe(false);
    expect(isLoopbackPostgresUrl("postgresql://home:home@127.0.0.1.evil:5432/home")).toBe(false);
    expect(isLoopbackPostgresUrl("postgresql://home:home@[::1].attacker.example:5432/home")).toBe(false);
    expect(isLoopbackPostgresUrl("postgresql://localhost@example.com/home")).toBe(false);
    expect(isLoopbackPostgresUrl("not a url")).toBe(false);
  });

  test("adapts Bun.SQL rows and transaction callbacks to the store executor shape", async () => {
    const calls: string[] = [];

    const transactionalClient: BunSqlClient = {
      unsafe: async (text: string, values: unknown[] = []) => {
        calls.push(`tx:${text}:${values.length}`);
        return rowsWithCount(values, values.length);
      },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>): Promise<T> => {
        void callback;
        throw new Error("nested");
      },
      close: async () => {
        calls.push("tx:close");
      },
    };

    const client: BunSqlClient = {
      unsafe: async (text: string, values: unknown[] = []) => {
        calls.push(`unsafe:${text}:${values.length}`);
        return rowsWithCount(values, values.length);
      },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>): Promise<T> => {
        calls.push("begin");
        return callback(transactionalClient);
      },
      close: async () => {
        calls.push("close");
      },
    };

    const executor = createBunSqlExecutor(client);

    // Like the Neon executor, a top-level query establishes one transaction.
    const result = await executor.query<unknown>("SELECT 1", ["bound"]);
    expect(result.rows).toEqual(["bound"]);
    expect(result.rowCount).toBe(1);
    expect(calls).toEqual(["begin", "tx:SELECT 1:1"]);

    const created = await executor.transaction((transaction) =>
      transaction.query("CREATE TABLE example (id INTEGER)", []),
    );
    expect(created.rowCount).toBe(0);
    expect(calls).toEqual(["begin", "tx:SELECT 1:1", "begin", "tx:CREATE TABLE example (id INTEGER):0"]);

    await expect(
      executor.transaction((transaction) => transaction.transaction(async () => undefined)),
    ).rejects.toThrow(/nested money-action transactions/);
  });

  test("disposes the top-level executor by closing the Bun client exactly once", async () => {
    let closes = 0;
    const client: BunSqlClient = {
      unsafe: async () => rowsWithCount([], 0),
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>) => {
        void callback;
        throw new Error("not used");
      },
      close: async () => { closes += 1; },
    };

    const executor = createBunSqlExecutor(client);
    await executor.dispose?.();
    await executor.dispose?.();
    expect(closes).toBe(1);
  });

  test("validates and applies an explicit schema search path inside transactions", async () => {
    const calls: string[] = [];
    const client: BunSqlClient = {
      unsafe: async (text: string, values: unknown[] = []) => {
        calls.push(`${text}:${JSON.stringify(values)}`);
        if (text.startsWith("SELECT 1 FROM pg_namespace")) {
          return rowsWithCount([{ "?column?": 1 }], 1);
        }
        return rowsWithCount([], 0);
      },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>) => {
        calls.push("begin");
        return callback(client);
      },
      close: async () => { calls.push("close"); },
    };

    const executor = createBunSqlExecutor(client, { schema: "public" });
    await executor.transaction(async (transaction) => {
      await transaction.query("SELECT 1");
    });
    expect(calls).toEqual([
      "begin",
      'SELECT 1 FROM pg_namespace WHERE nspname = $1:["public"]',
      'SET LOCAL search_path TO "public":[]',
      "SELECT 1:[]",
    ]);
  });

  test("scopes a schema-bearing top-level query through a transaction-local search path", async () => {
    const calls: string[] = [];
    const client: BunSqlClient = {
      unsafe: async (text: string, values: unknown[] = []) => {
        calls.push(`${text}:${JSON.stringify(values)}`);
        if (text.startsWith("SELECT 1 FROM pg_namespace")) {
          return rowsWithCount([{ "?column?": 1 }], 1);
        }
        return rowsWithCount([{ id: 1 }], 1);
      },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>) => {
        calls.push("begin");
        return callback(client);
      },
      close: async () => { calls.push("close"); },
    };

    const executor = createBunSqlExecutor(client, { schema: "audit" });
    const result = await executor.query("SELECT id FROM operations");
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(calls).toEqual([
      "begin",
      'SELECT 1 FROM pg_namespace WHERE nspname = $1:["audit"]',
      'SET LOCAL search_path TO "audit":[]',
      "SELECT id FROM operations:[]",
    ]);
  });

  test("rejects a pre-aborted signal before touching the Bun client", async () => {
    let unsafeCalls = 0;
    let beginCalls = 0;
    const signal = AbortSignal.abort(new DOMException("cancelled", "AbortError"));
    const client: BunSqlClient = {
      unsafe: async () => { unsafeCalls += 1; return rowsWithCount([], 0); },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>) => {
        void callback;
        beginCalls += 1;
        throw new Error("not used");
      },
      close: async () => {},
    };

    const executor = createBunSqlExecutor(client);
    await expect(executor.query("SELECT 1", [], { signal })).rejects.toThrow("cancelled");
    expect(unsafeCalls).toBe(0);
    expect(beginCalls).toBe(0);
  });

  test("rejects an in-flight abort when the signal fires after the call settles", async () => {
    const controller = new AbortController();
    const client: BunSqlClient = {
      unsafe: async () => {
        controller.abort(new DOMException("late abort", "AbortError"));
        return rowsWithCount([{ id: 1 }], 1);
      },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>) => {
        return callback(client);
      },
      close: async () => {},
    };

    const executor = createBunSqlExecutor(client);
    await expect(
      executor.query("SELECT 1", [], { signal: controller.signal }),
    ).rejects.toThrow("late abort");
  });

  test("validates and applies a bounded transaction-local statement timeout", async () => {
    const calls: string[] = [];
    const client: BunSqlClient = {
      unsafe: async (text: string, values: unknown[] = []) => {
        calls.push(`${text}:${JSON.stringify(values)}`);
        return rowsWithCount([], 0);
      },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>) => {
        calls.push("begin");
        return callback(client);
      },
      close: async () => {},
    };

    const executor = createBunSqlExecutor(client);
    await executor.query("SELECT id FROM operations", [], { timeoutMs: 250 });
    expect(calls).toEqual([
      "begin",
      'SELECT set_config(\'statement_timeout\', $1, true):["250ms"]',
      "SELECT id FROM operations:[]",
    ]);
  });

  test("rejects invalid statement timeouts before running the bounded read", async () => {
    let dataQueryCalls = 0;
    const client: BunSqlClient = {
      unsafe: async (text: string) => {
        if (text === "SELECT id FROM operations") dataQueryCalls += 1;
        return rowsWithCount([], 0);
      },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>) => {
        return callback(client);
      },
      close: async () => {},
    };

    const executor = createBunSqlExecutor(client);
    await expect(executor.query("SELECT id FROM operations", [], { timeoutMs: 0 }))
      .rejects.toThrow(/between 1 and 5000/);
    await expect(executor.query("SELECT id FROM operations", [], { timeoutMs: 6000 }))
      .rejects.toThrow(/between 1 and 5000/);
    expect(dataQueryCalls).toBe(0);
  });

  test("coexists schema search_path with a bounded statement timeout", async () => {
    const calls: string[] = [];
    const client: BunSqlClient = {
      unsafe: async (text: string, values: unknown[] = []) => {
        calls.push(`${text}:${JSON.stringify(values)}`);
        if (text.startsWith("SELECT 1 FROM pg_namespace")) {
          return rowsWithCount([{ "?column?": 1 }], 1);
        }
        return rowsWithCount([], 0);
      },
      begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>) => {
        calls.push("begin");
        return callback(client);
      },
      close: async () => {},
    };

    const executor = createBunSqlExecutor(client, { schema: "audit" });
    await executor.query("SELECT id FROM operations", [], { timeoutMs: 100 });
    expect(calls).toEqual([
      "begin",
      'SELECT 1 FROM pg_namespace WHERE nspname = $1:["audit"]',
      'SET LOCAL search_path TO "audit":[]',
      'SELECT set_config(\'statement_timeout\', $1, true):["100ms"]',
      "SELECT id FROM operations:[]",
    ]);
  });

  test("rejects empty or unsafe explicit schemas before opening a transaction", () => {
    const client: BunSqlClient = {
      unsafe: async () => rowsWithCount([], 0),
      begin: async () => { throw new Error("not used"); },
      close: async () => {},
    };
    expect(() => createBunSqlExecutor(client, { schema: "" })).toThrow(
      "unsafe PostgreSQL schema identifier",
    );
  });
});

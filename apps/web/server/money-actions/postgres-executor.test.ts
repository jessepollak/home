import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BunSqlClient } from "./bun-sql";
import { createPostgresSqlExecutor } from "./postgres-executor";

function fakeBunSqlClient(records: { created: string[]; closed: number }): BunSqlClient {
  return {
    unsafe: async (text: string, values: unknown[] = []) => {
      const rows = values;
      (rows as unknown[] & { count: number }).count = rows.length;
      return rows as unknown[] & { count: number };
    },
    begin: async <T>(callback: (transaction: BunSqlClient) => Promise<T>): Promise<T> => {
      return callback(fakeBunSqlClient(records));
    },
    close: async () => {
      records.closed += 1;
    },
  };
}

describe("Postgres executor selector", () => {
  test("routes exact loopback URLs to Bun.SQL and disposes the native client", async () => {
    const records = { created: [] as string[], closed: 0 };
    const executor = createPostgresSqlExecutor(
      "postgresql://home:home@127.0.0.1:5432/home",
      {},
      (url) => {
        records.created.push(url);
        return fakeBunSqlClient(records);
      },
    );

    expect(records.created).toEqual(["postgresql://home:home@127.0.0.1:5432/home"]);
    const result = await executor.query<unknown>("SELECT 1", ["bound"]);
    expect(result.rows).toEqual(["bound"]);
    expect(result.rowCount).toBe(1);

    await executor.dispose?.();
    expect(records.closed).toBe(1);
  });

  test("keeps hosted Neon URLs on the unchanged Neon path without constructing Bun.SQL", async () => {
    let bunConstructionCalls = 0;
    const executor = createPostgresSqlExecutor(
      "postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require",
      {},
      () => {
        bunConstructionCalls += 1;
        throw new Error("Bun.SQL must not be constructed for hosted URLs");
      },
    );

    expect(bunConstructionCalls).toBe(0);
    expect(typeof executor.dispose).toBe("function");
    await executor.dispose?.();
    expect(bunConstructionCalls).toBe(0);
  });

  test("the single selector is shared by the runtime store, store constructor, and migrate CLI", () => {
    const runtime = readFileSync(resolve(import.meta.dir, "runtime-store.ts"), "utf8");
    const store = readFileSync(resolve(import.meta.dir, "postgres-store.ts"), "utf8");
    const migrate = readFileSync(resolve(import.meta.dir, "migrate.ts"), "utf8");

    expect(runtime).toContain('await import("./postgres-executor")');
    expect(runtime).toContain("createPostgresSqlExecutor(connectionString)");
    expect(store).toContain("this.executor = createPostgresSqlExecutor(url);");
    expect(store).toContain(
      "createPostgresSqlExecutor(options.connectionString, { schema: options.schema })",
    );
    expect(migrate).toContain("const executor = createPostgresSqlExecutor(url);");
  });
});

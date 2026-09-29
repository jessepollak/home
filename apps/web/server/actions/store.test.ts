import "server-only";

import { describe, expect, test } from "bun:test";
import type { SqlExecutor } from "@/server/db/sql";
import { ActionsStore, actionOwnerKey } from "./store";

const owner = {
  subject: "subject",
  address: "0x1111111111111111111111111111111111111111" as const,
  chainId: 8453 as const,
  accountProvider: "cdp-embedded" as const,
};

describe("ActionsStore durable history queries", () => {
  test("binds the owner and limit for dispatched send history", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const sql: SqlExecutor = {
      async query<T>(text: string, values: unknown[] = []) {
        queries.push({ text, values });
        return { rows: [] as T[], rowCount: 0 };
      },
      async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) { return await run(this); },
    };
    const store = new ActionsStore(sql);

    expect(await store.listDispatchedSends(owner, 12)).toEqual([]);
    expect(queries[0]?.values).toEqual([actionOwnerKey(owner), 12]);
    await expect(store.listDispatchedSends(owner, 101)).rejects.toThrow("between 1 and 100");
  });
});

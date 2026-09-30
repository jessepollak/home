import "server-only";

import { expect, test } from "bun:test";
import type { SqlExecutor } from "@/server/db/sql";
import { CustomerResolver } from "./resolve";

test("read-only customer lookup passes an aborted signal to SQL and does not create records", async () => {
  const controller = new AbortController();
  controller.abort();
  const seen: Array<{ text: string; signal?: AbortSignal }> = [];
  const sql: SqlExecutor = {
    query: async (text, _values, options) => { seen.push({ text, signal: options?.signal }); options?.signal?.throwIfAborted(); return { rows: [], rowCount: 0 }; },
    transaction: async () => { throw new Error("unexpected transaction"); },
  };
  const resolver = new CustomerResolver(sql);
  await expect(resolver.resolveCustomer({ accountProvider: "base-account", user: { subject: "customer" }, smartAccount: null },
    { create: false, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.signal).toBe(controller.signal);
  expect(seen[0]?.text).toContain("FROM customer_credentials cr JOIN customers c");
});

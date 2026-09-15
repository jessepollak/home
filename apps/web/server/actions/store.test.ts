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

describe("ActionsStore cash-out recovery evidence", () => {
  test("uses an owner-scoped unwindowed existence query and reads persisted modes", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const sql: SqlExecutor = {
      async query<T>(text: string, values: unknown[] = []) {
        queries.push({ text, values });
        const rows = text.includes("SELECT 1 AS present")
          ? [{ present: 1 }]
          : [{ environment: "sandbox" }, { environment: "production" }, { environment: null }];
        return { rows: rows as T[], rowCount: rows.length };
      },
      async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) { return await run(this); },
    };
    const store = new ActionsStore(sql);

    expect(await store.hasCashoutHistory(owner)).toBe(true);
    expect(await store.cashoutRecoveryModes(owner)).toEqual(["sandbox", "production"]);
    expect(queries[0]?.text).toContain("kind IN ('cash-out', 'cash-out-withdraw')");
    expect(queries[0]?.text).not.toContain("interval");
    expect(queries[0]?.values).toEqual([actionOwnerKey(owner)]);
  });
});

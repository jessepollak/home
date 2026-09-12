import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { isLoopbackPostgresUrl } from "./bun-sql";
import { createPostgresSqlExecutor } from "./postgres-executor";
import { applyMoneyActionPostgresSchema } from "./postgres-sql";
import { PostgresMoneyActionStore } from "./postgres-store";

// Opt-in real local-Postgres smoke. Run with `bun run db:up` first, then:
// DATABASE_URL=postgresql://home:home@localhost:5432/home \
//   MONEY_ACTION_POSTGRES_SMOKE=1 bun test apps/web/server/money-actions/postgres-smoke.test.ts
const smoke = process.env.MONEY_ACTION_POSTGRES_SMOKE === "1" ? test : test.skip;
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

const OWNER = {
  subject: "smoke-subject",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} as const;

function action(id: string, reviewHash: string): PreparedMoneyAction {
  return {
    id,
    reviewHash,
    owner: OWNER,
    kind: "save-deposit",
    title: "Deposit USDC smoke",
    calls: [{ to: "0x3333333333333333333333333333333333333333", data: "0x1234", value: "0" }],
    amounts: [{ assetId: "base:usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
    warnings: [],
    createdAt: "2026-09-12T05:00:00.000Z",
    expiresAt: "2026-09-12T05:10:00.000Z",
  };
}

describe("local PostgreSQL migration and store smoke", () => {
  smoke("applies the schema through the shared executor selector", async () => {
    expect(isLoopbackPostgresUrl(databaseUrl), "DATABASE_URL must be an exact loopback host").toBe(true);
    const executor = createPostgresSqlExecutor(databaseUrl);
    try {
      await applyMoneyActionPostgresSchema(executor);
      const schema = await executor.query<{ schema_name: string }>(
        "SELECT current_schema() AS schema_name",
      );
      expect(schema.rows[0]?.schema_name).toBe("public");
      const schemaObjects = await executor.query<{
        operations: string | null;
        submission_index: string | null;
        user_operation_index: string | null;
      }>(`
        SELECT
          to_regclass('public.money_action_operations') AS operations,
          to_regclass('public.money_action_unique_owner_submission_id') AS submission_index,
          to_regclass('public.money_action_unique_owner_user_operation_hash') AS user_operation_index
      `.trim());
      expect(schemaObjects.rows[0]).toEqual({
        operations: "money_action_operations",
        submission_index: "money_action_unique_owner_submission_id",
        user_operation_index: "money_action_unique_owner_user_operation_hash",
      });
    } finally {
      await executor.dispose?.();
    }
  }, 30_000);

  smoke("issues, claims, and reloads a money action through the runtime store constructor", async () => {
    expect(isLoopbackPostgresUrl(databaseUrl), "DATABASE_URL must be an exact loopback host").toBe(true);
    const store = new PostgresMoneyActionStore(databaseUrl);
    try {
      await store.ensureSchema();

      // Unique per run so repeated smoke runs against the persistent
      // docker-compose volume never collide or trip over stale rows.
      const id = `smoke-${randomUUID()}`;
      const reviewHash = "a".repeat(64);
      const issued = await store.issue(action(id, reviewHash));
      expect(issued).toBe("issued");

      const prepared = await store.get(OWNER, id);
      expect(prepared).toMatchObject({ status: "prepared", attemptCount: 0 });
      expect(prepared?.action.id).toBe(id);

      const claimed = await store.claim(OWNER, id, reviewHash, "2026-09-12T05:01:00.000Z");
      expect(claimed).toMatchObject({
        disposition: "dispatch",
        operation: { status: "submitting", attemptCount: 1 },
      });

      // Targeted reload by the exact issued id instead of counting all rows.
      const reloaded = await store.get(OWNER, id);
      expect(reloaded).toMatchObject({ status: "submitting", attemptCount: 1 });
      expect(reloaded?.action.id).toBe(id);
    } finally {
      await store.dispose();
    }
  }, 30_000);
});

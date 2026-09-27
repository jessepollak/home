import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { PostgresWebhookSubscriptionStore } from "./webhook-subscription-store";
import { webhookSubscriptionStoreContract } from "./webhook-subscription-store.contract";

const connectionString = process.env.BALANCES_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
type BunSqlClient = {
  unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>;
  begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
let client: BunSqlClient;
let executor: SqlExecutor;

describePostgres("Postgres webhook subscription production contract", () => {
  beforeAll(async () => {
    client = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    const migration = await readMigrationSql("005_balances.sql");
    await client.unsafe("DROP TABLE IF EXISTS webhook_subscriptions");
    await client.unsafe(migration);
    await client.unsafe(await readMigrationSql("017_webhook_subscription_envelopes.sql"));
    executor = bunExecutor(client);
  });
  afterAll(async () => {
    await client?.unsafe("DROP TABLE IF EXISTS webhook_subscriptions");
    await client?.close();
  });

  webhookSubscriptionStoreContract({
    name: "Postgres",
    createStore: (keyring) => new PostgresWebhookSubscriptionStore(executor, keyring),
    reset: async () => { await client.unsafe("TRUNCATE webhook_subscriptions"); },
    seedLegacy: async (record) => {
      await client.unsafe("INSERT INTO webhook_subscriptions (subscription_id,secret,target,event_type) VALUES ($1,$2,$3,$4)", [record.subscriptionId, record.secret, record.target, record.eventType]);
    },
  });

  test("fresh insert persists only ciphertext", async () => {
    await client.unsafe("TRUNCATE webhook_subscriptions");
    const secret = randomBytes(32).toString("base64url");
    const { resolveSecretKeyring } = await import("@/server/secrets/at-rest");
    const key = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "1" });
    if (!key.ok) throw new Error("invalid fixture key");
    await new PostgresWebhookSubscriptionStore(executor, key.keyring).insert({ subscriptionId: "new", secret, target: "https://home.example", eventType: "wallet_activity" });
    const rows = await client.unsafe("SELECT secret,envelope FROM webhook_subscriptions") as Array<{ secret: string | null; envelope: string }>;
    expect(rows[0]?.secret).toBeNull();
    expect(rows[0]?.envelope).not.toContain(secret);
  });

  test("schema rejects invalid envelopes, version mismatches and absent or double credentials", async () => {
    await client.unsafe("TRUNCATE webhook_subscriptions");
    const pg = createPostgresSqlExecutor(connectionString!);
    try {
      const insert = (id: string, secret: string | null, envelope: string | null, version: number | null) => pg.query(
        "INSERT INTO webhook_subscriptions (subscription_id,secret,envelope,key_version,target,event_type) VALUES ($1,$2,$3,$4,'https://home.example','wallet_activity')", [id, secret, envelope, version],
      );
      await expect(insert("bad", null, "not-an-envelope", 1)).rejects.toThrow();
      const valid = `v1.${"a".repeat(16)}.${"b".repeat(22)}.${"c".repeat(8)}`;
      await expect(insert("mismatch", null, valid, 2)).rejects.toThrow();
      await expect(insert("missing-version", null, valid, null)).rejects.toThrow();
      await expect(insert("version-without-envelope", "legacy", null, 1)).rejects.toThrow();
      await expect(insert("both", "legacy", valid, 1)).rejects.toThrow();
      await expect(insert("neither", null, null, null)).rejects.toThrow();
    } finally { await pg.dispose?.(); }
  });
});

function bunExecutor(sqlClient: BunSqlClient, inTransaction = false): SqlExecutor {
  return {
    async query<T>(text: string, values: unknown[] = []) {
      const rows = Array.from(await sqlClient.unsafe(text, values)) as T[];
      return { rows, rowCount: rows.length };
    },
    async transaction<T>(run: (transaction: SqlExecutor) => Promise<T>) {
      if (inTransaction) throw new Error("nested transaction unsupported");
      return sqlClient.begin((transaction) => run(bunExecutor(transaction, true)));
    },
  };
}

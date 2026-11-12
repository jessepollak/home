import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readAllMigrationSql } from "@/tests/helpers/migrations";
import { PostgresBalanceSnapshotStore } from "./snapshot-store";
import { balanceSnapshotStoreContract } from "./snapshot-store.contract";

const connectionString = process.env.BALANCES_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = `balance_snapshot_test_${randomBytes(4).toString("hex")}`;
const enrolledAt = "2026-01-01T00:00:00.000Z";
let admin: Bun.SQL;
let executor: SqlExecutor;

describePostgres("Postgres balance snapshot production contract", () => {
  beforeAll(async () => {
    if (!connectionString) throw new Error("BALANCES_PG_TEST_URL is required");
    admin = new Bun.SQL(connectionString);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of await readAllMigrationSql()) await transaction.unsafe(migration);
    });
    executor = createPostgresSqlExecutor(connectionString, {
      poolFactory: (config) => new Pool({ ...config, options: `-c search_path=${schema}` }),
    });
  });
  afterAll(async () => {
    await executor?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  balanceSnapshotStoreContract({
    name: "Postgres",
    createStore: () => new PostgresBalanceSnapshotStore(executor),
    reset: async () => {
      await admin.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
        await transaction.unsafe("ALTER TABLE operator_events DISABLE TRIGGER operator_events_no_truncate");
        await transaction.unsafe("TRUNCATE balance_snapshots, customer_wallets, customer_credentials, customers CASCADE");
        await transaction.unsafe("ALTER TABLE operator_events ENABLE TRIGGER operator_events_no_truncate");
      });
    },
    enroll: async (address) => {
      const customerId = crypto.randomUUID();
      const credentialId = crypto.randomUUID();
      await executor.transaction(async (transaction) => {
        await transaction.query(
          "INSERT INTO customers (id,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,$2,$2,'sign_in')",
          [customerId, enrolledAt],
        );
        await transaction.query(
          "INSERT INTO customer_credentials (id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES ($1,$2,'base-account',$3,$4,$4)",
          [credentialId, customerId, address, enrolledAt],
        );
        await transaction.query(
          "INSERT INTO customer_wallets (id,customer_id,credential_id,chain_id,address,created_at) VALUES ($1,$2,$3,8453,$4,$5)",
          [crypto.randomUUID(), customerId, credentialId, address, enrolledAt],
        );
      });
    },
  });
});

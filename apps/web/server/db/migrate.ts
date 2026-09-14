// Migration numbers are one global sequence across server/db/migrations and server/funding/migrations; use the next free number.
import "server-only";

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSqlExecutor, type SqlExecutor } from "./sql";
import { migrationGateDecision } from "./migration-gate";

type Migration = {
  id: string;
  path: string;
};

const decision = migrationGateDecision(process.env);
if (!decision.run) {
  console.log(
    decision.reason === "database-unset"
      ? "Skipping database migrations: DATABASE_URL is unset."
      : "Skipping database migrations: Vercel migrations run only in production (set HOME_MIGRATE_ON_BUILD=1 to override).",
  );
} else {
  const migrations = await discoverMigrations();
  const sql = getSqlExecutor();
  let applied = 0;
  try {
    await sql.transaction(async (transaction) => {
      await transaction.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      await transaction.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      for (const migration of migrations) {
        if (await isApplied(transaction, migration.id)) continue;
        await transaction.query(await readFile(migration.path, "utf8"));
        await transaction.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          [migration.id],
        );
        applied += 1;
      }
    });
    console.log(`Applied ${applied} of ${migrations.length} migration(s).`);
  } finally {
    await sql.dispose?.();
  }
}

async function discoverMigrations(): Promise<Migration[]> {
  const dbDirectory = resolve(import.meta.dir, "migrations");
  const fundingDirectory = resolve(import.meta.dir, "../funding/migrations");
  const db = (await readdir(dbDirectory))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort()
    .map((name) => ({ id: `db/${name}`, path: resolve(dbDirectory, name) }));
  const funding = (await readdir(fundingDirectory))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort()
    .map((name) => ({
      id: `funding/${name}`,
      path: resolve(fundingDirectory, name),
    }));
  return [...db, ...funding].sort((left, right) => {
    const byNumber = migrationNumber(left) - migrationNumber(right);
    return byNumber || left.id.localeCompare(right.id);
  });
}

function migrationNumber(migration: Migration): number {
  const match = /(?:^|\/)(\d+)_/.exec(migration.id);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function isApplied(sql: SqlExecutor, id: string): Promise<boolean> {
  const result = await sql.query(
    "SELECT 1 FROM schema_migrations WHERE name = $1",
    [id],
  );
  return result.rows.length === 1;
}

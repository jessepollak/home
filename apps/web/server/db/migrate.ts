import "server-only";

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Migration = {
  id: string;
  path: string;
};

type MigrationSql = {
  unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>;
  begin<T>(run: (transaction: MigrationSql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required to migrate Home persistence.");
}

const migrations = await discoverMigrations();
const sql = new Bun.SQL(connectionString) as unknown as MigrationSql;
let applied = 0;
try {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await transaction.unsafe("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    for (const migration of migrations) {
      if (await isApplied(transaction, migration.id)) continue;
      await transaction.unsafe(await readFile(migration.path, "utf8"));
      await transaction.unsafe(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [migration.id],
      );
      applied += 1;
    }
  });
  console.log(`Applied ${applied} of ${migrations.length} migration(s).`);
} finally {
  await sql.close();
}

async function discoverMigrations(): Promise<Migration[]> {
  const dbDirectory = resolve(import.meta.dir, "migrations");
  const fundingDirectory = resolve(import.meta.dir, "../funding/migrations");
  const db = (await readdir(dbDirectory))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort()
    .map((name) => ({ id: `db/${name}`, path: resolve(dbDirectory, name) }));
  const funding = (await readdir(fundingDirectory))
    .filter((name) => /^002_.*\.sql$/.test(name))
    .sort()
    .map((name) => ({
      id: `funding/${name}`,
      path: resolve(fundingDirectory, name),
    }));
  return [...db, ...funding];
}

async function isApplied(sql: MigrationSql, id: string): Promise<boolean> {
  const rows = await sql.unsafe(
    "SELECT 1 FROM schema_migrations WHERE name = $1",
    [id],
  );
  return rows.length === 1;
}

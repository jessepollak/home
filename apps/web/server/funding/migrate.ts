import "server-only";

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required to migrate funding orders.");
const pool = new Pool({ connectionString });
try {
  const directory = resolve(import.meta.dir, "migrations");
  const migrations = (await readdir(directory)).filter((name) => /^002_.*\.sql$/.test(name)).sort();
  for (const migration of migrations) await pool.query(await readFile(resolve(directory, migration), "utf8"));
  console.log(`Applied ${migrations.length} funding migration(s).`);
} finally { await pool.end(); }

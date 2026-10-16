import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Single seam for integration fixtures that must apply the committed schema.
// Test files load migrations only through this helper so the test-only Oxlint
// override can reject fs/promises everywhere else.
const MIGRATION_DIRS = [
  resolve(import.meta.dir, "../../server/db/migrations"),
  resolve(import.meta.dir, "../../server/funding/migrations"),
] as const;

export async function readMigrationSql(name: string): Promise<string> {
  for (const dir of MIGRATION_DIRS) {
    try {
      return await readFile(resolve(dir, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Unknown migration: ${name}`);
}

export async function readAllMigrationSql(): Promise<string[]> {
  const files = (await Promise.all(MIGRATION_DIRS.map(async (dir, index) =>
    (await readdir(dir)).filter((name) => /^\d+_.*\.sql$/.test(name)).map((name) => ({ name, index, dir }))))).flat();
  files.sort((a,b) => Number(a.name.split("_")[0])-Number(b.name.split("_")[0]) || a.index-b.index || a.name.localeCompare(b.name));
  return Promise.all(files.map(({ name, dir }) => readFile(resolve(dir, name), "utf8")));
}

import { readFile } from "node:fs/promises";
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

import "server-only";

import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

type Outcome = "recent" | "stale" | "missing" | "unreadable";
type BackupMetadata = {
  outcome: Outcome;
  file: string;
  sizeBytes: number;
  modifiedAt: string | null;
  archiveCreatedAt: string | null;
  ageHours: number | null;
  tocEntries: number;
  hasOperatorSettingsData: boolean;
  hasSchemaMigrations: boolean;
};

const exitCodes: Record<Outcome, number> = { recent: 0, stale: 1, missing: 2, unreadable: 3 };

function printResult(metadata: BackupMetadata) {
  console.log(JSON.stringify(metadata));
  console.log(`${metadata.outcome}: ${JSON.stringify(metadata.file)}; a readable artifact is not a verified restore.`);
  process.exitCode = exitCodes[metadata.outcome];
}

function readOptions(): { file: string; maxAgeHours: number } | null {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  let file: string | undefined;
  let maxAgeHours = 24;
  let ageProvided = false;
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) return null;
    if (args[index] === "--file" && file === undefined && value.trim()) file = value;
    else if (args[index] === "--max-age-hours" && !ageProvided && value.trim()) {
      maxAgeHours = Number(value);
      ageProvided = true;
      if (!Number.isFinite(maxAgeHours) || maxAgeHours < 0) return null;
    } else return null;
  }
  return file === undefined ? null : { file, maxAgeHours };
}

async function readToc(file: string): Promise<{ toc: string } | { error: unknown }> {
  try {
    const child = Bun.spawn(["pg_restore", "--list", file], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const [toc, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return code === 0 ? { toc } : { error: code };
  } catch (error) {
    return { error };
  }
}

async function checkBackup(file: string, maxAgeHours: number): Promise<BackupMetadata> {
  const metadata: BackupMetadata = {
    outcome: "missing",
    file: basename(file),
    sizeBytes: 0,
    modifiedAt: null,
    archiveCreatedAt: null,
    ageHours: null,
    tocEntries: 0,
    hasOperatorSettingsData: false,
    hasSchemaMigrations: false,
  };
  let modifiedAt: number;
  try {
    const info = await stat(file);
    metadata.sizeBytes = info.size;
    metadata.modifiedAt = info.mtime.toISOString();
    modifiedAt = info.mtimeMs;
    metadata.ageHours = Math.max(0, (Date.now() - modifiedAt) / 3_600_000);
    if (!info.isFile()) return { ...metadata, outcome: "unreadable" };
    if (info.size === 0) return metadata;
  } catch (error) {
    const absent = error !== null && typeof error === "object" && "code" in error
      && (error.code === "ENOENT" || error.code === "ENOTDIR");
    return { ...metadata, outcome: absent ? "missing" : "unreadable" };
  }
  const result = await readToc(file);
  if ("error" in result) return { ...metadata, outcome: "unreadable" };
  const toc = result.toc;
  const entries = toc.split(/\r?\n/).filter((line) => /^\d+;/.test(line));
  metadata.tocEntries = entries.length;
  metadata.hasOperatorSettingsData = entries.some((line) => /\bTABLE DATA public operator_settings(?:\s|$)/.test(line));
  metadata.hasSchemaMigrations = entries.some((line) => /\bTABLE(?: DATA)? public schema_migrations(?:\s|$)/.test(line));
  const createdAt = /^;\s*Archive created at:?\s+(.+)$/m.exec(toc)?.[1];
  const archiveTime = createdAt === undefined ? NaN : Date.parse(createdAt.trim());
  metadata.archiveCreatedAt = Number.isFinite(archiveTime) ? new Date(archiveTime).toISOString() : null;
  const oldestTime = Number.isFinite(archiveTime) ? Math.min(archiveTime, modifiedAt) : modifiedAt;
  metadata.ageHours = Math.max(0, (Date.now() - oldestTime) / 3_600_000);
  metadata.outcome = !metadata.hasOperatorSettingsData || !metadata.hasSchemaMigrations || (createdAt !== undefined && !Number.isFinite(archiveTime))
    ? "unreadable" : metadata.ageHours > maxAgeHours ? "stale" : "recent";
  return metadata;
}

const options = readOptions();
if (options === null) {
  printResult({
    outcome: "unreadable", file: "", sizeBytes: 0, modifiedAt: null, archiveCreatedAt: null, ageHours: null,
    tocEntries: 0, hasOperatorSettingsData: false, hasSchemaMigrations: false,
  });
  console.error("Usage: db:backup-check -- --file <dump> [--max-age-hours 24]");
} else {
  printResult(await checkBackup(resolve(options.file), options.maxAgeHours));
}

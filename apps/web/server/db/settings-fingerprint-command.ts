import "server-only";

import { createHash } from "node:crypto";
import { Pool } from "pg";
import { readDatabaseUrl } from "@/server/config/env";

type SettingsRow = {
  domain: string;
  schema_version: number;
  revision: string;
  updated_at: Date;
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError();
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function safeCount(value: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError();
  return count;
}

function reportFailure(error: unknown) {
  const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "Error";
  const code = error !== null && typeof error === "object" && "code" in error
    && typeof error.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : undefined;
  console.error(JSON.stringify({ name, ...(code === undefined ? {} : { code }) }));
  process.exitCode = 3;
}

async function printFingerprint(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  pool.on("error", reportFailure);
  try {
    const client = await pool.connect();
    let rolledBack = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SET LOCAL lock_timeout = '10s'");
      const migrations = await client.query<{ count: string; latest: string | null }>(`
        SELECT count(*)::text AS count,
          (SELECT name FROM public.schema_migrations
            ORDER BY applied_at DESC, substring(name FROM '/([0-9]+)_')::integer DESC NULLS LAST,
              name COLLATE "C" DESC LIMIT 1) AS latest
        FROM public.schema_migrations
      `);
      const settings = await client.query<SettingsRow>(`
        SELECT domain, schema_version, revision::text, updated_at, value
        FROM public.operator_settings ORDER BY domain COLLATE "C"
      `);
      const audit = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM public.admin_audit_log");
      const snapshot = {
        migrations: { count: safeCount(migrations.rows[0].count), latest: migrations.rows[0].latest },
        settings: settings.rows.map((row) => ({
          domain: row.domain,
          schemaVersion: row.schema_version,
          revision: safeCount(row.revision),
          updatedAt: row.updated_at.toISOString(),
          valueSha256: sha256(row.value),
        })),
        auditLogEntries: safeCount(audit.rows[0].count),
      };
      await client.query("ROLLBACK");
      rolledBack = true;
      console.log(JSON.stringify({ ...snapshot, fingerprint: sha256(snapshot) }));
    } finally {
      client.release(!rolledBack);
    }
  } finally {
    await pool.end();
  }
}

async function fingerprintResult(connectionString: string): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await printFingerprint(connectionString);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

const connectionString = readDatabaseUrl();
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exitCode = 2;
} else {
  const result = await fingerprintResult(connectionString);
  if (!result.ok) reportFailure(result.error);
}

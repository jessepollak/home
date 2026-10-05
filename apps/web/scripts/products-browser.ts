import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { readMigrationSql } from "../tests/helpers/migrations";

const fixtureUrl = process.env.HOME_PRODUCTS_PG_TEST_URL?.trim();
if (!fixtureUrl) throw new Error("Set HOME_PRODUCTS_PG_TEST_URL to a disposable loopback PostgreSQL database; Products browser coverage never skips.");
const url = new URL(fixtureUrl);
if (!["postgres:", "postgresql:"].includes(url.protocol)
  || !url.username
  || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  || url.search || url.hash) {
  throw new Error("HOME_PRODUCTS_PG_TEST_URL must be a loopback PostgreSQL URL with its database user, without query options or a fragment.");
}
const cwd = resolve(import.meta.dir, "..");
for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) {
  if (existsSync(resolve(cwd, file))) throw new Error(`Products fixtures require a checkout without ${file}.`);
}
const schema = `products_browser_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5_000 });
let created = false;
let interrupted = false;
let child: Bun.Subprocess<"inherit", "inherit", "inherit"> | undefined;
const interrupt = () => {
  interrupted = true;
  process.exitCode = 1;
  child?.kill("SIGINT");
};
const requireUninterrupted = () => {
  if (interrupted) throw new Error("Products fixture interrupted.");
};
const setupQuery = async (sql: string) => {
  requireUninterrupted();
  await admin.query(sql);
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  await admin.connect();
  await setupQuery(`CREATE SCHEMA ${schema}`);
  created = true;
  await setupQuery("BEGIN");
  await setupQuery(`SET LOCAL search_path TO ${schema}`);
  await setupQuery(await readMigrationSql("010_operator_settings.sql"));
  await setupQuery("COMMIT");
  requireUninterrupted();
  url.searchParams.set("options", `-c search_path=${schema}`);
  const env: Record<string, string> = { HOME_PLAYWRIGHT_PRODUCTS: "1", DATABASE_URL: url.toString(), NEXT_TELEMETRY_DISABLED: "1" };
  for (const key of ["HOME", "PATH", "TMPDIR", "CI", "HOME_FIXTURE_PORT", "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "NODE_EXTRA_CA_CERTS"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  child = Bun.spawn(["./node_modules/.bin/playwright", "test", "--config", "playwright.config.ts", ...process.argv.slice(2)], {
    cwd,
    env,
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
    detached: true,
  });
  try {
    const exitCode = await child.exited;
    process.exitCode = interrupted ? 1 : exitCode;
  } finally { child = undefined; }
} finally {
  try {
    if (created) {
      await admin.query("ROLLBACK");
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      console.log("Products fixture schema removed.");
    }
  } finally {
    try { await admin.end(); }
    finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
  }
}

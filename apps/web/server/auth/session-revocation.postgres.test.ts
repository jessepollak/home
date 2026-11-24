import { Pool } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { MIGRATION_BOOTSTRAP_TIMEOUT_MS, readAllMigrationSql } from "@/tests/helpers/migrations";
import { assertCredentialLive } from "@/server/account-deletion/tombstone";
import { authorizeSession } from "@/server/auth/authorize";
import { createSessionHandler } from "@/server/cdp/session";
import { readOperatorPageDecision } from "@/server/operator/page";
import { createNativeBaseLogoutHandler, signedValue } from "./native-base-session";
import { createSessionRevocations } from "./session-revocation";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim() ?? "";
const schema = `session_revocation_test_${randomBytes(4).toString("hex")}`;
const SECRET = "test-home-session-secret-that-is-long-enough";
const ORIGIN = "http://127.0.0.1:3103";
const ADDRESS = "0x3333333333333333333333333333333333333333";
const NOW = new Date("2026-09-12T12:00:00.000Z");
let admin: Bun.SQL;
const executors: SqlExecutor[] = [];

function instance(): SqlExecutor {
  const sql = createPostgresSqlExecutor(connectionString, { poolFactory: (config) => new Pool({ ...config, options: `-c search_path=${schema}` }) });
  executors.push(sql);
  return sql;
}

function token(issuedAt: Date): string {
  const subject = `base-${createHash("sha256").update(ADDRESS).digest("hex").slice(0, 32)}`;
  return signedValue(Buffer.from(SECRET), JSON.stringify({
    version: 1,
    session: { user: { subject }, smartAccount: { address: ADDRESS, chainId: 8453 }, accountProvider: "base-account" },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
  }));
}

function sessionHandler(sql: SqlExecutor) {
  const revocations = createSessionRevocations(sql);
  return createSessionHandler({
    getValidator: async () => { throw new Error("CDP is not used by native sessions"); },
    baseAccountEnabled: true,
    homeSessionSecret: SECRET,
    revocations: () => revocations,
    assertLive: (session) => assertCredentialLive(sql, session),
  });
}

function sessionRequest(value: string): Request {
  return new Request(`${ORIGIN}/api/session`, { headers: { Cookie: `home-session=${value}`, "X-Home-Account-Provider": "base-account" } });
}

(connectionString ? describe : describe.skip)("native sign-out revocation on PostgreSQL", () => {
  beforeAll(async () => {
    setSystemTime(NOW);
    admin = new Bun.SQL(connectionString);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => { await tx.unsafe(`SET LOCAL search_path TO ${schema}`); for (const migration of await readAllMigrationSql()) await tx.unsafe(migration); });
  }, MIGRATION_BOOTSTRAP_TIMEOUT_MS);
  afterAll(async () => {
    setSystemTime();
    for (const sql of executors) await sql.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close();
  });

  test("a cookie retained across logout is rejected by session, owner and operator-page reads on every instance while the same owner's other session still authorizes", async () => {
    const signedOut = token(new Date(NOW.getTime() - 60_000));
    const control = token(new Date(NOW.getTime() - 30_000));
    const writer = instance(), reader = instance();
    for (const value of [signedOut, control]) expect((await sessionHandler(reader)(sessionRequest(value))).status).toBe(200);

    const writerRevocations = createSessionRevocations(writer);
    const logout = createNativeBaseLogoutHandler({ sessionSecret: SECRET, now: () => NOW, revocations: () => writerRevocations });
    const response = await logout(new Request(`${ORIGIN}/api/auth/base/logout`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: `home-session=${signedOut}` },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((value) => value.startsWith("home-session=;") && value.includes("Max-Age=0"))).toBe(true);

    const rejected = await sessionHandler(reader)(sessionRequest(signedOut));
    expect(rejected.status).toBe(401);
    const body = await rejected.text();
    expect(JSON.parse(body)).toEqual({ error: { code: "UNAUTHENTICATED", message: "A valid access token is required." } });
    expect(body.toLowerCase()).not.toContain(ADDRESS);
    const owner = await authorizeSession(sessionRequest(signedOut), sessionHandler(reader), async () => {});
    expect(owner instanceof Response && owner.status).toBe(401);

    const previous = { secret: process.env.HOME_SESSION_SECRET, operators: process.env.HOME_OPERATOR_ADDRESSES };
    process.env.HOME_SESSION_SECRET = SECRET;
    process.env.HOME_OPERATOR_ADDRESSES = ADDRESS;
    try {
      const readerRevocations = createSessionRevocations(reader);
      const page = (value: string) => readOperatorPageDecision({ getAll: (name) => name === "home-session" ? [{ value }] : [] }, () => readerRevocations);
      expect(await page(signedOut)).toEqual({ kind: "forbidden" });
      expect(await page(control)).toEqual({ kind: "operator", address: ADDRESS, provider: "base-account" });
    } finally {
      for (const [name, value] of [["HOME_SESSION_SECRET", previous.secret], ["HOME_OPERATOR_ADDRESSES", previous.operators]] as const) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }

    const allowed = await sessionHandler(reader)(sessionRequest(control));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ smartAccount: { address: ADDRESS } });
  });

  test("logout sweeps expired revocations", async () => {
    const sql = instance();
    await sql.query("INSERT INTO home_session_revocations(token_digest,revoked_at,expires_at) VALUES ($1,$2,$2)", ["0".repeat(64), new Date(NOW.getTime() - 1)]);
    await createSessionRevocations(sql).revoke(token(NOW), new Date(NOW.getTime() + 60_000), NOW);
    expect((await sql.query<{ token_digest: string }>("SELECT token_digest FROM home_session_revocations WHERE expires_at<=$1", [NOW])).rowCount).toBe(0);
  });
});

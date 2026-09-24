import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { describeUserTokenStore } from "./testing/describeUserTokenStore";
import { PostgresFundingProviderUserTokenStore } from "./user-token-store";
import { randomBytes } from "node:crypto";
import { resolveSecretKeyring, sealSecret } from "@/server/secrets/at-rest";
import { userTokenAad } from "./provider-user-token";
import { rotateUserTokens, verifyUserTokens } from "./user-token-rotation";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const SCHEMA = "funding_user_token_contract_test";
let admin: Bun.SQL, sql: SqlExecutor, store: PostgresFundingProviderUserTokenStore;
async function inSchema(text: string) {
  await admin.begin(async (transaction) => { await transaction.unsafe(`SET LOCAL search_path TO ${SCHEMA}`); await transaction.unsafe(text); });
}
describePostgres("Postgres funding provider user token store", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!);
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${SCHEMA}`);
    await inSchema(await readMigrationSql("008_funding_provider_user_tokens.sql"));
    sql = createPostgresSqlExecutor(connectionString!, { schema: SCHEMA });
    store = new PostgresFundingProviderUserTokenStore(sql);
  });
  beforeEach(async () => { await sql.query("TRUNCATE funding_provider_user_tokens"); });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); await admin?.close(); });
  describeUserTokenStore("shared PostgreSQL contract", () => store, async (key) => {
    const result = await sql.query("SELECT * FROM funding_provider_user_tokens WHERE account_provider=$1 AND owner_subject=$2", [key.owner.accountProvider, key.owner.subject]);
    return JSON.stringify(result.rows);
  });
  test("SQL version scan, CAS rotation and verification operate on committed rows", async () => {
    const old = randomBytes(32).toString("base64url"), active = randomBytes(32).toString("base64url");
    const oldRing = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: old, HOME_SECRET_KEY_VERSION: "1" });
    const newRing = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: active, HOME_SECRET_ENCRYPTION_KEY_PREVIOUS: old, HOME_SECRET_KEY_VERSION: "2" });
    if (!oldRing.ok || !newRing.ok) throw new Error("invalid synthetic keyring");
    const key = { owner: { accountProvider: "base-account" as const, subject: "owner" }, providerId: "coinbase", region: "US", sandbox: true };
    const binding = { ...key, destination: "0x1111111111111111111111111111111111111111" };
    const now = "2026-09-18T00:00:00.000Z";
    await store.putIfEnvelope(key, null, { destination: binding.destination, envelope: sealSecret(oldRing.keyring, "synthetic-private", userTokenAad(binding)), returnedAt: now, updatedAt: now });
    expect(await store.listNotAtVersion(2, null, 10)).toHaveLength(1);
    expect((await verifyUserTokens(store, newRing.keyring)).safeToRemovePrevious).toBe(false);
    expect((await rotateUserTokens(store, newRing.keyring, () => new Date(now))).rotated).toBe(1);
    expect(await verifyUserTokens(store, newRing.keyring)).toEqual({ notAtActive: 0, unreadable: 0, safeToRemovePrevious: true });
  });
  test("database constraint refuses plaintext and store query failures redact driver details", async () => {
    const plaintext = "synthetic-private-token";
    await expect(sql.query("INSERT INTO funding_provider_user_tokens (account_provider,owner_subject,provider_id,region,sandbox,destination,envelope,key_version,returned_at,updated_at) VALUES ('base-account','owner','coinbase','US',true,'0x1111111111111111111111111111111111111111',$1,1,now(),now())", [plaintext])).rejects.toThrow();
    let error: unknown;
    try { await store.putIfEnvelope({ owner: { accountProvider: "base-account", subject: "" }, providerId: "coinbase", region: "US", sandbox: true }, null, { destination: "0x1111111111111111111111111111111111111111", envelope: plaintext, returnedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }); } catch (caught) { error = caught; }
    expect(String(error) + JSON.stringify(error)).not.toContain(plaintext);
    const keyring = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "1" });
    if (!keyring.ok) throw new Error("invalid synthetic keyring");
    const encrypted = sealSecret(keyring.keyring, plaintext, { purpose: "test", binding: {} });
    try {
      await store.putIfEnvelope({ owner: { accountProvider: "base-account", subject: "" }, providerId: "coinbase", region: "US", sandbox: true }, null, { destination: "0x1111111111111111111111111111111111111111", envelope: encrypted, returnedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" });
      throw new Error("unexpected accepted row");
    } catch (caught) {
      expect(String(caught) + JSON.stringify(caught)).toBe("Error: query-failed{}");
    }
  });
});

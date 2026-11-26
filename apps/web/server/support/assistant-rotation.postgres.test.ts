import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { resolveSecretKeyring } from "@/server/secrets/at-rest";
import { MIGRATION_BOOTSTRAP_TIMEOUT_MS, readAllMigrationSql } from "@/tests/helpers/migrations";
import { SupportAssistantStore } from "./assistant";

const url = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `support_key_rotation_${randomBytes(4).toString("hex")}`;
const actor = "0x1111111111111111111111111111111111111111" as const;
const old = randomBytes(32).toString("base64url"), active = randomBytes(32).toString("base64url");
const v1 = { HOME_SECRET_ENCRYPTION_KEY: old, HOME_SECRET_KEY_VERSION: "1" };
const v2 = { HOME_SECRET_ENCRYPTION_KEY: active, HOME_SECRET_ENCRYPTION_KEY_PREVIOUS: old, HOME_SECRET_KEY_VERSION: "2" };
const v2Only = { HOME_SECRET_ENCRYPTION_KEY: active, HOME_SECRET_KEY_VERSION: "2" };
function ring(env: Record<string, string>) {
  const resolved = resolveSecretKeyring(env);
  if (!resolved.ok) throw new Error("invalid synthetic keyring");
  return resolved.keyring;
}
let admin: Bun.SQL, sql: SqlExecutor;
async function storedEnvelope() {
  const row = (await sql.query<{ envelope: string }>("SELECT envelope FROM support_assistant_credentials")).rows[0];
  if (!row) throw new Error("missing credential row");
  return row.envelope;
}

(url ? describe : describe.skip)("support assistant credential key rotation", () => {
  beforeAll(async () => {
    if (!url) throw new Error("FUNDING_PG_TEST_URL is required");
    admin = new Bun.SQL(url);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of await readAllMigrationSql()) await tx.unsafe(migration);
    });
    sql = createPostgresSqlExecutor(url, { schema });
  }, MIGRATION_BOOTSTRAP_TIMEOUT_MS);
  beforeEach(async () => { await sql.query("TRUNCATE support_assistant_credentials"); });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close(); });

  test("a credential sealed under the previous version rotates and stays usable once the previous key is removed", async () => {
    await new SupportAssistantStore(sql, v1).put("synthetic-gateway-key", actor);
    const store = new SupportAssistantStore(sql, v2);
    expect((await store.verifyCredential(ring(v2))).safeToRemovePrevious).toBe(false);
    expect(await store.rotateCredential(ring(v2))).toEqual({ rotated: 1, unreadable: 0, skippedConcurrent: 0 });
    expect(await store.rotateCredential(ring(v2))).toEqual({ rotated: 0, unreadable: 0, skippedConcurrent: 0 });
    expect(await store.verifyCredential(ring(v2))).toEqual({ notAtActive: 0, unreadable: 0, safeToRemovePrevious: true });
    expect((await new SupportAssistantStore(sql, v2Only).effective()).key).toBe("synthetic-gateway-key");
  });

  test("an unreadable or concurrently replaced credential is preserved and reported", async () => {
    await new SupportAssistantStore(sql, { HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "1" }).put("lost-key", actor);
    const unreadable = await storedEnvelope();
    const store = new SupportAssistantStore(sql, v2);
    expect(await store.rotateCredential(ring(v2))).toEqual({ rotated: 0, unreadable: 1, skippedConcurrent: 0 });
    expect(await store.verifyCredential(ring(v2))).toEqual({ notAtActive: 1, unreadable: 1, safeToRemovePrevious: false });
    expect(await storedEnvelope()).toBe(unreadable);

    await new SupportAssistantStore(sql, v1).put("prior-key", actor);
    let raced = false;
    const racing: SqlExecutor = {
      async query<T>(text: string, values?: unknown[]) {
        const result = await sql.query<T>(text, values);
        if (!raced && text.startsWith("SELECT envelope FROM support_assistant_credentials")) {
          raced = true;
          await new SupportAssistantStore(sql, v2).put("operator-replacement", actor);
        }
        return result;
      },
      transaction: (fn) => sql.transaction(fn),
    };
    expect(await new SupportAssistantStore(racing, v2).rotateCredential(ring(v2))).toEqual({ rotated: 0, unreadable: 0, skippedConcurrent: 1 });
    expect((await new SupportAssistantStore(sql, v2Only).effective()).key).toBe("operator-replacement");
  });
});

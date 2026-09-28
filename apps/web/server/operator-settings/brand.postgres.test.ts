import { describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor } from "@/server/db/sql";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { BRAND_DEFAULTS, brandSettingsPutRequest, parseBrandSettingsResponse } from "@/shared/operator-branding/contract";
import { readOperatorConfig } from "@/server/operator/config";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { resolveBrand } from "./brand";
import { createSettingsDomainHandlers } from "./handlers";
import { OperatorSettingsStore } from "./store";

const connectionString = process.env.OPERATOR_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "operator_593_brand_test";
const actor = "0x1111111111111111111111111111111111111111" as const;
const value = { displayName: "Home Plus", description: "Money, at home", primaryColor: "#000000", backgroundColor: "#0052ff" };
type AdminSql = { unsafe(text: string): Promise<ArrayLike<unknown>>; begin<T>(fn: (tx: AdminSql) => Promise<T>): Promise<T>; close(): Promise<void> };
const session: VerifiedAccountSession = { user: { subject: "operator" }, smartAccount: { address: actor, chainId: BASE_CHAIN_ID }, accountProvider: "base-account" };

describePostgres("brand settings persistence", () => {
  test("store, handler, restart, migration replay and resolver preserve brand values", async () => {
    const admin = new Bun.SQL(connectionString!) as unknown as AdminSql;
    let sql: ReturnType<typeof createPostgresSqlExecutor> | undefined;
    try {
      const migration = await readMigrationSql("010_operator_settings.sql");
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.unsafe(`CREATE SCHEMA ${schema}`);
      await admin.begin(async (tx) => { await tx.unsafe(`SET LOCAL search_path TO ${schema}`); await tx.unsafe(migration); });
      sql = createPostgresSqlExecutor(connectionString!, { schema });
      const store = new OperatorSettingsStore(sql);
      expect((await store.read("brand")).settings).toEqual({ value: BRAND_DEFAULTS, revision: 0, source: "default", updatedAt: null, updatedBy: null });
      expect((await store.write({ domain: "brand", expectedRevision: 0, value, actor })).settings).toMatchObject({ value, revision: 1, source: "stored" });
      expect((await store.read("brand")).settings.value).toEqual(value);
      const next = { ...value, description: "A better home for money" };
      const handlers = createSettingsDomainHandlers({ authorize: async () => session, config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: actor }), store: () => store });
      const request = new Request("https://home.test/api/admin/settings/brand", { method: "PUT", headers: { origin: "https://home.test", "content-type": "application/json" }, body: JSON.stringify(brandSettingsPutRequest(1, next)) });
      const response = await handlers.PUT(request, { params: Promise.resolve({ domain: "brand" }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("private");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(parseBrandSettingsResponse(await response.json())?.settings).toMatchObject({ value: next, revision: 2, source: "stored" });
      expect((await store.read("brand")).settings.value).toEqual(next);
      const freshSql = createPostgresSqlExecutor(connectionString!, { schema });
      try {
        const freshStore = new OperatorSettingsStore(freshSql);
        expect((await freshStore.read("brand")).settings.value).toEqual(next);
        await admin.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
          await tx.unsafe(migration);
          await tx.unsafe("CREATE TABLE IF NOT EXISTS brand_additive_test (id integer PRIMARY KEY)");
        });
        expect((await freshStore.read("brand")).settings).toMatchObject({ value: next, revision: 2, source: "stored" });
        expect(await resolveBrand({ store: () => freshStore })).toMatchObject({ settings: next, source: "stored", tokens: { primaryForeground: "#ffffff", backgroundForeground: "#ffffff" } });
      } finally { await freshSql.dispose?.(); }
    } finally {
      await sql?.dispose?.();
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.close();
    }
  });
});

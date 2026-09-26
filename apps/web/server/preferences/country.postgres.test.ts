import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { CustomerResolver } from "@/server/customers/resolve";
import { CountryPreferenceStore } from "./country";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "country_preference_contract_test";
type Admin = { unsafe(text: string): Promise<unknown>; begin<T>(run: (tx: Admin) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: Admin;
let sql: SqlExecutor;
let store: CountryPreferenceStore;
const session = { accountProvider: "cdp-embedded" as const, user: { subject: "country-preference-test" }, smartAccount: null };

describePostgres("customer preference PostgreSQL contract", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as Admin;
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of ["001_actions.sql", "011_operator_registry.sql", "014_customer_preferences.sql"]) {
        await tx.unsafe(await readMigrationSql(migration));
      }
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
  });
  beforeEach(async () => { await sql.query("DELETE FROM customers"); });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("read never creates a customer and missing preference returns null", async () => {
    expect(await store.readCountryPreference(session)).toBeNull();
    expect((await sql.query("SELECT id FROM customers")).rows).toHaveLength(0);
    await new CustomerResolver(sql).resolveCustomer(session, { create: true });
    expect(await store.readCountryPreference(session)).toBeNull();
  });

  test("adoption cannot overwrite saved country, while explicit choice can", async () => {
    expect(await store.writeCountryPreference(session, "MX", { onlyIfUnset: true })).toBe("MX");
    expect(await store.writeCountryPreference(session, "BR", { onlyIfUnset: true })).toBe("MX");
    expect(await store.writeCountryPreference(session, "DE", { onlyIfUnset: false })).toBe("DE");
    expect(await store.readCountryPreference(session)).toBe("DE");
    expect((await sql.query<{ country: string | null }>("SELECT country FROM customers")).rows[0]?.country).toBeNull();
  });

  test("account preference only accepts country codes", async () => {
    await store.writeCountryPreference(session, "GB", { onlyIfUnset: false });
    await expect(store.writeCountryPreference(session, "GLOBAL" as "GB", { onlyIfUnset: false }))
      .rejects.toThrow("Invalid country preference");
    const customer = await new CustomerResolver(sql).resolveCustomer(session, { create: false });
    await expect(sql.query(
      "UPDATE customer_preferences SET country_preference=$1 WHERE customer_id=$2",
      ["GLOBAL", customer!.id],
    )).rejects.toMatchObject({ code: "23514" });
    expect(await store.readCountryPreference(session)).toBe("GB");
  });

  test("concurrent adoptions retain exactly one value and customer deletion cascades", async () => {
    const results = await Promise.all(["MX", "BR"].map((id) => store.writeCountryPreference(session, id as "MX" | "BR", { onlyIfUnset: true })));
    expect(new Set(results).size).toBe(1);
    expect(await store.readCountryPreference(session)).toBe(results[0]);
    await sql.query("DELETE FROM customers");
    expect((await sql.query("SELECT customer_id FROM customer_preferences")).rows).toHaveLength(0);
  });
});

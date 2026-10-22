import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CustomerResolver } from "@/server/customers/resolve";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { readAllMigrationSql, readMigrationSql } from "@/tests/helpers/migrations";
import { CountryPreferenceStore, readCountryPreferenceForRender } from "./country";
import { createCountryPreferenceHandler, createCountryPreferenceReadHandler } from "./handler";

const url = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `country_preference_${randomBytes(4).toString("hex")}`;
const session = (subject: string): VerifiedAccountSession => ({ accountProvider: "cdp-embedded", user: { subject }, smartAccount: null });
const request = (body?: unknown) => new Request("https://home.test/api/account/country-preference?subject=owner-B", {
  method: body === undefined ? "GET" : "PUT", ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const save = { onlyIfUnset: false }, adopt = { onlyIfUnset: true };
let admin: Bun.SQL, sql: SqlExecutor, store: CountryPreferenceStore;

(url ? describe : describe.skip)("account country and display currency PostgreSQL integrity", () => {
  beforeAll(async () => {
    if (!url) throw new Error("FUNDING_PG_TEST_URL is required");
    admin = new Bun.SQL(url);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of await readAllMigrationSql()) await tx.unsafe(migration);
      await tx.unsafe(await readMigrationSql("025_display_currency.sql"));
    });
    sql = createPostgresSqlExecutor(url, { poolFactory: (config) => new Pool({ ...config, options: `-c search_path=${schema}` }) });
    store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
  });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close(); });

  test("session A cannot change or read B through supplied body or query identity", async () => {
    const owner = session("owner-A"), other = session("owner-B");
    await store.writeCountryPreference(other, { regionId: "BR", displayCurrency: "EUR" }, save);
    const write = createCountryPreferenceHandler({ authorize: async () => owner, regionOffered: async () => true,
      write: (verified, input, options) => store.writeCountryPreference(verified, input, options) });
    const response = await write(request({ version: 2, displayCurrency: "USD", subject: other.user.subject, customerId: "owner-B" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 2, regionId: null, displayCurrency: "USD" });
    const read = createCountryPreferenceReadHandler({ authorize: async () => owner, read: (verified) => store.readCountryPreference(verified) });
    expect(await (await read(request())).json()).toEqual({ version: 2, regionId: null, displayCurrency: "USD" });
    expect(await store.readCountryPreference(other)).toEqual({ regionId: "BR", displayCurrency: "EUR" });
    expect(await readCountryPreferenceForRender(owner, store)).toEqual({ regionId: null, displayCurrency: "USD" });
    expect(await store.readCountryPreference({ ...owner, accountProvider: "base-account" })).toEqual({ regionId: null, displayCurrency: null });
  });

  test("partial writes preserve the omitted field, including concurrent saves", async () => {
    const owner = session("independent-fields");
    expect(await store.readCountryPreference(owner)).toEqual({ regionId: null, displayCurrency: null });
    await store.writeCountryPreference(owner, { regionId: "US", displayCurrency: "USD" }, save);
    expect(await store.writeCountryPreference(owner, { regionId: "BR" }, save)).toEqual({ regionId: "BR", displayCurrency: "USD" });
    expect(await store.writeCountryPreference(owner, { displayCurrency: "country-default" }, save)).toEqual({ regionId: "BR", displayCurrency: "country-default" });
    await Promise.all([
      store.writeCountryPreference(owner, { regionId: "GB" }, save),
      store.writeCountryPreference(owner, { displayCurrency: "EUR" }, save),
    ]);
    expect(await store.readCountryPreference(owner)).toEqual({ regionId: "GB", displayCurrency: "EUR" });
  });

  test("adoption fills only each unset field and never replaces explicit or country-default choices", async () => {
    for (const displayCurrency of ["USD", "country-default"] as const) {
      const owner = session(`adopt-existing-${displayCurrency}`);
      await store.writeCountryPreference(owner, { displayCurrency }, save);
      expect(await store.writeCountryPreference(owner, { regionId: "BR", displayCurrency: "EUR" }, adopt)).toEqual({ regionId: "BR", displayCurrency });
      expect(await store.writeCountryPreference(owner, { regionId: "US", displayCurrency: "GBP" }, adopt)).toEqual({ regionId: "BR", displayCurrency });
    }
    const country = session("adopt-existing-country");
    await store.writeCountryPreference(country, { regionId: "US" }, save);
    expect(await store.writeCountryPreference(country, { regionId: "BR", displayCurrency: "EUR" }, adopt)).toEqual({ regionId: "US", displayCurrency: "EUR" });
    expect(await store.writeCountryPreference(session("adopt-empty"), { regionId: "BR", displayCurrency: "country-default" }, adopt)).toEqual({ regionId: "BR", displayCurrency: "country-default" });
  });

  test("an adoption waiting on a concurrent saved currency cannot overwrite it", async () => {
    const owner = session("adopt-race");
    const customer = await new CustomerResolver(sql).resolveCustomer(owner, { create: true });
    await store.writeCountryPreference(owner, { regionId: "US" }, save);
    let release = () => {}, locked = () => {};
    const held = new Promise<void>((resolve) => { locked = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const saved = sql.transaction(async (tx) => {
      await tx.query("UPDATE customer_preferences SET display_currency='USD' WHERE customer_id=$1", [customer.id]);
      locked();
      await resume;
    });
    await held;
    let adopting = () => {};
    const attempted = new Promise<void>((resolve) => { adopting = resolve; });
    const observingSql: SqlExecutor = {
      ...sql,
      transaction: (fn) => sql.transaction((tx) => fn({
        ...tx,
        query: <T>(text: string, values?: unknown[]) => {
          const pending = tx.query<T>(text, values);
          if (text.startsWith("INSERT INTO customer_preferences")) adopting();
          return pending;
        },
      })),
    };
    const adopter = new CountryPreferenceStore(observingSql, new CustomerResolver(sql));
    const adoption = adopter.writeCountryPreference(owner, { regionId: "BR", displayCurrency: "EUR" }, adopt);
    await attempted;
    release();
    await saved;
    expect(await adoption).toEqual({ regionId: "US", displayCurrency: "USD" });
  });

  test("migration is re-runnable and preserves withdrawn codes while rejecting invalid stored shapes", async () => {
    const owner = session("withdrawn-currency");
    const customer = await new CustomerResolver(sql).resolveCustomer(owner, { create: true });
    await store.writeCountryPreference(owner, { regionId: "US", displayCurrency: "USD" }, save);
    await sql.query("UPDATE customer_preferences SET display_currency='ZZZ' WHERE customer_id=$1", [customer.id]);
    expect(await store.readCountryPreference(owner)).toEqual({ regionId: "US", displayCurrency: "ZZZ" });
    expect(await store.writeCountryPreference(owner, { regionId: "BR" }, save)).toEqual({ regionId: "BR", displayCurrency: "ZZZ" });
    for (const invalid of ["usd", "USDC", "US", ""]) {
      await expect(sql.query("UPDATE customer_preferences SET display_currency=$2 WHERE customer_id=$1", [customer.id, invalid])).rejects.toMatchObject({ code: "23514" });
    }
  });

  test("representative owner reads and conflict writes retain selective primary and unique indexes", async () => {
    await sql.query("INSERT INTO customers(id,first_seen_at,last_seen_at,first_seen_source) SELECT md5('preference-customer'||g)::uuid,now(),now(),'sign_in' FROM generate_series(1,30000) g");
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) SELECT md5('preference-credential'||g)::uuid,md5('preference-customer'||g)::uuid,'cdp-embedded','bulk-owner-'||g,now(),now() FROM generate_series(1,30000) g");
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) SELECT md5('skew-credential'||g)::uuid,md5('preference-customer1')::uuid,'cdp-embedded','skew-owner-'||g,now(),now() FROM generate_series(1,30000) g");
    await sql.query("INSERT INTO customer_preferences(customer_id,country_preference,display_currency) SELECT md5('preference-customer'||g)::uuid,'US','country-default' FROM generate_series(1,30000) g");
    for (const table of ["customers", "customer_credentials", "customer_preferences"]) await sql.query(`ANALYZE ${table}`);
    type Node = { "Node Type": string; "Index Name"?: string; "Index Cond"?: string; "Actual Rows"?: number; "Actual Loops"?: number; "Shared Hit Blocks"?: number; "Shared Read Blocks"?: number; "Conflict Arbiter Indexes"?: string[]; Plans?: Node[] };
    type Plan = { Plan: Node; "Execution Time"?: number };
    const nodes = (node: Node): Node[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
    const measured: SqlExecutor = {
      query: async <T>(text: string, values?: unknown[]) => {
        const result = await sql.query<{ "QUERY PLAN": Plan[] }>(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${text}`, values);
        const plan = result.rows[0]?.["QUERY PLAN"][0];
        if (!plan) throw new Error("Missing preference read plan");
        const all = nodes(plan.Plan);
        expect(all.some((node) => node["Index Name"] === "customer_credentials_account_provider_subject_key")).toBe(true);
        expect(all.some((node) => node["Index Name"] === "customer_preferences_pkey")).toBe(true);
        expect(all.some((node) => node["Node Type"] === "Seq Scan")).toBe(false);
        expect(all.every((node) => (node["Actual Rows"] ?? 0) <= 1)).toBe(true);
        console.info("Preference read plan", { case: values?.[1], elapsedMs: plan["Execution Time"], rows: plan.Plan["Actual Rows"],
          hits: plan.Plan["Shared Hit Blocks"], reads: plan.Plan["Shared Read Blocks"],
          indexes: all.filter((node) => node["Index Name"]).map((node) => ({ index: node["Index Name"], condition: node["Index Cond"], rows: node["Actual Rows"], loops: node["Actual Loops"] })) });
        return sql.query<T>(text, values);
      },
      transaction: (fn) => sql.transaction((tx) => fn({
        ...tx,
        query: async <T>(text: string, values?: unknown[]) => {
          if (text.startsWith("INSERT INTO customer_preferences")) {
            const result = await tx.query<{ "QUERY PLAN": Plan[] }>(`EXPLAIN (FORMAT JSON) ${text}`, values);
            const plan = result.rows[0]?.["QUERY PLAN"][0];
            expect(plan?.Plan["Conflict Arbiter Indexes"]).toEqual(["customer_preferences_pkey"]);
            console.info("Preference write plan", { conflictIndexes: plan?.Plan["Conflict Arbiter Indexes"] });
          }
          return tx.query<T>(text, values);
        },
      })),
    };
    const measuredStore = new CountryPreferenceStore(measured, new CustomerResolver(sql));
    for (const subject of ["bulk-owner-15000", "skew-owner-30000", "missing-owner"]) await measuredStore.readCountryPreference(session(subject));
    expect(await measuredStore.writeCountryPreference(session("bulk-owner-15000"), { displayCurrency: "EUR" }, adopt)).toEqual({ regionId: "US", displayCurrency: "country-default" });
  });
});

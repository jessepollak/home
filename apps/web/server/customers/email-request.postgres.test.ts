import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { EmailRequestIdentityMismatchError, EmailRequestStore } from "./email-request";
import { CustomerResolver } from "./resolve";
import { parseAddress } from "@/shared/chain/hex";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "customer_email_request_test";
type Admin = { unsafe(text: string): Promise<unknown>; begin<T>(run: (tx: Admin) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: Admin;
let sql: SqlExecutor;
let store: EmailRequestStore;
const address = parseAddress("0x2222222222222222222222222222222222222222")!;
const otherAddress = parseAddress("0x3333333333333333333333333333333333333333")!;
const claim = { version: 1 as const, kind: "claim" as const, channel: "share_step" as const, address };
const email = "Wallet.Person@Example.COM";

function baseSession(subject: string = address) {
  return { accountProvider: "base-account" as const, user: { subject }, smartAccount: { chainId: 8453 as const, address } };
}

async function credential(subject: string = address) {
  return (await sql.query<{ email: string | null; email_source: string | null }>(
    "SELECT email,email_source FROM customer_credentials WHERE account_provider='base-account' AND subject=$1", [subject],
  )).rows[0];
}

async function marker(subject: string = address) {
  return (await sql.query<{ answer: string | null; answer_channel: string | null; asked: boolean; sign_in_capability: string | null; bundle_id: string | null }>(
    "SELECT answer,answer_channel,asked_at IS NOT NULL AS asked,sign_in_capability,bundle_id FROM customer_email_requests WHERE subject=$1", [subject],
  )).rows[0];
}

describePostgres("customer email request PostgreSQL contract", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as Admin;
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of ["011_operator_registry.sql", "015_invites.sql", "018_customer_email_requests.sql"]) {
        await tx.unsafe(await readMigrationSql(migration));
      }
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    store = new EmailRequestStore(sql, new CustomerResolver(sql));
  });
  beforeEach(async () => {
    await sql.query("DELETE FROM customers");
    await sql.query("DELETE FROM customer_email_requests");
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("stores a shared email lowercase as wallet-reported, creating the customer when sign-in has not written it yet", async () => {
    expect(await store.write(baseSession(), { version: 1, kind: "email", channel: "sign_in", email, address })).toEqual({ asked: true });
    expect(await credential()).toEqual({ email: "wallet.person@example.com", email_source: "wallet_reported" });
    expect(await marker()).toMatchObject({ answer: "shared", answer_channel: "sign_in", asked: true, bundle_id: null });
  });

  test("a mismatched address writes neither credential email nor marker", async () => {
    await expect(store.write(baseSession(), { version: 1, kind: "email", channel: "sign_in", email, address: otherAddress }))
      .rejects.toBeInstanceOf(EmailRequestIdentityMismatchError);
    expect(await credential()).toBeUndefined();
    expect(await marker()).toBeUndefined();
  });

  test("a mismatched claim creates neither credential nor marker", async () => {
    await expect(store.claim(baseSession(), { ...claim, address: otherAddress }))
      .rejects.toBeInstanceOf(EmailRequestIdentityMismatchError);
    expect(await credential()).toBeUndefined();
    expect(await marker()).toBeUndefined();
  });

  test("a retried save is idempotent and records a returned bundle id", async () => {
    const input = { version: 1 as const, kind: "email" as const, channel: "share_step" as const, email, address, bundleId: "0xbundle" };
    await store.write(baseSession(), input);
    await store.write(baseSession(), input);
    expect((await sql.query("SELECT 1 FROM customer_credentials")).rows).toHaveLength(1);
    expect(await credential()).toEqual({ email: "wallet.person@example.com", email_source: "wallet_reported" });
    expect(await marker()).toMatchObject({ answer: "shared", bundle_id: "0xbundle" });
  });

  test("each account is asked once, independently of other accounts", async () => {
    const other = "0x3333333333333333333333333333333333333333";
    expect(await store.read(baseSession())).toEqual({ asked: false });
    await store.write(baseSession(), { version: 1, kind: "asked", channel: "share_step", address });
    expect(await store.read(baseSession())).toEqual({ asked: true });
    expect(await store.read(baseSession(other))).toEqual({ asked: false });
  });

  test("the first claim marks asked and a second claim preserves asked_at", async () => {
    expect(await store.claim(baseSession(), claim)).toEqual({ claimed: true });
    expect(await store.read(baseSession())).toEqual({ asked: true });
    const firstAskedAt = (await sql.query<{ asked_at: Date }>(
      "SELECT asked_at FROM customer_email_requests WHERE account_provider='base-account' AND subject=$1", [address],
    )).rows[0].asked_at;
    expect(firstAskedAt).toBeInstanceOf(Date);
    expect(await store.claim(baseSession(), claim)).toEqual({ claimed: false });
    const secondAskedAt = (await sql.query<{ asked_at: Date }>(
      "SELECT asked_at FROM customer_email_requests WHERE account_provider='base-account' AND subject=$1", [address],
    )).rows[0].asked_at;
    expect(secondAskedAt).toEqual(firstAskedAt);
  });

  test("a stored email prevents a later claim", async () => {
    await store.write(baseSession(), { version: 1, kind: "email", channel: "sign_in", email, address });
    expect(await store.claim(baseSession(), claim)).toEqual({ claimed: false });
    expect(await credential()).toEqual({ email: "wallet.person@example.com", email_source: "wallet_reported" });
    expect(await marker()).toMatchObject({ answer: "shared", asked: true });
  });

  test("claims are independent per account", async () => {
    const other = "0x3333333333333333333333333333333333333333";
    expect(await store.claim(baseSession(), claim)).toEqual({ claimed: true });
    expect(await store.claim(baseSession(other), claim)).toEqual({ claimed: true });
    expect(await store.claim(baseSession(), claim)).toEqual({ claimed: false });
    expect(await store.claim(baseSession(other), claim)).toEqual({ claimed: false });
    expect(await marker(other)).toMatchObject({ asked: true });
  });

  test("a claim with no prior sign-in record creates a linked credential and marker without an email", async () => {
    expect(await credential()).toBeUndefined();
    expect(await marker()).toBeUndefined();
    expect(await store.claim(baseSession(), claim)).toEqual({ claimed: true });
    expect(await credential()).toEqual({ email: null, email_source: null });
    expect(await marker()).toMatchObject({ asked: true, answer: null, answer_channel: null });
    const linked = (await sql.query<{ linked: number }>(
      "SELECT count(*)::int AS linked FROM customer_email_requests r JOIN customer_credentials c ON c.account_provider=r.account_provider AND c.subject=r.subject",
    )).rows[0];
    expect(linked.linked).toBe(1);
  });

  test("concurrent claims on one account yield exactly one winner", async () => {
    const outcomes = await Promise.all([store.claim(baseSession(), claim), store.claim(baseSession(), claim)]);
    expect(outcomes.map((outcome) => outcome.claimed).sort()).toEqual([false, true]);
    expect((await sql.query("SELECT 1 FROM customer_email_requests")).rows).toHaveLength(1);
  });

  test("Not now and decline mark the account asked and store no email", async () => {
    const other = "0x4444444444444444444444444444444444444444";
    await store.write(baseSession(), { version: 1, kind: "answer", channel: "share_step", answer: "not_now", address });
    await store.write(baseSession(other), { version: 1, kind: "answer", channel: "sign_in", answer: "declined", walletCode: 4001, walletMessage: "User rejected", address });
    expect(await store.read(baseSession())).toEqual({ asked: true });
    expect(await store.read(baseSession(other))).toEqual({ asked: true });
    expect((await sql.query("SELECT 1 FROM customer_credentials WHERE email IS NOT NULL")).rows).toHaveLength(0);
    expect(await marker(other)).toMatchObject({ answer: "declined", answer_channel: "sign_in" });
  });

  test("a later failure answer never overwrites a shared answer", async () => {
    await store.write(baseSession(), { version: 1, kind: "email", channel: "share_step", email, address });
    await store.write(baseSession(), { version: 1, kind: "answer", channel: "share_step", answer: "failed", address });
    expect(await marker()).toMatchObject({ answer: "shared" });
  });

  test("sign-in capability evidence does not mark the account asked", async () => {
    expect(await store.write(baseSession(), { version: 1, kind: "sign_in_capability", result: "refused", walletCode: 5700, walletMessage: "unsupported", address }))
      .toEqual({ asked: false });
    expect(await store.read(baseSession())).toEqual({ asked: false });
    expect(await marker()).toMatchObject({ sign_in_capability: "refused", asked: false });
  });

  test("every write resolves the credential the marker belongs to", async () => {
    expect(await store.write(baseSession(), { version: 1, kind: "sign_in_capability", result: "ignored", address })).toEqual({ asked: false });
    expect((await sql.query("SELECT 1 FROM customer_credentials")).rows).toHaveLength(1);
    const linked = (await sql.query<{ linked: number }>(
      "SELECT count(*)::int AS linked FROM customer_email_requests r JOIN customer_credentials c ON c.account_provider=r.account_provider AND c.subject=r.subject",
    )).rows[0];
    expect(linked.linked).toBe(1);
  });

  test("deleting the customer removes the marker so a later sign-in is asked again", async () => {
    await store.write(baseSession(), { version: 1, kind: "answer", channel: "share_step", answer: "not_now", address });
    expect(await store.read(baseSession())).toEqual({ asked: true });
    await sql.query("DELETE FROM customers");
    expect((await sql.query("SELECT 1 FROM customer_email_requests")).rows).toHaveLength(0);
    expect((await sql.query("SELECT 1 FROM customer_credentials")).rows).toHaveLength(0);
    expect(await store.read(baseSession())).toEqual({ asked: false });
    await store.write(baseSession(), { version: 1, kind: "asked", channel: "share_step", address });
    expect(await store.read(baseSession())).toEqual({ asked: true });
  });

  test("the email never appears in operator events", async () => {
    await store.write(baseSession(), { version: 1, kind: "email", channel: "sign_in", email, address });
    const events = (await sql.query<{ props: unknown; name: string }>("SELECT name,props FROM operator_events")).rows;
    expect(JSON.stringify(events).toLowerCase()).not.toContain("wallet.person");
  });

  test("rejects non-Base sessions", async () => {
    await expect(store.write({ accountProvider: "cdp-embedded", user: { subject: "cdp" }, smartAccount: null },
      { version: 1, kind: "asked", channel: "share_step", address })).rejects.toThrow();
    await expect(store.claim({ accountProvider: "cdp-embedded", user: { subject: "cdp" }, smartAccount: null }, claim)).rejects.toThrow();
  });
});

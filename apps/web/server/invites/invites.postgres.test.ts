import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { CustomerResolver } from "@/server/customers/resolve";
import { InviteStore } from "./store";

const url = process.env.ACTION_PG_TEST_URL?.trim();
const schema = "invite_contract_test";
type Admin = { unsafe(text: string): Promise<unknown>; begin<T>(run: (tx: Admin) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: Admin;
let sql: SqlExecutor;
let resolver: CustomerResolver;
let invites: InviteStore;
const at = new Date("2026-01-02T00:00:00Z");
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const session = (provider: "cdp-embedded" | "base-account", subject: string, wallet: `0x${string}` | null = null) => ({
  accountProvider: provider, user: { subject }, smartAccount: wallet ? { address: wallet, chainId: 8453 as const } : null,
});
const signIn = (provider: "cdp-embedded" | "base-account", subject: string, inviteCode?: string, wallet: `0x${string}` | null = null, email?: string) =>
  resolver.resolveCustomer(session(provider, subject, wallet), { create: true, at, inviteCode, email });
const events = async (name: string) => (await sql.query<{ props: Record<string, unknown>; idempotency_key: string }>(
  "SELECT props,idempotency_key FROM operator_events WHERE name=$1", [name],
)).rows;
const attribution = async (id: string) => (await sql.query<{ invite_code: string | null }>("SELECT invite_code FROM customers WHERE id=$1", [id])).rows[0].invite_code;

(url ? describe : describe.skip)("invite PostgreSQL contract", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(url!) as unknown as Admin;
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of ["011_operator_registry.sql", "015_invites.sql"]) await tx.unsafe(await readMigrationSql(migration));
    });
    sql = createPostgresSqlExecutor(url!, { schema });
    resolver = new CustomerResolver(sql);
    invites = new InviteStore(sql);
  });
  beforeEach(async () => { await sql.query("DELETE FROM customers"); });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("stable one-per-customer code retries a competing code", async () => {
    const a = await signIn("base-account", "inviter-a");
    const b = await signIn("base-account", "inviter-b");
    const first = await invites.getOrCreateInviteCode(a.id);
    expect(await invites.getOrCreateInviteCode(a.id)).toBe(first);
    const retry = new InviteStore(sql, (() => { let attempt = 0; return () => ++attempt === 1 ? first : "abcdefghjk"; })());
    expect(await retry.getOrCreateInviteCode(b.id)).toBe("abcdefghjk");
    expect(await invites.findInviter(first)).toEqual({ customerId: a.id, status: "active" });
    expect(await invites.readInviteStats()).toEqual({ inviteLinks: 2, attributedSignUps: 0 });
    await expect(sql.query("UPDATE invite_codes SET code='mnpqrstuvw' WHERE customer_id=$1", [a.id])).rejects.toThrow("invite codes are immutable");
  });

  for (const provider of ["cdp-embedded", "base-account"] as const) {
    test(`${provider} first touch attributes only new sign-in with one event and immutable attribution`, async () => {
      const inviter = await signIn("base-account", "inviter", undefined, address("1"));
      const first = await invites.getOrCreateInviteCode(inviter.id);
      const otherInviter = await signIn("base-account", "second-inviter");
      const second = await invites.getOrCreateInviteCode(otherInviter.id);
      const referred = await signIn(provider, "referred", first, address("2"));
      expect(referred.created).toBe(true);
      expect(await attribution(referred.id)).toBe(first);
      expect((await events("customer.signed_up")).find((event) => event.props.inviteCode === first)?.props).toMatchObject({ accountProvider: provider });
      expect(await events("invite.attributed")).toEqual([{ props: { inviteCode: first, inviterCustomerId: inviter.id }, idempotency_key: `invite:${referred.id}` }]);
      await expect(sql.query("UPDATE customers SET invite_code=$2 WHERE id=$1", [referred.id, second])).rejects.toThrow("customer invite attribution is immutable");
      expect((await signIn(provider, "referred", second, address("2"))).created).toBe(false);
      expect(await attribution(referred.id)).toBe(first);
      expect(await events("invite.attributed")).toHaveLength(1);
      expect(await invites.readInviteStats()).toEqual({ inviteLinks: 2, attributedSignUps: 1 });
    });
  }

  test("existing customer cannot acquire attribution on later sign-in", async () => {
    const owner = await signIn("base-account", "owner");
    const code = await invites.getOrCreateInviteCode(owner.id);
    const existing = await signIn("cdp-embedded", "existing");
    await signIn("cdp-embedded", "existing", code);
    expect(await attribution(existing.id)).toBeNull();
    await expect(sql.query("UPDATE customers SET invite_code=$2 WHERE id=$1", [existing.id, code])).rejects.toThrow("customer invite attribution is immutable");
    expect(await events("invite.attributed")).toHaveLength(0);
  });

  test("self-invites by same wallet or normalized verified email cannot attribute", async () => {
    const inviter = await signIn("cdp-embedded", "owner", undefined, address("3"), "Owner@Example.com");
    const code = await invites.getOrCreateInviteCode(inviter.id);
    const sameWallet = await signIn("base-account", "wallet", code, address("3"));
    const sameEmail = await signIn("cdp-embedded", "email", code, address("4"), "OWNER@example.com");
    expect(await attribution(sameWallet.id)).toBeNull();
    expect(await attribution(sameEmail.id)).toBeNull();
    expect(await events("invite.attributed")).toHaveLength(0);
  });

  test("unknown and inactive inviter leave new customer unattributed", async () => {
    const inviter = await signIn("base-account", "owner");
    const code = await invites.getOrCreateInviteCode(inviter.id);
    await sql.query("UPDATE customers SET status='restricted' WHERE id=$1", [inviter.id]);
    const inactive = await signIn("base-account", "inactive", code);
    const unknown = await signIn("cdp-embedded", "unknown", "abcdefghjk");
    expect(await attribution(inactive.id)).toBeNull();
    expect(await attribution(unknown.id)).toBeNull();
    expect(await events("invite.attributed")).toHaveLength(0);
  });
});

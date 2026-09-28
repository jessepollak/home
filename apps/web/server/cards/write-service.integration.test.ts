import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { fetchFakeBridge, fixtureCustomer, startFakeBridge } from "@/tests/cards/fake-bridge";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createBridgeClient } from "./bridge/client";
import type { CardJourneyConfig } from "./bridge/journey-config";
import { createStripeClient } from "./stripe/client";
import { createCardWriteService } from "./write-service";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `cards_write_${randomBytes(4).toString("hex")}`;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const wallet = "0x1111111111111111111111111111111111111111" as const;
const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "owner" }, smartAccount: { chainId: 8453, address: wallet } };
let admin: Bun.SQL, sql: SqlExecutor;
let fake: ReturnType<typeof startFakeBridge>;
let service: ReturnType<typeof createCardWriteService>;
let writes = 0;
let ephemeralCalls = 0;
const card = { id: "ic_123", cardholder: fixtureCustomer.stripe_cardholder_id, status: "active", last4: "1234", metadata: {} as Record<string, string> };
const stripe = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname === "/v1/ephemeral_keys") { ephemeralCalls++; return Response.json({ secret: "ek_test_synthetic123456", other: "must_not_escape" }); }
  if (url.pathname.endsWith("/cardholders/" + fixtureCustomer.stripe_cardholder_id)) return Response.json({ id: fixtureCustomer.stripe_cardholder_id, status: "active" });
  if (init?.method === "POST") {
    writes++;
    const params = new URLSearchParams(String(init.body));
    if (url.pathname.endsWith("/cards")) return Response.json({ ...card, status: "active" });
    card.status = params.get("status") ?? "active";
    card.metadata = params.get("metadata[home_freeze]") === "customer" ? { home_freeze: "customer" } : {};
  }
  return Response.json(card);
}) as typeof fetch;

(connectionString ? describe : describe.skip)("card writes: PostgreSQL owner and lifecycle", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      await tx.unsafe(await readMigrationSql("011_operator_registry.sql"));
      await tx.unsafe(await readMigrationSql("020_card_accounts.sql"));
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    await sql.query("INSERT INTO customers (id,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,now(),now(),'sign_in'),($2,now(),now(),'sign_in')", [owner, other]);
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,'base-account','owner',now(),now())", [owner]);
    await sql.query("INSERT INTO customer_wallets(id,customer_id,credential_id,chain_id,address) VALUES (gen_random_uuid(),$1,(SELECT id FROM customer_credentials WHERE customer_id=$1),8453,$2)", [owner, wallet]);
    fake = startFakeBridge("fake-key");
    const config: CardJourneyConfig = { mode: "sandbox", bridgeOrigin: fake.origin, bridgeApiKey: "fake-key", stripeSecretKey: "sk_test_fake", stripeApiVersion: "2026-08-26.dahlia", funding: { kind: "crypto_wallet" } };
    service = createCardWriteService({ sql, config, bridge: createBridgeClient(config, fetchFakeBridge), stripe: createStripeClient(config, stripe) });
  });
  afterAll(async () => {
    await fake?.stop();
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });
  test("reserves a single account then reuses Bridge identity and a fresh KYC link", async () => {
    expect(await service.enroll(owner)).toContain("bridge.withpersona.com");
    expect(await service.enroll(owner)).toContain("bridge.withpersona.com");
    const account = await sql.query<{ bridge_customer_id: string }>("SELECT bridge_customer_id FROM card_accounts WHERE customer_id=$1 AND mode='sandbox'", [owner]);
    expect(account.rows).toEqual([{ bridge_customer_id: fixtureCustomer.id }]);
  });
  test("rejects unowned wallet or missing owner before calling Stripe", async () => {
    await expect(service.issue(other, session)).rejects.toThrow("CARD_NOT_READY");
    await expect(service.issue(owner, { ...session, smartAccount: { chainId: 8453, address: "0x2222222222222222222222222222222222222222" } })).rejects.toThrow("CARD_NOT_READY");
    expect(writes).toBe(0);
  });
  test("issues exactly one live card per wallet; rejects another owner before provider calls", async () => {
    expect(await service.issue(owner, session)).toBe("ic_123");
    expect((await sql.query("SELECT 1 FROM cards WHERE customer_id=$1 AND mode='sandbox' AND wallet_address=$2", [owner, wallet])).rowCount).toBe(1);
    await expect(service.issue(owner, session)).rejects.toThrow("CARD_CONFLICT");
    await expect(service.freeze(other, "ic_123", true)).rejects.toThrow("CARD_NOT_FOUND");
    expect(writes).toBe(1);
  });
  test("freezes, refuses provider-restricted unfreeze, unfreezes customer-marked card", async () => {
    expect(await service.freeze(owner, "ic_123", true)).toBe("ic_123");
    card.metadata = {};
    await expect(service.freeze(owner, "ic_123", false)).rejects.toThrow("CARD_NOT_READY");
    card.metadata = { home_freeze: "customer" };
    expect(await service.freeze(owner, "ic_123", false)).toBe("ic_123");
    expect(card.metadata).toEqual({});
    expect(writes).toBe(3);
  });
  test("reveals a key only for the owner and fresh active or customer-frozen card", async () => {
    await expect(service.ephemeralKey(other, "ic_123", "nonce_synthetic123")).rejects.toThrow("CARD_NOT_FOUND");
    expect(ephemeralCalls).toBe(0);
    expect(await service.ephemeralKey(owner, "ic_123", "nonce_synthetic123")).toBe("ek_test_synthetic123456");
    card.status = "inactive";
    card.metadata = { home_freeze: "customer" };
    expect(await service.ephemeralKey(owner, "ic_123", "nonce_synthetic456")).toBe("ek_test_synthetic123456");
    card.metadata = {};
    await expect(service.ephemeralKey(owner, "ic_123", "nonce_synthetic789")).rejects.toThrow("CARD_NOT_READY");
    card.status = "canceled";
    await expect(service.ephemeralKey(owner, "ic_123", "nonce_synthetic890")).rejects.toThrow("CARD_NOT_READY");
    expect(ephemeralCalls).toBe(2);
  });
});

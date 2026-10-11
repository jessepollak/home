import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionOwner } from "@/shared/money-actions/types";
import { ACCOUNT_EXPORT_HOME_CLASSES } from "@/shared/account/contracts/data-export";
import { parseAccountDeletionReceipt } from "@/shared/account/contracts/account-deletion";
import { financialEvidenceExpiresAt } from "@/shared/account/financial-retention";
import { createPostgresSqlExecutor, type SqlExecutor, type SqlQueryOptions } from "@/server/db/sql";
import { readAllMigrationSql } from "@/tests/helpers/migrations";
import { ACTION_DRAFT_RETENTION_MS, ActionsStore, actionOwnerKey } from "@/server/actions/store";
import { fundingProviders } from "@/server/funding/providers";
import { PostgresFundingOrderStore } from "@/server/funding/core/postgres-store";
import { recordCustomerIds } from "@/server/customers/record-ids";
import { CustomerResolver } from "@/server/customers/resolve";
import { authorizeSession } from "@/server/auth/authorize";
import { createCardEventStore } from "@/server/cards/store";
import { createCardTransactionStore } from "@/server/cards/transaction-store";
import { PostgresBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { PostgresHistoryStore } from "@/server/balances/history/store";
import { createCardWriteService } from "@/server/cards/write-service";
import { createBridgeClient } from "@/server/cards/bridge/client";
import { createStripeTransactionClient } from "@/server/cards/stripe/transactions";
import { verifyBaseFundingReceipt } from "@/server/funding/core/base-receipt";
import { createStripeClient } from "@/server/cards/stripe/client";
import { refreshCardPurchases } from "@/server/cards/transaction-refresh";
import { AccountExportReader } from "@/server/account-export/read";
import { assertNoAccountDeletions } from "@/server/operator-events/backfill-guard";
import { AccountDeletionStore } from "./store";
import { sweepAccountDeletions } from "./sweep";
import { AccountDeletedError, AccountDeletionError } from "./errors";
import { assertCredentialLive, credentialDigest, findTombstone, requireTombstoneKey } from "./tombstone";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `account_deletion_test_${randomBytes(4).toString("hex")}`;
const originalSecret = process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET;
let admin: Bun.SQL;
let sql: SqlExecutor;
let store: AccountDeletionStore;
let sequence = 0;
const amount = "900719925474099312345678901234567890";
const at = new Date("2030-01-01T00:00:00.000Z");
const hash: `0x${string}` = `0x${"a".repeat(64)}`;
const summary = { title: "Send", amounts: [{ assetId: "usdc", symbol: "USDC", amountBaseUnits: amount, direction: "spend", decimals: 6, privateMarker: "remove-me" }], metadata: { subject: "remove-me" } };

async function seed(rich = false) {
  sequence++;
  const id = crypto.randomUUID(), credential = crypto.randomUUID(), wallet = crypto.randomUUID();
  const address: `0x${string}` = `0x${sequence.toString(16).padStart(40,"0")}`;
  const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: `delete-owner-${sequence}` }, smartAccount: { chainId: 8453, address } };
  await sql.query("INSERT INTO customers(id,first_seen_at,last_seen_at,first_seen_source,country) VALUES ($1,now(),now(),'sign_in','US')", [id]);
  await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,email,email_source,first_seen_at,last_seen_at) VALUES ($1,$2,'base-account',$3,'owner@example.test','wallet_reported',now(),now())", [credential,id,session.user.subject]);
  await sql.query("INSERT INTO customer_wallets(id,customer_id,credential_id,chain_id,address) VALUES ($1,$2,$3,8453,$4)", [wallet,id,credential,address]);
  const action = crypto.randomUUID(), funding = crypto.randomUUID(), card = crypto.randomUUID();
  if (rich) {
    await sql.query("INSERT INTO actions(id,owner_key,customer_id,credential_id,wallet_id,account_address,provider,kind,summary,confirmed_at,transaction_hash,outcome,outcome_source,outcome_recorded_at,settled_at,observed_receipt_transaction_hash,observed_receipt_block_number) VALUES ($1,$2,$3,$4,$5,$6,'base-account','send',$7::jsonb,now(),$8,'succeeded','chain',now(),now(),$8,9007199254740993)", [action, actionOwnerKey({ accountProvider: session.accountProvider,subject: session.user.subject,chainId:8453,address }),id,credential,wallet,address,JSON.stringify(summary),hash]);
    await sql.query("INSERT INTO cashout_orders(action_id,owner_key,provider_id,environment,region,deposit_id,state,platform,platform_label,amount_atomic,remaining_atomic,settled_at) VALUES ($1,$2,'peer','sandbox','US',$3,'delivered','bank','Bank',$4,'0',now())", [action, actionOwnerKey({ accountProvider: session.accountProvider,subject: session.user.subject,chainId:8453,address }),`deposit-${sequence}`,amount]);
    await sql.query("INSERT INTO operator_fee_records(action_id,action_kind,amount_base_units,token_asset_id,token_address,token_decimals,bps,recipient,collected_by) VALUES ($1,'trade',$2::numeric,'usdc',$3,6,10,$3,'provider-native')", [action,amount,`0x${"b".repeat(40)}`]);
    await sql.query("INSERT INTO funding_orders(id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,provider_order_id,transaction_hash,log_index,customer_id,credential_id,wallet_id,created_at,updated_at) VALUES ($1::uuid,$2,'base-account',$3,'coinbase','US','usdc','bank','5.00',$1::uuid::text,$4::jsonb,'private-token','received',9007199254740993,$5,$6,$7,$8,$9,$10,now(),now())", [funding,session.user.subject,address,JSON.stringify({fiatAmount:"5.00",tokenAmountAtomic:amount,fees:[],expiresAt:"2026-10-07T00:00:00Z",secret:"remove-me"}),`provider-order-${sequence}`,hash,sequence,id,credential,wallet]);
    await sql.query("INSERT INTO funding_provider_customers(id,owner_subject,account_provider,provider_id,region,customer_ref,state,created_at,updated_at) VALUES (gen_random_uuid(),$1,'base-account','coinbase','US',$2,'verified',now(),now())", [session.user.subject,`private-provider-customer-${sequence}`]);
    await sql.query("INSERT INTO funding_provider_user_tokens(account_provider,owner_subject,provider_id,region,sandbox,destination,envelope,key_version,returned_at,updated_at) VALUES ('base-account',$1,'coinbase','US',true,$2,$3,1,now(),now())", [session.user.subject,address,`v1.${"a".repeat(16)}.${"b".repeat(22)}.${"c".repeat(40)}`]);
    await sql.query("INSERT INTO card_accounts(customer_id,mode,bridge_customer_id,stripe_cardholder_id) VALUES ($1,'sandbox',$2,$3)", [id,`bridge-${sequence}`,`holder-${sequence}`]);
    await sql.query("INSERT INTO cards(id,customer_id,mode,stripe_card_id,wallet_address) VALUES ($1,$2,'sandbox',$3,$4)", [card,id,`stripe-${sequence}`,address]);
    await sql.query("INSERT INTO card_transactions(card_id,provider,mode,provider_transaction_id,kind,amount_minor,currency,merchant_name,merchant_category,status,provider_created_at) VALUES ($1,'bridge','sandbox',$2,'transaction',9007199254740993,'USD','Private Merchant','Private Category','completed',now())", [card,`purchase-${sequence}`]);
    await sql.query("INSERT INTO card_events(provider,mode,event_id,kind,customer_id,card_id,occurred_at) VALUES ('bridge','sandbox',$1,'issuing_transaction.created',$2,$3,now())", [`event-${sequence}`,`bridge-${sequence}`,`stripe-${sequence}`]);
    await sql.query("INSERT INTO customer_preferences(customer_id,country_preference) VALUES ($1,'US')", [id]);
    await sql.query("INSERT INTO operator_events(id,customer_id,name,occurred_at,source,props,idempotency_key) VALUES (gen_random_uuid(),$1,'customer.signed_up',now(),'live',$3::jsonb,$2)", [id,`signup-${sequence}`, JSON.stringify({secret:"remove-me"})]);
    await sql.query("INSERT INTO admin_audit_log(actor,action,target_kind,target_id,purpose) VALUES ('operator','customer.read','customer',$1,'support')", [id]);
    await sql.query("INSERT INTO customer_email_requests(account_provider,subject,asked_at) VALUES ('base-account',$1,now())", [session.user.subject]);
    await sql.query("INSERT INTO support_conversations(id,customer_id,last_message_at) VALUES (gen_random_uuid(),$1,now())", [id]);
    await sql.query("INSERT INTO balance_snapshots(chain_id,address,block_number,block_hash,block_timestamp,observed_at,holdings,coverage) VALUES (8453,$1,1,$2,1,now(),'[]','{}')", [address,hash]);
    await sql.query("INSERT INTO history_addresses(chain_id,address,window_start_block,window_start_at,enrolled_block,backfill_block,forward_block) VALUES (8453,$1,1,now(),1,1,1)", [address]);
  }
  return { id,credential,wallet,address,session,action,funding,card,number:sequence };
}

async function prepared(owner: Awaited<ReturnType<typeof seed>>) {
  const id = crypto.randomUUID();
  await new ActionsStore(sql).insert({ id, owner: { accountProvider: owner.session.accountProvider, subject: owner.session.user.subject,chainId:8453,address:owner.address }, kind:"send",summary: { title: summary.title, amounts: [{ assetId:"usdc",symbol:"USDC",amountBaseUnits:amount,direction:"spend",decimals:6 }], warnings: [], expiresAt:new Date(at.getTime() + ACTION_DRAFT_RETENTION_MS).toISOString() }, pending:{calls:[{ to: owner.address, data: "0x", value: "0" }]},createdAt:at.toISOString() });
  return id;
}

async function reserveFunding(owner: Awaited<ReturnType<typeof seed>>, executor = sql) {
  return new PostgresFundingOrderStore(executor).reserve({ id: crypto.randomUUID(), owner: { subject: owner.session.user.subject, accountProvider: owner.session.accountProvider }, destination: owner.address, providerId: "coinbase", region: "US", assetId: "usdc", paymentMethod: "bank", fiatAmount: "1", intentDigest: crypto.randomUUID(), quote: { fiatAmount: "1", tokenAmountAtomic: "1", fees: [], expiresAt: at.toISOString() }, quoteToken: "fixture", customerRef: null, sandbox: false, creationBlock: "1", createdAt: at.toISOString() });
}

async function terminal(id: string) {
  await sql.query("UPDATE actions SET outcome='not_submitted',outcome_source='wallet',outcome_recorded_at=now(),pending=NULL WHERE id=$1", [id]);
}

function observeTransaction(before: (text: string) => Promise<void>, after: (text: string) => Promise<void>): SqlExecutor {
  return { query: sql.query.bind(sql), transaction: (fn, options) => sql.transaction((tx) => fn({
    query: async <T>(text: string, values?: unknown[], queryOptions?: SqlQueryOptions) => {
      await before(text);
      const result = await tx.query<T>(text, values, queryOptions);
      await after(text);
      return result;
    }, transaction: tx.transaction,
  }), options) };
}

(connectionString ? describe : describe.skip)("Leave Home PostgreSQL lifecycle", () => {
  beforeAll(async () => {
    if (!connectionString) throw new Error("FUNDING_PG_TEST_URL is required");
    process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET = "test-dedicated-tombstone-key-at-least-32-bytes";
    admin = new Bun.SQL(connectionString);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => { await tx.unsafe(`SET LOCAL search_path TO ${schema}`); for (const migration of await readAllMigrationSql()) await tx.unsafe(migration); });
    sql = createPostgresSqlExecutor(connectionString, { poolFactory: (config) => new Pool({...config,options:`-c search_path=${schema}`}) });
    store = new AccountDeletionStore(sql, () => at);
  });
  afterAll(async () => {
    await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close();
    if (originalSecret === undefined) delete process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET; else process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET = originalSecret;
  });
  test("none → completed; retained identifiers and amounts survive cascades while A/B identities stay isolated", async () => {
    const a = await seed(true), b = await seed(true);
    const second: VerifiedAccountSession = { accountProvider:"cdp-embedded",user:{subject:`linked-${a.number}`},smartAccount:null };
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,'cdp-embedded',$2,now(),now())", [a.id,second.user.subject]);
    const response = await store.read(a.session,true);
    expect(response.status).toBe("completed");
    expect(response.stores.map((entry) => entry.name)).toEqual([...ACCOUNT_EXPORT_HOME_CLASSES]);
    expect(parseAccountDeletionReceipt(JSON.parse(JSON.stringify(response)))).not.toBeNull();
    for (const marker of [a.session.user.subject,a.id,a.address,"owner@example.test","private-token","remove-me",b.id,b.address]) expect(JSON.stringify(response)).not.toContain(marker);
    expect((await store.read(a.session,true))).toEqual(response);
    expect((await store.read(second,false))).toEqual(response);
    expect((await sql.query("SELECT 1 FROM customers WHERE id=$1",[a.id])).rowCount).toBe(0);
    expect((await sql.query("SELECT 1 FROM customers WHERE id=$1",[b.id])).rowCount).toBe(1);
    expect((await sql.query("SELECT 1 FROM account_deletion_tombstones WHERE request_id=$1",[response.requestId])).rowCount).toBe(2);
    const action = (await sql.query("SELECT * FROM actions WHERE id=$1",[a.action])).rows[0];
    expect(action).toMatchObject({transaction_hash:hash,outcome:"succeeded",account_address:null,credential_id:null,wallet_id:null});
    expect(action.owner_key).toBe(`retained:${action.customer_id}`);
    expect(JSON.stringify(action.summary)).not.toContain("remove-me");
    const owner = (await sql.query("SELECT * FROM customers WHERE id=$1",[action.customer_id])).rows[0];
    expect(owner).toMatchObject({status:"closed",first_seen_source:"backfill",country:null,invite_code:null});
    expect(owner.retained_until).toEqual(financialEvidenceExpiresAt(new Date(response.completedAt ?? Number.NaN)));
    const funding = (await sql.query("SELECT * FROM funding_orders WHERE id=$1",[a.funding])).rows[0];
    expect(funding).toMatchObject({transaction_hash:hash,log_index:a.number,provider_order_id:`provider-order-${a.number}`,destination:null,customer_ref:null,quote_token:null,instructions:null,credential_id:null,wallet_id:null});
    expect(funding.owner_subject).toBe(`retained:${action.customer_id}`);
    const card = (await sql.query("SELECT * FROM cards WHERE id=$1",[a.card])).rows[0];
    expect(card).toMatchObject({customer_id:action.customer_id,wallet_address:null,stripe_card_id:`stripe-${a.number}`});
    const transaction = (await sql.query("SELECT amount_minor::text,merchant_name,merchant_category FROM card_transactions WHERE card_id=$1",[a.card])).rows[0];
    expect(transaction).toEqual({amount_minor:"9007199254740993",merchant_name:null,merchant_category:null});
    expect((await sql.query("SELECT 1 FROM operator_fee_records WHERE action_id=$1",[a.action])).rowCount).toBe(1);
    expect((await sql.query("SELECT 1 FROM admin_audit_log WHERE target_id=$1",[a.id])).rowCount).toBe(1);
    for (const table of ["customer_credentials","customer_wallets","customer_preferences","operator_events","support_conversations","card_accounts"]) expect((await sql.query(`SELECT 1 FROM ${table} WHERE customer_id=$1`,[a.id])).rowCount).toBe(0);
    for (const table of ["balance_snapshots","history_addresses"]) expect((await sql.query(`SELECT 1 FROM ${table} WHERE address=$1`,[a.address])).rowCount).toBe(0);
    expect((await sql.query("SELECT 1 FROM customer_email_requests WHERE subject=$1",[a.session.user.subject])).rowCount).toBe(0);
    for (const table of ["funding_provider_customers", "funding_provider_user_tokens"]) {
      expect((await sql.query(`SELECT 1 FROM ${table} WHERE owner_subject=$1`, [a.session.user.subject])).rowCount).toBe(0);
      expect((await sql.query(`SELECT 1 FROM ${table} WHERE owner_subject=$1`, [b.session.user.subject])).rowCount).toBe(1);
    }
    await expect(store.read(b.session,false)).rejects.toMatchObject({code:"ACCOUNT_DELETION_NOT_FOUND"});
    expect(response.providers.map((entry)=>entry.provider)).toEqual(["Base Account","Coinbase","Coinbase","Bridge","Stripe"]);
  });

  test.each(["actions","funding_orders","cashout_orders","card_transactions"] as const)("none → queued and GET/POST refresh while %s blocks; reconciled → completed", async (blocker) => {
    const a = await seed(true);
    if (blocker === "actions") await sql.query("UPDATE actions SET outcome=NULL,outcome_source=NULL,outcome_recorded_at=NULL WHERE id=$1",[a.action]);
    if (blocker === "funding_orders") {
      const extra = crypto.randomUUID();
      await sql.query("INSERT INTO funding_orders(id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,customer_id,created_at,updated_at) VALUES ($1::uuid,$2,'base-account',$3,'coinbase','US','usdc','bank','1',$1::uuid::text,$4::jsonb,'private-token','dispatch-ambiguous',1,$5,now(),now())",[extra,a.session.user.subject,a.address,JSON.stringify({fiatAmount:"1",tokenAmountAtomic:"1",fees:[],expiresAt:at.toISOString()}),a.id]);
    }
    if (blocker === "cashout_orders") await sql.query("UPDATE cashout_orders SET settled_at=NULL,state='submitted' WHERE action_id=$1",[a.action]);
    if (blocker === "card_transactions") await sql.query("UPDATE card_transactions SET status='pending' WHERE card_id=$1",[a.card]);
    const queued = await store.read(a.session,true);
    expect(queued.status).toBe("queued");
    expect(queued.blockers).toEqual([{name:blocker,count:1}]);
    expect(queued.lastAttempt?.outcome).toBe("blocked");
    expect((await store.read(a.session,false)).requestId).toBe(queued.requestId);
    expect((await store.read(a.session,true)).requestId).toBe(queued.requestId);
    expect((await sql.query("SELECT 1 FROM customers WHERE id=$1",[a.id])).rowCount).toBe(1);
    if (blocker === "actions") await sql.query("UPDATE actions SET outcome='succeeded',outcome_source='chain',outcome_recorded_at=now() WHERE id=$1",[a.action]);
    if (blocker === "funding_orders") await sql.query("UPDATE funding_orders SET state='cancelled' WHERE customer_id=$1 AND state='dispatch-ambiguous'",[a.id]);
    if (blocker === "cashout_orders") await sql.query("UPDATE cashout_orders SET settled_at=now(),state='delivered' WHERE action_id=$1",[a.action]);
    if (blocker === "card_transactions") await sql.query("UPDATE card_transactions SET status='completed' WHERE card_id=$1",[a.card]);
    expect((await store.read(a.session,false)).status).toBe("completed");
  });

  test("unconfirmed prepared actions block, and a queued request does not serialize or disable new actions", async () => {
    const a = await seed();
    const first = await prepared(a);
    const queued = await store.read(a.session,true);
    expect(queued.blockers).toEqual([{name:"actions",count:1}]);
    const second = await prepared(a);
    expect((await store.read(a.session,false)).blockers).toEqual([{name:"actions",count:2}]);
    expect((await sweepAccountDeletions(sql, { now: at, batchSize: 500 })).blocked).toBeGreaterThan(0);
    expect((await store.read(a.session,false)).blockers).toEqual([{name:"actions",count:2}]);
    await terminal(first); await terminal(second);
    expect((await store.read(a.session,false)).status).toBe("completed");
  });

  test("concurrent POSTs converge, including concurrent eligible completion", async () => {
    const a = await seed();
    const pending = await prepared(a);
    const results = await Promise.all(Array.from({length:5},()=>store.read(a.session,true)));
    expect(new Set(results.map((entry)=>entry.requestId)).size).toBe(1);
    await terminal(pending);
    const completed = await Promise.all(Array.from({length:5},()=>store.read(a.session,true)));
    expect(new Set(completed.map((entry)=>entry.requestId)).size).toBe(1);
    expect(completed.every((entry)=>entry.status==="completed")).toBe(true);
  });

  test("linked credentials concurrent first POSTs serialize publication before completion without deadlock", async () => {
    const a = await seed();
    const b: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: `first-post-linked-${a.number}` }, smartAccount: { chainId: 8453, address: `0x${a.number.toString(16).padStart(40, "8")}` } };
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,$2,$3,now(),now())", [a.id, b.accountProvider, b.user.subject]);
    if (!b.smartAccount) throw new Error("expected session wallet");
    const id = crypto.randomUUID(), ownerKey = actionOwnerKey({ accountProvider: b.accountProvider, subject: b.user.subject, chainId: 8453, address: b.smartAccount.address });
    await sql.query("INSERT INTO actions(id,owner_key,provider,kind,summary,created_at,confirmed_at,handle_recorded_at,provider_handle) VALUES ($1,$2,$3,'send',$4::jsonb,$5,$5,$5,'live-legacy-handle')", [id, ownerKey, b.accountProvider, JSON.stringify({ title: "Legacy", amounts: [] }), at]);
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
    let paused = false;
    const bSql = observeTransaction(async () => {}, async (text) => {
      if (!paused && text.includes("pg_advisory_xact_lock")) { paused = true; held.resolve(); await release.promise; }
    });
    const aSql = observeTransaction(async (text) => { if (text.includes("pg_advisory_xact_lock")) waiting.resolve(); }, async () => {});
    const deletingB = new AccountDeletionStore(bSql, () => at).read(b, true);
    await held.promise;
    const deletingA = new AccountDeletionStore(aSql, () => at).read(a.session, true);
    await waiting.promise;
    release.resolve();
    const receipts = await Promise.all([deletingA, deletingB]);
    expect(new Set(receipts.map((receipt) => receipt.requestId)).size).toBe(1);
    for (const receipt of receipts) {
      expect(receipt.status).toBe("queued");
      expect(receipt.blockers).toEqual([{ name: "actions", count: 1 }]);
    }
    expect((await sql.query<{ session_owner_keys: string[] }>("SELECT session_owner_keys FROM account_deletion_requests WHERE id=$1", [receipts[0].requestId])).rows[0].session_owner_keys).toContain(ownerKey);
    expect((await sql.query("SELECT owner_key,customer_id FROM actions WHERE id=$1", [id])).rows[0]).toEqual({ owner_key: ownerKey, customer_id: null });
    await terminal(id);
    expect((await store.attempt(receipts[0].requestId)).status).toBe("completed");
    expect((await sql.query<{ owner_key: string }>("SELECT owner_key FROM actions WHERE id=$1", [id])).rows[0].owner_key).toStartWith("retained:");
  });

  test.each(["attempt", "request-row"])("GET waits for a busy %s before publishing and retrying", async (busy) => {
    const a = await seed(), pending = await prepared(a);
    const queued = await store.read(a.session, true);
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
    let paused = false;
    const hooked = observeTransaction(async () => {}, async (text) => {
      if (!paused && text === "SELECT * FROM account_deletion_requests WHERE id=$1 FOR UPDATE") { paused = true; held.resolve(); await release.promise; }
    });
    const holding = busy === "attempt"
      ? new AccountDeletionStore(hooked, () => at).attempt(queued.requestId)
      : sql.transaction(async (tx) => {
          await tx.query("SELECT * FROM account_deletion_requests WHERE id=$1 FOR UPDATE", [queued.requestId]);
          held.resolve(); await release.promise;
        });
    await held.promise;
    const polling = observeTransaction(async (text) => {
      if (text.includes("pg_advisory_xact_lock") || text === "SELECT * FROM account_deletion_requests WHERE customer_id=$1 AND status='queued' FOR UPDATE") waiting.resolve();
    }, async () => {});
    let settled = false;
    const reading = new AccountDeletionStore(polling, () => at).read(a.session, false).then((receipt) => { settled = true; return receipt; });
    await waiting.promise;
    expect(settled).toBe(false);
    release.resolve();
    await holding;
    expect(await reading).toEqual(queued);
    await terminal(pending);
    expect((await store.read(a.session, false)).status).toBe("completed");
  });

  test.each([true, false])("deletion-first %s create blocks on unpublished linked credential legacy scope", async (create) => {
    const a = await seed(), pending = await prepared(a);
    const b: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: `deletion-first-linked-${a.number}` }, smartAccount: { chainId: 8453, address: `0x${a.number.toString(16).padStart(40, "8")}` } };
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,$2,$3,now(),now())", [a.id, b.accountProvider, b.user.subject]);
    if (!b.smartAccount) throw new Error("expected session wallet");
    const id = crypto.randomUUID(), ownerKey = actionOwnerKey({ accountProvider: b.accountProvider, subject: b.user.subject, chainId: 8453, address: b.smartAccount.address });
    await sql.query("INSERT INTO actions(id,owner_key,provider,kind,summary,created_at,confirmed_at,handle_recorded_at,provider_handle) VALUES ($1,$2,$3,'send',$4::jsonb,$5,$5,$5,'live-legacy-handle')", [id, ownerKey, b.accountProvider, JSON.stringify({ title: "Legacy", amounts: [] }), at]);
    const queued = await store.read(a.session, true);
    await terminal(pending);
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
    const completing = observeTransaction(async () => {}, async (text) => {
      if (text === "SELECT * FROM account_deletion_requests WHERE id=$1 FOR UPDATE") { held.resolve(); await release.promise; }
    });
    const polling = observeTransaction(async (text) => { if (text.includes("pg_advisory_xact_lock")) waiting.resolve(); }, async () => {});
    const deleting = new AccountDeletionStore(completing, () => at).attempt(queued.requestId);
    await held.promise;
    let settled = false;
    const reading = new AccountDeletionStore(polling, () => at).read(b, create).then((receipt) => { settled = true; return receipt; });
    await waiting.promise;
    expect(settled).toBe(false);
    release.resolve();
    expect((await deleting).blockers).toEqual([{ name: "actions", count: 1 }]);
    expect((await reading).blockers).toEqual([{ name: "actions", count: 1 }]);
    expect((await sql.query<{ session_owner_keys: string[] }>("SELECT session_owner_keys FROM account_deletion_requests WHERE id=$1", [queued.requestId])).rows[0].session_owner_keys).toContain(ownerKey);
    expect((await store.attempt(queued.requestId)).blockers).toEqual([{ name: "actions", count: 1 }]);
    expect((await sql.query("SELECT owner_key,customer_id FROM actions WHERE id=$1", [id])).rows[0]).toEqual({ owner_key: ownerKey, customer_id: null });
    await terminal(id);
    expect((await store.attempt(queued.requestId)).status).toBe("completed");
    expect((await sql.query<{ owner_key: string }>("SELECT owner_key FROM actions WHERE id=$1", [id])).rows[0].owner_key).toStartWith("retained:");
  });

  test.each(["account_address", "owner_key"])("legacy %s address belonging to another customer preserves that customer's caches", async (field) => {
    const a = await seed(), b = await seed();
    const legacyAddress = `0x${"d".repeat(40)}` as const;
    const id = crypto.randomUUID();
    const owner: MoneyActionOwner = { accountProvider: a.session.accountProvider, subject: a.session.user.subject, chainId: 8453, address: field === "owner_key" ? b.address : legacyAddress };
    await sql.query("INSERT INTO actions(id,owner_key,account_address,provider,kind,summary) VALUES ($1,$2,$3,'base-account','send','{\"amounts\":[]}')", [id,actionOwnerKey(owner),field === "account_address" ? b.address : legacyAddress]);
    await terminal(id);
    await sql.query("INSERT INTO balance_snapshots(chain_id,address,block_number,block_hash,block_timestamp,observed_at,holdings,coverage) VALUES (8453,$1,1,$2,1,now(),'[]','{}')", [b.address, hash]);
    expect((await store.read(a.session, true)).status).toBe("completed");
    expect((await sql.query("SELECT account_address FROM actions WHERE id=$1", [id])).rows[0]).toEqual({ account_address: null });
    expect((await sql.query("SELECT 1 FROM balance_snapshots WHERE address=$1", [b.address])).rowCount).toBe(1);
  });

  test.each(["enrollment-first", "completion-first"] as const)("legacy address cache cleanup fences real enrollment in %s order", async (order) => {
    const a = await seed();
    const address: `0x${string}` = `0x${a.number.toString(16).padStart(40, "e")}`;
    const b: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: `cache-race-${a.number}` }, smartAccount: { chainId: 8453, address } };
    const id = crypto.randomUUID();
    await sql.query("INSERT INTO actions(id,owner_key,account_address,provider,kind,summary,created_at) VALUES ($1,$2,$3,'base-account','send','{\"amounts\":[]}',$4)", [id, actionOwnerKey({ accountProvider: a.session.accountProvider, subject: a.session.user.subject, chainId: 8453, address }), address, at]);
    const queued = await store.read(a.session, true);
    expect(queued.status).toBe("queued");
    await terminal(id);
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
    let paused = false, addressLocks = 0;
    const persistCaches = async () => {
      expect(await new PostgresBalanceSnapshotStore(sql).putObservation({ chainId: 8453, address, blockNumber: "1", blockHash: hash, blockTimestamp: "1", observedAt: at.toISOString(), holdings: [], coverage: { registry: "complete", catalog: "complete" } })).toBe(true);
      expect(await new PostgresHistoryStore(sql).enroll({ chainId: 8453, address, windowStartBlock: BigInt(1), windowStartAt: at, enrolledBlock: BigInt(1) })).not.toBeNull();
    };
    const enrollment = observeTransaction(async (text) => {
      if (order === "completion-first" && text === "SELECT pg_advisory_xact_lock(hashtextextended($1,0))" && ++addressLocks === 2) waiting.resolve();
    }, async (text) => {
      if (order === "enrollment-first" && text.includes("INSERT INTO customer_wallets")) { held.resolve(); await release.promise; }
    });
    const completion = observeTransaction(async (text) => {
      if (order === "enrollment-first" && text === "SELECT pg_advisory_xact_lock(hashtextextended($1,0))" && ++addressLocks === 2) waiting.resolve();
    }, async (text) => {
      if (text.startsWith("SELECT address FROM customer_wallets") && !paused) {
        paused = true;
        if (order === "completion-first") { held.resolve(); await release.promise; }
        else await persistCaches();
      }
    });
    const resolver = new CustomerResolver(enrollment);
    let deleting: Promise<ReturnType<typeof parseAccountDeletionReceipt>>, enrolling: ReturnType<typeof resolver.resolveCustomer>;
    if (order === "enrollment-first") {
      enrolling = resolver.resolveCustomer(b, { create: true });
      await held.promise;
      deleting = new AccountDeletionStore(completion, () => at).attempt(queued.requestId);
    } else {
      deleting = new AccountDeletionStore(completion, () => at).attempt(queued.requestId);
      await held.promise;
      enrolling = resolver.resolveCustomer(b, { create: true });
    }
    await waiting.promise;
    release.resolve();
    expect((await deleting)?.status).toBe("completed");
    const customerB = await enrolling;
    expect(customerB?.id).not.toBe(a.id);
    if (order === "completion-first") await persistCaches();
    expect((await sql.query("SELECT 1 FROM customer_wallets WHERE customer_id=$1 AND address=$2", [customerB?.id, address])).rowCount).toBe(1);
    for (const table of ["balance_snapshots", "history_addresses"]) expect((await sql.query(`SELECT 1 FROM ${table} WHERE address=$1`, [address])).rowCount).toBe(1);
  });

  test("legacy registry backfill commands refuse to run once a deletion request exists", async () => {
    await sql.transaction(async (tx) => {
      if ((await tx.query("SELECT 1 FROM account_deletion_requests LIMIT 1")).rowCount === 0) await expect(assertNoAccountDeletions(tx)).resolves.toBeUndefined();
    });
    const a = await seed();
    await prepared(a);
    expect((await store.read(a.session, true)).status).toBe("queued");
    await expect(sql.transaction((tx) => assertNoAccountDeletions(tx))).rejects.toThrow("Legacy registry backfills are unsupported");
    const b = await seed(true);
    expect((await store.read(b.session, true)).status).toBe("completed");
    await sql.query("DELETE FROM account_deletion_requests");
    await expect(sql.transaction((tx) => assertNoAccountDeletions(tx))).rejects.toThrow("Legacy registry backfills are unsupported");
  });

  test("sweep classifies a persisted deadline failure as failed rather than blocked", async () => {
    const a = await seed();
    const id = await prepared(a);
    const queued = await store.read(a.session, true);
    const attempt = spyOn(AccountDeletionStore.prototype, "attempt").mockResolvedValue({ ...queued, lastAttempt: { at: at.toISOString(), outcome: "failed" } });
    try {
      const counts = await sweepAccountDeletions(sql, { now: at, batchSize: 500 });
      expect(counts).toMatchObject({ completed: 0, blocked: 0 });
      expect(counts.failed).toBeGreaterThan(0);
    }
    finally { attempt.mockRestore(); await terminal(id); await store.attempt(queued.requestId); }
  });

  test("GET without a credential or tombstone is NOT_FOUND", async () => {
    const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "never-recorded" }, smartAccount: null };
    await expect(store.read(session, false)).rejects.toMatchObject({ code: "ACCOUNT_DELETION_NOT_FOUND" });
  });

  test("publication exhausts the same deadline used by completion without a fresh request budget", async () => {
    const a = await seed();
    const deadline = new AbortController();
    const nativeTimeout = AbortSignal.timeout;
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === 25_000 ? deadline.signal : nativeTimeout(ms));
    let publications = 0;
    const executor: SqlExecutor = { query: sql.query.bind(sql), transaction: async (fn, options) => {
      const result = await sql.transaction(fn, options);
      if (++publications === 1) deadline.abort(new DOMException("Operation timed out", "TimeoutError"));
      return result;
    } };
    try {
      const receipt = await new AccountDeletionStore(executor, () => at).read(a.session, true);
      expect(receipt).toMatchObject({ status: "queued", lastAttempt: { outcome: "failed" } });
      expect(timeout.mock.calls.filter(([ms]) => ms === 25_000)).toHaveLength(1);
      expect((await sql.query("SELECT 1 FROM customer_credentials WHERE customer_id=$1", [a.id])).rowCount).toBe(1);
    } finally { timeout.mockRestore(); }
    expect((await store.read(a.session, false)).status).toBe("completed");
  });

  test("shared operation deadline rolls back rotated evidence and returns persisted failed queued receipt", async () => {
    const a = await seed(true), pending = await prepared(a);
    const queued = await store.read(a.session, true);
    await terminal(pending);
    const deadline = new AbortController();
    const bounded = observeTransaction(async () => {}, async (text) => {
      if (text.startsWith("UPDATE actions SET customer_id=")) deadline.abort(new DOMException("Operation timed out", "TimeoutError"));
    });
    const failed = await new AccountDeletionStore(bounded, () => at).attempt(queued.requestId, a.session, undefined, deadline.signal);
    expect(failed).toMatchObject({ status: "queued", lastAttempt: { outcome: "failed" } });
    expect((await sql.query("SELECT customer_id,account_address FROM actions WHERE id=$1", [a.action])).rows[0]).toEqual({ customer_id: a.id, account_address: a.address });
    expect(await store.read(a.session, false)).toMatchObject({ status: "completed" });
  });

  test("unpublished linked legacy terminal action is pseudonymized without touching other subjects or providers", async () => {
    const a = await seed(), b = await seed(), c = await seed();
    const subject = `unpublished-linked-${a.number}`;
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,'cdp-embedded',$2,now(),now()),(gen_random_uuid(),$3,'base-account',$2,now(),now())", [a.id, subject, c.id]);
    const address = `0x${"e".repeat(40)}` as const;
    const owners = [
      { accountProvider: "cdp-embedded", subject, chainId: 8453, address },
      { accountProvider: b.session.accountProvider, subject: b.session.user.subject, chainId: 8453, address },
      { accountProvider: "base-account", subject, chainId: 8453, address },
    ] satisfies MoneyActionOwner[];
    const ids = owners.map(() => crypto.randomUUID());
    for (const [index, owner] of owners.entries()) {
      await sql.query("INSERT INTO actions(id,owner_key,account_address,provider,kind,summary,created_at,confirmed_at) VALUES ($1,$2,$3,$4,'send',$5::jsonb,$6,$6)", [ids[index], actionOwnerKey(owner), address, owner.accountProvider, JSON.stringify({ title: "Legacy", amounts: [] }), at]);
    }
    await terminal(ids[0]);
    await sql.query("UPDATE actions SET account_address=NULL WHERE id=$1", [ids[0]]);
    await sql.query("INSERT INTO balance_snapshots(chain_id,address,block_number,block_hash,block_timestamp,observed_at,holdings,coverage) VALUES (8453,$1,1,$2,1,now(),'[]','{}')", [address,hash]);
    await sql.query("INSERT INTO cashout_orders(action_id,owner_key,provider_id,environment,region,state,platform,platform_label,amount_atomic,remaining_atomic) VALUES ($1,$2,'peer','sandbox','US','failed','bank','Bank','1','1')", [ids[0],actionOwnerKey(owners[0])]);
    await sql.query("INSERT INTO operator_fee_records(action_id,action_kind,amount_base_units,token_asset_id,token_address,token_decimals,bps,recipient,collected_by) VALUES ($1,'trade',1,'usdc',$2,6,10,$2,'provider-native')", [ids[0],address]);
    const exported = await new AccountExportReader(sql).read(a.session);
    for (const name of ["actions", "cashout_orders", "operator_fees"]) expect(exported.classes.find((entry) => entry.name === name)?.records).toHaveLength(1);
    expect(exported.classes.find((entry) => entry.name === "actions")?.records[0]?.id).toBe(ids[0]);
    await expect(new AccountExportReader(sql, 1).read(a.session)).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_TOO_LARGE" });
    expect((await store.read(a.session, true)).status).toBe("completed");
    const retained = (await sql.query<{ customer_id: string; owner_key: string; account_address: string | null }>("SELECT customer_id,owner_key,account_address FROM actions WHERE id=$1", [ids[0]])).rows[0];
    expect(retained.owner_key).toBe(`retained:${retained.customer_id}`);
    expect(retained.account_address).toBeNull();
    for (const table of ["balance_snapshots", "history_addresses"]) expect((await sql.query(`SELECT 1 FROM ${table} WHERE address=$1`, [address])).rowCount).toBe(0);
    for (const index of [1, 2]) expect((await sql.query("SELECT customer_id,owner_key,account_address FROM actions WHERE id=$1", [ids[index]])).rows[0]).toEqual({ customer_id: null, owner_key: actionOwnerKey(owners[index]), account_address: address });
  });

  test.each(["invalid_subject", "invalid%subject", "invalid\"subject", "invalid\\subject", "invalid-subject\n", "s".repeat(101)])("legacy scope rejects invalid linked subject %p before deletion", async (subject) => {
    const a = await seed();
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,'cdp-embedded',$2,now(),now())", [a.id, subject]);
    await expect(store.read(a.session, true)).rejects.toMatchObject({ code: "ACCOUNT_DELETION_LINKAGE" });
    expect((await sql.query("SELECT 1 FROM customer_credentials WHERE customer_id=$1", [a.id])).rowCount).toBe(2);
    expect((await sql.query("SELECT status,last_attempt_outcome FROM account_deletion_requests WHERE customer_id=$1", [a.id])).rows[0]).toEqual({ status: "queued", last_attempt_outcome: "failed" });
  });

  test("unpublished credential legacy scope fails closed on a cross-customer action", async () => {
    const a = await seed(), b = await seed();
    const subject = `conflicting-linked-${a.number}`;
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,'cdp-embedded',$2,now(),now())", [a.id, subject]);
    const ownerKey = actionOwnerKey({ accountProvider: "cdp-embedded", subject, chainId: 8453, address: `0x${"f".repeat(40)}` });
    await sql.query("INSERT INTO actions(id,customer_id,owner_key,provider,kind,summary) VALUES (gen_random_uuid(),$1,$2,'cdp-embedded','send','{}')", [b.id, ownerKey]);
    await expect(new AccountExportReader(sql).read(a.session)).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_LINKAGE" });
    await expect(store.read(a.session, true)).rejects.toMatchObject({ code: "ACCOUNT_DELETION_LINKAGE" });
    expect((await sql.query("SELECT 1 FROM customer_credentials WHERE customer_id=$1", [a.id])).rowCount).toBe(2);
  });

  test.each([true, false])("completion between %s create reads recovers the frozen receipt after waiting", async (create) => {
    const a = await seed(), pending = await prepared(a);
    const queued = await store.read(a.session, true);
    await terminal(pending);
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
    const completing = observeTransaction(async () => {}, async (text) => {
      if (text === "SELECT * FROM account_deletion_requests WHERE id=$1 FOR UPDATE") { held.resolve(); await release.promise; }
    });
    const polling = observeTransaction(async (text) => {
      if (text.includes("pg_advisory_xact_lock")) waiting.resolve();
    }, async () => {});
    const deleting = new AccountDeletionStore(completing, () => at).attempt(queued.requestId);
    await held.promise;
    const reading = new AccountDeletionStore(polling, () => at).read(a.session, create);
    await waiting.promise;
    release.resolve();
    const completed = await deleting;
    expect(completed.status).toBe("completed");
    expect(await reading).toEqual(completed);
    expect((await store.read(a.session, false))).toEqual(completed);
  });

  test("funding receipt labels come from every registered provider manifest; unknown ids fail closed", async () => {
    const a = await seed();
    for (const provider of fundingProviders) {
      await sql.query("INSERT INTO funding_provider_customers(id,owner_subject,account_provider,provider_id,region,customer_ref,state,created_at,updated_at) VALUES (gen_random_uuid(),$1,$2,$3,'US',$4,'verified',now(),now())", [a.session.user.subject, a.session.accountProvider, provider.manifest.id, `registered-${provider.manifest.id}-${a.number}`]);
    }
    const completed = await store.read(a.session, true);
    for (const provider of fundingProviders) expect(completed.providers.map((entry) => entry.provider)).toContain(provider.manifest.displayName);
    const b = await seed();
    await sql.query("INSERT INTO funding_provider_customers(id,owner_subject,account_provider,provider_id,region,customer_ref,state,created_at,updated_at) VALUES (gen_random_uuid(),$1,$2,'unknown-provider','US','unknown-ref','verified',now(),now())", [b.session.user.subject, b.session.accountProvider]);
    await expect(store.read(b.session, true)).rejects.toMatchObject({ code: "ACCOUNT_DELETION_UNAVAILABLE" });
    expect((await sql.query("SELECT 1 FROM customer_credentials WHERE customer_id=$1", [b.id])).rowCount).toBe(1);
    await sql.query("DELETE FROM funding_provider_customers WHERE owner_subject=$1", [b.session.user.subject]);
    expect((await store.read(b.session, false)).status).toBe("completed");
  });

  test("completion failure rolls back all deletions and pseudonymization, marks failed, then retries", async () => {
    const a = await seed(true);
    const pending = await prepared(a);
    const queued = await store.read(a.session,true);
    await terminal(pending);
    const failing: SqlExecutor = {query:sql.query.bind(sql),transaction:(fn,options)=>sql.transaction((tx)=>fn({query:async <T>(text: string,values?: unknown[],queryOptions?: SqlQueryOptions)=>{if(text.startsWith("UPDATE funding_orders")) throw new Error("private-failure-marker");return tx.query<T>(text,values,queryOptions);},transaction:tx.transaction}),options)};
    await expect(new AccountDeletionStore(failing, () => at).attempt(queued.requestId,a.session)).rejects.toBeInstanceOf(AccountDeletionError);
    expect((await sql.query("SELECT status,last_attempt_outcome FROM account_deletion_requests WHERE id=$1",[queued.requestId])).rows[0]).toEqual({status:"queued",last_attempt_outcome:"failed"});
    expect((await sql.query("SELECT customer_id,account_address FROM actions WHERE id=$1",[a.action])).rows[0]).toEqual({customer_id:a.id,account_address:a.address});
    expect((await sql.query("SELECT 1 FROM customer_credentials WHERE customer_id=$1",[a.id])).rowCount).toBe(1);
    expect((await sql.query("SELECT 1 FROM account_deletion_tombstones WHERE request_id=$1",[queued.requestId])).rowCount).toBe(0);
    expect((await store.read(a.session,false)).status).toBe("completed");
  });

  test("application abort rolls back a completion that already rotated evidence", async () => {
    const a = await seed(true), controller = new AbortController();
    const pending = await prepared(a), queued = await store.read(a.session,true); await terminal(pending);
    const aborting: SqlExecutor = {query:sql.query.bind(sql),transaction:(fn,options)=>sql.transaction((tx)=>fn({query:async <T>(text: string,values?: unknown[],queryOptions?: SqlQueryOptions)=>{const result=await tx.query<T>(text,values,queryOptions);if(text.startsWith("UPDATE funding_orders")) controller.abort();return result;},transaction:tx.transaction}),options)};
    await expect(new AccountDeletionStore(aborting, () => at).attempt(queued.requestId,a.session,controller.signal)).rejects.toBeInstanceOf(AccountDeletionError);
    expect((await sql.query("SELECT customer_id FROM actions WHERE id=$1",[a.action])).rows[0].customer_id).toBe(a.id);
    expect((await sql.query("SELECT last_attempt_outcome FROM account_deletion_requests WHERE id=$1",[queued.requestId])).rows[0].last_attempt_outcome).toBe("failed");
    expect((await store.read(a.session,false)).status).toBe("completed");
  });

  test("action creation first wins the credential lock and blocks completion", async () => {
    const a = await seed();
    const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
    const creating = sql.transaction(async(tx)=>{
      await assertCredentialLive(tx,a.session,at,true); entered.resolve(); await gate.promise;
      await tx.query("INSERT INTO actions(id,owner_key,customer_id,account_address,provider,kind,summary,pending,created_at) VALUES (gen_random_uuid(),$1,$2,$3,'base-account','send',$4::jsonb,'{\"calls\":[]}',$5)",[actionOwnerKey({accountProvider:a.session.accountProvider,subject:a.session.user.subject,chainId:8453,address:a.address}),a.id,a.address,JSON.stringify(summary),at]);
    });
    await entered.promise;
    const watching: SqlExecutor={query:sql.query.bind(sql),transaction:(fn,options)=>sql.transaction((tx)=>fn({query:<T>(text: string,values?: unknown[],queryOptions?: SqlQueryOptions)=>{if(text.includes("pg_advisory_xact_lock")) waiting.resolve();return tx.query<T>(text,values,queryOptions);},transaction:tx.transaction}),options)};
    const deleting = new AccountDeletionStore(watching, () => at).read(a.session,true);
    await waiting.promise; gate.resolve(); await creating;
    expect((await deleting).blockers).toEqual([{name:"actions",count:1}]);
  });

  test("completion first wins the credential lock and a racing action is refused before credential insertion", async () => {
    const a=await seed(); const committed=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();
    const watching: SqlExecutor={query:sql.query.bind(sql),transaction:(fn,options)=>sql.transaction((tx)=>fn({query:async <T>(text: string,values?: unknown[],queryOptions?: SqlQueryOptions)=>{const result=await tx.query<T>(text,values,queryOptions);if(text.startsWith("UPDATE account_deletion_requests SET customer_id=NULL")){committed.resolve();await gate.promise;}return result;},transaction:tx.transaction}),options)};
    const deleting=new AccountDeletionStore(watching, () => at).read(a.session,true);await committed.promise;
    const creating=prepared(a);gate.resolve();expect((await deleting).status).toBe("completed");
    await expect(creating).rejects.toBeInstanceOf(AccountDeletedError);
    expect((await sql.query("SELECT 1 FROM customer_credentials WHERE subject=$1",[a.session.user.subject])).rowCount).toBe(0);
  });

  test("old-session authorization and resolver deny; recovery is receipt-only; after window fresh sign-in has no old linkage",async()=>{
    const a=await seed(true),receipt=await store.read(a.session,true);
    const response=await authorizeSession(new Request("https://home.test/private",{headers:{"X-Home-Account-Provider":"base-account"}}),async()=>a.session,(owner)=>assertCredentialLive(sql,owner));
    if (!(response instanceof Response)) throw new Error("expected a revocation response");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({error:{code:"ACCOUNT_DELETED"}});
    await expect(new CustomerResolver(sql).resolveCustomer(a.session,{create:true})).rejects.toBeInstanceOf(AccountDeletedError);
    expect(await store.read(a.session,false)).toEqual(receipt);
    const after=new Date("2000-01-01T00:00:00Z");
    await sql.query("UPDATE account_deletion_tombstones SET completed_at=$2 WHERE request_id=$1",[receipt.requestId,after]);
    const fresh=await new CustomerResolver(sql).resolveCustomer(a.session,{create:true});
    expect(fresh.id).not.toBe(a.id);
    expect((await sql.query("SELECT 1 FROM actions WHERE customer_id=$1",[fresh.id])).rowCount).toBe(0);
    expect((await sql.query("SELECT 1 FROM funding_orders WHERE customer_id=$1 OR owner_subject=$2",[fresh.id,a.session.user.subject])).rowCount).toBe(0);
  });

  test("webhook and transaction replay cannot recreate deleted events or restore retained merchant identity",async()=>{
    const a=await seed(true);await store.read(a.session,true);
    expect(await createCardEventStore(sql).insert({provider:"bridge",mode:"sandbox",eventId:`event-${a.number}`,kind:"issuing_transaction.created",externalIds:{cardholder:`holder-${a.number}`,card:`stripe-${a.number}`,transaction:`purchase-${a.number}`,customer:`bridge-${a.number}`},occurredAt:at.toISOString()})).toBe(false);
    await createCardTransactionStore(sql).upsert(a.card,"sandbox",{id:`purchase-${a.number}`,cardId:`stripe-${a.number}`,authorizationId:null,kind:"transaction",amountMinor:"9007199254740993",currency:"USD",merchantName:"Restore Identity",merchantCategory:null,status:"completed",declineReasonCode:null,createdAt:at.toISOString(),updatedAt:at.toISOString()});
    expect((await sql.query("SELECT merchant_name FROM card_transactions WHERE card_id=$1",[a.card])).rows[0].merchant_name).toBeNull();
    expect((await sql.query("SELECT 1 FROM card_events WHERE event_id=$1",[`event-${a.number}`])).rowCount).toBe(0);
  });

  test("audit is append-only before expiry; exact expiry sweep removes evidence, audit, pseudonym and receipt; rerun converges",async()=>{
    const a=await seed(true),receipt=await store.read(a.session,true);
    const p=(await sql.query<{customer_id:string}>("SELECT customer_id FROM actions WHERE id=$1",[a.action])).rows[0].customer_id;
    await expect(sql.query("DELETE FROM admin_audit_log WHERE target_id=$1",[a.id])).rejects.toThrow();
    await expect(sql.query("UPDATE admin_audit_log SET purpose='changed' WHERE target_id=$1",[a.id])).rejects.toThrow();
    const expiry=new Date("2000-01-01T00:00:00Z");
    await sql.query("UPDATE customers SET retained_until=$2 WHERE id=$1",[p,expiry]);
    await sql.query("UPDATE account_deletion_requests SET expires_at=$2 WHERE id=$1",[receipt.requestId,expiry]);
    await sql.query("UPDATE account_deletion_audit_expiry SET expires_at=$2 WHERE target_id=$1",[a.id,expiry]);
    await sweepAccountDeletions(sql,{now:new Date(expiry.getTime()-1),batchSize:500});
    expect((await sql.query("SELECT 1 FROM customers WHERE id=$1",[p])).rowCount).toBe(1);
    await sweepAccountDeletions(sql,{now:expiry,batchSize:500});
    for(const [table,column,id] of [["customers","id",p],["cashout_orders","action_id",a.action],["operator_fee_records","action_id",a.action],["card_accounts","customer_id",p],["card_transactions","card_id",a.card],["actions","id",a.action],["funding_orders","id",a.funding],["cards","id",a.card],["account_deletion_requests","id",receipt.requestId],["admin_audit_log","target_id",a.id]] as const) expect((await sql.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`,[id])).rowCount).toBe(0);
    expect((await sql.query("SELECT 1 FROM account_deletion_tombstones WHERE request_id=$1",[receipt.requestId])).rowCount).toBe(0);
    expect((await sweepAccountDeletions(sql,{now:expiry,batchSize:500})).expiredOwners).toBe(0);
  });

  test("missing HMAC secret rejects deletion; existing tombstones make auth fail closed",async()=>{
    const a=await seed(),key=requireTombstoneKey();await store.read(a.session,true);
    delete process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET;
    try {
      await expect(store.read(a.session,false)).rejects.toMatchObject({code:"ACCOUNT_DELETION_UNAVAILABLE"});
      await expect(findTombstone(sql,a.session)).rejects.toThrow("AUTH_UNAVAILABLE");
    } finally {process.env.ACCOUNT_DELETION_TOMBSTONE_SECRET=key.toString("utf8");}
    expect((await sql.query("SELECT credential_digest FROM account_deletion_tombstones WHERE credential_digest=$1",[credentialDigest(key,a.session.accountProvider,a.session.user.subject)])).rowCount).toBe(1);
  });

  test.each(["delivered", "returned", "failed", "submitted", "awaiting-buyer", "unknown"])("cashout state %s requires both durable settlement and a state terminal in planCashoutRefresh", async (state) => {
    const a = await seed(true);
    await sql.query("UPDATE cashout_orders SET state=$2 WHERE action_id=$1", [a.action, state]);
    const result = await store.read(a.session, true);
    expect(result.status).toBe(["delivered", "returned", "failed"].includes(state) ? "completed" : "queued");
    if (result.status === "queued") expect(result.blockers).toEqual([{ name: "cashout_orders", count: 1 }]);
  });

  test("statement timeout records a failed attempt without deletion and retry completes", async () => {
    const a = await seed(true), pending = await prepared(a), queued = await store.read(a.session, true);
    await terminal(pending);
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const holder = sql.transaction(async (tx) => {
      await tx.query("SELECT customer_id FROM card_accounts WHERE customer_id=$1 FOR UPDATE", [a.id]);
      held.resolve(); await release.promise;
    });
    await held.promise;
    const timed: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn, options) => sql.transaction((tx) => fn({
      query: async <T>(text: string, values?: unknown[], queryOptions?: SqlQueryOptions) => {
        if (text.startsWith("SELECT customer_id FROM card_accounts")) await tx.query("SET LOCAL statement_timeout='30ms'");
        return tx.query<T>(text, values, queryOptions);
      }, transaction: tx.transaction,
    }), options) };
    try { await expect(new AccountDeletionStore(timed, () => at).attempt(queued.requestId, a.session)).rejects.toMatchObject({ code: "ACCOUNT_DELETION_UNAVAILABLE" }); }
    finally { release.resolve(); await holder; }
    expect((await sql.query("SELECT status,last_attempt_outcome FROM account_deletion_requests WHERE id=$1", [queued.requestId])).rows[0]).toEqual({ status: "queued", last_attempt_outcome: "failed" });
    expect((await sql.query("SELECT customer_id FROM actions WHERE id=$1", [a.action])).rows[0].customer_id).toBe(a.id);
    expect((await store.read(a.session, false)).status).toBe("completed");
  });

  test("real credential/card lock deadlock rolls back completion, marks failed and retries", async () => {
    const a = await seed(true), pending = await prepared(a), queued = await store.read(a.session, true);
    await terminal(pending);
    const held = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
    const holder = sql.transaction(async (tx) => {
      await tx.query("SET LOCAL deadlock_timeout='10s'");
      await tx.query("SELECT customer_id FROM card_accounts WHERE customer_id=$1 FOR UPDATE", [a.id]);
      held.resolve(); await waiting.promise;
      await assertCredentialLive(tx, a.session, at, true);
    });
    await held.promise;
    let deadlockCode: unknown;
    const cycling: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn, options) => sql.transaction((tx) => fn({
      query: async <T>(text: string, values?: unknown[], queryOptions?: SqlQueryOptions) => {
        if (text.startsWith("SELECT customer_id FROM card_accounts")) {
          await tx.query("SET LOCAL deadlock_timeout='20ms'"); waiting.resolve();
        }
        try { return await tx.query<T>(text, values, queryOptions); }
        catch (error) { if (error && typeof error === "object" && "code" in error) deadlockCode = error.code; throw error; }
      }, transaction: tx.transaction,
    }), options) };
    await expect(new AccountDeletionStore(cycling, () => at).attempt(queued.requestId, a.session)).rejects.toMatchObject({ code: "ACCOUNT_DELETION_UNAVAILABLE" });
    await holder;
    expect(deadlockCode).toBe("40P01");
    expect((await sql.query("SELECT status,last_attempt_outcome FROM account_deletion_requests WHERE id=$1", [queued.requestId])).rows[0]).toEqual({ status: "queued", last_attempt_outcome: "failed" });
    expect((await sql.query("SELECT customer_id FROM actions WHERE id=$1", [a.action])).rows[0].customer_id).toBe(a.id);
    expect((await store.read(a.session, false)).status).toBe("completed");
  });

  test("retained provider card cannot be adopted by a new live account", async () => {
    const a = await seed(true); await store.read(a.session, true);
    const b = await seed();
    await sql.query("INSERT INTO card_accounts(customer_id,mode,bridge_customer_id,stripe_cardholder_id) VALUES ($1,'sandbox',$2,$3)", [b.id, `new-bridge-${b.number}`, `new-holder-${b.number}`]);
    const config = { mode: "sandbox" as const, bridgeOrigin: "https://bridge.test", bridgeApiKey: "fixture", stripeSecretKey: "fixture", stripeApiVersion: "2026-01-01", funding: { kind: "crypto_wallet" as const } };
    const customer = { id: `new-bridge-${b.number}`, status: "active" as const, stripeCardholderId: `new-holder-${b.number}`, cardsEndorsement: { status: "approved" as const, missing: false, pending: false, issues: false } };
    const bridge = { ...createBridgeClient(config), readCustomer: async () => customer };
    const stripe = { ...createStripeClient(config), readCardholder: async () => ({ id: customer.stripeCardholderId, status: "active" as const }), issueCard: async () => ({ id: `stripe-${a.number}`, cardholderId: customer.stripeCardholderId, status: "active" as const, customerFrozen: false, last4: "1234" }) };
    await expect(createCardWriteService({ sql, config, bridge, stripe }).issue(b.id, b.session)).rejects.toMatchObject({ code: "CARDS_UNAVAILABLE", status: 503 });
    expect((await sql.query("SELECT 1 FROM cards WHERE customer_id=$1", [b.id])).rowCount).toBe(0);
    expect((await sql.query("SELECT wallet_address FROM cards WHERE id=$1", [a.card])).rows[0].wallet_address).toBeNull();
  });

  test("transaction refresh resumed after completion drops provider replay without restoring identity", async () => {
    const a = await seed(true), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const purchase = { id: `purchase-${a.number}`, cardId: `stripe-${a.number}`, authorizationId: null, kind: "transaction" as const, amountMinor: "9007199254740993", currency: "USD", merchantName: "Restore Identity", merchantCategory: null, status: "completed" as const, declineReasonCode: null, createdAt: at.toISOString(), updatedAt: at.toISOString() };
    const client = { read: async () => purchase, list: async () => { entered.resolve(); await release.promise; return { rows: [purchase], partial: false }; } };
    const refresh = refreshCardPurchases(a.id, "sandbox", createCardTransactionStore(sql), client);
    await entered.promise;
    expect((await store.read(a.session, true)).status).toBe("completed");
    release.resolve();
    expect((await refresh).rows).toEqual([]);
    expect((await sql.query("SELECT merchant_name FROM card_transactions WHERE card_id=$1", [a.card])).rows[0].merchant_name).toBeNull();
  });

  test("stale owner balance observation cannot recreate deleted snapshot or write across fresh wallet enrollment", async () => {
    const a = await seed(true), snapshots = new PostgresBalanceSnapshotStore(sql);
    const original = await snapshots.get(8453, a.address);
    if (!original) throw new Error("expected a seeded snapshot");
    const stale = { ...original, observedAt: at.toISOString(), blockNumber: "2" };
    expect(await snapshots.putObservation(stale)).toBe(true);
    expect((await store.read(a.session, true)).status).toBe("completed");
    expect(await snapshots.putObservation(stale)).toBe(false);
    expect(await snapshots.get(8453, a.address)).toBeNull();
    const fresh = await seed();
    await sql.query("UPDATE customer_wallets SET address=$2,created_at=$3 WHERE id=$1", [fresh.wallet, a.address, new Date(Date.parse(stale.observedAt) + 1000)]);
    expect(await snapshots.putObservation(stale)).toBe(false);
    expect(await snapshots.get(8453, a.address)).toBeNull();
  });

  test("funding reservation first commits under the credential lock and blocks completion", async () => {
    const a = await seed(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
    const creatingSql: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn, options) => sql.transaction((tx) => fn({
      query: async <T>(text: string, values?: unknown[], queryOptions?: SqlQueryOptions) => {
        const result = await tx.query<T>(text, values, queryOptions);
        if (text.includes("pg_advisory_xact_lock(hashtextextended")) { entered.resolve(); await release.promise; }
        return result;
      }, transaction: tx.transaction,
    }), options) };
    const creating = reserveFunding(a, creatingSql); await entered.promise;
    const watching: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn, options) => sql.transaction((tx) => fn({
      query: <T>(text: string, values?: unknown[], queryOptions?: SqlQueryOptions) => {
        if (text.includes("pg_advisory_xact_lock(hashtextextended")) waiting.resolve();
        return tx.query<T>(text, values, queryOptions);
      }, transaction: tx.transaction,
    }), options) };
    const deleting = new AccountDeletionStore(watching, () => at).read(a.session, true);
    await waiting.promise; release.resolve(); await creating;
    expect((await deleting).blockers).toEqual([{ name: "funding_orders", count: 1 }]);
  });

  test("completion first refuses a racing funding reservation before identity or order insertion", async () => {
    const a = await seed(), completing = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const watching: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn, options) => sql.transaction((tx) => fn({
      query: async <T>(text: string, values?: unknown[], queryOptions?: SqlQueryOptions) => {
        const result = await tx.query<T>(text, values, queryOptions);
        if (text.startsWith("UPDATE account_deletion_requests SET customer_id=NULL")) { completing.resolve(); await release.promise; }
        return result;
      }, transaction: tx.transaction,
    }), options) };
    const deleting = new AccountDeletionStore(watching, () => at).read(a.session, true); await completing.promise;
    const creating = reserveFunding(a); release.resolve();
    expect((await deleting).status).toBe("completed");
    await expect(creating).rejects.toBeInstanceOf(AccountDeletedError);
    expect((await sql.query("SELECT 1 FROM funding_orders WHERE owner_subject=$1", [a.session.user.subject])).rowCount).toBe(0);
    expect((await sql.query("SELECT 1 FROM customer_credentials WHERE subject=$1", [a.session.user.subject])).rowCount).toBe(0);
  });

  test("unreconciled issuing event blocks deletion until a terminal transaction refresh", async () => {
    const a=await seed(true), event=`unreconciled-${a.number}`, txn=`new-purchase-${a.number}`;
    await sql.query("INSERT INTO card_events(provider,mode,event_id,kind,card_id,transaction_id,occurred_at) VALUES ('bridge','sandbox',$1,'issuing_transaction.created',$2,$3,now())", [event,`stripe-${a.number}`,txn]);
    await sql.query("UPDATE card_events SET received_at=now()-interval '31 days' WHERE event_id=$1",[event]);
    await createCardEventStore(sql).insert({provider:"bridge",mode:"sandbox",eventId:`prune-${a.number}`,kind:"issuing_cardholder.created",externalIds:{cardholder:`holder-${a.number}`,card:null,transaction:null,customer:null},occurredAt:at.toISOString()});
    const queued=await store.read(a.session,true);
    expect(queued.status).toBe("queued"); expect(queued.blockers).toEqual([{name:"card_transactions",count:1}]);
    expect((await sql.query("SELECT 1 FROM card_events WHERE event_id=$1",[event])).rowCount).toBe(1);
    await sql.query("INSERT INTO card_transactions(card_id,provider,mode,provider_transaction_id,kind,amount_minor,currency,merchant_name,status,provider_created_at) VALUES ($1,'bridge','sandbox',$2,'transaction',1,'USD','Merchant','completed',now())",[a.card,txn]);
    expect((await store.read(a.session,false)).status).toBe("completed");
    expect((await sql.query("SELECT 1 FROM card_events WHERE event_id=$1",[event])).rowCount).toBe(0);
  });

  test("cardholder-created event is removed without touching another cardholder", async () => {
    const a=await seed(true), b=await seed(true);
    for(const owner of [a,b]) await sql.query("INSERT INTO card_events(provider,mode,event_id,kind,cardholder_account_id,occurred_at) VALUES ('bridge','sandbox',$1,'issuing_cardholder.created',$2,now())",[`holder-event-${owner.number}`,`holder-${owner.number}`]);
    expect((await store.read(a.session,true)).status).toBe("completed");
    expect((await sql.query("SELECT 1 FROM card_events WHERE event_id=$1",[`holder-event-${a.number}`])).rowCount).toBe(0);
    expect((await sql.query("SELECT 1 FROM card_events WHERE event_id=$1",[`holder-event-${b.number}`])).rowCount).toBe(1);
  });

  test("deletion strips only A invitation references under real immutability triggers", async () => {
    const a=await seed(), b=await seed(), c=await seed();
    const code="abcdefghjk", other="abcdefghjm";
    await sql.query("INSERT INTO invite_codes(code,customer_id) VALUES ($1,$2),($3,$4)",[code,a.id,other,c.id]);
    await sql.query("INSERT INTO customers(id,first_seen_at,last_seen_at,first_seen_source,invite_code) VALUES (gen_random_uuid(),now(),now(),'sign_in',$1)",[code]);
    const event=crypto.randomUUID();
    const props={inviteCode:code,inviterCustomerId:a.id,amount:"123",otherCustomer:c.id};
    await sql.query("INSERT INTO operator_events(id,customer_id,name,occurred_at,source,props,idempotency_key) VALUES ($1,$2,'invite.attributed',now(),'live',$3::jsonb,$1::uuid::text)",[event,b.id,JSON.stringify(props)]);
    const mixed=crypto.randomUUID();
    await sql.query("INSERT INTO operator_events(id,customer_id,name,occurred_at,source,props,idempotency_key) VALUES ($1,$2,'invite.attributed',now(),'live',$3::jsonb,$1::uuid::text)",[mixed,b.id,JSON.stringify({inviteCode:other,inviterCustomerId:a.id,amount:"456"})]);
    await expect(sql.query("UPDATE operator_events SET props=props-'inviteCode' WHERE id=$1",[event])).rejects.toThrow();
    await expect(sql.query("UPDATE customers SET invite_code=NULL WHERE invite_code=$1",[code])).rejects.toThrow();
    expect((await store.read(a.session,true)).status).toBe("completed");
    expect((await sql.query("SELECT props,customer_id FROM operator_events WHERE id=$1",[event])).rows[0]).toEqual({props:{amount:"123",otherCustomer:c.id},customer_id:b.id});
    expect((await sql.query("SELECT props FROM operator_events WHERE id=$1",[mixed])).rows[0].props).toEqual({inviteCode:other,amount:"456"});
    expect((await sql.query("SELECT 1 FROM customers WHERE invite_code=$1",[code])).rowCount).toBe(0);
    expect((await sql.query("SELECT 1 FROM invite_codes WHERE code=$1",[other])).rowCount).toBe(1);
    await expect(sql.query("UPDATE operator_events SET props=props-'amount' WHERE id=$1",[event])).rejects.toThrow();
  });

  test("sweep progresses past a permanently blocked full batch", async () => {
    const blocked=await seed(), pending=await prepared(blocked), queued=await store.read(blocked.session,true);
    const eligible=await seed();
    const request=(await sql.query<{id:string}>("INSERT INTO account_deletion_requests(customer_id) VALUES ($1) RETURNING id",[eligible.id])).rows[0];
    await sql.query("UPDATE account_deletion_requests SET last_attempt_at='1900-01-01' WHERE status='queued'");
    await sql.query("UPDATE account_deletion_requests SET last_attempt_at='1800-01-01' WHERE id=$1",[queued.requestId]);
    await sql.query("UPDATE account_deletion_requests SET last_attempt_at='1850-01-01' WHERE id=$1",[request.id]);
    expect((await sweepAccountDeletions(sql,{now:at,batchSize:1})).blocked).toBe(1);
    expect((await sweepAccountDeletions(sql,{now:at,batchSize:1})).completed).toBe(1);
    expect((await sql.query("SELECT status FROM account_deletion_requests WHERE id=$1",[request.id])).rows[0].status).toBe("completed");
    await terminal(pending);
  });

  test.each(["none", "deposit_id", "deposit_proven", "provider_handle", "transaction_hash", "outcome"])("confirmed then declined cash-out with %s evidence preserves deletion eligibility", async (evidence) => {
    const a = await seed(), id = crypto.randomUUID(), actions = new ActionsStore(sql);
    const owner: MoneyActionOwner = { accountProvider: a.session.accountProvider, subject: a.session.user.subject, chainId: 8453, address: a.address };
    await actions.insert({ id, owner, kind: "cash-out", createdAt: at.toISOString(), pending: { calls: [{ to: a.address, data: "0x", value: "0" }] }, summary: {
      title: "Cash out", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, direction: "spend", amountBaseUnits: "2000000" }], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z",
      metadata: { product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production",
        region: "US", platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "alice", approximateFiatAmount: "2",
        etaSeconds: 100, minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" }, estimateAsOf: at.toISOString(), escrow: a.address },
    } });
    expect(await actions.confirm(owner, id)).not.toBeNull();
    expect((await actions.cashoutOrders(owner, [id]))[0]).toMatchObject({ deposit_id: null, deposit_proven: false, settled_at: null });
    expect((await actions.recordDecline(owner, id, 0)).changed).toBe(true);
    if (evidence === "deposit_id") await actions.linkCashoutDeposit(owner, id, `declined-deposit-${a.number}`);
    if (evidence === "deposit_proven") await sql.query("UPDATE cashout_orders SET deposit_proven=true WHERE action_id=$1", [id]);
    if (evidence === "provider_handle") await actions.recordHandle(owner, id, { providerHandle: "wallet-handle" });
    if (evidence === "transaction_hash") await actions.recordHandle(owner, id, { transactionHash: hash });
    if (evidence === "outcome") await actions.recordOutcome(owner, id, { outcome: "succeeded", source: "chain", settledAt: at });
    await sql.query("UPDATE actions SET summary=jsonb_set(summary,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1", [id, at.toISOString()]);
    const receipt = await store.read(a.session, true);
    expect(receipt.status).toBe(evidence === "none" ? "completed" : "queued");
    if (evidence !== "none") {
      expect(receipt.blockers).toContainEqual({ name: "cashout_orders", count: 1 });
      await sql.query("UPDATE cashout_orders SET state='delivered',settled_at=now() WHERE action_id=$1", [id]);
      await terminal(id);
    }
  });

  test("not_submitted without deposit evidence is terminal for deletion", async () => {
    const a = await seed(true);
    await sql.query("UPDATE actions SET outcome='not_submitted',outcome_source='wallet',transaction_hash=NULL,provider_handle=NULL WHERE id=$1", [a.action]);
    await sql.query("UPDATE cashout_orders SET deposit_id=NULL,deposit_proven=false,state='submitted',settled_at=NULL WHERE action_id=$1", [a.action]);
    expect((await store.read(a.session, true)).status).toBe("completed");
  });

  test.each(["customer", "legacy"])("expired %s drafts do not block completion at review expiry or after draft retention", async (scope) => {
    for (const expiry of ["review", "age", "age-boundary", "live"]) {
      const a = await seed(), id = await prepared(a);
      if (scope === "legacy") await sql.query("UPDATE actions SET customer_id=NULL,credential_id=NULL,wallet_id=NULL WHERE id=$1", [id]);
      if (expiry === "review") await sql.query("UPDATE actions SET summary=jsonb_set(summary,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1", [id, at.toISOString()]);
      if (expiry === "age" || expiry === "age-boundary") await sql.query("UPDATE actions SET created_at=$2 WHERE id=$1", [id, new Date(at.getTime() - ACTION_DRAFT_RETENTION_MS - (expiry === "age" ? 1 : 0))]);
      const receipt = await store.read(a.session, true);
      expect(receipt.status).toBe(expiry === "review" || expiry === "age" ? "completed" : "queued");
      if (receipt.status === "queued") {
        expect(receipt.blockers).toEqual([{ name: "actions", count: 1 }]);
        await terminal(id);
      }
    }
  });


  test.each(["confirm", "retry", "handle"])("existing action %s races completion in both lock orders without orphaning money", async (mutation) => {
    for (const first of ["action", "deletion"]) {
      const a = await seed(), id = await prepared(a), actions = new ActionsStore(sql);
      const owner: MoneyActionOwner = { accountProvider: a.session.accountProvider, subject: a.session.user.subject, chainId: 8453, address: a.address };
      if (mutation !== "confirm") {
        await actions.confirm(owner, id);
        await actions.recordDecline(owner, id, 0);
      }
      await sql.query("UPDATE actions SET summary=jsonb_set(summary,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1", [id, at.toISOString()]);
      const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const hooked = observeTransaction(async (text) => {
        if (first === "action" && text.startsWith("SELECT id FROM actions WHERE") && text.endsWith("FOR UPDATE")) { reached.resolve(); await release.promise; }
      }, async (text) => {
        if (first === "deletion" && text.startsWith("SELECT confirmed_at,created_at")) { reached.resolve(); await release.promise; }
      });
      const deleting = new AccountDeletionStore(hooked, () => at).read(a.session, true);
      await reached.promise;
      const mutate = () => mutation === "confirm" ? actions.confirm(owner, id) : mutation === "handle" ? actions.recordHandle(owner, id, { providerHandle: "late-wallet-handle" }) : actions.beginRetry(owner, id, 1).then((result) => result.row);
      let changed;
      if (first === "action") {
        changed = await mutate();
        release.resolve();
      } else {
        try {
          await expect(sql.transaction(async (tx) => {
            await tx.query("SET LOCAL lock_timeout='100ms'");
            await tx.query("SELECT id FROM actions WHERE id=$1 FOR UPDATE", [id]);
          })).rejects.toMatchObject({ code: "55P03" });
        } catch (error) { release.resolve(); await deleting; throw error; }
        const changing = mutate();
        release.resolve();
        changed = await changing;
      }
      const receipt = await deleting;
      expect(receipt.status).toBe(first === "action" ? "queued" : "completed");
      if (first === "action") { expect(changed).not.toBeNull(); await terminal(id); }
      else { expect(changed).toBeNull(); expect((await sql.query("SELECT owner_key,provider_handle FROM actions WHERE id=$1", [id])).rows[0]).toMatchObject({ provider_handle: null }); }
    }
  });

  test("declined actions stay blocking until review expiry even after draft retention", async () => {
    const a = await seed(), id = await prepared(a), actions = new ActionsStore(sql);
    const owner: MoneyActionOwner = { accountProvider: a.session.accountProvider, subject: a.session.user.subject, chainId: 8453, address: a.address };
    await actions.confirm(owner, id); await actions.recordDecline(owner, id, 0);
    await sql.query("UPDATE actions SET created_at=$2 WHERE id=$1", [id, new Date(at.getTime() - ACTION_DRAFT_RETENTION_MS - 1)]);
    expect((await store.read(a.session, true)).blockers).toEqual([{ name: "actions", count: 1 }]);
    await sql.query("UPDATE actions SET summary=jsonb_set(summary,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1", [id, at.toISOString()]);
    expect((await store.read(a.session, false)).status).toBe("completed");
  });

  test.each(["closed", "expired", "open", "partial", "no-capture", "unreadable", "wrong-authorization"])("card authorization %s is terminal on explicit closure regardless of capture", async (evidence) => {
    const a = await seed(true), transactions = createCardTransactionStore(sql);
    const client = createStripeTransactionClient({ stripeSecretKey: "sk_test_synthetic", stripeApiVersion: "2026-08-26.dahlia" }, Object.assign(async () => Response.json({
      object: "issuing.authorization", id: `iauth_${a.number}`, card: `ic_${a.number}`, amount: 100, currency: "usd", created: 1788264000,
      merchant_data: { name: "Merchant" }, approved: true, status: evidence === "open" ? "pending" : evidence === "expired" ? "expired" : "closed",
    }), { preconnect: fetch.preconnect }));
    await sql.query("UPDATE cards SET stripe_card_id=$2 WHERE id=$1", [a.card, `ic_${a.number}`]);
    await transactions.upsert(a.card, "sandbox", await client.read("authorization", `iauth_${a.number}`));
    if (evidence !== "no-capture") await transactions.upsert(a.card, "sandbox", { id: `ipi_${a.number}`, cardId: `ic_${a.number}`, authorizationId: evidence === "wrong-authorization" ? "iauth_other" : `iauth_${a.number}`, kind: "transaction", amountMinor: evidence === "partial" ? "50" : "100", currency: "USD", merchantName: "Merchant", merchantCategory: null, status: "completed", declineReasonCode: null, createdAt: at.toISOString(), updatedAt: at.toISOString() });
    if (evidence === "unreadable") await sql.query("UPDATE card_transactions SET authorization_closed=NULL WHERE card_id=$1 AND kind='authorization'", [a.card]);
    const receipt = await store.read(a.session, true);
    expect(receipt.status).toBe(["open", "unreadable"].includes(evidence) ? "queued" : "completed");
    if (receipt.status === "queued") { expect(receipt.blockers).toEqual([{ name: "card_transactions", count: 1 }]); await sql.query("UPDATE card_transactions SET status='reversed' WHERE card_id=$1 AND kind='authorization'", [a.card]); }
  });

  test("retained abandoned funding refuses late provider status and receipt without restoring identity", async () => {
    const a = await seed(), funding = new PostgresFundingOrderStore(sql), reservation = await reserveFunding(a);
    const dispatched = await funding.completeDispatch(reservation.order.id, { providerOrderId: `abandoned-${a.number}`, expectedTokenAmountAtomic: "1", fees: [], expiresAt: null, instructions: { kind: "redirect", url: "https://example.test" }, expectedVersion: reservation.order.version, updatedAt: at.toISOString() });
    await funding.abandon(dispatched.id, { accountProvider: a.session.accountProvider, subject: a.session.user.subject }, { expectedVersion: dispatched.version, reason: "owner", updatedAt: at.toISOString() });
    expect((await store.read(a.session, true)).status).toBe("completed");
    const before = (await sql.query("SELECT * FROM funding_orders WHERE id=$1", [dispatched.id])).rows[0];
    expect(await funding.getByProviderOrderId("coinbase", `abandoned-${a.number}`)).toBeNull();
    expect(await funding.applyObservation(dispatched.id, { state: "payment-received", providerStatus: "paid", expectedVersion: Number(before.version), updatedAt: at.toISOString() })).toBeNull();
    expect(await funding.claimReceipt(dispatched.id, { transactionHash: `0x${"a".repeat(64)}`, logIndex: a.number, expectedVersion: Number(before.version), updatedAt: at.toISOString() })).toBeNull();
    expect((await sql.query("SELECT * FROM funding_orders WHERE id=$1", [dispatched.id])).rows[0]).toEqual(before);
    Reflect.set(dispatched, "destination", null);
    expect(await verifyBaseFundingReceipt(dispatched, `0x${"a".repeat(64)}`, {}, Object.assign(async () => { throw new Error("must not call RPC for erased destination"); }, { preconnect: fetch.preconnect }))).toBeNull();
  });

  test.each(["funding", "deletion"])("abandoned funding revival %s first is fenced by the eligibility locks", async (first) => {
    const a = await seed(), funding = new PostgresFundingOrderStore(sql), reservation = await reserveFunding(a);
    const dispatched = await funding.completeDispatch(reservation.order.id, { providerOrderId: `racing-abandoned-${a.number}`, expectedTokenAmountAtomic: "1", fees: [], expiresAt: null, instructions: { kind: "redirect", url: "https://example.test" }, expectedVersion: reservation.order.version, updatedAt: at.toISOString() });
    const abandoned = await funding.abandon(dispatched.id, { accountProvider: a.session.accountProvider, subject: a.session.user.subject }, { expectedVersion: dispatched.version, reason: "owner", updatedAt: at.toISOString() });
    if (!abandoned) throw new Error("Missing abandoned order");
    const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const hooked = observeTransaction(async (text) => {
      if (first === "funding" && text.startsWith("SELECT id FROM funding_orders WHERE") && text.endsWith("FOR UPDATE")) { reached.resolve(); await release.promise; }
    }, async (text) => {
      if (first === "deletion" && text.startsWith("SELECT confirmed_at,created_at")) { reached.resolve(); await release.promise; }
    });
    const deleting = new AccountDeletionStore(hooked, () => at).read(a.session, true);
    await reached.promise;
    const revive = () => funding.applyObservation(dispatched.id, { state: "payment-received", providerStatus: "paid", expectedVersion: abandoned.version, updatedAt: at.toISOString() });
    let changed;
    if (first === "funding") { changed = await revive(); release.resolve(); }
    else {
      try {
        await expect(sql.transaction(async (tx) => {
          await tx.query("SET LOCAL lock_timeout='100ms'");
          await tx.query("SELECT id FROM funding_orders WHERE id=$1 FOR UPDATE", [dispatched.id]);
        })).rejects.toMatchObject({ code: "55P03" });
      } catch (error) { release.resolve(); await deleting; throw error; }
      const changing = revive(); release.resolve(); changed = await changing;
    }
    expect((await deleting).status).toBe(first === "funding" ? "queued" : "completed");
    if (first === "funding") { expect(changed).not.toBeNull(); await sql.query("UPDATE funding_orders SET state='cancelled' WHERE id=$1", [dispatched.id]); }
    else expect(changed).toBeNull();
  });

  test("queued session owner key persists even when completion rolls back", async () => {
    const a = await seed(), id = await prepared(a);
    await sql.query("UPDATE actions SET customer_id=NULL,credential_id=NULL,wallet_id=NULL WHERE id=$1", [id]);
    await sql.query("DELETE FROM customer_wallets WHERE id=$1", [a.wallet]);
    const request = (await sql.query<{ id: string }>("INSERT INTO account_deletion_requests(customer_id) VALUES ($1) RETURNING id", [a.id])).rows[0];
    const failing = observeTransaction(async (text) => { if (text.startsWith("SELECT confirmed_at,created_at")) throw new Error("fail completion"); }, async () => {});
    await expect(new AccountDeletionStore(failing, () => at).read(a.session, false)).rejects.toMatchObject({ code: "ACCOUNT_DELETION_UNAVAILABLE" });
    expect((await sql.query("SELECT session_owner_keys FROM account_deletion_requests WHERE id=$1", [request.id])).rows[0].session_owner_keys).toHaveLength(1);
    await sql.query("UPDATE account_deletion_requests SET last_attempt_at=NULL WHERE id=$1", [request.id]);
    expect((await sweepAccountDeletions(sql, { now: at, batchSize: 1 })).blocked).toBe(1);
    await terminal(id);
  });

  test.each([true, false])("queued-only live session owner key survives sweep after %s create", async (create) => {
    const a = await seed(), id = await prepared(a);
    await sql.query("UPDATE actions SET customer_id=NULL,credential_id=NULL,wallet_id=NULL WHERE id=$1", [id]);
    await sql.query("DELETE FROM customer_wallets WHERE id=$1", [a.wallet]);
    if (!create) await sql.query("INSERT INTO account_deletion_requests(customer_id) VALUES ($1)", [a.id]);
    const receipt = await store.read(a.session, create);
    expect(receipt.status).toBe("queued");
    expect((await sql.query("SELECT session_owner_keys FROM account_deletion_requests WHERE id=$1", [receipt.requestId])).rows[0].session_owner_keys).toHaveLength(1);
    await sql.query("UPDATE account_deletion_requests SET last_attempt_at=NULL WHERE id=$1", [receipt.requestId]);
    await sweepAccountDeletions(sql, { now: at, batchSize: 1 });
    expect((await sql.query("SELECT status FROM account_deletion_requests WHERE id=$1", [receipt.requestId])).rows[0].status).toBe("queued");
    await terminal(id);
    await sql.query("UPDATE account_deletion_requests SET last_attempt_at=NULL WHERE id=$1", [receipt.requestId]);
    await sweepAccountDeletions(sql, { now: at, batchSize: 1 });
    expect((await sql.query("SELECT status,session_owner_keys,customer_id FROM account_deletion_requests WHERE id=$1", [receipt.requestId])).rows[0]).toEqual({ status: "completed", session_owner_keys: null, customer_id: null });
    expect((await sql.query("SELECT owner_key FROM actions WHERE id=$1", [id])).rows[0].owner_key).toStartWith("retained:");
  });

  test("signup attribution locks inviter until completion can strip the committed references", async () => {
    const a = await seed(), code = "abcdefghjn";
    await sql.query("INSERT INTO invite_codes(code,customer_id) VALUES ($1,$2)", [code, a.id]);
    const attributed = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const watching: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn, options) => sql.transaction((tx) => fn({
      query: async <T>(text: string, values?: unknown[], queryOptions?: SqlQueryOptions) => {
        const result = await tx.query<T>(text, values, queryOptions);
        if (text.includes("SELECT i.customer_id FROM invite_codes")) { attributed.resolve(); await release.promise; }
        return result;
      }, transaction: tx.transaction,
    }), options) };
    const b: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: `invited-${a.number}` }, smartAccount: null };
    const signingUp = new CustomerResolver(watching).resolveCustomer(b, { create: true, inviteCode: code });
    await attributed.promise;
    const locking = Promise.withResolvers<void>();
    const deletionSql: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn, options) => sql.transaction((tx) => fn({
      query: async <T>(text: string, values?: unknown[], queryOptions?: SqlQueryOptions) => {
        if (text === "SELECT id FROM customers WHERE id=$1 FOR UPDATE") locking.resolve();
        return tx.query<T>(text, values, queryOptions);
      }, transaction: tx.transaction,
    }), options) };
    try {
      await expect(sql.transaction(async (tx) => {
        await tx.query("SET LOCAL lock_timeout='100ms'");
        await tx.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE", [a.id]);
      })).rejects.toMatchObject({ code: "55P03" });
    } catch (error) { release.resolve(); await signingUp; throw error; }
    const deleting = new AccountDeletionStore(deletionSql, () => at).read(a.session, true);
    await locking.promise;
    release.resolve();
    const invited = await signingUp;
    expect((await deleting).status).toBe("completed");
    expect((await sql.query("SELECT invite_code FROM customers WHERE id=$1", [invited.id])).rows[0].invite_code).toBeNull();
    const events = (await sql.query("SELECT props FROM operator_events WHERE customer_id=$1", [invited.id])).rows;
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.props).not.toHaveProperty("inviteCode");
      expect(event.props).not.toHaveProperty("inviterCustomerId");
    }
    const c: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: `late-invited-${a.number}` }, smartAccount: null };
    const late = await new CustomerResolver(sql).resolveCustomer(c, { create: true, inviteCode: code });
    expect((await sql.query("SELECT invite_code FROM customers WHERE id=$1", [late.id])).rows[0].invite_code).toBeNull();
  });

  test("deletion GET and POST recover outside revocation window only without a live credential", async () => {
    const a=await seed(true), receipt=await store.read(a.session,true);
    await sql.query("UPDATE account_deletion_tombstones SET completed_at='2000-01-01' WHERE request_id=$1",[receipt.requestId]);
    expect(await store.read(a.session,false)).toEqual(receipt);
    expect(await store.read(a.session,true)).toEqual(receipt);
    const fresh=await new CustomerResolver(sql).resolveCustomer(a.session,{create:true});
    expect(fresh.id).not.toBe(a.id);
    await expect(store.read(a.session,false)).rejects.toMatchObject({code:"ACCOUNT_DELETION_NOT_FOUND"});
  });

  test.each([true, false])("existing request %s create publishes legacy session scope before a racing sweep", async (create) => {
    const a = await seed(), first = await prepared(a);
    const live: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: `linked-legacy-${a.number}` }, smartAccount: { chainId: 8453, address: `0x${a.number.toString(16).padStart(40, "9")}` } };
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES (gen_random_uuid(),$1,$2,$3,now(),now())", [a.id, live.accountProvider, live.user.subject]);
    if (!live.smartAccount) throw new Error("expected a live session wallet");
    const id = crypto.randomUUID(), ownerKey = actionOwnerKey({ accountProvider: live.accountProvider, subject: live.user.subject, chainId: 8453, address: live.smartAccount.address });
    await sql.query("INSERT INTO actions(id,owner_key,provider,kind,summary,created_at,confirmed_at,handle_recorded_at,provider_handle) VALUES ($1,$2,$3,'send',$4::jsonb,$5,$5,$5,'legacy-wallet-handle')", [id, ownerKey, live.accountProvider, JSON.stringify({ title: "Legacy", amounts: [], expiresAt: at.toISOString() }), at]);
    const queued = await store.read(a.session, true);
    await terminal(first);
    const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const hooked = observeTransaction(async (text) => {
      if (text.startsWith("UPDATE account_deletion_requests SET session_owner_keys=")) { reached.resolve(); await release.promise; }
    }, async () => {});
    const reading = new AccountDeletionStore(hooked, () => at).read(live, create);
    await reached.promise;
    try {
      await expect(sql.transaction(async (tx) => {
        await tx.query("SET LOCAL lock_timeout='100ms'");
        await tx.query("SELECT id FROM account_deletion_requests WHERE id=$1 FOR UPDATE", [queued.requestId]);
      })).rejects.toMatchObject({ code: "55P03" });
    } finally { release.resolve(); }
    const swept = new AccountDeletionStore(sql, () => at).attempt(queued.requestId);
    expect((await reading).blockers).toEqual([{ name: "actions", count: 1 }]);
    expect((await swept).blockers).toEqual([{ name: "actions", count: 1 }]);
    expect((await sql.query("SELECT owner_key,customer_id FROM actions WHERE id=$1", [id])).rows[0]).toEqual({ owner_key: ownerKey, customer_id: null });
    await terminal(id);
    expect((await store.attempt(queued.requestId)).status).toBe("completed");
    expect((await sql.query("SELECT owner_key FROM actions WHERE id=$1", [id])).rows[0].owner_key).toStartWith("retained:");
  });

  test.each([false, true])("cashout deposit proven %s races completion in both lock orders", async (proven) => {
    for (const first of ["updater", "deletion"]) {
      const a = await seed(true), actions = new ActionsStore(sql);
      const owner: MoneyActionOwner = { accountProvider: a.session.accountProvider, subject: a.session.user.subject, chainId: 8453, address: a.address };
      await sql.query("UPDATE actions SET outcome=NULL,outcome_source=NULL,outcome_recorded_at=NULL,settled_at=NULL,observed_receipt_transaction_hash=NULL,observed_receipt_block_number=NULL,transaction_hash=NULL,handle_recorded_at=NULL,declined_reported_at=now(),summary=jsonb_set(summary,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1", [a.action, at.toISOString()]);
      await sql.query("UPDATE cashout_orders SET deposit_id=NULL,deposit_proven=false,state='submitted',settled_at=NULL WHERE action_id=$1", [a.action]);
      const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const hooked = observeTransaction(async (text) => {
        if (first === "updater" && text.startsWith("SELECT action_id FROM cashout_orders WHERE")) { reached.resolve(); await release.promise; }
      }, async (text) => {
        if (first === "deletion" && text.startsWith("SELECT count(*) FROM (SELECT t.id::text FROM cards")) { reached.resolve(); await release.promise; }
      });
      const deleting = new AccountDeletionStore(hooked, () => at).read(a.session, true);
      await reached.promise;
      const mutate = () => actions.linkCashoutDeposit(owner, a.action, `racing-deposit-${a.number}`, proven);
      let changed;
      if (first === "updater") { changed = await mutate(); release.resolve(); }
      else {
        try {
          await expect(sql.transaction(async (tx) => {
            await tx.query("SET LOCAL lock_timeout='100ms'");
            await tx.query("SELECT action_id FROM cashout_orders WHERE action_id=$1 FOR UPDATE", [a.action]);
          })).rejects.toMatchObject({ code: "55P03" });
        } finally { release.resolve(); }
        changed = await mutate();
      }
      const receipt = await deleting;
      expect(receipt.status).toBe(first === "updater" ? "queued" : "completed");
      if (first === "updater") {
        expect(changed).not.toBeNull();
        expect(receipt.blockers).toContainEqual({ name: "cashout_orders", count: 1 });
        await sql.query("UPDATE cashout_orders SET state='delivered',settled_at=now() WHERE action_id=$1", [a.action]);
      } else {
        expect(changed).toBeNull();
        const retained = (await sql.query("SELECT * FROM cashout_orders WHERE action_id=$1", [a.action])).rows[0];
        expect(await actions.updateCashoutProgress(owner, a.action, { state: "submitted", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: amount, withdrawable: false, settled: false }, at.toISOString())).toBeNull();
        await actions.claimCashoutRefresh(owner, a.action);
        expect((await sql.query("SELECT * FROM cashout_orders WHERE action_id=$1", [a.action])).rows[0]).toEqual(retained);
      }
    }
  });

  test("activity owner resolution preserves sign-in last-seen timestamps and deletion fencing", async () => {
    const a = await seed(), before = (await sql.query("SELECT c.last_seen_at AS customer_seen,cr.last_seen_at AS credential_seen FROM customers c JOIN customer_credentials cr ON cr.customer_id=c.id WHERE c.id=$1", [a.id])).rows[0];
    const owner = { accountProvider: a.session.accountProvider, subject: a.session.user.subject, address: a.address };
    await sql.transaction((tx) => recordCustomerIds(tx, owner, at));
    expect((await sql.query("SELECT c.last_seen_at AS customer_seen,cr.last_seen_at AS credential_seen FROM customers c JOIN customer_credentials cr ON cr.customer_id=c.id WHERE c.id=$1", [a.id])).rows[0]).toEqual(before);
    const freshOwner = { ...owner, subject: `activity-new-${a.number}`, address: null };
    const fresh = await sql.transaction((tx) => recordCustomerIds(tx, freshOwner, at));
    expect((await sql.query("SELECT first_seen_source FROM customers WHERE id=$1", [fresh.customerId])).rows[0].first_seen_source).toBe("activity");
    await store.read(a.session, true);
    await expect(sql.transaction((tx) => recordCustomerIds(tx, owner, at))).rejects.toBeInstanceOf(AccountDeletedError);
  });

  test("card issuance fences deletion before any provider call and rejects a retained owner", async () => {
    const a = await seed();
    await sql.query("INSERT INTO card_accounts(customer_id,mode,bridge_customer_id,stripe_cardholder_id) VALUES ($1,'sandbox',$2,$3)", [a.id, `issuing-bridge-${a.number}`, `issuing-holder-${a.number}`]);
    const config = { mode: "sandbox" as const, bridgeOrigin: "https://bridge.test", bridgeApiKey: "fixture", stripeSecretKey: "fixture", stripeApiVersion: "2026-01-01", funding: { kind: "crypto_wallet" as const } };
    const customer = { id: `issuing-bridge-${a.number}`, status: "active" as const, stripeCardholderId: `issuing-holder-${a.number}`, cardsEndorsement: { status: "approved" as const, missing: false, pending: false, issues: false } };
    const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let providerCalls = 0;
    const bridge = { ...createBridgeClient(config), readCustomer: async () => customer };
    const stripe = { ...createStripeClient(config), readCardholder: async () => ({ id: customer.stripeCardholderId, status: "active" as const }), issueCard: async () => {
      providerCalls++; reached.resolve(); await release.promise;
      return { id: `issued-${a.number}`, cardholderId: customer.stripeCardholderId, status: "active" as const, customerFrozen: false, last4: "1234" };
    } };
    const service = createCardWriteService({ sql, config, bridge, stripe });
    const issuing = service.issue(a.id, a.session);
    await reached.promise;
    try {
      await expect(sql.transaction(async (tx) => {
        await tx.query("SET LOCAL lock_timeout='100ms'");
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [credentialDigest(requireTombstoneKey(), a.session.accountProvider, a.session.user.subject)]);
      })).rejects.toMatchObject({ code: "55P03" });
    } finally { release.resolve(); }
    expect((await issuing).id).toBe(`issued-${a.number}`);
    const receipt = await store.read(a.session, true);
    expect(receipt.status).toBe("completed");
    await expect(service.issue(a.id, a.session)).rejects.toBeInstanceOf(AccountDeletedError);
    const retainedId = (await sql.query<{ customer_id: string }>("SELECT customer_id FROM cards WHERE stripe_card_id=$1", [`issued-${a.number}`])).rows[0].customer_id;
    await sql.query("UPDATE account_deletion_tombstones SET completed_at='2000-01-01' WHERE request_id=$1", [receipt.requestId]);
    await expect(service.issue(retainedId, a.session)).rejects.toMatchObject({ code: "CARD_NOT_READY" });
    expect(providerCalls).toBe(1);
  });

});

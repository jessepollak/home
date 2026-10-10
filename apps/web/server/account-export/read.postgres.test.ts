import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ACCOUNT_EXPORT_HOME_CLASSES, parseAccountExportResponse, type AccountExportResponse } from "@/shared/account/contracts/data-export";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createPostgresSqlExecutor, type SqlExecutor, type SqlQueryOptions } from "@/server/db/sql";
import { actionOwnerKey } from "@/server/actions/store";
import { PostgresBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { AccountExportReader } from "./read";
import { createAccountExportHandler } from "./handler";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `account_export_test_${randomBytes(4).toString("hex")}`;
const migrations = ["001_actions.sql", "002_funding_provider_seam.sql", "003_coinbase_hosted_retired.sql", "004_funding_sandbox.sql", "005_balances.sql", "006_valuation_attempts.sql", "007_balance_borrow.sql", "007_funding_provider_customers.sql", "008_funding_provider_user_tokens.sql", "010_operator_settings.sql", "011_operator_registry.sql", "012_action_outcomes.sql", "013_action_call_commitment.sql", "014_cashout_orders.sql", "014_customer_preferences.sql", "015_invites.sql", "016_action_receipt_observations.sql", "017_record_customer_ids.sql", "017_webhook_subscription_envelopes.sql", "018_cards.sql", "018_customer_email_requests.sql", "018_operator_fee_records.sql", "019_card_events_provider.sql", "020_balance_history.sql", "020_card_accounts.sql", "020_support.sql", "021_card_transactions.sql", "021_cashout_provider_progress.sql", "022_funding_order_abandon.sql", "023_account_export_indexes.sql"];
const amountA = "900719925474099312345678901234567890";
const amountB = "987654321098765432109876543210987654";
const secret = "EXPORTSECRETMARKER";
const envelope = `v1.${"a".repeat(16)}.${"b".repeat(22)}.${secret}`;
const at = "2026-10-07T00:00:00.000Z";
const uuid = (owner: number, item: number) => `${String(owner).repeat(8)}-${String(owner).repeat(4)}-4${String(owner).repeat(3)}-8${String(owner).repeat(3)}-${String(item).padStart(12, "0")}`;
const address = (owner: number): `0x${string}` => `0x${String(owner).repeat(40)}`;
const session = (owner: number): VerifiedAccountSession => ({ accountProvider: "base-account", user: { subject: `export-owner-${owner}` }, smartAccount: { chainId: 8453, address: address(owner) } });
const key = (owner: number) => actionOwnerKey({ subject: `export-owner-${owner}`, accountProvider: "base-account", chainId: 8453, address: address(owner) });
let admin: Bun.SQL;
let sql: SqlExecutor;
let reader: AccountExportReader;

async function seed(owner: number) {
  const c = uuid(owner, 1), credential = uuid(owner, 2), wallet = uuid(owner, 3), action = uuid(owner, 4), funding = uuid(owner, 5), card = uuid(owner, 6), conversation = uuid(owner, 7), message = uuid(owner, 8);
  const amount = owner === 1 ? amountA : amountB;
  await sql.query("INSERT INTO customers (id,country,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,$2,$3,$3,'sign_in')", [c, owner === 1 ? "US" : "GB", at]);
  await sql.query("INSERT INTO customer_credentials (id,customer_id,account_provider,subject,email,email_source,first_seen_at,last_seen_at) VALUES ($1,$2,'base-account',$3,$4,'wallet_reported',$5,$5)", [credential, c, `export-owner-${owner}`, `owner${owner}@example.test`, at]);
  await sql.query("INSERT INTO customer_wallets (id,customer_id,credential_id,chain_id,address) VALUES ($1,$2,$3,8453,$4)", [wallet, c, credential, address(owner)]);
  await sql.query("INSERT INTO customer_preferences(customer_id,country_preference) VALUES ($1,$2)", [c, owner === 1 ? "US" : "GB"]);
  await sql.query("INSERT INTO invite_codes(code,customer_id) VALUES ($1,$2)", [owner === 1 ? "abcdefghjk" : "mnpqrstuvw", c]);
  await sql.query("INSERT INTO customer_email_requests(account_provider,subject,asked_at,answer,answer_channel,wallet_message) VALUES ('base-account',$1,$2,'shared','sign_in',$3)", [`export-owner-${owner}`, at, `owner-${owner}-wallet-message`]);
  await sql.query("INSERT INTO operator_events(id,customer_id,name,occurred_at,source,props,idempotency_key) VALUES ($1,$2,'invite.attributed',$3,'live',$4::jsonb,$5)", [uuid(owner, 9), c, at, JSON.stringify({ inviterCustomerId: uuid(owner === 1 ? 2 : 1, 1), secret }), `event-${owner}`]);
  await sql.query("INSERT INTO admin_audit_log(actor,action,target_kind,target_id,purpose) VALUES ($1,'customer.read','customer',$2,$3)", [secret, c, `owner-${owner}-audit-purpose`]);
  await sql.query("INSERT INTO actions(id,owner_key,customer_id,account_address,provider,kind,summary,confirmed_at,transaction_hash,observed_receipt_block_number,observed_receipt_transaction_hash) VALUES ($1,$2,$3,$4,'base-account','send',$5::jsonb,$6,$7,$8::numeric,$7)", [action, key(owner), c, address(owner), JSON.stringify({ title: `owner-${owner}-send`, expiresAt: "2026-10-06T20:00:00-04:00", amounts: [{ assetId: "usdc", symbol: "USDC", amountBaseUnits: amount, direction: "spend", decimals: 6, secret }], signing: { secret }, metadata: { secret }, networkFee: { payment: "usdc", token: `0x${"a".repeat(40)}`, paymaster: `0x${"b".repeat(40)}`, maxFeeBaseUnits: amount, decimals: 6, secret } }), at, `0x${String(owner).repeat(64)}`, amount]);
  await sql.query("INSERT INTO cashout_orders(action_id,owner_key,provider_id,environment,region,platform,platform_label,amount_atomic,remaining_atomic) VALUES ($1,$2,'peer','sandbox','US','bank','Bank',$3,$3)", [action, key(owner), amount]);
  await sql.query("INSERT INTO operator_fee_records(action_id,action_kind,amount_base_units,token_asset_id,token_address,token_decimals,bps,recipient,collected_by) VALUES ($1,'trade',$2::numeric,'usdc',$3,6,10,$3,'provider-native')", [action, amount, address(owner)]);
  await sql.query("INSERT INTO funding_orders(id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,transaction_hash,log_index,customer_id,created_at,updated_at,fees) VALUES ($1::uuid,$2,'base-account',$3,'coinbase','US','usdc','bank',$4::text,$1::uuid::text,$5::jsonb,$6,'received',$4::text::numeric,$7,2147483647,$8,$9,$9,$10::jsonb)", [funding, `export-owner-${owner}`, address(owner), amount, JSON.stringify({ fiatAmount: amount, expiresAt: "2026-10-06T20:00:00-04:00", tokenAmountAtomic: amount, fees: [{ label: "fee", amount, currency: "USD", secret }], secret }), secret, `0x${String(owner).repeat(64)}`, c, at, JSON.stringify([{ label: "fee", amount, currency: "USD", secret }])]);
  await sql.query("INSERT INTO funding_provider_customers(id,owner_subject,account_provider,provider_id,region,customer_ref,state,customer_id,created_at,updated_at) VALUES ($1,$2,'base-account','coinbase','US',$3,'verified',$4,$5,$5)", [uuid(owner, 10), `export-owner-${owner}`, secret + owner, c, at]);
  await sql.query("INSERT INTO funding_provider_user_tokens(account_provider,owner_subject,provider_id,region,sandbox,destination,envelope,key_version,returned_at,updated_at,customer_id) VALUES ('base-account',$1,'coinbase','US',true,$2,$3,1,$4,$4,$5)", [`export-owner-${owner}`, address(owner), envelope, at, c]);
  await sql.query("INSERT INTO balance_snapshots(chain_id,address,block_number,block_hash,block_timestamp,observed_at,holdings,coverage) VALUES (8453,$1,9007199254740993,$2,1791331200,$3,$4::jsonb,$5::jsonb)", [address(owner), `0x${String(owner).repeat(64)}`, at, JSON.stringify([{ key: "asset-usdc", decimals: 6, balance: { status: "ready", baseUnits: amount, secret }, secret, imageUrl: secret }]), JSON.stringify({ registry: "complete", catalog: "complete", secret })]);
  const history = (await sql.query<{ id: number }>("INSERT INTO history_addresses(chain_id,address,window_start_block,window_start_at,enrolled_block,backfill_block,forward_block) VALUES (8453,$1,1,$2,3,2,4) RETURNING id", [address(owner), at])).rows[0].id;
  const asset = (await sql.query<{ id: number }>("INSERT INTO history_assets(chain_id,asset_key,kind,contract_address,decimals) VALUES (8453,$1,'erc20',$2,6) RETURNING id", [`owner-${owner}-asset`, address(owner)])).rows[0].id;
  await sql.query("INSERT INTO balance_changes(address_id,asset_id,block_number,log_index,block_time,tx_hash,delta,source) VALUES ($1,$2,9007199254740993,2147483647,$3,decode($4,'hex'),$5::numeric,'cdp-sql-transfer')", [history, asset, at, String(owner).repeat(64), amount]);
  await sql.query("INSERT INTO balance_checkpoints(address_id,asset_id,block_number,purpose,chain_quantity,log_quantity,observed_at) VALUES ($1,$2,9007199254740993,'reconcile',$3::numeric,$3::numeric,$4)", [history, asset, amount, at]);
  await sql.query("INSERT INTO card_accounts(customer_id,mode,bridge_customer_id,stripe_cardholder_id) VALUES ($1,'sandbox',$2,$3)", [c, `bridge-${owner}`, `holder-${owner}`]);
  await sql.query("INSERT INTO cards(id,customer_id,mode,stripe_card_id,wallet_address) VALUES ($1,$2,'sandbox',$3,$4)", [card, c, `stripe-${owner}`, address(owner)]);
  await sql.query("INSERT INTO card_events(provider,mode,event_id,kind,customer_id,card_id,occurred_at,raw_payload) VALUES ('bridge','sandbox',$1,'purchase',$2,$3,$4,$5::jsonb),('bridge','sandbox',$6,'purchase',NULL,$3,$4,$5::jsonb),('immersve','sandbox',$7,'purchase',$2,$3,$4,$5::jsonb)", [`event-${owner}`, `bridge-${owner}`, `stripe-${owner}`, at, JSON.stringify({ pan: secret, ephemeralKey: secret }), `stripe-event-${owner}`, `foreign-provider-event-${owner}`]);
  await sql.query("INSERT INTO card_transactions(card_id,provider,mode,provider_transaction_id,kind,amount_minor,currency,merchant_name,status,provider_created_at,raw_payload) VALUES ($1,'bridge','sandbox',$2,'transaction',9007199254740993,'USD',$3,'completed',$4,$5::jsonb)", [card, `transaction-${owner}`, `owner-${owner}-merchant`, at, JSON.stringify({ secret })]);
  await sql.query("INSERT INTO support_conversations(id,customer_id,last_message_at) VALUES ($1,$2,$3)", [conversation, c, at]);
  await sql.query("INSERT INTO support_messages(id,conversation_id,author_type,body,client_message_id) VALUES ($1,$2,'customer',$3,$4)", [message, conversation, `owner-${owner}-customer-message`, `client-msg-${owner}`]);
  await sql.query("INSERT INTO support_messages(id,conversation_id,author_type,status,body,client_message_id) VALUES ($1,$2,'assistant','draft',$3,$4)", [uuid(owner, 11), conversation, secret, `draft-msg-${owner}`]);
  await sql.query("INSERT INTO support_assistant_runs(id,conversation_id,message_id,replay) VALUES ($1,$2,$3,false),($4,$2,$5,false)", [uuid(owner, 12), conversation, message, uuid(owner, 13), uuid(owner, 11)]);
  await sql.query("INSERT INTO support_context_refs(id,conversation_id,message_id,kind,ref_id) VALUES ($1,$2,$3,'money_action',$4)", [uuid(owner, 14), conversation, message, action]);
}

function records(body: AccountExportResponse, name: string) {
  const entry = body.classes.find((entry) => entry.name === name);
  if (!entry) throw new Error(`Missing export class: ${name}`);
  return entry.records;
}

(connectionString ? describe : describe.skip)("account export PostgreSQL data boundary", () => {
  beforeAll(async () => {
    if (!connectionString) throw new Error("FUNDING_PG_TEST_URL is required");
    admin = new Bun.SQL(connectionString);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of migrations) await tx.unsafe(await readMigrationSql(migration));
      await tx.unsafe("ALTER TABLE card_events ADD COLUMN raw_payload jsonb; ALTER TABLE card_transactions ADD COLUMN raw_payload jsonb");
    });
    sql = createPostgresSqlExecutor(connectionString, { poolFactory: (config) => new Pool({ ...config, options: `-c search_path=${schema}` }) });
    reader = new AccountExportReader(sql);
    await seed(1);
    await seed(2);
    await sql.query("INSERT INTO webhook_subscriptions(subscription_id,secret,target,event_type) VALUES ('excluded',$1,'https://example.test','balance')", [secret]);
    await sql.query("INSERT INTO support_assistant_credentials(id,envelope,last4,updated_at,updated_by) VALUES ('default',$1,'ABCD',$2,$3)", [secret, at, address(2)]);
  });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close(); });

  test("exports every class without another customer's facts or any secret material", async () => {
    const body = await reader.read(session(1));
    expect(body.classes.map((entry) => entry.name)).toEqual([...ACCOUNT_EXPORT_HOME_CLASSES]);
    expect(body.classes.every((entry) => entry.holder === "home" && entry.records.length > 0)).toBe(true);
    const serialized = JSON.stringify(body);
    for (const marker of [address(2), amountB, "export-owner-2", "owner2@example.test", secret, "bridge-2", "stripe-2", "owner-2-customer-message", ...Array.from({ length: 14 }, (_, index) => uuid(2, index + 1))]) expect(serialized).not.toContain(marker);
    expect(records(body, "card_events").map((event) => event.eventId).sort()).toEqual(["event-1", "stripe-event-1"]);
    expect(records(body, "support_messages")).toHaveLength(1);
    expect(records(body, "support_assistant_runs")).toHaveLength(1);
    expect(records(body, "operator_events")[0].props).toBeUndefined();
    expect(records(body, "access_audit")[0].actor).toBeUndefined();
  });

  test("round-trips exact money, block numbers, receipt hashes and log indexes through the contract", async () => {
    const body = await reader.read(session(1));
    expect(parseAccountExportResponse(JSON.parse(JSON.stringify(body)))).not.toBeNull();
    expect(records(body, "operator_fees")[0].amountBaseUnits).toBe(amountA);
    expect(records(body, "funding_orders")[0].creationBlock).toBe(amountA);
    expect(records(body, "funding_orders")[0].logIndex).toBe("2147483647");
    expect(records(body, "balance_changes")[0].delta).toBe(amountA);
    expect(records(body, "balance_changes")[0].transactionHash).toBe(`0x${"1".repeat(64)}`);
    expect(records(body, "balance_changes")[0].blockNumber).toBe("9007199254740993");
    expect(records(body, "balance_checkpoints")[0].chainQuantity).toBe(amountA);
    expect(records(body, "actions")[0].observedReceiptBlockNumber).toBe(amountA);
    expect(records(body, "card_transactions")[0].amountMinor).toBe("9007199254740993");
    expect(records(body, "actions")[0].summary).toMatchObject({ expiresAt: "2026-10-07T00:00:00.000Z" });
    expect(records(body, "funding_orders")[0].quote).toMatchObject({ expiresAt: "2026-10-07T00:00:00.000Z" });
  });

  test("borrow observations round-trip exact amounts and rates from the real snapshot store", async () => {
    const store = new PostgresBalanceSnapshotStore(sql);
    const snapshot = await store.get(8453, address(1));
    if (!snapshot) throw new Error("Missing seeded snapshot");
    const market = { marketId: `0x${"a".repeat(64)}` as const, status: "ready" as const, blockNumber: "9007199254740993", collateralRaw: amountA, debtAssetsRaw: "900719925474099312345678901234567891", borrowAprWad: "51000000000000001" };
    const unavailable = { marketId: `0x${"b".repeat(64)}` as const, status: "unavailable" as const };
    const storedMarket = { ...market, secret };
    expect(await store.putObservation({ ...snapshot, blockNumber: "9007199254740994", borrow: { markets: [storedMarket, unavailable] } })).toBe(true);
    const body = JSON.parse(JSON.stringify(await reader.read(session(1))));
    expect(parseAccountExportResponse(body)).not.toBeNull();
    expect(records(body, "balance_snapshots")[0].borrow).toEqual({ markets: [market, unavailable] });
    expect(records(await reader.read(session(2)), "balance_snapshots")[0].borrow).toBeNull();
  });

  test.each([
    ["actions", "summary", { amounts: null }],
    ["actions", "summary", {}],
    ["actions", "summary", { amounts: [{ amountBaseUnits: true }] }],
    ["actions", "summary", { amounts: [{ amountBaseUnits: 9007199254740992 }] }],
    ["actions", "summary", { amounts: [], networkFee: null }],
    ["funding_orders", "quote", { fiatAmount: "5.00", tokenAmountAtomic: "1", fees: null }],
    ["funding_orders", "quote", { fiatAmount: "5.00", tokenAmountAtomic: "1.5", fees: [] }],
    ["funding_orders", "fees", null],
    ["actions", "summary", { amounts: [{}] }],
    ["actions", "summary", { amounts: [], networkFee: {} }],
    ["actions", "summary", { amounts: [], networkFee: { payment: "usdc" } }],
    ["actions", "summary", { amounts: [], networkFee: { payment: "usdc", token: `0x${"a".repeat(40)}`, maxFeeBaseUnits: "1", decimals: 18 } }],
    ["actions", "summary", { amounts: [], networkFee: { payment: "usdc", token: "not-an-address", maxFeeBaseUnits: "1", decimals: 6 } }],
    ["funding_orders", "quote", { fees: [] }],
    ["funding_orders", "fees", [{}]],
    ["balance_snapshots", "holdings", [{ balance: { status: "ready", baseUnits: true } }]],
    ["balance_snapshots", "holdings", [{ balance: { status: true, baseUnits: "1" } }]],
    ["balance_snapshots", "holdings", [{ balance: { status: "ready", baseUnits: null } }]],
    ["balance_snapshots", "holdings", [{ balance: { status: "unavailable", baseUnits: "1" } }]],
    ["balance_snapshots", "borrow", { markets: null }],
    ["balance_snapshots", "borrow", { markets: [{ marketId: "market", status: "ready", blockNumber: "1", collateralRaw: "1", debtAssetsRaw: "1", borrowAprWad: true }] }],
    ["balance_snapshots", "borrow", { markets: [{ marketId: "market", status: "ready" }] }],
  ] as const)("malformed stored %s.%s yields 503 without a partial body", async (table, column, value) => {
    const where = table === "balance_snapshots" ? "address=$1" : "id=$1";
    const id = table === "balance_snapshots" ? address(1) : uuid(1, table === "actions" ? 4 : 5);
    const original = (await sql.query(`SELECT ${column} AS value FROM ${table} WHERE ${where}`, [id])).rows[0].value;
    await sql.query(`UPDATE ${table} SET ${column}=$2::jsonb WHERE ${where}`, [id, JSON.stringify(value)]);
    try {
      const response = await createAccountExportHandler({ authorize: async () => session(1), read: (owner, signal) => reader.read(owner, signal) })(new Request("https://home.test/api/account/export", { headers: { "X-Home-Account-Provider": "base-account" } }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "ACCOUNT_EXPORT_UNAVAILABLE", message: "Your account export is temporarily unavailable." } });
    } finally {
      await sql.query(`UPDATE ${table} SET ${column}=$2::jsonb WHERE ${where}`, [id, JSON.stringify(original)]);
    }
  });

  test("stored fractional fiat fees stay exact", async () => {
    const original = (await sql.query("SELECT quote FROM funding_orders WHERE id=$1", [uuid(1, 5)])).rows[0].quote;
    await sql.query("UPDATE funding_orders SET quote=$2::jsonb WHERE id=$1", [uuid(1, 5), JSON.stringify({ fiatAmount: "5.00", enteredFiatAmount: "4.90", tokenAmountAtomic: "4880000", fees: [{ label: "fee", amount: "0.10", currency: "USD" }], expiresAt: at })]);
    try {
      expect(records(await reader.read(session(1)), "funding_orders")[0].quote).toEqual({ fiatAmount: "5.00", enteredFiatAmount: "4.90", tokenAmountAtomic: "4880000", fees: [{ label: "fee", amount: "0.10", currency: "USD" }], expiresAt: at });
    } finally {
      await sql.query("UPDATE funding_orders SET quote=$2::jsonb WHERE id=$1", [uuid(1, 5), JSON.stringify(original)]);
    }
  });

  test("unavailable holdings preserve null quantities", async () => {
    const original = (await sql.query("SELECT holdings FROM balance_snapshots WHERE address=$1", [address(1)])).rows[0].holdings;
    await sql.query("UPDATE balance_snapshots SET holdings=$2::jsonb WHERE address=$1", [address(1), JSON.stringify([{ balance: { status: "unavailable", baseUnits: null } }])]);
    try {
      expect(records(await reader.read(session(1)), "balance_snapshots")[0].holdings).toEqual([{ balance: { status: "unavailable", baseUnits: null } }]);
    } finally {
      await sql.query("UPDATE balance_snapshots SET holdings=$2::jsonb WHERE address=$1", [address(1), JSON.stringify(original)]);
    }
  });

  test("a fresh linked customer has all empty optional classes in contract order", async () => {
    await sql.query("INSERT INTO customers(id,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,$2,$2,'sign_in')", [uuid(3, 1), at]);
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at) VALUES ($1,$2,'base-account','export-owner-3',$3,$3)", [uuid(3, 2), uuid(3, 1), at]);
    const body = await reader.read(session(3));
    expect(parseAccountExportResponse(body)).not.toBeNull();
    expect(body.classes.map((entry) => entry.name)).toEqual([...ACCOUNT_EXPORT_HOME_CLASSES]);
    expect(body.classes.filter((entry) => entry.name !== "customer" && entry.name !== "credentials").every((entry) => entry.records.length === 0)).toBe(true);
  });

  test("linked credentials and legacy null-customer owner rows remain inside the same customer", async () => {
    await sql.query("INSERT INTO customer_credentials(id,customer_id,account_provider,subject,linked_via,first_seen_at,last_seen_at) VALUES ($1,$2,'cdp-embedded','linked-A','link',$3,$3)", [uuid(1, 20), uuid(1, 1), at]);
    const linkedAddress = address(4);
    await sql.query("INSERT INTO customer_wallets(id,customer_id,credential_id,chain_id,address) VALUES ($1,$2,$3,8453,$4)", [uuid(1, 21), uuid(1, 1), uuid(1, 20), linkedAddress]);
    const linkedKey = actionOwnerKey({ subject: "linked-A", address: linkedAddress, accountProvider: "cdp-embedded", chainId: 8453 });
    await sql.query(`INSERT INTO actions(id,owner_key,provider,kind,summary) VALUES ($1,$2,'cdp-embedded','send','{"amounts":[]}'),($3,$4,'base-account','send','{"amounts":[]}')`, [uuid(1, 22), linkedKey, uuid(1, 23), key(1)]);
    await sql.query("INSERT INTO funding_provider_customers(id,owner_subject,account_provider,provider_id,region,state,created_at,updated_at) VALUES ($1,'linked-A','cdp-embedded','legacy','US','reserving',$2,$2)", [uuid(1, 24), at]);
    const body = await reader.read(session(1));
    expect(records(body, "credentials").map((entry) => entry.subject).sort()).toEqual(["export-owner-1", "linked-A"]);
    expect(records(body, "actions").map((entry) => entry.id)).toContain(uuid(1, 22));
    expect(records(body, "actions").map((entry) => entry.id)).toContain(uuid(1, 23));
    expect(records(body, "funding_provider_customers").map((entry) => entry.id)).toContain(uuid(1, 24));
  });

  test("legacy funding rows with null customer ids are included only through linked credentials", async () => {
    for (const table of ["funding_orders", "funding_provider_customers", "funding_provider_user_tokens"]) await sql.query(`UPDATE ${table} SET customer_id=NULL WHERE owner_subject='export-owner-1'`);
    try {
      const body = await reader.read(session(1));
      expect(records(body, "funding_orders").map((entry) => entry.id)).toEqual([uuid(1, 5)]);
      expect(records(body, "funding_provider_credentials")).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain(amountB);
    } finally {
      for (const table of ["funding_orders", "funding_provider_customers", "funding_provider_user_tokens"]) await sql.query(`UPDATE ${table} SET customer_id=$1 WHERE owner_subject='export-owner-1'`, [uuid(1, 1)]);
    }
  });

  test("all classes use a read-only repeatable-read snapshot despite concurrent changes", async () => {
    let inspected = false;
    const snapshotSql: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn) => sql.transaction((tx) => fn({ ...tx, query: async <T = Record<string, unknown>>(text: string, values?: unknown[], options?: SqlQueryOptions) => {
      const result = await tx.query<T>(text, values, options);
      if (!inspected && text.startsWith("SELECT customer_id FROM customer_credentials")) {
        inspected = true;
        const settings = await tx.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only");
        expect(settings.rows[0]).toEqual({ isolation: "repeatable read", read_only: "on" });
        await sql.query(`INSERT INTO actions(id,owner_key,customer_id,provider,kind,summary) VALUES ($1,$2,$3,'base-account','send','{"amounts":[]}')`, [uuid(1, 40), key(1), uuid(1, 1)]);
      }
      return result;
    } })) };
    try {
      const body = await new AccountExportReader(snapshotSql).read(session(1));
      expect(inspected).toBe(true);
      expect(records(body, "actions").map((entry) => entry.id)).not.toContain(uuid(1, 40));
    } finally { await sql.query("DELETE FROM actions WHERE id=$1", [uuid(1, 40)]); }
  });

  test("a foreign support context reference is omitted", async () => {
    await sql.query("INSERT INTO support_context_refs(id,conversation_id,kind,ref_id) VALUES ($1,$2,'money_action',$3)", [uuid(1, 41), uuid(1, 7), uuid(2, 4)]);
    const body = await reader.read(session(1));
    expect(records(body, "support_context_refs").map((entry) => entry.refId)).toEqual([uuid(1, 4)]);
  });

  test("absent linkage fails closed", async () => { await expect(reader.read(session(9))).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_LINKAGE" }); });
  test("merged customers fail closed", async () => {
    await sql.query("UPDATE customers SET merged_into=$2 WHERE id=$1", [uuid(1, 1), uuid(2, 1)]);
    try { await expect(reader.read(session(1))).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_LINKAGE" }); }
    finally { await sql.query("UPDATE customers SET merged_into=NULL WHERE id=$1", [uuid(1, 1)]); }
  });
  test("a session wallet owned by another customer fails closed", async () => {
    await expect(reader.read({ ...session(1), smartAccount: session(2).smartAccount })).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_LINKAGE" });
  });
  test("conflicting non-null legacy action customer fails closed", async () => {
    await sql.query(`INSERT INTO actions(id,owner_key,customer_id,provider,kind,summary) VALUES ($1,$2,$3,'base-account','send','{"amounts":[]}')`, [uuid(1, 30), key(1), uuid(2, 1)]);
    try { await expect(reader.read(session(1))).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_LINKAGE" }); }
    finally { await sql.query("DELETE FROM actions WHERE id=$1", [uuid(1, 30)]); }
  });
  test.each(["funding_orders", "funding_provider_customers", "funding_provider_user_tokens"])("conflicting funding credential linkage fails closed", async (table) => {
    await sql.query(`UPDATE ${table} SET customer_id=$2 WHERE account_provider='base-account' AND owner_subject=$1`, ["export-owner-1", uuid(2, 1)]);
    try { await expect(reader.read(session(1))).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_LINKAGE" }); }
    finally { await sql.query(`UPDATE ${table} SET customer_id=$2 WHERE account_provider='base-account' AND owner_subject=$1`, ["export-owner-1", uuid(1, 1)]); }
  });
  test("overflow returns an error instead of silently truncating", async () => {
    await expect(new AccountExportReader(sql, 2).read(session(1))).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_TOO_LARGE" });
  });
  test("late query failure returns private 503 without a partial body", async () => {
    const broken: SqlExecutor = { query: sql.query.bind(sql), transaction: (fn) => sql.transaction((tx) => fn({ ...tx, query: async (text, values, options) => {
      if (text.includes("FROM support_messages")) throw new Error(secret);
      return tx.query(text, values, options);
    } })) };
    const response = await createAccountExportHandler({ authorize: async () => session(1), read: (owner, signal) => new AccountExportReader(broken).read(owner, signal) })(new Request("https://home.test/api/account/export", { headers: { "X-Home-Account-Provider": "base-account" } }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ error: { code: "ACCOUNT_EXPORT_UNAVAILABLE", message: "Your account export is temporarily unavailable." } });
  });
});

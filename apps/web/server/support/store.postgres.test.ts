import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { actionOwnerKey } from "@/server/actions/store";
import { CustomerResolver } from "@/server/customers/resolve";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { moneyActionOwner } from "@/server/money-actions/session";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { parseAuditListResponse } from "@/shared/operator-settings/contract";
import { AdminAuditLog } from "@/server/operator-settings/audit";
import { parseCustomerSupportResponse, parseOperatorSupportConversationResponse, parseOperatorSupportListResponse } from "@/shared/support/contract";
import { SupportRateLimitedError, SupportStore } from "./store";
import { SupportAssistantStore } from "./assistant";
import { createCustomerSupportChatHandler, createOperatorSupportListHandler, createOperatorSupportConversationHandler } from "./handlers";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "support_contract_test";
type Admin = { unsafe(text: string): Promise<unknown>; begin<T>(run: (tx: Admin) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: Admin;
let observer: Admin;
let sql: SqlExecutor;
let store: SupportStore;
let customers: CustomerResolver;
const actor = `0x${"1".repeat(40)}` as `0x${string}`;
const address = `0x${"3".repeat(40)}` as `0x${string}`;
const session = (subject = "alice"): VerifiedAccountSession => ({ accountProvider: "base-account", user: { subject }, smartAccount: { address, chainId: BASE_CHAIN_ID } });
const send = (id: string, context?: { kind: "funding_order" | "money_action"; id: string }) => ({ version: 2 as const, body: `body ${id}`, clientMessageId: id, ...(context ? { context } : {}) });
const reply = (id: string, readThroughMessageId: string) => ({ version: 2 as const, body: `reply ${id}`, clientMessageId: id, readThroughMessageId });

async function claimRun(conversationId: string, messageId: string, cap = { available: true, handoff: false }): Promise<string> {
  const claim = await store.claimAssistantRun(conversationId, messageId, cap);
  if (claim.status !== "claimed") throw new Error(`Expected assistant claim; got ${claim.status}`);
  return claim.runId;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function manualPoll() {
  const wakes: Array<() => void> = [];
  let notify = () => {};
  return {
    wait: async () => new Promise<void>((resolve) => { wakes.push(resolve); notify(); }),
    until: async (count: number) => { if (wakes.length < count) await new Promise<void>((resolve) => { notify = resolve; }); },
    wake: () => { const next = wakes.shift(); if (!next) throw new Error("No waiting chat"); next(); },
  };
}
function chatRequest(handler: ReturnType<typeof createCustomerSupportChatHandler>, id: string, signal?: AbortSignal): Promise<Response> {
  return handler(new Request("https://home.test/api/support/chat", { method: "POST", headers: { origin: "https://home.test", "content-type": "application/json" }, body: JSON.stringify({ version: 2, message: { id, text: `body ${id}` } }), signal }));
}
function streamReply(body: string) {
  return simulateReadableStream({ chunks: [{ type: "text-start" as const, id: "t" }, { type: "text-delta" as const, id: "t", delta: body }, { type: "text-end" as const, id: "t" }, { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } }] });
}
function chatHandler(c: Awaited<ReturnType<typeof customer>>, model: (key: string, id: string) => MockLanguageModelV3, options: { wait?: (ms: number, signal: AbortSignal) => Promise<void>; now?: () => number; effective?: SupportAssistantStore["effective"]; handoff?: boolean; storeOverride?: SupportStore } = {}) {
  const cap = { available: true, handoff: options.handoff ?? false };
  return createCustomerSupportChatHandler({
    authorize: async () => session(), store: () => options.storeOverride ?? store, resolve: async () => c, model,
    assistant: () => ({ effective: options.effective ?? (async () => ({ settings: { mode: options.handoff ? "hybrid" : "assistant", model: "test/model", instructions: "" }, key: "test-key", available: true, capability: cap })) }) as SupportAssistantStore,
    ...(options.wait ? { wait: options.wait } : {}), ...(options.now ? { now: options.now } : {}),
  });
}
async function customer(subject = "alice") { return customers.resolveCustomer(session(subject), { create: true }); }
async function conversation(subject = "alice") {
  const c = await customer(subject);
  return { customerId: c.id, id: (await store.sendCustomer(c.id, session(subject), send("initial_01"))).response.conversation!.id };
}

async function observedId(conversationId: string, clientMessageId: string): Promise<string> {
  return (await sql.query<{ id: string }>("SELECT id FROM support_messages WHERE conversation_id=$1 AND client_message_id=$2", [conversationId, clientMessageId])).rows[0].id;
}

async function assistantRunId(conversationId: string): Promise<string | null> {
  return (await sql.query<{ assistant_run_id: string | null }>("SELECT assistant_run_id FROM support_conversations WHERE id=$1", [conversationId])).rows[0].assistant_run_id;
}

async function waitForBlockedWriter(query: string): Promise<Date | null> {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const rows = await observer.unsafe(`SELECT xact_start FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND xact_start IS NOT NULL AND clock_timestamp() - xact_start > interval '2 milliseconds' AND query LIKE '${query}'`) as { xact_start: Date | null }[];
    if (rows[0]?.xact_start) return rows[0].xact_start;
  }
  return null;
}

describePostgres("support PostgreSQL contract", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as Admin;
    observer = new Bun.SQL(connectionString!) as unknown as Admin;
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of ["001_actions.sql", "002_funding_provider_seam.sql", "010_operator_settings.sql", "011_operator_registry.sql", "012_action_outcomes.sql", "016_action_receipt_observations.sql", "020_support.sql"]) await tx.unsafe(await readMigrationSql(migration));
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    store = new SupportStore(sql);
    customers = new CustomerResolver(sql);
  });
  beforeEach(async () => { await sql.query("DELETE FROM customers"); });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close(); await observer?.close(); });

  test("listing audits every returned customer in one insert and shares the detail read window", async () => {
    const accounts: Array<Awaited<ReturnType<typeof conversation>>> = [];
    for (const subject of ["alice", "bob", "carol"]) accounts.push(await conversation(subject));
    const writes: number[] = [];
    const audit = new AdminAuditLog({
      async query<T>(text: string, values?: unknown[]) {
        const result = await sql.query<T>(text, values);
        writes.push(result.rowCount);
        return result;
      },
      transaction: (fn) => sql.transaction(fn),
    });
    const options = {
      authorize: async () => ({ ...session(), smartAccount: { address: actor, chainId: BASE_CHAIN_ID } }),
      config: () => ({ kind: "configured" as const, addresses: new Set([actor]) }),
      store: () => store, audit: () => audit, assistant: () => new SupportAssistantStore(sql),
    };
    const request = () => new Request("https://home.test/api/admin/support/conversations?status=all&limit=2");
    const list = createOperatorSupportListHandler(options);
    const response = await list(request());
    expect(response.status).toBe(200);
    const page = parseOperatorSupportListResponse(await response.json());
    if (!page) throw new Error("Expected support list response");
    expect(page.conversations).toHaveLength(2);
    const expected = accounts.filter(({ id }) => page.conversations.some((row) => row.id === id)).map(({ customerId }) => customerId).sort();
    const entries = async () => (await sql.query<{ target_id: string; occurred_at: Date }>("SELECT target_id,occurred_at FROM admin_audit_log WHERE actor=$1 AND action='customer.read' AND purpose='support' AND target_id=ANY($2::text[]) ORDER BY target_id", [actor, accounts.map(({ customerId }) => customerId)])).rows;
    const first = await entries();
    expect(first.map((row) => row.target_id)).toEqual(expected);
    expect(writes).toEqual([2]);
    expect((await list(request())).status).toBe(200);
    expect(await entries()).toEqual(first);
    expect(writes).toEqual([2, 0]);
    const id = page.conversations[0].id;
    expect((await createOperatorSupportConversationHandler(options)(new Request(`https://home.test/api/admin/support/conversations/${id}`), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(await entries()).toEqual(first);
    expect(writes).toEqual([2, 0, 0]);
  });

  test("inbox previews preserve whole code points within the 140-code-unit contract", async () => {
    const c = await customer();
    for (const [index, [body, preview]] of [
      ["a".repeat(139) + "😀z", "a".repeat(139)],
      ["a".repeat(138) + "😀z", "a".repeat(138) + "😀"],
      ["😀".repeat(71), "😀".repeat(70)],
    ].entries()) {
      await store.sendCustomer(c.id, session(), { ...send(`emoji_000_${index}`), body });
      const response = await store.list({ status: "all", limit: 10 });
      expect(response.conversations[0].preview).toBe(preview);
      expect(parseOperatorSupportListResponse(response)).not.toBeNull();
    }
  });

  test("read has no side effects, customer messages reopen, and both unread counters track reads", async () => {
    const c = await customer();
    expect((await store.customerConversation(c.id)).conversation).toBeNull();
    expect((await store.customerSummary(c.id)).unreadCount).toBe(0);
    expect((await sql.query("SELECT * FROM support_conversations")).rows).toHaveLength(0);
    const first = await store.sendCustomer(c.id, session(), send("message_01"));
    expect(first.replayed).toBe(false);
    const id = first.response.conversation!.id;
    const firstMessageId = first.response.conversation!.messages[0].id;
    expect((await store.operatorSummary()).unreadConversations).toBe(1);
    expect((await store.list({ status: "all", limit: 10 })).conversations[0].unread).toBe(true);
    expect(await store.readOperator(id, firstMessageId)).toBe(true);
    expect((await store.operatorSummary()).unreadConversations).toBe(0);
    const replyResponse = await store.sendOperator(id, actor, reply("reply_001", firstMessageId));
    expect(replyResponse).toMatchObject({ outcome: "ok", replayed: false });
    if (replyResponse.outcome !== "ok") throw new Error(`Expected operator reply; got ${replyResponse.outcome}`);
    expect(replyResponse.response?.conversation.messages).toHaveLength(2);
    expect((await store.customerSummary(c.id)).unreadCount).toBe(1);
    await store.readCustomer(c.id, replyResponse.response!.conversation.messages.at(-1)!.id);
    expect((await store.customerSummary(c.id)).unreadCount).toBe(0);
    expect(await store.setStatus(id, actor, "resolved", replyResponse.response!.conversation.messages.at(-1)!.id)).toBe("ok");
    expect((await store.customerConversation(c.id)).conversation?.status).toBe("resolved");
    const replay = await store.sendCustomer(c.id, session(), send("message_01"));
    expect(replay.replayed).toBe(true);
    expect(replay.response.conversation?.status).toBe("resolved");
    const reopened = await store.sendCustomer(c.id, session(), send("message_02"));
    expect(reopened.response.conversation?.status).toBe("open");
    expect((await store.operatorSummary()).unreadConversations).toBe(1);
    expect((await sql.query<{ resolved_at: Date | null }>("SELECT resolved_at FROM support_conversations WHERE id=$1", [id])).rows[0].resolved_at).toBeNull();
  });

  test("resolved operator reply conflicts without inserting a message or changing conversation markers", async () => {
    const { id, customerId } = await conversation();
    const firstMessageId = await observedId(id, "initial_01");
    const otherOperator = `0x${"2".repeat(40)}` as `0x${string}`;
    expect(await store.setStatus(id, otherOperator, "resolved", firstMessageId)).toBe("ok");
    const before = (await sql.query<{ status: string; resolved_at: Date | null; last_message_at: Date }>("SELECT status,resolved_at,last_message_at FROM support_conversations WHERE id=$1", [id])).rows[0];
    expect(before).toMatchObject({ status: "resolved", resolved_at: expect.any(Date) });

    expect(await store.sendOperator(id, actor, reply("reply_001", firstMessageId))).toEqual({ outcome: "conflict" });

    expect((await sql.query("SELECT id FROM support_messages WHERE conversation_id=$1 AND client_message_id=$2", [id, "reply_001"])).rows).toHaveLength(0);
    expect((await sql.query("SELECT status,resolved_at,last_message_at FROM support_conversations WHERE id=$1", [id])).rows[0]).toEqual(before);
    expect((await store.customerConversation(customerId)).conversation?.messages).toHaveLength(1);
    expect((await store.customerSummary(customerId)).unreadCount).toBe(0);
  });

  test("resolved reply replay returns the conversation without inserting another message", async () => {
    const { id } = await conversation();
    const firstMessageId = await observedId(id, "initial_01");
    const sent = await store.sendOperator(id, actor, reply("reply_001", firstMessageId));
    expect(sent).toMatchObject({ outcome: "ok", replayed: false });
    if (sent.outcome !== "ok") throw new Error(`Expected operator reply; got ${sent.outcome}`);
    expect(sent.response?.conversation.messages).toHaveLength(2);
    const replyId = await observedId(id, "reply_001");
    expect(await store.setStatus(id, actor, "resolved", replyId)).toBe("ok");
    const before = (await sql.query("SELECT status,resolved_at,last_message_at FROM support_conversations WHERE id=$1", [id])).rows[0];
    const resolved = await store.operatorConversation(id);

    const replayed = await store.sendOperator(id, actor, reply("reply_001", firstMessageId));

    expect(replayed).toMatchObject({ outcome: "ok", replayed: true });
    if (replayed.outcome !== "ok") throw new Error(`Expected operator reply replay; got ${replayed.outcome}`);
    expect(replayed.response).toEqual(resolved);
    expect(replayed.response?.conversation.status).toBe("resolved");
    expect(replayed.response?.conversation.resolvedAt).not.toBeNull();
    expect((await sql.query("SELECT id FROM support_messages WHERE conversation_id=$1 AND client_message_id=$2", [id, "reply_001"])).rows).toEqual([{ id: replyId }]);
    expect((await sql.query("SELECT status,resolved_at,last_message_at FROM support_conversations WHERE id=$1", [id])).rows[0]).toEqual(before);
  });

  test("stale operator reply conflicts without inserting or advancing conversation markers and keeps hand-back blocked", async () => {
    const { id, customerId } = await conversation();
    const observed = await observedId(id, "initial_01");
    await store.sendCustomer(customerId, session(), send("message_02"));
    const before = (await sql.query<{ last_message_at: Date; last_operator_message_at: Date | null }>("SELECT last_message_at,last_operator_message_at FROM support_conversations WHERE id=$1", [id])).rows[0];

    expect(await store.sendOperator(id, actor, reply("reply_001", observed))).toEqual({ outcome: "conflict" });

    expect((await sql.query("SELECT id FROM support_messages WHERE conversation_id=$1 AND client_message_id=$2", [id, "reply_001"])).rows).toHaveLength(0);
    expect((await sql.query("SELECT last_message_at,last_operator_message_at FROM support_conversations WHERE id=$1", [id])).rows[0]).toEqual(before);
    expect(await store.setHandler(id, "assistant")).toBe("conflict");
  });

  test("operator reply with the newest sent customer read marker inserts successfully", async () => {
    const { id, customerId } = await conversation();
    await store.sendCustomer(customerId, session(), send("message_02"));
    const observed = await observedId(id, "message_02");

    expect(await store.sendOperator(id, actor, reply("reply_001", observed))).toMatchObject({ outcome: "ok", replayed: false });

    expect((await sql.query("SELECT body FROM support_messages WHERE conversation_id=$1 AND client_message_id=$2", [id, "reply_001"])).rows).toEqual([{ body: "reply reply_001" }]);
  });

  test("operator reply replay with a stale read marker stays idempotent after a newer customer message", async () => {
    const { id, customerId } = await conversation();
    const observed = await observedId(id, "initial_01");
    expect(await store.sendOperator(id, actor, reply("reply_001", observed))).toMatchObject({ outcome: "ok", replayed: false });
    const replyId = await observedId(id, "reply_001");
    await store.sendCustomer(customerId, session(), send("message_02"));

    expect(await store.sendOperator(id, actor, reply("reply_001", observed))).toMatchObject({ outcome: "ok", replayed: true });

    expect((await sql.query("SELECT id FROM support_messages WHERE conversation_id=$1 AND client_message_id=$2", [id, "reply_001"])).rows).toEqual([{ id: replyId }]);
    expect(await store.setHandler(id, "assistant")).toBe("conflict");
  });

  test("operator reply accepts the conversation-id fallback when the newest page has no customer message", async () => {
    const { id } = await conversation();
    await sql.query(`INSERT INTO support_messages (id,conversation_id,author_type,author_operator,body,client_message_id,created_at)
      SELECT gen_random_uuid(),$1::uuid,'operator',$2,'previous reply','previous_' || n,clock_timestamp() FROM generate_series(1,50) n`, [id, actor]);
    const visible = (await store.operatorConversation(id))!.conversation.messages;
    expect(visible).toHaveLength(50);
    expect(visible.every((message) => message.authorType === "operator")).toBe(true);

    expect(await store.sendOperator(id, actor, reply("reply_001", id))).toMatchObject({ outcome: "ok", replayed: false });

    expect((await sql.query("SELECT body FROM support_messages WHERE conversation_id=$1 AND client_message_id=$2", [id, "reply_001"])).rows).toEqual([{ body: "reply reply_001" }]);
  });

  test("operator reply with the conversation-id fallback conflicts while the newest customer message is unanswered", async () => {
    const { id, customerId } = await conversation();
    await sql.query(`INSERT INTO support_messages (id,conversation_id,author_type,author_operator,body,client_message_id,created_at)
      SELECT gen_random_uuid(),$1::uuid,'operator',$2,'previous reply','previous_' || n,clock_timestamp() FROM generate_series(1,50) n`, [id, actor]);
    const visible = (await store.operatorConversation(id))!.conversation.messages;
    expect(visible).toHaveLength(50);
    expect(visible.every((message) => message.authorType === "operator")).toBe(true);
    await store.sendCustomer(customerId, session(), send("message_02"));
    const newestCustomerMessageId = await observedId(id, "message_02");
    const before = (await sql.query<{ last_message_at: Date; last_operator_message_at: Date | null }>("SELECT last_message_at,last_operator_message_at FROM support_conversations WHERE id=$1", [id])).rows[0];

    expect(await store.sendOperator(id, actor, reply("reply_001", id))).toEqual({ outcome: "conflict" });

    expect((await sql.query("SELECT id FROM support_messages WHERE conversation_id=$1 AND client_message_id=$2", [id, "reply_001"])).rows).toHaveLength(0);
    expect((await sql.query("SELECT last_message_at,last_operator_message_at FROM support_conversations WHERE id=$1", [id])).rows[0]).toEqual(before);
    expect(await store.setHandler(id, "assistant")).toBe("conflict");

    expect(await store.sendOperator(id, actor, reply("reply_001", newestCustomerMessageId))).toMatchObject({ outcome: "ok", replayed: false });
    expect(await store.setHandler(id, "assistant")).toBe("ok");
  });

  test("drafts never reach customers; discarded never reaches either reader", async () => {
    const { id, customerId } = await conversation();
    await sql.query("INSERT INTO support_messages (id,conversation_id,author_type,status,body,client_message_id) VALUES ($1,$2,'assistant','draft','suggestion','draft_001')", [crypto.randomUUID(), id]);
    await sql.query("INSERT INTO support_messages (id,conversation_id,author_type,status,body,client_message_id) VALUES ($1,$2,'assistant','discarded','removed','discard_01')", [crypto.randomUUID(), id]);
    expect((await store.customerConversation(customerId)).conversation?.messages).toHaveLength(1);
    const response = await store.operatorConversation(id);
    expect(response?.conversation.messages.map((m) => m.status)).toEqual(["sent", "draft"]);
    expect((await store.customerSummary(customerId)).unreadCount).toBe(0);
  });

  test("list is ordered by last message timestamp and UUID with stable cursor across pages", async () => {
    const ids = [];
    for (const subject of ["alice", "bob", "carol"]) ids.push((await conversation(subject)).id);
    await sql.query("UPDATE support_conversations SET last_message_at='2026-01-01T00:00:00.000Z'");
    const sorted = [...ids].sort().reverse();
    const first = await store.list({ status: "all", limit: 2 });
    expect(first.conversations.map((row) => row.id)).toEqual(sorted.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    const second = await store.list({ status: "all", limit: 2, before: first.nextCursor! });
    expect(second.conversations.map((row) => row.id)).toEqual(sorted.slice(2));
    expect(second.nextCursor).toBeNull();
    const observed = (await store.operatorConversation(ids[0]))!.conversation.messages.at(-1)!.id;
    expect(await store.setStatus(ids[0], actor, "resolved", observed)).toBe("ok");
    expect((await store.list({ status: "open", limit: 5 })).conversations).toHaveLength(2);
    expect((await store.list({ status: "resolved", limit: 5 })).conversations).toHaveLength(1);
  });

  test("foreign context refs are dropped, owned refs are attached, and customer deletion cascades", async () => {
    const c = await customer();
    const order = crypto.randomUUID();
    const action = crypto.randomUUID();
    await sql.query(`INSERT INTO funding_orders (id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,fees,created_at,updated_at)
      VALUES ($1,'bob','base-account',$2,'coinbase','US','USDC','card','20','digest','{}','token','failed',0,'[]',now(),now())`, [order, address]);
    await sql.query("INSERT INTO actions (id,owner_key,provider,kind,summary) VALUES ($1,$2,'base-account','send','{}')", [action, actionOwnerKey(moneyActionOwner(session("bob"))!)]);
    const foreign = await store.sendCustomer(c.id, session(), send("message_01", { kind: "funding_order", id: order }));
    const id = foreign.response.conversation!.id;
    expect(foreign.response.conversation!.contextRefs).toEqual([]);
    await store.sendCustomer(c.id, session(), send("message_02", { kind: "money_action", id: action }));
    expect((await store.customerConversation(c.id)).conversation?.contextRefs).toEqual([]);
    await sql.query("UPDATE funding_orders SET owner_subject='alice' WHERE id=$1", [order]);
    await sql.query("UPDATE actions SET owner_key=$2 WHERE id=$1", [action, actionOwnerKey(moneyActionOwner(session())!)]);
    const attached = await store.sendCustomer(c.id, session(), send("message_03", { kind: "funding_order", id: order }));
    expect(attached.response.conversation?.contextRefs).toEqual([{ kind: "funding_order", id: order }]);
    const latest = await store.sendCustomer(c.id, session(), send("message_04", { kind: "money_action", id: action }));
    expect((await store.operatorConversation(id))?.conversation.contextRefs).toHaveLength(2);
    expect(await store.assistantContext(id, latest.messageId)).toEqual([expect.stringContaining("send · pending"), expect.stringContaining("failed · coinbase · 20")]);
    expect((await sql.query<{ count: string }>("SELECT count(*)::text AS count FROM support_context_refs r JOIN support_messages m ON m.id=r.message_id WHERE r.conversation_id=$1 AND r.created_at < m.created_at", [id])).rows[0].count).toBe("0");
    await sql.query("DELETE FROM customers WHERE id=$1", [c.id]);
    expect((await sql.query("SELECT * FROM support_conversations")).rows).toHaveLength(0);
    expect((await sql.query("SELECT * FROM support_messages")).rows).toHaveLength(0);
    expect((await sql.query("SELECT * FROM support_context_refs")).rows).toHaveLength(0);
  });

  test("assistant context excludes references attached after the claimed customer message", async () => {
    const c = await customer();
    const order = crypto.randomUUID();
    const action = crypto.randomUUID();
    await sql.query(`INSERT INTO funding_orders (id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,fees,created_at,updated_at)
      VALUES ($1,'alice','base-account',$2,'coinbase','US','USDC','card','20',$3,'{}','token','failed',0,'[]',now(),now())`, [order, address, crypto.randomUUID()]);
    await sql.query("INSERT INTO actions (id,owner_key,provider,kind,summary) VALUES ($1,$2,'base-account','send','{}')", [action, actionOwnerKey(moneyActionOwner(session())!)]);
    const earlier = await store.sendCustomer(c.id, session(), send("initial_01", { kind: "funding_order", id: order }), { available: true, handoff: false });
    const id = earlier.response.conversation!.id;
    const run = await claimRun(id, earlier.messageId);
    await store.sendCustomer(c.id, session(), send("message_02", { kind: "money_action", id: action }));
    expect(await store.assistantContext(id, earlier.messageId)).toEqual([expect.stringContaining("failed · coinbase · 20")]);
    await store.releaseAssistantRun(id, run);
  });
  test("money-action context follows the persisted outcome and receipt state", async () => {
    const c = await customer();
    const first = await store.sendCustomer(c.id, session(), send("initial_01"));
    const id = first.response.conversation!.id;
    const owner = actionOwnerKey(moneyActionOwner(session())!);
    const reverted = crypto.randomUUID(), absent = crypto.randomUUID(), succeeded = crypto.randomUUID(), observed = crypto.randomUUID(), prepared = crypto.randomUUID();
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,confirmed_at,handle_recorded_at,transaction_hash,outcome,outcome_source,outcome_recorded_at,settled_at)
      VALUES ($1,$2,'base-account','send','{}',now(),now(),$3,'reverted','chain',now(),now())`, [reverted, owner, `0x${"a".repeat(64)}`]);
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,confirmed_at,outcome,outcome_source,outcome_recorded_at)
      VALUES ($1,$2,'base-account','cash-out','{}',now(),'not_submitted','wallet',now())`, [absent, owner]);
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,confirmed_at,handle_recorded_at,transaction_hash,outcome,outcome_source,outcome_recorded_at,settled_at)
      VALUES ($1,$2,'base-account','send','{}',now(),now(),$3,'succeeded','chain',now(),now())`, [succeeded, owner, `0x${"b".repeat(64)}`]);
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,confirmed_at,handle_recorded_at,transaction_hash,observed_receipt_transaction_hash,observed_receipt_block_number,observed_receipt_block_hash,observed_receipt_outcome,observed_at)
      VALUES ($1,$2,'base-account','send','{}',now(),now(),$3,$3,1,$4,'reverted',now())`, [observed, owner, `0x${"c".repeat(64)}`, `0x${"d".repeat(64)}`]);
    await sql.query("INSERT INTO actions (id,owner_key,provider,kind,summary) VALUES ($1,$2,'base-account','send','{}')", [prepared, owner]);
    for (const action of [reverted, absent, succeeded, observed, prepared]) await store.sendCustomer(c.id, session(), send(`ref_${action}`, { kind: "money_action", id: action }));
    const expected = ["cash-out · failed", "send · confirmed", "send · failed", "send · failed", "send · pending"];
    expect((await store.operatorConversation(id))!.conversation.contextRefs.map((ref) => ref.summary).sort()).toEqual([...expected].sort());
    const latest = (await store.customerConversation(c.id)).conversation!.messages.at(-1)!.id;
    expect((await store.assistantContext(id, latest)).sort()).toEqual([...expected].sort());
  });

  test("simultaneous customer sends enforce the ten-minute quota", async () => {
    const c = await customer();
    const outcomes = await Promise.allSettled(Array.from({ length: 15 }, (_, index) =>
      store.sendCustomer(c.id, session(), send(`message_${String(index).padStart(2, "0")}`))));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(10);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(5);
    for (const outcome of rejected) expect(outcome.reason).toBeInstanceOf(SupportRateLimitedError);
    expect((await store.customerConversation(c.id)).conversation?.messages).toHaveLength(10);
  });

  test("simultaneous first sends create exactly one conversation", async () => {
    const c = await customer();
    const outcomes = await Promise.allSettled(Array.from({ length: 3 }, (_, index) =>
      store.sendCustomer(c.id, session(), send(`message_${String(index).padStart(2, "0")}`))));
    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect((await sql.query("SELECT id FROM support_conversations WHERE customer_id=$1", [c.id])).rows).toHaveLength(1);
    expect((await store.customerConversation(c.id)).conversation?.messages).toHaveLength(3);
  });

  test("a customer without a smart account can send while unowned money actions stay private", async () => {
    const c = await customer();
    const walletless = { ...session(), smartAccount: null };
    const sent = await store.sendCustomer(c.id, walletless, send("message_01", { kind: "money_action", id: crypto.randomUUID() }));
    expect(sent.response.conversation?.messages).toHaveLength(1);
    expect(sent.response.conversation?.contextRefs).toEqual([]);
  });

  test("DB-backed customer and operator limits count only sent messages, retries do not consume quota", async () => {
    const { id, customerId } = await conversation();
    for (let n = 2; n <= 10; n++) await store.sendCustomer(customerId, session(), send(`message_${String(n).padStart(2, "0")}`));
    expect((await store.sendCustomer(customerId, session(), send("initial_01"))).replayed).toBe(true);
    await expect(store.sendCustomer(customerId, session(), send("message_11"))).rejects.toMatchObject({ retryAfter: 600 });
    await sql.query("UPDATE support_messages SET created_at=now()-interval '11 minutes' WHERE conversation_id=$1 AND author_type='customer'", [id]);
    for (let n = 11; n <= 50; n++) {
      await store.sendCustomer(customerId, session(), send(`message_${String(n).padStart(2, "0")}`));
      if (n % 10 === 0) await sql.query("UPDATE support_messages SET created_at=now()-interval '11 minutes' WHERE conversation_id=$1 AND author_type='customer'", [id]);
    }
    await expect(store.sendCustomer(customerId, session(), send("message_51"))).rejects.toMatchObject({ retryAfter: 86400 });
    await sql.query("UPDATE support_messages SET created_at=now()-interval '25 hours' WHERE conversation_id=$1 AND author_type='customer'", [id]);
    expect((await store.sendCustomer(customerId, session(), send("message_52"))).replayed).toBe(false);
    const observed = await observedId(id, "message_52");
    for (let n = 1; n <= 60; n++) await store.sendOperator(id, actor, reply(`reply_${String(n).padStart(3, "0")}`, observed));
    expect(await store.sendOperator(id, actor, reply("reply_001", id))).toMatchObject({ outcome: "ok", replayed: true });
    await expect(store.sendOperator(id, actor, reply("reply_061", id))).rejects.toMatchObject({ retryAfter: 60 });
  });

  test("read markers advance only through the observed message", async () => {
    const { id, customerId } = await conversation();
    const firstMessageId = (await store.customerConversation(customerId)).conversation!.messages[0].id;
    await store.sendCustomer(customerId, session(), send("message_02"));
    expect((await store.operatorSummary()).unreadConversations).toBe(1);
    expect(await store.readOperator(id, firstMessageId)).toBe(true);
    expect((await store.operatorSummary()).unreadConversations).toBe(1);
    const latest = (await store.operatorConversation(id))!.conversation.messages.at(-1)!.id;
    expect(await store.readOperator(id, latest)).toBe(true);
    expect((await store.operatorSummary()).unreadConversations).toBe(0);
    await store.sendOperator(id, actor, reply("reply_001", latest));
    const replyId = (await store.operatorConversation(id))!.conversation.messages.at(-1)!.id;
    await store.sendOperator(id, actor, reply("reply_002", replyId));
    expect((await store.customerSummary(customerId)).unreadCount).toBe(2);
    expect(await store.readCustomer(customerId, firstMessageId)).toBe(true);
    expect((await store.customerSummary(customerId)).unreadCount).toBe(2);
    const repliesLatest = (await store.operatorConversation(id))!.conversation.messages.at(-1)!.id;
    expect(await store.readCustomer(customerId, repliesLatest)).toBe(true);
    expect((await store.customerSummary(customerId)).unreadCount).toBe(0);
  });

  test("message history is served in bounded pages with a stable older cursor", async () => {
    const { id, customerId } = await conversation();
    for (let index = 0; index < 60; index++) {
      await sql.query("INSERT INTO support_messages (id,conversation_id,author_type,body,client_message_id,created_at) VALUES ($1,$2,'customer',$3,$4,now() + ($5 || ' seconds')::interval)", [crypto.randomUUID(), id, `extra ${index}`, `extra_${String(index).padStart(3, "0")}`, String(index)]);
    }
    const first = await store.customerConversation(customerId);
    expect(first.conversation!.messages).toHaveLength(50);
    expect(first.conversation!.messagesNextCursor).not.toBeNull();
    const older = await store.customerConversation(customerId, first.conversation!.messagesNextCursor!);
    expect(older.conversation!.messages).toHaveLength(11);
    expect(older.conversation!.messagesNextCursor).toBeNull();
    const combined = [...older.conversation!.messages, ...first.conversation!.messages];
    expect(new Set(combined.map((item) => item.id)).size).toBe(combined.length);
    expect(combined.map((item) => item.createdAt)).toEqual([...combined.map((item) => item.createdAt)].sort());
    const operator = await store.operatorConversation(id);
    expect(operator!.conversation.messages).toHaveLength(50);
    expect(operator!.conversation.messagesNextCursor).not.toBeNull();
    expect(parseCustomerSupportResponse(first)).not.toBeNull();
    expect(parseOperatorSupportConversationResponse(operator)).not.toBeNull();
    expect(parseOperatorSupportConversationResponse({ ...operator!, conversation: { ...operator!.conversation, messagesNextCursor: "not-a-uuid" } })).toBeNull();
  });

  test("re-attaching an older context reference moves it to the current message", async () => {
    const c = await customer();
    const order = crypto.randomUUID();
    await sql.query(`INSERT INTO funding_orders (id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,fees,created_at,updated_at)
      VALUES ($1,'alice','base-account',$2,'coinbase','US','USDC','card','20',$3,'{}','token','failed',0,'[]',now(),now())`, [order, address, crypto.randomUUID()]);
    const first = await store.sendCustomer(c.id, session(), send("reattach_01", { kind: "funding_order", id: order }));
    const id = first.response.conversation?.id ?? "";
    for (let index = 0; index < 20; index++) {
      await sql.query("INSERT INTO support_context_refs (id,conversation_id,message_id,kind,ref_id,created_at) VALUES ($1,$2,$3,'money_action',$4,clock_timestamp())", [crypto.randomUUID(), id, first.messageId, `ref_${String(index).padStart(2, "0")}`]);
    }
    expect((await store.operatorConversation(id))?.conversation.contextRefs.map((ref) => ref.id)).not.toContain(order);
    const again = await store.sendCustomer(c.id, session(), send("reattach_02", { kind: "funding_order", id: order }));
    expect((await store.operatorConversation(id))?.conversation.contextRefs.at(-1)).toMatchObject({ kind: "funding_order", id: order });
    expect(await store.assistantContext(id, again.messageId)).toContainEqual(expect.stringContaining("failed · coinbase · 20"));
    expect((await sql.query<{ message_id: string }>("SELECT message_id FROM support_context_refs WHERE conversation_id=$1 AND ref_id=$2", [id, order])).rows).toEqual([{ message_id: again.messageId }]);
  });

  test("ownership of an assistant run ends when an operator replies", async () => {
    const c = await customer();
    const sent = await store.sendCustomer(c.id, session(), send("owned_01"), { available: true, handoff: false });
    const id = sent.response.conversation?.id ?? "";
    const latest = sent.messageId;
    const runId = await claimRun(id, latest);
    expect(await store.ownsAssistantRun(id, runId)).toBe(true);
    expect((await store.sendOperator(id, actor, reply("takeover_01", latest))).outcome).toBe("ok");
    expect(await store.ownsAssistantRun(id, runId)).toBe(false);
  });

  test("context references are bounded to the most recent twenty", async () => {
    const { id } = await conversation();
    for (let index = 0; index < 25; index++) {
      await sql.query("INSERT INTO support_context_refs (id,conversation_id,kind,ref_id,created_at) VALUES ($1,$2,'money_action',$3,now() + ($4 || ' seconds')::interval)", [crypto.randomUUID(), id, `ref_${String(index).padStart(2, "0")}`, String(index)]);
    }
    const response = await store.operatorConversation(id);
    expect(response!.conversation.contextRefs).toHaveLength(20);
    expect(response!.conversation.contextRefs.at(-1)!.id).toBe("ref_24");
  });

  test("resolve is refused when a customer message arrives after the observed message", async () => {
    const { id, customerId } = await conversation();
    const observed = (await store.customerConversation(customerId)).conversation!.messages.at(-1)!.id;
    await store.sendCustomer(customerId, session(), send("message_02"));
    expect(await store.setStatus(id, actor, "resolved", observed)).toBe("conflict");
    expect((await store.customerConversation(customerId)).conversation!.status).toBe("open");
    expect(await store.setStatus(id, actor, "resolved", crypto.randomUUID())).toBe("conflict");
    expect((await store.customerConversation(customerId)).conversation!.status).toBe("open");
    const latest = (await store.customerConversation(customerId)).conversation!.messages.at(-1)!.id;
    expect(await store.setStatus(id, actor, "resolved", latest)).toBe("ok");
    expect((await store.customerConversation(customerId)).conversation!.status).toBe("resolved");
    expect(await store.setStatus(id, actor, "open", crypto.randomUUID())).toBe("ok");
    expect((await store.customerConversation(customerId)).conversation!.status).toBe("open");
  });
  test("resolving advances the operator read marker through the observed message", async () => {
    const { id, customerId } = await conversation();
    const observed = (await store.customerConversation(customerId)).conversation!.messages.at(-1)!.id;
    expect((await store.operatorSummary()).unreadConversations).toBe(1);
    expect(await store.setStatus(id, actor, "resolved", observed)).toBe("ok");
    expect((await store.operatorSummary()).unreadConversations).toBe(0);
    expect((await store.list({ status: "all", limit: 10 })).conversations[0].unread).toBe(false);
  });

  test("a customer write that waits on a lock still takes the newest timestamp", async () => {
    const { id, customerId } = await conversation();
    const competing = crypto.randomUUID();
    let pending: ReturnType<SupportStore["sendCustomer"]> | undefined;
    let xactStart: Date | null = null;
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      await tx.unsafe(`SELECT 1 FROM customers WHERE id='${customerId}' FOR UPDATE`);
      pending = store.sendCustomer(customerId, session(), send("message_02"));
      xactStart = await waitForBlockedWriter("%customers%");
      await tx.unsafe(`INSERT INTO support_messages (id,conversation_id,author_type,body,client_message_id,created_at) VALUES ('${competing}','${id}','customer','competing','message_00',clock_timestamp())`);
      await tx.unsafe(`UPDATE support_conversations SET last_message_at=date_trunc('milliseconds',clock_timestamp()),last_customer_message_at=clock_timestamp() WHERE id='${id}'`);
    });
    const sent = await pending!;
    expect(xactStart).not.toBeNull();
    expect(sent.replayed).toBe(false);
    const waited = await observedId(id, "message_02");
    const waitedAt = (await sql.query<{ created_at: Date }>("SELECT created_at FROM support_messages WHERE id=$1", [waited])).rows[0].created_at;
    expect(waitedAt.getTime()).toBeGreaterThan(xactStart!.getTime());
    const markers = (await sql.query<{ last_message_at: Date; last_customer_message_at: Date }>("SELECT last_message_at,last_customer_message_at FROM support_conversations WHERE id=$1", [id])).rows[0];
    expect(markers.last_customer_message_at.getTime()).toBe(waitedAt.getTime());
    expect(markers.last_message_at.getTime()).toBe(waitedAt.getTime());
    const ordered = (await store.customerConversation(customerId)).conversation!.messages.map((message) => message.id);
    expect(ordered).toEqual([await observedId(id, "initial_01"), competing, waited]);
  });

  test("assistant handler transition table: create, customer handoff, operator takeover, hand back and reopen", async () => {
    const available = { available: true, handoff: true };
    const c = await customer();
    const created = await store.sendCustomer(c.id, session(), send("initial_01"), available);
    const id = created.response.conversation!.id;
    expect(created.response.conversation?.handler).toBe("assistant");
    expect((await store.list({ status: "all", limit: 5 }, available)).conversations[0].unread).toBe(false);
    expect((await store.operatorSummary(available)).unreadConversations).toBe(0);
    expect(await store.handoffCustomer(c.id, true)).toBe("ok");
    expect(await store.handoffCustomer(c.id, true)).toBe("ok");
    expect((await store.customerConversation(c.id, undefined, available)).conversation?.handler).toBe("operator");
    expect((await store.operatorConversation(id, undefined, available))?.conversation.handedOffAt).not.toBeNull();
    expect(await store.setHandler(id, "assistant")).toBe("conflict");
    await store.sendOperator(id, actor, reply("reply_001", created.response.conversation!.messages[0].id));
    expect((await store.customerConversation(c.id, undefined, available)).conversation?.handler).toBe("operator");
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    expect(await store.handoffCustomer(c.id, false)).toBe("conflict");
    const first = (await store.customerConversation(c.id, undefined, available)).conversation!.messages.at(-1)!.id;
    expect(await store.setStatus(id, actor, "resolved", first)).toBe("ok");
    const reopened = await store.sendCustomer(c.id, session(), send("message_02"), available);
    expect(reopened.response.conversation?.handler).toBe("assistant");
    expect((await store.operatorConversation(id, undefined, available))?.conversation.handedOffAt).toBeNull();
    expect((await store.customerConversation(c.id)).conversation?.handler).toBe("operator");
    expect((await store.operatorSummary()).unreadConversations).toBe(1);
  });

  test("failed assistant run reclaims latest replay; completed and older messages do not", async () => {
    const cap = { available: true, handoff: false };
    const c = await customer();
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId);
    expect(await store.claimAssistantRun(id, first.messageId, cap)).toEqual({ status: "answering" });
    await store.releaseAssistantRun(id, runId);
    const retry = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    expect(retry.replayed).toBe(true);
    const replayRun = await claimRun(id, retry.messageId);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "reply", replayRun)).toBe("sent");
    await store.releaseAssistantRun(id, replayRun);
    expect(await store.claimAssistantRun(id, first.messageId, cap)).toEqual({ status: "skipped" });
    const next = await store.sendCustomer(c.id, session(), send("message_02"), cap);
    const nextRun = await claimRun(id, next.messageId);
    expect(await store.claimAssistantRun(id, first.messageId, cap)).toEqual({ status: "skipped" });
    await store.releaseAssistantRun(id, nextRun);
  });

  test("provider-failed partial text is discarded and the same customer message can regenerate", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const firstRun = await claimRun(id, first.messageId);
    const partialId = crypto.randomUUID();
    expect(await store.saveAssistant(id, partialId, "partial", firstRun, true)).toBe("discarded");
    expect((await sql.query<{ in_reply_to: string | null }>("SELECT in_reply_to FROM support_messages WHERE id=$1", [partialId])).rows[0].in_reply_to).toBeNull();
    expect((await sql.query<{ status: string }>("SELECT status FROM support_messages WHERE id=$1", [partialId])).rows[0].status).toBe("discarded");
    await store.releaseAssistantRun(id, firstRun);
    expect((await store.customerConversation(c.id, undefined, cap)).conversation?.messages).toHaveLength(1);
    const replay = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const replayRun = await claimRun(id, replay.messageId);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "regenerated", replayRun)).toBe("sent");
    await store.releaseAssistantRun(id, replayRun);
    expect((await store.customerConversation(c.id, undefined, cap)).conversation?.messages.at(-1)?.body).toBe("regenerated");
    expect(await store.claimAssistantRun(id, first.messageId, cap)).toEqual({ status: "skipped" });
  });

  test("concurrent claims are exclusive; expired runs can be replaced without releasing a newer claim", async () => {
    const cap = { available: true, handoff: false };
    const c = await customer();
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const [one, two] = await Promise.all([store.claimAssistantRun(id, first.messageId, cap), store.claimAssistantRun(id, first.messageId, cap)]);
    expect([one, two].map((result) => result.status).sort()).toEqual(["answering", "claimed"]);
    const claimed = one.status === "claimed" ? one.runId : two.status === "claimed" ? two.runId : "";
    await sql.query("UPDATE support_conversations SET assistant_run_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
    const recovered = await claimRun(id, first.messageId);
    expect(recovered).not.toBe(claimed);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "stale reply", claimed)).toBe("discarded");
    await store.releaseAssistantRun(id, claimed);
    expect(await store.claimAssistantRun(id, first.messageId, cap)).toEqual({ status: "answering" });
    await store.releaseAssistantRun(id, recovered);
    const next = await store.sendCustomer(c.id, session(), send("message_02"), cap);
    const nextRun = await claimRun(id, next.messageId);
    const newer = await store.sendCustomer(c.id, session(), send("message_03"), cap);
    expect(await store.claimAssistantRun(id, next.messageId, cap)).toEqual({ status: "skipped" });
    expect(await store.claimAssistantRun(id, newer.messageId, cap)).toEqual({ status: "held" });
    const previousReply = crypto.randomUUID();
    expect(await store.saveAssistant(id, previousReply, "answer to message 02", nextRun)).toBe("sent");
    expect((await sql.query<{ in_reply_to: string }>("SELECT in_reply_to FROM support_messages WHERE id=$1", [previousReply])).rows[0].in_reply_to).toBe(next.messageId);
    await store.releaseAssistantRun(id, nextRun);
    const latestRun = await claimRun(id, newer.messageId);
    await store.releaseAssistantRun(id, latestRun);
  });

  test("history cutoff excludes a customer message saved after the earlier turn claimed", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const earlier = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = earlier.response.conversation!.id;
    const claimed = await claimRun(id, earlier.messageId);
    const later = await store.sendCustomer(c.id, session(), send("message_02"), cap);
    expect(await store.assistantHistory(id, earlier.messageId)).toEqual([{ role: "user", content: "body initial_01" }]);
    expect(await store.assistantHistory(id, later.messageId)).toEqual([{ role: "user", content: "body initial_01" }, { role: "user", content: "body message_02" }]);
    await store.releaseAssistantRun(id, claimed);
  });

  test("history includes a sent assistant reply to A after B arrived but before B is claimed", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const firstRun = await claimRun(id, first.messageId);
    const second = await store.sendCustomer(c.id, session(), send("message_02"), cap);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "answer A", firstRun)).toBe("sent");
    await store.releaseAssistantRun(id, firstRun);
    const secondRun = await claimRun(id, second.messageId);
    expect(await store.assistantHistory(id, second.messageId)).toEqual([
      { role: "user", content: "body initial_01" },
      { role: "user", content: "body message_02" },
      { role: "assistant", content: "answer A" },
    ]);
    await store.releaseAssistantRun(id, secondRun);
  });

  test("two tabs answer in separate streams; each model sees history through its own claim", async () => {
    const c = await customer();
    const firstStarted = deferred();
    const release = deferred();
    const poll = manualPoll();
    const prompts: string[] = [];
    const model = () => new MockLanguageModelV3({ doStream: async (params) => {
      prompts.push(JSON.stringify(params.prompt));
      const turn = prompts.length;
      if (turn === 1) { firstStarted.resolve(); await release.promise; }
      return { stream: streamReply(`answer ${turn}`) };
    } });
    const handler = chatHandler(c, model, { wait: poll.wait });
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    const firstText = (await chatRequest(handler, a)).text();
    await firstStarted.promise;
    const secondText = (await chatRequest(handler, b)).text();
    await poll.until(1);
    release.resolve();
    expect(await firstText).toContain("answer 1");
    poll.wake();
    const responseB = await secondText;
    expect(responseB).toContain("answer 2");
    expect(responseB).not.toContain("answer 1");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain(`body ${a}`);
    expect(prompts[0]).not.toContain(`body ${b}`);
    expect(prompts[1]).toContain(`body ${a}`);
    expect(prompts[1]).toContain(`body ${b}`);
    const rows = (await sql.query<{ body: string; in_reply_to: string }>("SELECT body,in_reply_to FROM support_messages WHERE author_type='assistant' ORDER BY created_at,id")).rows;
    expect(rows.map((row) => row.body)).toEqual(["answer 1", "answer 2"]);
    expect(rows.map((row) => row.in_reply_to)).toEqual([await observedId((await store.customerConversation(c.id)).conversation!.id, a), await observedId((await store.customerConversation(c.id)).conversation!.id, b)]);
  });
  test("three fast messages skip the middle turn and claim only the latest after release", async () => {
    const c = await customer();
    const firstStarted = deferred(), release = deferred(), poll = manualPoll();
    let turns = 0;
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => {
      if (++turns === 1) { firstStarted.resolve(); await release.promise; }
      return { stream: streamReply(`answer ${turns}`) };
    } }), { wait: poll.wait });
    const first = (await chatRequest(handler, crypto.randomUUID())).text();
    await firstStarted.promise;
    const middle = (await chatRequest(handler, crypto.randomUUID())).text();
    await poll.until(1);
    const latest = (await chatRequest(handler, crypto.randomUUID())).text();
    await poll.until(2);
    poll.wake();
    const middleText = await middle;
    expect(middleText).toContain('"type":"data-support"');
    expect(middleText).not.toContain("answer");
    release.resolve();
    await first;
    poll.wake();
    expect(await latest).toContain("answer 2");
    expect(turns).toBe(2);
  });

  test("a cancelled customer's claim releases so the waiting tab can reply", async () => {
    const c = await customer();
    const started = deferred(), release = deferred(), poll = manualPoll();
    const controller = new AbortController();
    let turns = 0;
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => {
      const turn = ++turns;
      if (turn === 1) { started.resolve(); await release.promise; }
      return { stream: streamReply(`answer ${turn}`) };
    } }), { wait: poll.wait });
    const first = (await chatRequest(handler, crypto.randomUUID(), controller.signal)).text();
    await started.promise;
    const second = (await chatRequest(handler, crypto.randomUUID())).text();
    await poll.until(1);
    controller.abort();
    const conversationId = (await store.customerConversation(c.id)).conversation!.id;
    let released = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = (await sql.query<{ assistant_run_id: string | null }>("SELECT assistant_run_id FROM support_conversations WHERE id=$1", [conversationId])).rows[0];
      if (row.assistant_run_id === null) { released = true; break; }
    }
    expect(released).toBe(true);
    poll.wake();
    expect(await second).toContain("answer 2");
    release.resolve();
    await first;
    expect(turns).toBe(2);
    const messages = (await store.customerConversation(c.id)).conversation!.messages;
    expect(messages.filter((message) => message.authorType === "assistant").map((message) => message.body)).toEqual(["answer 2"]);
  });

  test("abort before a claimed run's first token keeps hybrid pending messages in the operator queue", async () => {
    const c = await customer();
    const controller = new AbortController(), started = deferred(), release = deferred();
    let turns = 0;
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => {
      turns++; started.resolve(); await release.promise;
      return { stream: streamReply("unreachable") };
    } }), { handoff: true });
    const clientId = crypto.randomUUID();
    const first = (await chatRequest(handler, clientId, controller.signal)).text();
    await started.promise;
    controller.abort();
    const id = (await store.customerConversation(c.id)).conversation!.id;
    let handedOff = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = (await sql.query<{ assistant_run_id: string | null; handler: string }>("SELECT assistant_run_id,handler FROM support_conversations WHERE id=$1", [id])).rows[0];
      if (row.assistant_run_id === null && row.handler === "operator") { handedOff = true; break; }
    }
    release.resolve();
    await first;
    expect(handedOff).toBe(true);
    expect(turns).toBe(1);
    expect((await store.list({ status: "open", limit: 10 }, { available: true, handoff: true })).conversations[0]).toMatchObject({ id, handler: "operator", unread: true });
    expect((await store.customerConversation(c.id)).conversation!.messages.filter((m) => m.authorType === "assistant")).toHaveLength(0);
  });

  test("the waiting tab gets an explicit exhaustion outcome in each assistant mode", async () => {
    for (const mode of ["assistant", "hybrid"] as const) {
      const c = await customer(mode);
      const cap = { available: true, handoff: mode === "hybrid" };
      const seeded = await store.sendCustomer(c.id, session(mode), send("initial_01"), cap);
      const id = seeded.response.conversation!.id;
      await sql.query(`INSERT INTO support_assistant_runs (id,conversation_id,message_id,started_at,replay)
        SELECT gen_random_uuid(),$1::uuid,$2::uuid,clock_timestamp()-interval '15 minutes',false FROM generate_series(1,39)`, [id, seeded.messageId]);
      const started = deferred(), release = deferred(), poll = manualPoll();
      let turns = 0;
      const handler = createCustomerSupportChatHandler({
        authorize: async () => session(mode), store: () => store, resolve: async () => c, wait: poll.wait,
        assistant: () => ({ effective: async () => ({ settings: { mode, model: "test/model", instructions: "" }, key: "test-key", available: true, capability: cap }) }) as SupportAssistantStore,
        model: () => new MockLanguageModelV3({ doStream: async () => { turns++; started.resolve(); await release.promise; return { stream: streamReply("first reply") }; } }),
      });
      const first = (await chatRequest(handler, crypto.randomUUID())).text();
      await started.promise;
      const second = (await chatRequest(handler, crypto.randomUUID())).text();
      await poll.until(1);
      release.resolve();
      await first;
      poll.wake();
      const outcome = await second;
      expect(turns).toBe(1);
      if (mode === "hybrid") expect(outcome).toContain('"handler":"operator"');
      else {
        const retryAfter = Number(outcome.match(/"limited":\{"retryAfter":(\d+)\}/)?.[1]);
        expect(retryAfter).toBeGreaterThan(85_000);
        expect(retryAfter).toBeLessThan(86_400);
      }
      expect(outcome).toContain('"type":"data-support"');
      expect((await sql.query<{ count: string }>("SELECT count(*)::text AS count FROM support_assistant_runs WHERE conversation_id=$1", [id])).rows[0].count).toBe("40");
    }
  });

  test("disabling the assistant while another tab waits prevents a stale-key model call", async () => {
    const c = await customer();
    const started = deferred(), release = deferred(), poll = manualPoll();
    let enabled = true, turns = 0, effectiveReads = 0;
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => {
      turns++; started.resolve(); await release.promise; return { stream: streamReply("first reply") };
    } }), { wait: poll.wait, effective: async () => {
      effectiveReads++;
      return { settings: { mode: enabled ? "assistant" : "operator", model: enabled ? "test/model" : "", instructions: "" }, key: enabled ? "test-key" : null, available: enabled, capability: { available: enabled, handoff: false } };
    } });
    const first = (await chatRequest(handler, crypto.randomUUID())).text();
    await started.promise;
    const second = (await chatRequest(handler, crypto.randomUUID())).text();
    await poll.until(1);
    enabled = false;
    poll.wake();
    const outcome = await second;
    expect(outcome).toContain('"handler":"operator"');
    expect(outcome).not.toContain("first reply");
    release.resolve();
    await first;
    expect(turns).toBe(1);
    expect(effectiveReads).toBeGreaterThanOrEqual(5);
    expect((await store.handlerForCustomer(c.id, { available: true, handoff: false }))?.handler).toBe("operator");
  });

  test("an unreadable configuration before the send queues the message under the operator even when the stream is cancelled", async () => {
    const c = await customer();
    const served = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => ({ stream: streamReply("answer") }) }));
    const firstId = crypto.randomUUID();
    await (await chatRequest(served, firstId)).text();
    const id = (await store.customerConversation(c.id)).conversation!.id;
    const cap = { available: true, handoff: true };
    expect((await store.operatorConversation(id, undefined, cap))?.conversation.handler).toBe("assistant");
    const controller = new AbortController();
    controller.abort();
    let models = 0;
    const unreadable = chatHandler(c, () => { models += 1; return new MockLanguageModelV3({ doStream: async () => ({ stream: streamReply("unreachable") }) }); }, { effective: async () => { throw new Error("invalid support assistant settings"); } });
    const body = await (await chatRequest(unreadable, crypto.randomUUID(), controller.signal)).text();
    expect(body).toContain('"handler":"operator"');
    expect(models).toBe(0);
    expect((await store.operatorConversation(id, undefined, cap))?.conversation.handler).toBe("operator");
    expect((await store.list({ status: "open", limit: 10 }, cap)).conversations[0]).toMatchObject({ id, handler: "operator", unread: true });
    expect((await store.operatorSummary(cap)).unreadConversations).toBe(1);
  });
  test("an assistant that cannot serve a pending message hands it to the operator and keeps it queued", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const seeded = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = seeded.response.conversation!.id;
    expect((await store.operatorSummary(cap)).unreadConversations).toBe(0);
    expect((await store.operatorSummary({ available: false, handoff: false })).unreadConversations).toBe(1);
    expect(await store.claimAssistantRun(id, seeded.messageId, { available: false, handoff: false })).toEqual({ status: "unavailable" });
    expect(await store.handoffCustomer(c.id, true)).toBe("ok");
    expect((await store.operatorConversation(id, undefined, cap))?.conversation.handler).toBe("operator");
    expect((await store.operatorSummary(cap)).unreadConversations).toBe(1);
    expect(await store.claimAssistantRun(id, seeded.messageId, cap)).toEqual({ status: "unavailable" });
    await store.sendOperator(id, actor, reply("reply_001", seeded.messageId));
    expect(await store.claimAssistantRun(id, seeded.messageId, { available: false, handoff: false })).toEqual({ status: "skipped" });
    expect((await store.operatorSummary(cap)).unreadConversations).toBe(0);
  });

  test("pending-only cancellation takeover skips answered or superseded messages", async () => {
    const c = await customer();
    const cap = { available: true, handoff: true };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const second = await store.sendCustomer(c.id, session(), send("message_02"), cap);
    expect(await store.handoffCustomer(c.id, true, true, first.messageId)).toBe("ok");
    expect((await store.operatorConversation(id, undefined, cap))?.conversation.handler).toBe("assistant");
    const run = await claimRun(id, second.messageId, cap);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "answered", run)).toBe("sent");
    await store.releaseAssistantRun(id, run);
    expect(await store.handoffCustomer(c.id, true, true, second.messageId)).toBe("ok");
    expect((await store.operatorConversation(id, undefined, cap))?.conversation.handler).toBe("assistant");
    const pending = await store.sendCustomer(c.id, session(), send("message_03"), cap);
    expect(await store.handoffCustomer(c.id, true, true, pending.messageId)).toBe("ok");
    expect((await store.operatorConversation(id, undefined, cap))?.conversation.handler).toBe("operator");
    expect((await store.operatorSummary(cap)).unreadConversations).toBe(1);
  });

  test("an operator-answered older message is never re-claimed on hand-back", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const earlier = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = earlier.response.conversation!.id;
    await store.sendOperator(id, actor, reply("reply_001", earlier.messageId));
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    let turns = 0;
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => { turns++; return { stream: streamReply("new reply") }; } }));
    const latest = crypto.randomUUID();
    expect(await (await chatRequest(handler, latest)).text()).toContain("new reply");
    expect(turns).toBe(1);
    const runs = (await sql.query<{ message_id: string }>("SELECT message_id FROM support_assistant_runs WHERE conversation_id=$1", [id])).rows;
    expect(runs.map((run) => run.message_id)).toEqual([await observedId(id, latest)]);
    expect(await store.claimAssistantRun(id, earlier.messageId, cap)).toEqual({ status: "skipped" });
  });

  test("operator reply to latest message blocks hand-back replay without calling the model", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const clientId = crypto.randomUUID();
    const first = await store.sendCustomer(c.id, session(), send(clientId), cap);
    const id = first.response.conversation!.id;
    await store.sendOperator(id, actor, reply("reply_001", first.messageId));
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    let turns = 0;
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => { turns++; return { stream: streamReply("unexpected") }; } }));
    const replay = await chatRequest(handler, clientId);
    const body = await replay.text();
    expect(body).toContain('"type":"data-support"');
    expect(body).not.toContain("unexpected");
    expect(turns).toBe(0);
    expect(await store.claimAssistantRun(id, first.messageId, cap)).toEqual({ status: "skipped" });
    expect((await sql.query<{ count: string }>("SELECT count(*)::text AS count FROM support_assistant_runs WHERE conversation_id=$1", [id])).rows[0].count).toBe("0");
  });

  test("same-message replay waits for healthy holder, then returns metadata without another model call", async () => {
    const c = await customer();
    const started = deferred(), release = deferred(), poll = manualPoll();
    let turns = 0;
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => { turns++; started.resolve(); await release.promise; return { stream: streamReply("answer") }; } }), { wait: poll.wait });
    const clientId = crypto.randomUUID();
    const first = (await chatRequest(handler, clientId)).text();
    await started.promise;
    const replay = (await chatRequest(handler, clientId)).text();
    await poll.until(1);
    release.resolve();
    expect(await first).toContain("answer");
    poll.wake();
    const outcome = await replay;
    expect(outcome).toContain('"type":"data-support"');
    expect(outcome).not.toContain('"type":"error"');
    expect(outcome).not.toContain('"type":"text-delta"');
    expect(turns).toBe(1);
  });
  test("dead same-message claim returns a retryable error at 35 seconds without starting another run", async () => {
    const c = await customer();
    const clientId = crypto.randomUUID();
    const first = await store.sendCustomer(c.id, session(), send(clientId), { available: true, handoff: false });
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId);
    let now = 0, turns = 0, waits = 0;
    const handler = chatHandler(c, () => { turns++; return new MockLanguageModelV3({ doStream: async () => ({ stream: streamReply("wrong") }) }); }, { now: () => now, wait: async (ms) => { now += ms; waits++; } });
    const outcome = await (await chatRequest(handler, clientId)).text();
    expect(outcome).toContain('"type":"error"');
    expect(outcome).toContain("Please try again.");
    expect(waits).toBe(70);
    expect(turns).toBe(0);
    expect((await sql.query<{ count: string }>("SELECT count(*)::text AS count FROM support_assistant_runs WHERE conversation_id=$1", [id])).rows[0].count).toBe("1");
    await store.releaseAssistantRun(id, runId);
    expect(await store.claimAssistantRun(id, first.messageId, { available: true, handoff: false }, true)).toEqual({ status: "pending" });
  });

  test("same-message replay errors if the holder releases without a reply", async () => {
    const c = await customer();
    const clientId = crypto.randomUUID(), poll = manualPoll();
    const sent = await store.sendCustomer(c.id, session(), send(clientId), { available: true, handoff: false });
    const runId = await claimRun(sent.response.conversation!.id, sent.messageId);
    let turns = 0;
    const handler = chatHandler(c, () => { turns++; return new MockLanguageModelV3({ doStream: async () => ({ stream: streamReply("unexpected") }) }); }, { wait: poll.wait });
    const replay = (await chatRequest(handler, clientId)).text();
    await poll.until(1);
    await store.releaseAssistantRun(sent.response.conversation!.id, runId);
    poll.wake();
    expect(await replay).toContain('"type":"error"');
    expect(turns).toBe(0);
    expect((await store.customerConversation(c.id, undefined, { available: true, handoff: false })).conversation!.messages).toHaveLength(1);
  });
  test("superseded same-message replay ends as metadata after recheck", async () => {
    const c = await customer();
    const clientId = crypto.randomUUID(), poll = manualPoll();
    const sent = await store.sendCustomer(c.id, session(), send(clientId), { available: true, handoff: false });
    const runId = await claimRun(sent.response.conversation!.id, sent.messageId);
    let turns = 0;
    const handler = chatHandler(c, () => { turns++; return new MockLanguageModelV3({ doStream: async () => ({ stream: streamReply("unexpected") }) }); }, { wait: poll.wait });
    const replay = (await chatRequest(handler, clientId)).text();
    await poll.until(1);
    await store.sendCustomer(c.id, session(), send(crypto.randomUUID()), { available: true, handoff: false });
    poll.wake();
    const outcome = await replay;
    expect(outcome).toContain('"type":"data-support"');
    expect(outcome).not.toContain('"type":"error"');
    expect(turns).toBe(0);
    await store.releaseAssistantRun(sent.response.conversation!.id, runId);
  });

  test("a waiting request times out with a retryable error instead of an empty stream", async () => {
    const c = await customer();
    const started = deferred(), release = deferred();
    let now = 0, waits = 0, turns = 0;
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => {
      turns++; started.resolve(); await release.promise; return { stream: streamReply("first reply") };
    } }), { now: () => now, wait: async (ms) => { now += ms; waits++; } });
    const first = (await chatRequest(handler, crypto.randomUUID())).text();
    await started.promise;
    const outcome = await (await chatRequest(handler, crypto.randomUUID())).text();
    expect(outcome).toContain("Please try again.");
    expect(outcome).toContain('"type":"error"');
    expect(outcome).toContain('"type":"data-support"');
    expect(waits).toBe(70);
    expect(turns).toBe(1);
    release.resolve();
    await first;
  });

  test("assistant finish under row lock discards output after operator takeover, and read pages exclude it", async () => {
    const c = await customer();
    const available = { available: true, handoff: true };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), available);
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId, available);
    const modelFinished = crypto.randomUUID();
    await store.setHandler(id, "operator");
    expect(await store.saveAssistant(id, modelFinished, "unused reply", runId)).toBe("discarded");
    await store.releaseAssistantRun(id, runId);
    expect((await store.customerConversation(c.id, undefined, available)).conversation?.messages).toHaveLength(1);
    expect((await store.operatorConversation(id, undefined, available))?.conversation.messages).toHaveLength(1);
    expect(await store.setHandler(id, "assistant")).toBe("conflict");
    await store.sendOperator(id, actor, reply("reply_002", first.messageId));
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    expect(await store.claimAssistantRun(id, first.messageId, available)).toEqual({ status: "skipped" });
    expect(await store.saveAssistant(id, crypto.randomUUID(), "good reply")).toBe("sent");
    expect((await store.customerConversation(c.id, undefined, available)).conversation?.messages.at(-1)?.body).toBe("good reply");
    expect((await store.customerSummary(c.id)).unreadCount).toBe(2);
  });

  test("an operator reply that hands back cannot resurrect the superseded assistant run", async () => {
    const c = await customer();
    const available = { available: true, handoff: true };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), available);
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId, available);
    expect(await store.sendOperator(id, actor, reply("reply_001", first.messageId))).toMatchObject({ outcome: "ok", replayed: false });
    expect(await assistantRunId(id)).toBeNull();
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    const lateReply = crypto.randomUUID();
    expect(await store.saveAssistant(id, lateReply, "late reply", runId)).toBe("discarded");
    expect((await sql.query<{ status: string }>("SELECT status FROM support_messages WHERE id=$1", [lateReply])).rows).toHaveLength(0);
    await store.releaseAssistantRun(id, runId);
    const latest = (await store.customerConversation(c.id, undefined, available)).conversation!;
    expect(latest.handler).toBe("assistant");
    expect(latest.messages.map((m) => m.body)).toEqual(["body initial_01", "reply reply_001"]);
    expect(latest.unreadCount).toBe(1);
  });

  test("explicit take-over and customer handoff clear the active assistant claim", async () => {
    const available = { available: true, handoff: true };
    const c = await customer();
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), available);
    const id = first.response.conversation!.id;
    const claimed = await claimRun(id, first.messageId, available);
    expect(await store.setHandler(id, "operator")).toBe("ok");
    expect(await assistantRunId(id)).toBeNull();
    expect(await store.saveAssistant(id, crypto.randomUUID(), "late reply", claimed)).toBe("discarded");

    const other = await customer("bob");
    const handoff = await store.sendCustomer(other.id, session("bob"), send("initial_01"), available);
    const handoffId = handoff.response.conversation!.id;
    const handoffRun = await claimRun(handoffId, handoff.messageId, available);
    expect(await store.handoffCustomer(other.id, true)).toBe("ok");
    expect(await assistantRunId(handoffId)).toBeNull();
    expect(await store.saveAssistant(handoffId, crypto.randomUUID(), "late reply", handoffRun)).toBe("discarded");
  });

  test("hand back during streaming discards the superseded model reply", async () => {
    const c = await customer();
    const available = { available: true, handoff: true };
    const started = deferred(), release = deferred();
    const handler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => { started.resolve(); await release.promise; return { stream: streamReply("late answer") }; } }), { handoff: true });
    const clientMessageId = crypto.randomUUID();
    const pending = (await chatRequest(handler, clientMessageId)).text();
    await started.promise;
    const id = (await store.customerConversation(c.id)).conversation!.id;
    const messageId = await observedId(id, clientMessageId);
    await store.sendOperator(id, actor, reply("reply_01", messageId));
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    release.resolve();
    const body = await pending;
    expect(body).toContain('"handler":"assistant"');
    expect(body).toContain('"discardedMessageId"');
    const latest = (await store.customerConversation(c.id, undefined, available)).conversation!;
    expect(latest.messages.map((m) => m.authorType)).toEqual(["customer", "operator"]);
  });

  test("a stale pending-only handoff leaves the handler and active claim alone", async () => {
    const c = await customer();
    const available = { available: true, handoff: true };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), available);
    const id = first.response.conversation!.id;
    const second = await store.sendCustomer(c.id, session(), send("message_02"), available);
    const runId = await claimRun(id, second.messageId, available);
    expect(await store.handoffCustomer(c.id, true, true, first.messageId)).toBe("ok");
    expect((await sql.query<{ handler: string; assistant_run_id: string | null }>("SELECT handler,assistant_run_id FROM support_conversations WHERE id=$1", [id])).rows[0]).toMatchObject({ handler: "assistant", assistant_run_id: runId });
    expect(await store.saveAssistant(id, crypto.randomUUID(), "answer", runId)).toBe("sent");
  });

  test("an operator reply replay does not invalidate a newer assistant claim", async () => {
    const c = await customer();
    const available = { available: true, handoff: true };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), available);
    const id = first.response.conversation!.id;
    await store.sendOperator(id, actor, reply("reply_001", first.messageId));
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    const second = await store.sendCustomer(c.id, session(), send("message_02"), available);
    const runId = await claimRun(id, second.messageId, available);
    expect(await store.sendOperator(id, actor, reply("reply_001", first.messageId))).toMatchObject({ outcome: "ok", replayed: true });
    expect(await assistantRunId(id)).toBe(runId);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "answer", runId)).toBe("sent");
  });

  test("an unknown run cannot save and a superseded release cannot clear a newer claim", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "unknown run", crypto.randomUUID())).toBe("discarded");
    await store.releaseAssistantRun(id, crypto.randomUUID());
    expect(await assistantRunId(id)).toBe(runId);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "answer", runId)).toBe("sent");
  });

  test("resolving during a claimed stream fences the late assistant reply", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId);
    expect(await store.setStatus(id, actor, "resolved", first.messageId)).toBe("ok");
    const replyId = crypto.randomUUID();
    expect(await store.saveAssistant(id, replyId, "late reply", runId)).toBe("discarded");
    await store.releaseAssistantRun(id, runId);
    expect((await store.customerConversation(c.id, undefined, cap)).conversation?.messages.map((m) => m.id)).toEqual([first.messageId]);
    expect((await sql.query<{ status: string }>("SELECT status FROM support_messages WHERE id=$1", [replyId])).rows).toHaveLength(0);
  });
  test("resolution invalidates A's claim before B reopens and B can answer independently", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const first = await store.sendCustomer(c.id, session(), send("question_a"), cap);
    const id = first.response.conversation!.id;
    const oldRun = await claimRun(id, first.messageId);
    expect(await store.setStatus(id, actor, "resolved", first.messageId)).toBe("ok");
    expect((await sql.query<{ assistant_run_id: string | null }>("SELECT assistant_run_id FROM support_conversations WHERE id=$1", [id])).rows[0].assistant_run_id).toBeNull();
    const reopened = await store.sendCustomer(c.id, session(), send("question_b"), cap);
    expect(reopened.response.conversation).toMatchObject({ status: "open", handler: "assistant" });
    expect(await store.claimAssistantRun(id, reopened.messageId, cap, true)).toEqual({ status: "pending" });
    const newRun = await claimRun(id, reopened.messageId);
    const staleReply = crypto.randomUUID();
    expect(await store.saveAssistant(id, staleReply, "answer A", oldRun)).toBe("discarded");
    await store.releaseAssistantRun(id, oldRun);
    expect((await sql.query<{ assistant_run_id: string | null }>("SELECT assistant_run_id FROM support_conversations WHERE id=$1", [id])).rows[0].assistant_run_id).toBe(newRun);
    const freshReply = crypto.randomUUID();
    expect(await store.saveAssistant(id, freshReply, "answer B", newRun)).toBe("sent");
    await store.releaseAssistantRun(id, newRun);
    expect((await store.customerConversation(c.id, undefined, cap)).conversation!.messages.map((m) => m.id)).toEqual([first.messageId, reopened.messageId, freshReply]);
    expect((await sql.query<{ status: string }>("SELECT status FROM support_messages WHERE id=$1", [staleReply])).rows).toHaveLength(0);
  });
  for (const outcome of ["failure", "tool", "save-budget", "claim-budget"] as const) {
    test(`resolve/reopen leaves B's claimed run intact after A's late ${outcome}`, async () => {
      const c = await customer();
      const cap = { available: true, handoff: true };
      const started = deferred(), release = deferred(), saving = deferred(), releaseSave = deferred();
      const bStarted = deferred(), releaseB = deferred();
      let aCalls = 0, bCalls = 0, toolResult = "";
      const aStore = outcome === "claim-budget"
        ? Object.assign(Object.create(store) as SupportStore, { claimAssistantRun: async (...args: Parameters<SupportStore["claimAssistantRun"]>) => {
          const claimed = await store.claimAssistantRun(...args);
          if (claimed.status !== "claimed") throw new Error(`Expected A claim; got ${claimed.status}`);
          await store.releaseAssistantRun(args[0], claimed.runId);
          started.resolve();
          await release.promise;
          return { status: "limited" as const, retryAfter: 86400 };
        } })
        : outcome === "save-budget"
          ? Object.assign(Object.create(store) as SupportStore, { saveAssistant: async () => { saving.resolve(); await releaseSave.promise; return "budget" as const; } })
          : store;
      const aHandler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async (params) => {
        aCalls++;
        if (aCalls === 1) { started.resolve(); await release.promise; }
        if (outcome === "failure") throw new Error("provider failed");
        if (outcome === "tool" && aCalls === 1) return { stream: simulateReadableStream({ chunks: [
          { type: "tool-call" as const, toolCallId: "late-handoff", toolName: "handoff_to_operator", input: "{}" },
          { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
        ] }) };
        if (outcome === "tool") toolResult = JSON.stringify(params.prompt);
        return { stream: streamReply("stale A") };
      } }), { handoff: true, storeOverride: aStore });
      const bHandler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => {
        bCalls++; bStarted.resolve(); await releaseB.promise;
        return { stream: streamReply("answer B") };
      } }), { handoff: true });
      const aId = crypto.randomUUID(), bId = crypto.randomUUID();
      const a = (await chatRequest(aHandler, aId)).text();
      await started.promise;
      const id = (await store.customerConversation(c.id)).conversation!.id;
      expect(await store.setStatus(id, actor, "resolved", await observedId(id, aId))).toBe("ok");
      const b = (await chatRequest(bHandler, bId)).text();
      await bStarted.promise;
      const bRun = (await sql.query<{ assistant_run_id: string | null }>("SELECT assistant_run_id FROM support_conversations WHERE id=$1", [id])).rows[0].assistant_run_id;
      expect(bRun).not.toBeNull();
      try {
        release.resolve();
        if (outcome === "save-budget") { await saving.promise; releaseSave.resolve(); }
        const stale = await a;
        expect(stale).not.toContain('"handler":"operator"');
        if (outcome === "tool") expect(toolResult).toContain('"handler":"assistant"');
        const row = (await sql.query<{ handler: string; handed_off_at: Date | null; assistant_run_id: string | null }>("SELECT handler,handed_off_at,assistant_run_id FROM support_conversations WHERE id=$1", [id])).rows[0];
        expect(row).toMatchObject({ handler: "assistant", handed_off_at: null, assistant_run_id: bRun });
      } finally {
        release.resolve(); releaseSave.resolve(); releaseB.resolve();
        await Promise.allSettled([a, b]);
      }
      expect(await b).toContain("answer B");
      const latest = (await store.customerConversation(c.id, undefined, cap)).conversation!;
      expect(latest.handler).toBe("assistant");
      expect(latest.messages.filter((m) => m.authorType === "assistant").map((m) => m.body)).toEqual(["answer B"]);
      expect(aCalls).toBe(outcome === "claim-budget" ? 0 : outcome === "tool" ? 2 : 1);
      expect(bCalls).toBe(1);
    });
  }
  test("model handoff from a superseded run cannot take over a newer unanswered message", async () => {
    const c = await customer();
    const cap = { available: true, handoff: true };
    const started = deferred(), release = deferred();
    let calls = 0, toolResult = "";
    const aId = crypto.randomUUID(), bId = crypto.randomUUID();
    const aHandler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async (params) => {
      if (++calls === 1) {
        started.resolve(); await release.promise;
        return { stream: simulateReadableStream({ chunks: [
          { type: "tool-call" as const, toolCallId: "superseded-handoff", toolName: "handoff_to_operator", input: "{}" },
          { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
        ] }) };
      }
      toolResult = JSON.stringify(params.prompt);
      return { stream: streamReply("stale A") };
    } }), { handoff: true });
    const a = (await chatRequest(aHandler, aId)).text();
    await started.promise;
    await store.sendCustomer(c.id, session(), send(bId), cap);
    release.resolve();
    expect(await a).not.toContain('"handler":"operator"');
    expect(toolResult).toContain('"handler":"assistant"');
    expect((await store.customerConversation(c.id, undefined, cap)).conversation?.handler).toBe("assistant");
    const bHandler = chatHandler(c, () => new MockLanguageModelV3({ doStream: async () => ({ stream: streamReply("answer B") }) }), { handoff: true });
    expect(await (await chatRequest(bHandler, bId)).text()).toContain("answer B");
    expect((await store.customerConversation(c.id, undefined, cap)).conversation!.messages.filter((m) => m.authorType === "assistant").map((m) => m.body)).toEqual(["stale A", "answer B"]);
  });
  test("resolve and save race under the conversation lock; resolved state has no later sent assistant reply", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId);
    const gate = deferred(), entered = deferred();
    const resolving = sql.transaction(async (tx) => {
      await tx.query("SELECT id FROM support_conversations WHERE id=$1 FOR UPDATE", [id]);
      entered.resolve();
      await gate.promise;
      await tx.query("UPDATE support_conversations SET status='resolved',resolved_at=clock_timestamp() WHERE id=$1", [id]);
    });
    await entered.promise;
    const replyId = crypto.randomUUID();
    const saving = store.saveAssistant(id, replyId, "late reply", runId);
    gate.resolve();
    await resolving;
    expect(await saving).toBe("discarded");
    expect((await store.customerConversation(c.id, undefined, cap)).conversation?.messages).toHaveLength(1);
  });

  test("hand back is refused while the customer awaits a reply, and allowed once answered", async () => {
    const available = { available: true, handoff: true };
    const c = await customer();
    const created = await store.sendCustomer(c.id, session(), send("initial_01"), available);
    const id = created.response.conversation!.id;
    expect(await store.setHandler(id, "operator")).toBe("ok");
    expect(await store.setHandler(id, "assistant")).toBe("conflict");
    await store.sendOperator(id, actor, reply("reply_001", created.messageId));
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    expect((await store.customerConversation(c.id, undefined, available)).conversation?.handler).toBe("assistant");
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    expect(await store.setHandler(id, "operator")).toBe("ok");
    expect(await store.setHandler(id, "operator")).toBe("ok");
  });

  test("hand back waits for the latest customer after an older assistant reply lands", async () => {
    const cap = { available: true, handoff: true };
    const c = await customer();
    const first = await store.sendCustomer(c.id, session(), send("question_a"), cap);
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId, cap);
    const second = await store.sendCustomer(c.id, session(), send("question_b"), cap);
    expect(await store.saveAssistant(id, crypto.randomUUID(), "answer A", runId)).toBe("sent");
    await store.releaseAssistantRun(id, runId);
    expect(await store.setHandler(id, "operator")).toBe("ok");
    expect(await store.setHandler(id, "assistant")).toBe("conflict");
    await store.sendOperator(id, actor, reply("answer_b", second.messageId));
    expect(await store.setHandler(id, "assistant")).toBe("ok");
    const third = await store.sendCustomer(c.id, session(), send("question_c"), cap);
    expect(third.response.conversation?.handler).toBe("assistant");
    expect(await store.setHandler(id, "assistant")).toBe("ok");
  });

  test("claimed attempts enforce both the 40-per-day and 10-replay-per-ten-minute limits", async () => {
    const c = await customer();
    const cap = { available: true, handoff: false };
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    const runId = await claimRun(id, first.messageId);
    await store.releaseAssistantRun(id, runId);
    for (let n = 1; n < 40; n++) {
      if (n % 10 === 1) await sql.query("UPDATE support_assistant_runs SET started_at=clock_timestamp()-interval '11 minutes' WHERE conversation_id=$1 AND replay", [id]);
      const retryRun = await claimRun(id, first.messageId);
      await store.releaseAssistantRun(id, retryRun);
    }
    const dayLimit = await store.claimAssistantRun(id, first.messageId, cap);
    expect(dayLimit.status).toBe("limited");
    if (dayLimit.status === "limited") expect(dayLimit.retryAfter).toBeGreaterThan(0);
    expect((await sql.query<{ count: string }>("SELECT count(*)::text AS count FROM support_assistant_runs WHERE conversation_id=$1", [id])).rows[0].count).toBe("40");
    await sql.query("UPDATE support_assistant_runs SET started_at=clock_timestamp()-interval '25 hours' WHERE conversation_id=$1", [id]);
    const recovered = await claimRun(id, first.messageId);
    await store.releaseAssistantRun(id, recovered);
    for (let n = 0; n < 9; n++) {
      const retryRun = await claimRun(id, first.messageId);
      await store.releaseAssistantRun(id, retryRun);
    }
    const replayLimit = await store.claimAssistantRun(id, first.messageId, cap);
    expect(replayLimit.status).toBe("limited");
    if (replayLimit.status === "limited") expect(replayLimit.retryAfter).toBeGreaterThan(0);
    await sql.query("DELETE FROM customers WHERE id=$1", [c.id]);
    expect((await sql.query("SELECT * FROM support_assistant_runs")).rows).toHaveLength(0);
  });

  test("assistant retryAfter follows the oldest run in each rolling window", async () => {
    const cap = { available: true, handoff: false };
    const c = await customer();
    const first = await store.sendCustomer(c.id, session(), send("initial_01"), cap);
    const id = first.response.conversation!.id;
    await sql.query(`INSERT INTO support_assistant_runs (id,conversation_id,message_id,started_at,replay)
      SELECT gen_random_uuid(),$1::uuid,$2::uuid,
        CASE WHEN n=1 THEN clock_timestamp()-interval '23 hours 59 minutes 50 seconds' ELSE clock_timestamp()-interval '2 minutes' END,false
      FROM generate_series(1,40) n`, [id, first.messageId]);
    const day = await store.claimAssistantRun(id, first.messageId, cap);
    expect(day.status).toBe("limited");
    if (day.status === "limited") expect(day.retryAfter).toBeGreaterThanOrEqual(1);
    if (day.status === "limited") expect(day.retryAfter).toBeLessThanOrEqual(10);
    await sql.query("DELETE FROM support_assistant_runs WHERE conversation_id=$1", [id]);
    await sql.query(`INSERT INTO support_assistant_runs (id,conversation_id,message_id,started_at,replay)
      SELECT gen_random_uuid(),$1::uuid,$2::uuid,
        CASE WHEN n=1 THEN clock_timestamp()-interval '9 minutes 50 seconds' ELSE clock_timestamp()-interval '2 minutes' END,true
      FROM generate_series(1,10) n`, [id, first.messageId]);
    const replay = await store.claimAssistantRun(id, first.messageId, cap);
    expect(replay.status).toBe("limited");
    if (replay.status === "limited") expect(replay.retryAfter).toBeGreaterThanOrEqual(1);
    if (replay.status === "limited") expect(replay.retryAfter).toBeLessThanOrEqual(10);
  });

  test("credential is sealed, audited without key material, and unavailable with missing keyring", async () => {
    const key = "sensitive-key-not-public-9876";
    const env = { HOME_SECRET_KEY_VERSION: "1", HOME_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url") };
    const assistant = new SupportAssistantStore(sql, env);
    const absent = new SupportAssistantStore(sql, {});
    expect(await absent.put(key, actor)).toBeNull();
    expect((await assistant.credential()).configured).toBe(false);
    const result = await assistant.put(key, actor);
    expect(result).toMatchObject({ configured: true, available: true, last4: "9876" });
    await sql.query("INSERT INTO operator_settings (domain,schema_version,value,revision,updated_at,updated_by) VALUES ('support-assistant',1,$1::jsonb,1,now(),$2)", [JSON.stringify({ mode: "hybrid", model: "test/model", instructions: "" }), actor]);
    expect(await assistant.capability()).toEqual({ available: true, handoff: true });
    expect((await assistant.effective()).key).toBe(key);
    const stored = (await sql.query<{ envelope: string }>("SELECT envelope FROM support_assistant_credentials WHERE id='default'")).rows[0].envelope;
    expect(stored).not.toContain(key);
    expect((await absent.credential()).available).toBe(false);
    const wrong = new SupportAssistantStore(sql, { HOME_SECRET_KEY_VERSION: "1", HOME_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64url") });
    expect((await wrong.credential()).available).toBe(false);
    expect(await wrong.capability()).toEqual({ available: false, handoff: false });
    expect(await absent.capability()).toEqual({ available: false, handoff: false });
    expect((await absent.effective()).available).toBe(false);
    expect((await sql.query<{ before: unknown; after: unknown }>("SELECT before,after FROM admin_audit_log WHERE action='support.credential.update'")).rows.every((row) => !JSON.stringify(row).includes(key))).toBe(true);
    expect((await assistant.delete(actor)).configured).toBe(false);
    expect(await assistant.capability()).toEqual({ available: false, handoff: false });
    await sql.query("DELETE FROM operator_settings WHERE domain='support-assistant'");
    expect((await sql.query<{ before: unknown; after: unknown }>("SELECT before,after FROM admin_audit_log WHERE action='support.credential.delete'")).rows.every((row) => !JSON.stringify(row).includes(key))).toBe(true);
    const feed = await new AdminAuditLog(sql).list();
    const credentialEntries = feed.entries.filter((entry) => entry.action === "support.credential.update" || entry.action === "support.credential.delete");
    expect(credentialEntries.map((entry) => entry.action)).toEqual(["support.credential.delete", "support.credential.update"]);
    expect(credentialEntries[0]).toMatchObject({ action: "support.credential.delete", target: { kind: "settings", id: "support-assistant-key" }, before: { last4: "9876" }, after: { last4: null } });
    expect(parseAuditListResponse({ version: 1, entries: feed.entries, nextCursor: feed.nextCursor })).not.toBeNull();
  });


  test("an operator reply that waits on the actor lock still takes the newest timestamp", async () => {
    const { id } = await conversation();
    const first = (await store.operatorConversation(id))!.conversation.messages.at(-1)!.id;
    const competing = crypto.randomUUID();
    let pending: ReturnType<SupportStore["sendOperator"]> | undefined;
    let xactStart: Date | null = null;
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      await tx.unsafe(`SELECT pg_advisory_xact_lock(hashtext('${actor}'))`);
      pending = store.sendOperator(id, actor, reply("reply_002", first));
      xactStart = await waitForBlockedWriter("%advisory%");
      await tx.unsafe(`INSERT INTO support_messages (id,conversation_id,author_type,author_operator,body,client_message_id,created_at) VALUES ('${competing}','${id}','operator','${actor}','competing','reply_000',clock_timestamp())`);
      await tx.unsafe(`UPDATE support_conversations SET last_message_at=date_trunc('milliseconds',clock_timestamp()),last_operator_message_at=clock_timestamp() WHERE id='${id}'`);
    });
    const sent = await pending!;
    expect(sent.outcome).toBe("ok");
    if (sent.outcome !== "ok") throw new Error(`Expected operator reply; got ${sent.outcome}`);
    expect(xactStart).not.toBeNull();
    expect(sent.response).not.toBeNull();
    const waited = await observedId(id, "reply_002");
    const waitedAt = (await sql.query<{ created_at: Date }>("SELECT created_at FROM support_messages WHERE id=$1", [waited])).rows[0].created_at;
    expect(waitedAt.getTime()).toBeGreaterThan(xactStart!.getTime());
    const markers = (await sql.query<{ last_message_at: Date; last_operator_message_at: Date }>("SELECT last_message_at,last_operator_message_at FROM support_conversations WHERE id=$1", [id])).rows[0];
    expect(markers.last_operator_message_at.getTime()).toBe(waitedAt.getTime());
    expect(markers.last_message_at.getTime()).toBe(waitedAt.getTime());
    const ordered = (await store.operatorConversation(id))!.conversation.messages.filter((message) => message.status === "sent").map((message) => message.id);
    expect(ordered).toEqual([first, competing, waited]);
  });
});

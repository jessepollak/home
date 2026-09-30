import "server-only";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { SUPPORT_CONTRACT_VERSION, decodeSupportCursor, type CustomerSupportResponse, type CustomerSupportSendRequest, type CustomerSupportSummary, type OperatorSupportConversationResponse, type OperatorSupportListQuery, type OperatorSupportListResponse, type OperatorSupportReplyRequest, type OperatorSupportSummary, type SupportMessage, type SupportContextRef, type SupportHandler, type SupportAssistantCapability } from "@/shared/support/contract";
import { actionOwnerKey, type ActionOutcome } from "@/server/actions/store";
import { deriveActionStatus, type ActionReceiptState } from "@/server/actions/status";
import type { SqlExecutor } from "@/server/db/sql";
import { moneyActionOwner } from "@/server/money-actions/session";

type ConversationRow = { id: string; customer_id: string; status: "open" | "resolved"; handler: SupportHandler; handed_off_at: Date | null; assistant_run_id: string | null; assistant_run_expires_at: Date | null; assistant_run_message_id: string | null; created_at: Date; resolved_at: Date | null; customer_read_at: Date | null; operator_read_at: Date | null; last_customer_message_at: Date | null };
type MessageRow = { id: string; author_type: SupportMessage["authorType"]; author_operator: `0x${string}` | null; status: SupportMessage["status"]; body: string; client_message_id: string; created_at: Date };
type ContextRow = { kind: SupportContextRef["kind"]; ref_id: string; summary: string | null };
type ContextSummaryRow = ContextRow & {
  action_kind: string | null;
  action_outcome: ActionOutcome | null;
  action_confirmed_at: Date | null;
  action_created_at: Date | null;
  action_handle_recorded_at: Date | null;
  action_transaction_hash: string | null;
  action_receipt_transaction_hash: string | null;
  action_receipt_block_hash: string | null;
  action_receipt_block_number: string | number | null;
  action_receipt_outcome: string | null;
};

function date(value: Date): string { return new Date(value).toISOString(); }
function message(row: MessageRow): SupportMessage { return { id: row.id, authorType: row.author_type, status: row.status, body: row.body, createdAt: date(row.created_at), ...(row.author_type === "customer" ? { clientMessageId: row.client_message_id } : {}) }; }
function effectiveHandler(row: { handler: SupportHandler }, capability: SupportAssistantCapability): SupportHandler { return capability.available && row.handler === "assistant" ? "assistant" : "operator"; }
function unread(row: Pick<ConversationRow, "last_customer_message_at" | "operator_read_at">): boolean { return row.last_customer_message_at !== null && (row.operator_read_at === null || row.last_customer_message_at > row.operator_read_at); }
function receiptState(row: ContextSummaryRow): ActionReceiptState | null {
  if (!row.action_transaction_hash || !row.action_receipt_transaction_hash || row.action_receipt_transaction_hash.toLowerCase() !== row.action_transaction_hash.toLowerCase() ||
    !row.action_receipt_block_hash || row.action_receipt_block_number === null) return null;
  if (row.action_receipt_outcome === "succeeded") return "confirmed";
  if (row.action_receipt_outcome === "reverted") return "failed";
  return null;
}
function contextSummary(row: ContextSummaryRow): string | null {
  if (row.kind === "funding_order") return row.summary;
  if (!row.action_kind || !row.action_created_at) return null;
  return `${row.action_kind} · ${deriveActionStatus({
    confirmedAt: date(row.action_confirmed_at ?? row.action_created_at),
    submittedAt: row.action_handle_recorded_at ? date(row.action_handle_recorded_at) : null,
    transactionHash: row.action_transaction_hash,
    receipt: receiptState(row),
    outcome: row.action_outcome,
  })}`;
}

const MESSAGE_PAGE_LIMIT = 50;
const CONTEXT_PAGE_LIMIT = 20;

export class SupportRateLimitedError extends Error {
  constructor(readonly retryAfter: number) { super("Support message rate exceeded"); }
}

export class SupportStore {
  constructor(private readonly sql: SqlExecutor) {}

  async customerConversation(customerId: string, before?: string, capability: SupportAssistantCapability = { available: false, handoff: false }): Promise<CustomerSupportResponse> {
    const row = (await this.sql.query<ConversationRow>("SELECT * FROM support_conversations WHERE customer_id=$1", [customerId])).rows[0];
    if (!row) return { version: SUPPORT_CONTRACT_VERSION, conversation: null, assistant: capability };
    const [page, contexts, count] = await Promise.all([
      this.messagePage(row.id, false, before),
      this.sql.query<ContextRow>("SELECT kind,ref_id,NULL::text AS summary FROM support_context_refs WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2", [row.id, CONTEXT_PAGE_LIMIT]),
      this.customerUnreadCount(row.id),
    ]);
    const handler = effectiveHandler(row, capability);
    const assistant = { available: capability.available, handoff: capability.handoff && handler === "assistant" };
    return { version: SUPPORT_CONTRACT_VERSION, assistant: capability, conversation: { id: row.id, status: row.status, handler, assistant, messages: page.messages.map(message), messagesNextCursor: page.nextCursor, contextRefs: [...contexts.rows].reverse().map((ref) => ({ kind: ref.kind, id: ref.ref_id })), unreadCount: count } };
  }

  private async messagePage(conversationId: string, includeDrafts: boolean, before?: string): Promise<{ messages: MessageRow[]; nextCursor: string | null }> {
    const result = await this.sql.query<MessageRow>(`SELECT m.id,m.author_type,m.author_operator,m.status,m.body,m.client_message_id,m.created_at FROM support_messages m
      WHERE m.conversation_id=$1 AND (m.status='sent' OR ($2::boolean AND m.status='draft'))
        AND ($3::uuid IS NULL OR (m.created_at,m.id) < (SELECT p.created_at,p.id FROM support_messages p WHERE p.id=$3 AND p.conversation_id=$1))
      ORDER BY m.created_at DESC,m.id DESC LIMIT $4`, [conversationId, includeDrafts, before ?? null, MESSAGE_PAGE_LIMIT + 1]);
    const page = result.rows.slice(0, MESSAGE_PAGE_LIMIT).reverse();
    return { messages: page, nextCursor: result.rows.length > MESSAGE_PAGE_LIMIT ? page[0].id : null };
  }

  private async customerUnreadCount(id: string): Promise<number> {
    const result = await this.sql.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_messages m JOIN support_conversations c ON c.id=m.conversation_id
      WHERE c.id=$1 AND m.status='sent' AND m.author_type IN ('operator','assistant') AND (c.customer_read_at IS NULL OR m.created_at > c.customer_read_at)`, [id]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async customerSummary(customerId: string): Promise<CustomerSupportSummary> {
    const row = (await this.sql.query<{ id: string }>("SELECT id FROM support_conversations WHERE customer_id=$1", [customerId])).rows[0];
    return { version: SUPPORT_CONTRACT_VERSION, unreadCount: row ? await this.customerUnreadCount(row.id) : 0 };
  }

  async sendCustomer(customerId: string, session: VerifiedAccountSession, input: CustomerSupportSendRequest, capability: SupportAssistantCapability = { available: false, handoff: false }): Promise<{ response: CustomerSupportResponse; replayed: boolean; messageId: string }> {
    const sent = await this.sql.transaction(async (tx) => {
      const customer = (await tx.query<{ status: string }>("SELECT status FROM customers WHERE id=$1 FOR UPDATE", [customerId])).rows[0];
      if (!customer || customer.status === "closed") throw new SupportCustomerClosedError();
      let row = (await tx.query<ConversationRow>("SELECT * FROM support_conversations WHERE customer_id=$1 FOR UPDATE", [customerId])).rows[0];
      if (!row) {
        row = (await tx.query<ConversationRow>(`INSERT INTO support_conversations (id,customer_id,last_message_at,handler) VALUES ($1,$2,date_trunc('milliseconds',now()),$3) RETURNING *`, [crypto.randomUUID(), customerId, capability.available ? "assistant" : "operator"])).rows[0];
      }
      const existing = (await tx.query<{ id: string }>("SELECT id FROM support_messages WHERE conversation_id=$1 AND author_type='customer' AND client_message_id=$2", [row.id, input.clientMessageId])).rows[0];
      const id = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        const rates = (await tx.query<{ ten: string; day: string }>(`SELECT count(*) FILTER (WHERE created_at > clock_timestamp() - interval '10 minutes')::text AS ten,
          count(*)::text AS day FROM support_messages WHERE conversation_id=$1 AND author_type='customer' AND status='sent' AND created_at > clock_timestamp() - interval '24 hours'`, [row.id])).rows[0];
        if (Number(rates.ten) >= 10) throw new SupportRateLimitedError(600);
        if (Number(rates.day) >= 50) throw new SupportRateLimitedError(86400);
        await tx.query(`WITH sent AS (
          INSERT INTO support_messages (id,conversation_id,author_type,body,client_message_id,created_at)
          VALUES ($1,$2,'customer',$3,$4,clock_timestamp()) RETURNING created_at)
          UPDATE support_conversations c SET status='open',resolved_at=NULL,resolved_by=NULL,updated_at=sent.created_at,
            last_message_at=date_trunc('milliseconds',sent.created_at),last_customer_message_at=sent.created_at,
            handler=CASE WHEN c.status='resolved' THEN $5 ELSE c.handler END,
            handed_off_at=CASE WHEN c.status='resolved' THEN NULL ELSE c.handed_off_at END
          FROM sent WHERE c.id=$2`, [id, row.id, input.body, input.clientMessageId, capability.available ? "assistant" : "operator"]);
        if (input.context && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.context.id)) {
          const owner = moneyActionOwner(session);
          const source = input.context.kind === "funding_order"
            ? await tx.query("SELECT 1 FROM funding_orders WHERE id=$1::uuid AND account_provider=$2 AND owner_subject=$3", [input.context.id, session.accountProvider, session.user.subject])
            : owner ? await tx.query("SELECT 1 FROM actions WHERE id=$1::uuid AND owner_key=$2", [input.context.id, actionOwnerKey(owner)]) : null;
          if (source?.rows.length) await tx.query(`INSERT INTO support_context_refs (id,conversation_id,message_id,kind,ref_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (conversation_id,kind,ref_id) DO NOTHING`, [crypto.randomUUID(), row.id, id, input.context.kind, input.context.id]);
        }
      }
      return { replayed: !!existing, messageId: id };
    });
    return { response: await this.customerConversation(customerId, undefined, capability), ...sent };
  }

  async claimAssistantRun(conversationId: string, messageId: string, capability: SupportAssistantCapability, recheckOnly = false): Promise<{ status: "claimed"; runId: string } | { status: "answering" | "held" | "skipped" | "unavailable" | "pending" } | { status: "limited"; retryAfter: number }> {
    return this.sql.transaction(async (tx) => {
      const row = (await tx.query<ConversationRow>("SELECT * FROM support_conversations WHERE id=$1 FOR UPDATE", [conversationId])).rows[0];
      if (!row || row.status !== "open") return { status: "skipped" } as const;
      const state = (await tx.query<{ latest: string | null; replied: boolean }>(`SELECT
        (SELECT id FROM support_messages WHERE conversation_id=$1 AND author_type='customer' AND status='sent' ORDER BY created_at DESC,id DESC LIMIT 1) AS latest,
        EXISTS (SELECT 1 FROM support_messages a JOIN support_messages target ON target.id=$2 AND target.conversation_id=$1
          WHERE a.conversation_id=$1 AND a.status='sent' AND a.author_type='operator'
          AND (a.created_at,a.id) > (target.created_at,target.id)) OR
        EXISTS (SELECT 1 FROM support_messages a WHERE a.conversation_id=$1 AND a.in_reply_to=$2
          AND a.author_type='assistant' AND a.status IN ('sent','discarded')) AS replied`, [conversationId, messageId])).rows[0];
      if (state?.latest !== messageId || state.replied) return { status: "skipped" } as const;
      if (effectiveHandler(row, capability) !== "assistant") return { status: "unavailable" } as const;
      if (row.assistant_run_id && row.assistant_run_expires_at && row.assistant_run_expires_at.getTime() > Date.now()) return { status: row.assistant_run_message_id === messageId ? "answering" : "held" } as const;
      if (recheckOnly) return { status: "pending" } as const;
      const claim = await this.insertAssistantRun(tx, conversationId, messageId);
      return typeof claim === "string" ? { status: "claimed", runId: claim } as const : { status: "limited", retryAfter: claim } as const;
    });
  }

  private async insertAssistantRun(tx: SqlExecutor, conversationId: string, messageId: string): Promise<string | number> {
    const counts = (await tx.query<{ day: string; recent_replays: string; prior: boolean; day_retry_after: number | null; replay_retry_after: number | null }>(`SELECT rates.day,rates.recent_replays,
      EXISTS (SELECT 1 FROM support_assistant_runs WHERE conversation_id=$1 AND message_id=$2) AS prior,
      GREATEST(1,ceil(extract(epoch FROM (rates.oldest_day + interval '24 hours' - cutoff.checked_at))))::integer AS day_retry_after,
      GREATEST(1,ceil(extract(epoch FROM (rates.oldest_replay + interval '10 minutes' - cutoff.checked_at))))::integer AS replay_retry_after
      FROM (SELECT clock_timestamp() AS checked_at) cutoff
      CROSS JOIN LATERAL (SELECT
        count(*) FILTER (WHERE started_at > cutoff.checked_at - interval '24 hours')::text AS day,
        min(started_at) FILTER (WHERE started_at > cutoff.checked_at - interval '24 hours') AS oldest_day,
        count(*) FILTER (WHERE replay AND started_at > cutoff.checked_at - interval '10 minutes')::text AS recent_replays,
        min(started_at) FILTER (WHERE replay AND started_at > cutoff.checked_at - interval '10 minutes') AS oldest_replay
        FROM support_assistant_runs WHERE conversation_id=$1) rates`, [conversationId, messageId])).rows[0];
    if (Number(counts.day) >= 40) return counts.day_retry_after!;
    if (counts.prior && Number(counts.recent_replays) >= 10) return counts.replay_retry_after!;
    const runId = crypto.randomUUID();
    await tx.query("INSERT INTO support_assistant_runs (id,conversation_id,message_id,replay) VALUES ($1,$2,$3,$4)", [runId, conversationId, messageId, counts.prior]);
    await tx.query("UPDATE support_conversations SET assistant_run_id=$2,assistant_run_message_id=$3,assistant_run_expires_at=clock_timestamp() + interval '60 seconds' WHERE id=$1", [conversationId, runId, messageId]);
    return runId;
  }

  async readCustomer(customerId: string, lastMessageId: string): Promise<boolean> {
    const result = await this.sql.query(`UPDATE support_conversations c SET customer_read_at=GREATEST(COALESCE(c.customer_read_at,$3::timestamptz),m.created_at)
      FROM support_messages m WHERE c.customer_id=$1 AND m.id=$2 AND m.conversation_id=c.id AND m.status='sent'`, [customerId, lastMessageId, "1970-01-01T00:00:00.000Z"]);
    return result.rowCount > 0;
  }

  async list(input: OperatorSupportListQuery, capability: SupportAssistantCapability = { available: false, handoff: false }): Promise<OperatorSupportListResponse> {
    const before = input.before ? decodeSupportCursor(input.before) : null;
    const result = await this.sql.query<{ id: string; status: "open" | "resolved"; handler: SupportHandler; last_message_at: Date; preview: string; author_type: SupportMessage["authorType"]; last_customer_message_at: Date | null; operator_read_at: Date | null; label_wallet: string | null }>(`SELECT c.id,c.status,c.handler,c.last_message_at,c.last_customer_message_at,c.operator_read_at,
       m.body AS preview,m.author_type,w.address AS label_wallet
       FROM support_conversations c
       JOIN LATERAL (SELECT body,author_type FROM support_messages WHERE conversation_id=c.id AND status='sent' ORDER BY created_at DESC,id DESC LIMIT 1) m ON true
       LEFT JOIN LATERAL (SELECT address FROM customer_wallets WHERE customer_id=c.customer_id ORDER BY created_at DESC,id DESC LIMIT 1) w ON true
       WHERE ($1::text='all' OR c.status=$1) AND ($2::timestamptz IS NULL OR (c.last_message_at,c.id) < ($2::timestamptz,$3::uuid))
       ORDER BY c.last_message_at DESC,c.id DESC LIMIT $4`, [input.status, before?.at ?? null, before?.id ?? null, input.limit + 1]);
    const rows = result.rows.slice(0, input.limit);
    return { version: SUPPORT_CONTRACT_VERSION, conversations: rows.map((row) => ({ id: row.id, status: row.status, handler: effectiveHandler(row, capability), lastMessageAt: date(row.last_message_at), preview: row.preview.slice(0, 140), lastAuthorType: row.author_type, unread: effectiveHandler(row, capability) === "operator" && unread(row), customerLabel: row.label_wallet ? `${row.label_wallet.slice(0, 6)}…${row.label_wallet.slice(-4)}` : `Customer ${row.id.slice(0, 8)}` })), nextCursor: result.rows.length > input.limit ? Buffer.from(JSON.stringify({ at: date(rows.at(-1)!.last_message_at), id: rows.at(-1)!.id })).toString("base64url") : null };
  }

  async operatorSummary(capability: SupportAssistantCapability = { available: false, handoff: false }): Promise<OperatorSupportSummary> {
    const result = await this.sql.query<{ count: string }>("SELECT count(*)::text AS count FROM support_conversations WHERE last_customer_message_at IS NOT NULL AND (operator_read_at IS NULL OR last_customer_message_at > operator_read_at) AND ($1::boolean=false OR handler='operator')", [capability.available]);
    return { version: SUPPORT_CONTRACT_VERSION, unreadConversations: Number(result.rows[0]?.count ?? 0) };
  }

  async customerIdForConversation(id: string): Promise<string | null> {
    return (await this.sql.query<{ customer_id: string }>("SELECT customer_id FROM support_conversations WHERE id=$1", [id])).rows[0]?.customer_id ?? null;
  }

  async operatorConversation(id: string, before?: string, capability: SupportAssistantCapability = { available: false, handoff: false }): Promise<OperatorSupportConversationResponse | null> {
    const row = (await this.sql.query<ConversationRow>("SELECT * FROM support_conversations WHERE id=$1", [id])).rows[0];
    if (!row) return null;
    const [page, contexts, customer, credentials, wallets, events] = await Promise.all([
      this.messagePage(id, true, before),
      this.sql.query<ContextSummaryRow>(`SELECT t.kind,t.ref_id,t.summary,t.action_kind,t.action_outcome,t.action_confirmed_at,t.action_created_at,t.action_handle_recorded_at,t.action_transaction_hash,t.action_receipt_transaction_hash,t.action_receipt_block_hash,t.action_receipt_block_number,t.action_receipt_outcome FROM (SELECT r.kind,r.ref_id,r.created_at,r.id,CASE WHEN r.kind='funding_order' THEN (SELECT f.state || ' · ' || f.provider_id || ' · ' || f.fiat_amount || ' (' || f.region || ')' FROM funding_orders f WHERE f.id::text=r.ref_id) END AS summary,
        a.kind AS action_kind,a.outcome AS action_outcome,a.confirmed_at AS action_confirmed_at,a.created_at AS action_created_at,a.handle_recorded_at AS action_handle_recorded_at,a.transaction_hash AS action_transaction_hash,
        a.observed_receipt_transaction_hash AS action_receipt_transaction_hash,a.observed_receipt_block_hash AS action_receipt_block_hash,a.observed_receipt_block_number AS action_receipt_block_number,a.observed_receipt_outcome AS action_receipt_outcome
        FROM support_context_refs r LEFT JOIN actions a ON r.kind='money_action' AND a.id::text=r.ref_id WHERE r.conversation_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT $2) t ORDER BY t.created_at,t.id`, [id, CONTEXT_PAGE_LIMIT]),
      this.sql.query<{ id: string; status: string; country: string | null; first_seen_at: Date; last_seen_at: Date }>("SELECT id,status,country,first_seen_at,last_seen_at FROM customers WHERE id=$1", [row.customer_id]),
      this.sql.query<{ email: string | null; account_provider: string }>("SELECT email,account_provider FROM customer_credentials WHERE customer_id=$1 ORDER BY first_seen_at,id", [row.customer_id]),
      this.sql.query<{ address: `0x${string}` }>("SELECT DISTINCT address FROM customer_wallets WHERE customer_id=$1 ORDER BY address", [row.customer_id]),
      this.sql.query<{ name: string; occurred_at: Date }>("SELECT name,occurred_at FROM operator_events WHERE customer_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 10", [row.customer_id]),
    ]);
    const person = customer.rows[0];
    if (!person) return null;
    return { version: SUPPORT_CONTRACT_VERSION, conversation: { id: row.id, status: row.status, handler: effectiveHandler(row, capability), handedOffAt: row.handed_off_at ? date(row.handed_off_at) : null, assistantAvailable: capability.available, createdAt: date(row.created_at), resolvedAt: row.resolved_at ? date(row.resolved_at) : null, messages: page.messages.map((m) => ({ ...message(m), authorOperator: m.author_operator })), messagesNextCursor: page.nextCursor, contextRefs: contexts.rows.map((r) => ({ kind: r.kind, id: r.ref_id, summary: contextSummary(r) })) }, customer: { status: person.status, country: person.country, firstSeenAt: date(person.first_seen_at), lastSeenAt: date(person.last_seen_at), emails: [...new Set(credentials.rows.flatMap((c) => c.email ? [c.email] : []))], accountProviders: [...new Set(credentials.rows.map((c) => c.account_provider))], wallets: wallets.rows.map((w) => w.address), recentEvents: events.rows.map((e) => ({ name: e.name, occurredAt: date(e.occurred_at) })) } };
  }

  async sendOperator(id: string, actor: `0x${string}`, input: OperatorSupportReplyRequest): Promise<{ outcome: "ok"; response: OperatorSupportConversationResponse | null; replayed: boolean } | { outcome: "not-found" } | { outcome: "conflict" }> {
    const sent = await this.sql.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor]);
      const row = (await tx.query<ConversationRow>("SELECT * FROM support_conversations WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) return { outcome: "not-found" } as const;
      const existing = (await tx.query<{ id: string }>("SELECT id FROM support_messages WHERE conversation_id=$1 AND author_type='operator' AND client_message_id=$2", [id, input.clientMessageId])).rows[0];
      if (existing) return { outcome: "ok", replayed: true } as const;
      if (row.status !== "open") return { outcome: "conflict" } as const;
      const state = (await tx.query<{ observed: number | null; newer: number | null; unanswered: number | null }>(`SELECT
        (SELECT 1 FROM support_messages o WHERE o.id=$2 AND o.conversation_id=$1) AS observed,
        (SELECT 1 FROM support_messages m WHERE m.conversation_id=$1 AND m.author_type='customer' AND m.status='sent'
          AND (m.created_at,m.id) > (SELECT o.created_at,o.id FROM support_messages o WHERE o.id=$2 AND o.conversation_id=$1) LIMIT 1) AS newer,
        (SELECT 1 FROM support_messages m WHERE m.conversation_id=$1 AND m.author_type='customer' AND m.status='sent'
          AND NOT EXISTS (SELECT 1 FROM support_messages newer WHERE newer.conversation_id=$1 AND newer.author_type='customer' AND newer.status='sent' AND (newer.created_at,newer.id) > (m.created_at,m.id))
          AND NOT EXISTS (SELECT 1 FROM support_messages answer WHERE answer.conversation_id=$1 AND answer.status='sent' AND (
            (answer.author_type='operator' AND (answer.created_at,answer.id) > (m.created_at,m.id))
            OR (answer.author_type='assistant' AND answer.in_reply_to=m.id))) LIMIT 1) AS unanswered`, [id, input.readThroughMessageId])).rows[0];
      if (state && (state.newer !== null || (state.observed === null && state.unanswered !== null))) return { outcome: "conflict" } as const;
      const rate = (await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM support_messages WHERE author_type='operator' AND author_operator=$1 AND status='sent' AND created_at > clock_timestamp() - interval '1 minute'", [actor])).rows[0];
      if (Number(rate.count) >= 60) throw new SupportRateLimitedError(60);
      await tx.query(`WITH sent AS (
        INSERT INTO support_messages (id,conversation_id,author_type,author_operator,body,client_message_id,created_at)
        VALUES ($1,$2,'operator',$3,$4,$5,clock_timestamp()) RETURNING created_at)
        UPDATE support_conversations c SET last_message_at=date_trunc('milliseconds',sent.created_at),last_operator_message_at=sent.created_at,updated_at=sent.created_at,handler='operator',handed_off_at=COALESCE(c.handed_off_at,sent.created_at),assistant_run_id=NULL,assistant_run_message_id=NULL,assistant_run_expires_at=NULL
        FROM sent WHERE c.id=$2`, [crypto.randomUUID(), id, actor, input.body, input.clientMessageId]);
      await tx.query(`UPDATE support_conversations c SET operator_read_at=GREATEST(COALESCE(c.operator_read_at,$3::timestamptz),m.created_at)
        FROM support_messages m WHERE c.id=$1 AND m.id=$2 AND m.conversation_id=c.id AND m.status IN ('sent','draft')`, [id, input.readThroughMessageId, "1970-01-01T00:00:00.000Z"]);
      return { outcome: "ok", replayed: false } as const;
    });
    return sent.outcome === "ok" ? { ...sent, response: await this.operatorConversation(id) } : sent;
  }

  async setStatus(id: string, actor: `0x${string}`, status: "open" | "resolved", observedMessageId: string): Promise<"ok" | "not-found" | "conflict"> {
    return await this.sql.transaction(async (tx) => {
      const row = (await tx.query<ConversationRow>("SELECT * FROM support_conversations WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) return "not-found" as const;
      if (status === "resolved") {
        const state = (await tx.query<{ observed: number | null; newer: number | null }>(`SELECT
          (SELECT 1 FROM support_messages o WHERE o.id=$2 AND o.conversation_id=$1) AS observed,
          (SELECT 1 FROM support_messages m WHERE m.conversation_id=$1 AND m.author_type='customer' AND m.status='sent'
            AND (m.created_at,m.id) > (SELECT o.created_at,o.id FROM support_messages o WHERE o.id=$2 AND o.conversation_id=$1) LIMIT 1) AS newer`, [id, observedMessageId])).rows[0];
        if (!state || state.observed === null || state.newer !== null) return "conflict" as const;
        await tx.query(`UPDATE support_conversations c SET operator_read_at=GREATEST(COALESCE(c.operator_read_at,$3::timestamptz),m.created_at)
          FROM support_messages m WHERE c.id=$1 AND m.id=$2 AND m.conversation_id=c.id AND m.status IN ('sent','draft')`, [id, observedMessageId, "1970-01-01T00:00:00.000Z"]);
      }
      await tx.query(`UPDATE support_conversations SET status=$2,resolved_at=CASE WHEN $2='resolved' THEN COALESCE(resolved_at,now()) ELSE NULL END,
        resolved_by=CASE WHEN $2='resolved' THEN COALESCE(resolved_by,$3) ELSE NULL END,updated_at=now(),
        assistant_run_id=CASE WHEN $2='resolved' THEN NULL ELSE assistant_run_id END,
        assistant_run_message_id=CASE WHEN $2='resolved' THEN NULL ELSE assistant_run_message_id END,
        assistant_run_expires_at=CASE WHEN $2='resolved' THEN NULL ELSE assistant_run_expires_at END WHERE id=$1`, [id, status, actor]);
      return "ok" as const;
    });
  }

  async handlerForCustomer(customerId: string, capability: SupportAssistantCapability): Promise<{ id: string; handler: SupportHandler } | null> {
    const row = (await this.sql.query<ConversationRow>("SELECT * FROM support_conversations WHERE customer_id=$1", [customerId])).rows[0];
    return row ? { id: row.id, handler: effectiveHandler(row, capability) } : null;
  }

  async setHandler(id: string, handler: SupportHandler): Promise<"ok" | "not-found" | "conflict"> {
    return this.sql.transaction(async (tx) => {
      const row = (await tx.query<ConversationRow>("SELECT * FROM support_conversations WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) return "not-found";
      if (row.handler === handler) return "ok";
      if (handler === "assistant") {
        const unanswered = (await tx.query<{ id: string }>(`SELECT customer.id FROM support_messages customer
          WHERE customer.conversation_id=$1 AND customer.author_type='customer' AND customer.status='sent'
          AND NOT EXISTS (SELECT 1 FROM support_messages newer WHERE newer.conversation_id=$1 AND newer.author_type='customer' AND newer.status='sent'
            AND (newer.created_at,newer.id) > (customer.created_at,customer.id))
          AND NOT EXISTS (SELECT 1 FROM support_messages answer WHERE answer.conversation_id=$1 AND answer.status='sent' AND (
            (answer.author_type='operator' AND (answer.created_at,answer.id) > (customer.created_at,customer.id))
            OR (answer.author_type='assistant' AND answer.in_reply_to=customer.id))) LIMIT 1`, [id])).rows[0];
        if (unanswered) return "conflict";
      }
      if (row.handler !== handler) await tx.query("UPDATE support_conversations SET handler=$2,handed_off_at=CASE WHEN $2='operator' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp(),assistant_run_id=CASE WHEN $2='operator' THEN NULL ELSE assistant_run_id END,assistant_run_message_id=CASE WHEN $2='operator' THEN NULL ELSE assistant_run_message_id END,assistant_run_expires_at=CASE WHEN $2='operator' THEN NULL ELSE assistant_run_expires_at END WHERE id=$1", [id, handler]);
      return "ok";
    });
  }

  async handoffCustomer(customerId: string, hybrid: boolean, pendingOnly = false, messageId?: string): Promise<"ok" | "not-found" | "conflict"> {
    return this.sql.transaction(async (tx) => {
      const row = (await tx.query<ConversationRow>("SELECT * FROM support_conversations WHERE customer_id=$1 FOR UPDATE", [customerId])).rows[0];
      if (!row) return "not-found";
      if (row.handler === "operator") return "ok";
      if (!hybrid) return "conflict";
      if (pendingOnly) {
        const pending = (await tx.query<{ id: string }>(`SELECT customer.id FROM support_messages customer
          WHERE customer.conversation_id=$1 AND customer.author_type='customer' AND customer.status='sent'
          AND customer.id=(SELECT id FROM support_messages WHERE conversation_id=$1 AND author_type='customer' AND status='sent' ORDER BY created_at DESC,id DESC LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM support_messages answer WHERE answer.conversation_id=$1 AND answer.status='sent' AND (
            (answer.author_type='operator' AND (answer.created_at,answer.id) > (customer.created_at,customer.id))
            OR (answer.author_type='assistant' AND answer.in_reply_to=customer.id))) AND ($2::uuid IS NULL OR customer.id=$2) LIMIT 1`, [row.id, messageId ?? null])).rows[0];
        if (!pending || row.status !== "open") return "ok";
      }
      await tx.query("UPDATE support_conversations SET handler='operator',handed_off_at=clock_timestamp(),updated_at=clock_timestamp(),assistant_run_id=NULL,assistant_run_message_id=NULL,assistant_run_expires_at=NULL WHERE id=$1", [row.id]);
      return "ok";
    });
  }

  async releaseAssistantRun(id: string, runId: string): Promise<void> {
    await this.sql.query("UPDATE support_conversations SET assistant_run_id=NULL,assistant_run_message_id=NULL,assistant_run_expires_at=NULL WHERE id=$1 AND assistant_run_id=$2", [id, runId]);
  }

  async assistantHistory(id: string, messageId: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
    const rows = (await this.sql.query<{ author_type: SupportMessage["authorType"]; body: string }>(`SELECT author_type,body FROM support_messages
      WHERE conversation_id=$1 AND status='sent' AND (
        (author_type='customer' AND (created_at,id) <= (SELECT created_at,id FROM support_messages WHERE conversation_id=$1 AND id=$2 AND author_type='customer'))
        OR (author_type IN ('operator','assistant') AND created_at <= COALESCE(
          (SELECT r.started_at FROM support_assistant_runs r JOIN support_conversations c ON c.assistant_run_id=r.id WHERE c.id=$1 AND r.message_id=$2),
          (SELECT created_at FROM support_messages WHERE conversation_id=$1 AND id=$2 AND author_type='customer'))))
      ORDER BY created_at DESC,id DESC LIMIT 30`, [id, messageId])).rows;
    return rows.reverse().map((m) => ({ role: m.author_type === "customer" ? "user" : "assistant", content: m.body }));
  }

  async assistantContext(id: string, messageId: string): Promise<string[]> {
    const rows = (await this.sql.query<ContextSummaryRow>(`SELECT r.kind,r.ref_id,CASE WHEN r.kind='funding_order' THEN (SELECT f.state || ' · ' || f.provider_id || ' · ' || f.fiat_amount || ' (' || f.region || ')' FROM funding_orders f WHERE f.id::text=r.ref_id) END AS summary,
      a.kind AS action_kind,a.outcome AS action_outcome,a.confirmed_at AS action_confirmed_at,a.created_at AS action_created_at,a.handle_recorded_at AS action_handle_recorded_at,a.transaction_hash AS action_transaction_hash,
      a.observed_receipt_transaction_hash AS action_receipt_transaction_hash,a.observed_receipt_block_hash AS action_receipt_block_hash,a.observed_receipt_block_number AS action_receipt_block_number,a.observed_receipt_outcome AS action_receipt_outcome
      FROM support_context_refs r JOIN support_messages m ON m.id=r.message_id AND m.conversation_id=r.conversation_id
      LEFT JOIN actions a ON r.kind='money_action' AND a.id::text=r.ref_id
      WHERE r.conversation_id=$1 AND (m.created_at,m.id) <= (SELECT created_at,id FROM support_messages WHERE conversation_id=$1 AND id=$2 AND author_type='customer')
      ORDER BY r.created_at DESC,r.id DESC LIMIT 20`, [id, messageId])).rows;
    return rows.flatMap((row) => { const summary = contextSummary(row); return summary ? [summary] : []; });
  }

  async saveAssistant(id: string, messageId: string, text: string, runId?: string, discard = false): Promise<"sent" | "discarded" | "empty" | "budget"> {
    const body = text.trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").slice(0, 2000);
    if (!body) return "empty";
    return this.sql.transaction(async (tx) => {
      const row = (await tx.query<ConversationRow>("SELECT * FROM support_conversations WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) return "discarded";
      if (runId && row.assistant_run_id !== runId) return "discarded";
      if (row.handler === "assistant" && !runId && !discard) {
        const rate = (await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM support_messages WHERE conversation_id=$1 AND author_type='assistant' AND status='sent' AND created_at > clock_timestamp() - interval '24 hours'", [id])).rows[0];
        if (Number(rate?.count ?? 0) >= 40) return "budget";
      }
      const status = row.status === "open" && row.handler === "assistant" && !discard ? "sent" : "discarded";
      await tx.query(`INSERT INTO support_messages (id,conversation_id,author_type,status,body,client_message_id,in_reply_to,created_at)
        VALUES ($1,$2,'assistant',$3,$4,$5,CASE WHEN $7::boolean THEN NULL ELSE COALESCE($6::uuid,(SELECT id FROM support_messages WHERE conversation_id=$2 AND author_type='customer' AND status='sent' ORDER BY created_at DESC,id DESC LIMIT 1)) END,clock_timestamp())`, [messageId, id, status, body, messageId, runId ? row.assistant_run_message_id : null, discard]);
      if (status === "sent") await tx.query(`UPDATE support_conversations c SET last_message_at=date_trunc('milliseconds',m.created_at),updated_at=m.created_at FROM support_messages m WHERE c.id=$1 AND m.id=$2`, [id, messageId]);
      return status;
    });
  }


  async readOperator(id: string, lastMessageId: string): Promise<boolean> {
    const result = await this.sql.query(`UPDATE support_conversations c SET operator_read_at=GREATEST(COALESCE(c.operator_read_at,$3::timestamptz),m.created_at)
      FROM support_messages m WHERE c.id=$1 AND m.id=$2 AND m.conversation_id=c.id AND m.status IN ('sent','draft')`, [id, lastMessageId, "1970-01-01T00:00:00.000Z"]);
    return result.rowCount > 0;
  }
}

export class SupportCustomerClosedError extends Error {}

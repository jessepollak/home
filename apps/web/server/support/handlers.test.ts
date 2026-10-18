import { expect, test } from "bun:test";

import type { SqlExecutor } from "@/server/db/sql";
import { AdminAuditLog } from "@/server/operator-settings/audit";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { OPERATOR_REPLY_CONTRACT_VERSION, SUPPORT_CONTRACT_VERSION, parseOperatorSupportConversationResponse, parseOperatorSupportReplyResponse, type OperatorSupportConversationResponse } from "@/shared/support/contract";
import { SupportAssistantStore } from "./assistant";
import { createOperatorSupportReplyHandler } from "./handlers";
import { SupportStore } from "./store";

const operatorAddress = "0x1111111111111111111111111111111111111111" as const;
const conversationId = "11111111-1111-4111-8111-111111111111";
const replyId = "55555555-5555-4555-8555-555555555555";
const at = "2026-09-27T12:00:00.000Z";
function makeHandler(replay: boolean, rejectSql = false) {
  const message = { id: replay ? replyId : "", author_type: "operator", author_operator: operatorAddress, status: "sent", body: "We can help", client_message_id: "client-message-1", created_at: new Date(at) };
  const rowsByQuery: [string, unknown[]][] = [
    ["SELECT customer_id FROM support_conversations WHERE id=$1", [{ customer_id: "customer-1" }]],
    ["INSERT INTO admin_audit_log (actor, action, target_kind, target_id, purpose)", []],
    ["SELECT pg_advisory_xact_lock(hashtext($1))", []],
    ["SELECT * FROM support_conversations WHERE id=$1", [{ id: conversationId, customer_id: "customer-1", status: "open", handler: "operator", handed_off_at: null, assistant_run_id: null, assistant_run_expires_at: null, assistant_run_message_id: null, created_at: new Date(at), resolved_at: null, customer_read_at: null, operator_read_at: null, last_customer_message_at: null }]],
    ["SELECT id FROM support_messages WHERE conversation_id=$1 AND author_type='operator' AND client_message_id=$2", replay ? [{ id: replyId }] : []],
    ["AS observed", []],
    ["SELECT count(*)::text AS count FROM support_messages WHERE author_type='operator'", [{ count: "0" }]],
    ["WITH sent AS (", []],
    ["UPDATE support_conversations c SET operator_read_at=GREATEST(", []],
    ["SELECT m.id,m.author_type,m.author_operator,m.status,m.body,m.client_message_id,m.created_at FROM support_messages m", [message]],
    ["SELECT t.kind,t.ref_id,t.summary", []],
    ["SELECT id,status,country,first_seen_at,last_seen_at FROM customers WHERE id=$1", [{ id: "customer-1", status: "active", country: null, first_seen_at: new Date(at), last_seen_at: new Date(at) }]],
    ["SELECT email,account_provider FROM customer_credentials WHERE customer_id=$1", []],
    ["SELECT DISTINCT address FROM customer_wallets WHERE customer_id=$1", []],
    ["SELECT name,occurred_at FROM operator_events WHERE customer_id=$1", []],
    ["SELECT value FROM operator_settings WHERE domain='support-assistant'", []],
    ["SELECT envelope,last4,updated_at FROM support_assistant_credentials WHERE id='default'", []],
  ];
  const unexpected: string[] = [];
  const fakeSql: SqlExecutor = {
    async query<T>(text: string, values: unknown[] = []) {
      const match = !rejectSql && rowsByQuery.find(([key]) => text.includes(key));
      if (!match) { unexpected.push(text); throw new Error(`Unexpected SQL: ${text}`); }
      if (text.includes("WITH sent AS (")) {
        const inserted = values[0];
        if (typeof inserted !== "string") throw new Error("Unexpected insert values");
        message.id = inserted;
      }
      return { rows: match[1] as T[], rowCount: match[1].length };
    },
    transaction: async (fn) => fn(fakeSql),
  };
  const session: VerifiedAccountSession = { user: { subject: "operator" }, smartAccount: { address: operatorAddress, chainId: 8453 }, accountProvider: "base-account" };
  const handler = createOperatorSupportReplyHandler({
    authorize: async () => session,
    config: () => ({ kind: "configured", addresses: new Set([operatorAddress]) }),
    store: () => new SupportStore(fakeSql),
    audit: () => new AdminAuditLog(fakeSql),
    assistant: () => new SupportAssistantStore(fakeSql, {}),
  });
  function call(version: number): Promise<Response> {
    const url = `https://home.test/api/admin/support/conversations/${conversationId}/messages`;
    return handler(new Request(url, { method: "POST", headers: { origin: "https://home.test", "content-type": "application/json" }, body: JSON.stringify({ version, body: "We can help", clientMessageId: "client-message-1", readThroughMessageId: replyId }) }), { params: Promise.resolve({ id: conversationId }) });
  }
  return { call, messageId: () => message.id, unexpected };
}
function conversationDetail(messageId: string): OperatorSupportConversationResponse {
  return {
    version: 2,
    conversation: {
      id: conversationId, status: "open", handler: "operator", handedOffAt: null, assistantAvailable: false, createdAt: at, resolvedAt: null,
      messages: [{ id: messageId, authorType: "operator", authorOperator: operatorAddress, status: "sent", body: "We can help", createdAt: at }],
      messagesNextCursor: null, contextRefs: [],
    },
    customer: { status: "active", country: null, firstSeenAt: at, lastSeenAt: at, emails: [], accountProviders: [], wallets: [], recentEvents: [] },
  };
}

test("a stale version 2 reply request keeps the conversation-only response its client parses", async () => {
  const { call, unexpected } = makeHandler(true);
  const response = await call(SUPPORT_CONTRACT_VERSION);
  const value = await response.json();
  expect(response.status).toBe(200);
  expect(parseOperatorSupportReplyResponse(value)).toBeNull();
  expect(value).not.toHaveProperty("reply");
  expect(parseOperatorSupportConversationResponse(value)).toEqual(conversationDetail(replyId));
  expect(unexpected).toEqual([]);
});

test("a version 3 reply request returns reply metadata without changing the conversation ETag", async () => {
  const { call, unexpected } = makeHandler(true);
  const response = await call(OPERATOR_REPLY_CONTRACT_VERSION);
  const legacyResponse = await call(SUPPORT_CONTRACT_VERSION);
  const value = await response.json();
  const parsed = parseOperatorSupportReplyResponse(value);
  expect(response.status).toBe(200);
  expect(parsed?.version).toBe(3);
  expect(parsed?.reply).toEqual({ messageId: replyId, replayed: true });
  expect(parsed?.conversation.id).toBe(conversationId);
  expect(parsed?.conversation.messages).toEqual([
    { id: replyId, authorType: "operator", authorOperator: operatorAddress, status: "sent", body: "We can help", createdAt: at },
  ]);
  expect(parseOperatorSupportConversationResponse(value)).toBeNull();
  expect(response.headers.get("ETag")).not.toBeNull();
  expect(response.headers.get("ETag")).toBe(legacyResponse.headers.get("ETag"));
  expect(unexpected).toEqual([]);
});

test.each([OPERATOR_REPLY_CONTRACT_VERSION, SUPPORT_CONTRACT_VERSION])("a fresh version %s reply returns its negotiated response", async (version) => {
  const { call, messageId, unexpected } = makeHandler(false);
  const response = await call(version);
  const value = await response.json();
  expect(response.status).toBe(201);
  if (version === OPERATOR_REPLY_CONTRACT_VERSION) {
    const parsed = parseOperatorSupportReplyResponse(value);
    expect(parsed?.reply).toEqual({ messageId: messageId(), replayed: false });
    expect(parsed?.reply.messageId).toBe(parsed?.conversation.messages[0].id);
    expect(parseOperatorSupportConversationResponse(value)).toBeNull();
  } else {
    expect(parseOperatorSupportConversationResponse(value)).toEqual(conversationDetail(messageId()));
    expect(value).not.toHaveProperty("reply");
  }
  expect(unexpected).toEqual([]);
});

test("an unknown reply request version is rejected before any SQL", async () => {
  const { call, unexpected } = makeHandler(false, true);
  const response = await call(4);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
  expect(unexpected).toEqual([]);
});

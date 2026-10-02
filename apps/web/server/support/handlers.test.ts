import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { SUPPORT_CONTRACT_VERSION, parseCustomerSupportChatRequest, parseCustomerSupportHandoffRequest, parseCustomerSupportResponse, parseOperatorSupportConversationResponse, parseOperatorSupportHandlerRequest, parseOperatorSupportListResponse, parseSupportCredentialPutRequest, parseSupportCredentialResponse, parseSupportErrorResponse, parseSupportStreamData, type OperatorSupportConversationResponse } from "@/shared/support/contract";
import { parseSupportAssistantSettings } from "@/shared/operator-settings/contract";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type { AdminAuditLog } from "@/server/operator-settings/audit";
import { createCustomerSupportChatHandler, createCustomerSupportHandoffHandler, createCustomerSupportHandlers, createOperatorSupportConversationHandler, createOperatorSupportHandlerHandler, createOperatorSupportListHandler, createOperatorSupportReplyHandler, createSupportCredentialHandlers } from "./handlers";
import type { SupportAssistantStore } from "./assistant";
import type { SupportStore } from "./store";

const actor = `0x${"1".repeat(40)}` as `0x${string}`;
const other = `0x${"2".repeat(40)}` as `0x${string}`;
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const session = (address: `0x${string}` = actor): VerifiedAccountSession => ({ accountProvider: "base-account", user: { subject: "alice" }, smartAccount: { address, chainId: BASE_CHAIN_ID } });
const request = (path: string, method = "GET", body?: unknown, origin = "https://home.test") => new Request(`https://home.test/api/${path}`, { method, ...(method === "GET" ? {} : { headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }) });
const chat = { version: 2, message: { id: messageId, text: " Hello " } };
const ctx = { params: Promise.resolve({ id: conversationId }) };
const capability = { available: true, handoff: true };
const customer = { version: SUPPORT_CONTRACT_VERSION, assistant: capability, conversation: { id: conversationId, status: "open", handler: "assistant", assistant: capability, messages: [], messagesNextCursor: null, contextRefs: [], unreadCount: 0 } } as const;
const operator: OperatorSupportConversationResponse = { version: SUPPORT_CONTRACT_VERSION, conversation: { id: conversationId, status: "open", handler: "assistant", handedOffAt: null, assistantAvailable: true, createdAt: "2026-01-01T00:00:00.000Z", resolvedAt: null, messages: [], messagesNextCursor: null, contextRefs: [] }, customer: { status: "active", country: null, firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", emails: [], accountProviders: [], wallets: [], recentEvents: [] } };

function setup(mode: "operator" | "assistant" | "hybrid" = "hybrid", owner = alice) {
  const calls: string[] = [];
  const handoffs: Array<Parameters<SupportStore["handoffCustomer"]>> = [];
  const active = mode !== "operator";
  let currentHandler: "assistant" | "operator" = active ? "assistant" : "operator";
  const cap = { available: active, handoff: mode === "hybrid" };
  const response = { ...customer, assistant: cap, conversation: { ...customer.conversation, handler: active ? "assistant" as const : "operator" as const, assistant: cap } };
  const store = {
    customerConversation: async (id: string) => { calls.push(`get:${id}`); return response; },
    sendCustomer: async (id: string, _session: VerifiedAccountSession, input: { body: string; clientMessageId: string }) => { calls.push(`send:${id}:${input.body}:${input.clientMessageId}`); return { response, replayed: false, messageId }; },
    claimAssistantRun: async (_id: string, _messageId: string, capability: { available: boolean }) => active && capability.available ? { status: "claimed" as const, runId: crypto.randomUUID() } : { status: "unavailable" as const },
    assistantHistory: async () => [{ role: "user", content: "Hello" }],
    assistantContext: async () => [],
    saveAssistant: async (_id: string, _mid: string, text: string) => { calls.push(`saved:${text}`); return "sent" as const; },
    releaseAssistantRun: async () => {},
    ownsAssistantRun: async () => true,
    handoffCustomer: async (id: string, hybrid: boolean, pendingOnly?: boolean, targetMessageId?: string) => { calls.push(`handoff:${id}:${hybrid}`); handoffs.push([id, hybrid, pendingOnly, targetMessageId]); if (hybrid) currentHandler = "operator"; return hybrid ? "ok" as const : "conflict" as const; },
    handlerForCustomer: async () => ({ id: conversationId, handler: currentHandler }),
    customerIdForConversation: async (id: string) => id === conversationId ? owner : null,
    operatorConversation: async () => operator,
    setHandler: async (_id: string, handler: string) => { calls.push(`handler:${handler}`); return "ok" as const; },
  } as unknown as SupportStore;
  const credential = { version: SUPPORT_CONTRACT_VERSION, configured: true, last4: "test", updatedAt: "2026-01-01T00:00:00.000Z", available: true };
  const assistant = {
    effective: async () => ({ settings: { mode, model: "acme/support", instructions: "" }, key: "fixture-key", available: active, capability: cap }),
    capability: async () => cap,
    credential: async () => credential,
    put: async (key: string) => { calls.push(`put:${key.length}`); return credential; },
    delete: async () => { calls.push("delete"); return { ...credential, configured: false, available: false, last4: null, updatedAt: null }; },
  } as unknown as SupportAssistantStore;
  const options = {
    authorize: async () => session(), config: () => ({ kind: "configured" as const, addresses: new Set([actor]) }),
    store: () => store, assistant: () => assistant,
    resolve: async () => ({ id: owner, status: "active" as const, created: false, credentialId: messageId, walletId: null }),
    audit: () => ({ recordCustomerRead: async () => {} }) as unknown as AdminAuditLog,
  };
  return { options, calls, handoffs, store, assistant };
}
const model = () => new MockLanguageModelV3({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: "text-start" as const, id: "t" }, { type: "text-delta" as const, id: "t", delta: "Welcome" }, { type: "text-end" as const, id: "t" }, { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } }] }) }) });

const streamReplyWithoutToken = () => simulateReadableStream({ chunks: [{ type: "abort" as const } as never] });
describe("support v2 contract", () => {
  test("settings, chat, handoff, handler and credential parsers reject unknown keys and invalid fields", () => {
    expect(parseSupportAssistantSettings({ mode: "operator", model: "", instructions: "" })).not.toBeNull();
    expect(parseSupportAssistantSettings({ mode: "assistant", model: "", instructions: "" })).toBeNull();
    expect(parseSupportAssistantSettings({ mode: "hybrid", model: "A/b", instructions: "" })).toBeNull();
    expect(parseSupportAssistantSettings({ mode: "assistant", model: "a/b", instructions: "\u0000" })).toBeNull();
    expect(parseCustomerSupportChatRequest(chat)?.message.text).toBe("Hello");
    for (const input of [{ ...chat, message: { ...chat.message, id: "bad" } }, { ...chat, message: { ...chat.message, text: "\u0000" } }, { ...chat, conversationId }, { ...chat, version: 1 }]) expect(parseCustomerSupportChatRequest(input)).toBeNull();
    expect(parseCustomerSupportHandoffRequest({ version: 2 })).not.toBeNull();
    expect(parseCustomerSupportHandoffRequest({ version: 2, id: conversationId })).toBeNull();
    expect(parseOperatorSupportHandlerRequest({ version: 2, handler: "assistant" })).not.toBeNull();
    expect(parseOperatorSupportHandlerRequest({ version: 2, handler: "bot" })).toBeNull();
    expect(parseSupportCredentialPutRequest({ version: 2, apiKey: " 12345678 " })?.apiKey).toBe("12345678");
    expect(parseSupportCredentialPutRequest({ version: 2, apiKey: "short" })).toBeNull();
    expect(parseSupportCredentialPutRequest({ version: 2, apiKey: "12345678\n" })).not.toBeNull();
    expect(parseSupportCredentialPutRequest({ version: 2, apiKey: "12\n345678" })).toBeNull();
    expect(parseSupportCredentialResponse({ version: 2, configured: false, last4: null, updatedAt: null, available: false })).not.toBeNull();
    expect(parseSupportCredentialResponse({ version: 2, configured: false, last4: null, updatedAt: null, available: true })).toBeNull();
    expect(parseCustomerSupportResponse(customer)).not.toBeNull();
    expect(parseCustomerSupportResponse({ ...customer, conversation: { ...customer.conversation, messages: [{ id: messageId, authorType: "customer", status: "sent", body: "hello", createdAt: "2026-01-01T00:00:00.000Z" }] } })).toBeNull();
    expect(parseOperatorSupportConversationResponse(operator)).not.toBeNull();
    expect(parseOperatorSupportListResponse({ version: 2, conversations: [{ id: conversationId, status: "open", handler: "assistant", lastMessageAt: "2026-01-01T00:00:00.000Z", preview: "hello", lastAuthorType: "customer", unread: false, customerLabel: "Customer" }], nextCursor: null })).not.toBeNull();
    expect(parseSupportErrorResponse({ error: { code: "SUPPORT_CONFLICT", body: "private" } })).toBeNull();
    expect(parseSupportStreamData({ handler: "operator", conversationId, discardedMessageId: messageId })).toEqual({ handler: "operator", conversationId, discardedMessageId: messageId });
    expect(parseSupportStreamData({ handler: "operator", conversationId, discardedMessageId: "invalid" })).toBeNull();
    expect(parseSupportStreamData({ handler: "assistant", conversationId, body: "secret" })).toBeNull();
  });
});

describe("support stream data", () => {
  test("limit metadata requires a positive retry delay and rejects unknown fields", () => {
    expect(parseSupportStreamData({ handler: "assistant", conversationId, limited: { retryAfter: 600 } })?.limited).toEqual({ retryAfter: 600 });
    expect(parseSupportStreamData({ handler: "assistant", conversationId, limited: { retryAfter: 0 } })).toBeNull();
    expect(parseSupportStreamData({ handler: "assistant", conversationId, limited: { retryAfter: "600" } })).toBeNull();
    expect(parseSupportStreamData({ handler: "assistant", conversationId, limited: { retryAfter: 600, unexpected: true } })).toBeNull();
  });
});

describe("support v2 routes", () => {
  test("operator reply conflict returns a parsed SUPPORT_CONFLICT response", async () => {
    const { options, store } = setup();
    store.sendOperator = async () => ({ outcome: "conflict" });
    const response = await createOperatorSupportReplyHandler(options)(request(`admin/support/conversations/${conversationId}/messages`, "POST", { version: 2, body: "Reply", clientMessageId: "reply_001", readThroughMessageId: messageId }), ctx);

    expect(response.status).toBe(409);
    expect(parseSupportErrorResponse(await response.json())?.error.code).toBe("SUPPORT_CONFLICT");
  });

  test("operator reply returns 201 when sent and 200 on an idempotent replay", async () => {
    const { options, store } = setup();
    const handler = createOperatorSupportReplyHandler(options);
    for (const [replayed, status] of [[false, 201], [true, 200]] as const) {
      store.sendOperator = async () => ({ outcome: "ok", replayed, response: operator });
      const response = await handler(request(`admin/support/conversations/${conversationId}/messages`, "POST", { version: 2, body: "Reply", clientMessageId: "reply_001", readThroughMessageId: messageId }), ctx);

      expect(response.status).toBe(status);
      expect(parseOperatorSupportConversationResponse(await response.json())).toEqual(operator);
    }
  });

  test("operator reply returns NOT_FOUND for a missing conversation or a null follow-up read", async () => {
    const { options, store } = setup();
    for (const outcome of ["not-found", "ok"] as const) {
      store.sendOperator = async () => outcome === "ok" ? { outcome, replayed: false, response: operator } : { outcome };
      store.operatorConversation = async () => null;
      const response = await createOperatorSupportReplyHandler(options)(request(`admin/support/conversations/${conversationId}/messages`, "POST", { version: 2, body: "Reply", clientMessageId: "reply_001", readThroughMessageId: messageId }), ctx);

      expect(response.status).toBe(404);
      expect(parseSupportErrorResponse(await response.json())?.error.code).toBe("NOT_FOUND");
    }
  });

  test("customer identity fences GET, chat, handoff and stream includes data-support", async () => {
    const { options, calls } = setup("operator", bob);
    expect((await createCustomerSupportHandlers(options).GET(request("support"))).status).toBe(200);
    const response = await createCustomerSupportChatHandler(options)(request("support/chat", "POST", chat));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain('"type":"data-support"');
    expect(calls).toContain(`send:${bob}:Hello:${messageId}`);
expect((await createCustomerSupportHandoffHandler(options)(request("support/handoff", "POST", { version: 2 }))).status).toBe(200);
expect(calls).not.toContain(`handoff:${bob}:false`);
  });

  test("all new routes authorize before store and operator access rejects non-admin", async () => {
    const { options, calls } = setup();
    const denied = { ...options, authorize: async () => new Response(null, { status: 401 }) };
    const routes = [
      () => createCustomerSupportChatHandler(denied)(request("support/chat", "POST", chat)),
      () => createCustomerSupportHandoffHandler(denied)(request("support/handoff", "POST", { version: 2 })),
      () => createSupportCredentialHandlers(denied).GET(request("admin/support/assistant/credential")),
      () => createSupportCredentialHandlers(denied).PUT(request("admin/support/assistant/credential", "PUT", { version: 2, apiKey: "12345678" })),
      () => createSupportCredentialHandlers(denied).DELETE(request("admin/support/assistant/credential", "DELETE", { version: 2 })),
      () => createOperatorSupportHandlerHandler(denied)(request(`admin/support/conversations/${conversationId}/handler`, "POST", { version: 2, handler: "operator" }), ctx),
    ];
    for (const call of routes) expect((await call()).status).toBe(401);
    expect(calls).toEqual([]);
    const nonAdmin = { ...options, authorize: async () => session(other) };
    for (const call of [
      () => createSupportCredentialHandlers(nonAdmin).GET(request("admin/support/assistant/credential")),
      () => createSupportCredentialHandlers(nonAdmin).PUT(request("admin/support/assistant/credential", "PUT", { version: 2, apiKey: "12345678" })),
      () => createSupportCredentialHandlers(nonAdmin).DELETE(request("admin/support/assistant/credential", "DELETE", { version: 2 })),
      () => createOperatorSupportHandlerHandler(nonAdmin)(request(`admin/support/conversations/${conversationId}/handler`, "POST", { version: 2, handler: "operator" }), ctx),
    ]) expect((await call()).status).toBe(403);
  });

  test("all new mutations reject cross-origin and invalid JSON before writes", async () => {
    const { options, calls } = setup();
    const cases = [
      (origin: string, body: unknown) => createCustomerSupportChatHandler(options)(request("support/chat", "POST", body, origin)),
      (origin: string, body: unknown) => createCustomerSupportHandoffHandler(options)(request("support/handoff", "POST", body, origin)),
      (origin: string, body: unknown) => createSupportCredentialHandlers(options).PUT(request("admin/support/assistant/credential", "PUT", body, origin)),
      (origin: string, body: unknown) => createSupportCredentialHandlers(options).DELETE(request("admin/support/assistant/credential", "DELETE", body, origin)),
      (origin: string, body: unknown) => createOperatorSupportHandlerHandler(options)(request(`admin/support/conversations/${conversationId}/handler`, "POST", body, origin), ctx),
    ];
    for (const call of cases) {
      expect((await call("https://foreign.test", { version: 2 })).status).toBe(403);
      expect((await call("https://home.test", { version: 1 })).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  test("hybrid handoff and operator handler controls reject unavailable assistant", async () => {
    const { options, calls, store } = setup();
    expect((await createCustomerSupportHandoffHandler(options)(request("support/handoff", "POST", { version: 2 }))).status).toBe(200);
    expect((await createOperatorSupportHandlerHandler(options)(request(`admin/support/conversations/${conversationId}/handler`, "POST", { version: 2, handler: "operator" }), ctx)).status).toBe(200);
    expect(calls).toContain("handler:operator");
    const off = setup("operator");
    expect((await createOperatorSupportHandlerHandler(off.options)(request(`admin/support/conversations/${conversationId}/handler`, "POST", { version: 2, handler: "assistant" }), ctx)).status).toBe(409);
    const fenced = { ...options, store: () => ({ ...store, setHandler: async () => "conflict" as const }) as unknown as SupportStore };
    expect((await createOperatorSupportHandlerHandler(fenced)(request(`admin/support/conversations/${conversationId}/handler`, "POST", { version: 2, handler: "assistant" }), ctx)).status).toBe(409);
    const missing = { ...options, store: () => ({ ...store, setHandler: async () => "not-found" as const }) as unknown as SupportStore };
    expect((await createOperatorSupportHandlerHandler(missing)(request(`admin/support/conversations/${conversationId}/handler`, "POST", { version: 2, handler: "operator" }), ctx)).status).toBe(404);
    expect((await createOperatorSupportHandlerHandler(options)(request(`admin/support/conversations/bad/handler`, "POST", { version: 2, handler: "operator" }), { params: Promise.resolve({ id: "bad" }) })).status).toBe(404);
  });
  test("stale handoff persists operator takeover; assistant-only still conflicts while available", async () => {
    const fixture = setup("assistant");
    const unavailable = { ...fixture.options, assistant: () => ({ capability: async () => ({ available: false, handoff: false }) }) as SupportAssistantStore };
    const result = await createCustomerSupportHandoffHandler(unavailable)(request("support/handoff", "POST", { version: 2 }));
    expect(result.status).toBe(200);
    expect(fixture.calls).toContain(`handoff:${alice}:true`);
    const available = setup("assistant");
    const conflict = await createCustomerSupportHandoffHandler(available.options)(request("support/handoff", "POST", { version: 2 }));
    expect(conflict.status).toBe(409);
    expect(available.calls).toContain(`handoff:${alice}:false`);
  });

  test("credential route returns metadata but never key and does not leak on unavailable writes", async () => {
    const { options, calls } = setup();
    const route = createSupportCredentialHandlers(options);
    expect(await route.GET(request("admin/support/assistant/credential")).then((r) => r.json())).toEqual({ version: 2, configured: true, last4: "test", updatedAt: "2026-01-01T00:00:00.000Z", available: true });
    const put = await route.PUT(request("admin/support/assistant/credential", "PUT", { version: 2, apiKey: "abcdefgh1234" }));
    expect((await put.text()).includes("abcdefgh")).toBe(false);
    expect(calls).toContain("put:12");
    expect((await route.DELETE(request("admin/support/assistant/credential", "DELETE", { version: 2 }))).status).toBe(200);
    const unavailable = { ...options, assistant: () => ({ ...options.assistant(), put: async () => null }) as unknown as SupportAssistantStore };
    expect((await createSupportCredentialHandlers(unavailable).PUT(request("admin/support/assistant/credential", "PUT", { version: 2, apiKey: "abcdefgh1234" }))).status).toBe(503);
  });

  test("budget exhaustion hands hybrid to a person and rate-limits assistant mode", async () => {
    const hybrid = setup();
    const exhausted = { ...hybrid.store, claimAssistantRun: async () => ({ status: "limited" as const, retryAfter: 86400 as const }) } as unknown as SupportStore;
    const handed = await createCustomerSupportChatHandler({ ...hybrid.options, store: () => exhausted })(request("support/chat", "POST", chat));
    expect((await handed.text())).toContain('"handler":"operator"');
    expect(hybrid.calls).toContain(`handoff:${alice}:true`);
    expect(hybrid.handoffs).toContainEqual([alice, true, true, messageId]);
    const assistant = setup("assistant");
    const exhaustedAssistant = { ...assistant.store, claimAssistantRun: async () => ({ status: "limited" as const, retryAfter: 86400 as const }) } as unknown as SupportStore;
    const limited = await createCustomerSupportChatHandler({ ...assistant.options, store: () => exhaustedAssistant })(request("support/chat", "POST", chat));
    expect(limited.status).toBe(200);
    const events = (await limited.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as { type: string; data?: unknown });
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(parseSupportStreamData(events.find((event) => event.type === "data-support")?.data)).toEqual({ handler: "assistant", conversationId, limited: { retryAfter: 86400 } });
  });

  test("save-time assistant budget discards streamed text and reports typed limit metadata", async () => {
    const fixture = setup("assistant");
    const store = { ...fixture.store, saveAssistant: async () => "budget" as const } as unknown as SupportStore;
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, model })(request("support/chat", "POST", chat));
    const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as { type: string; messageId?: string; data?: unknown });
    const started = events.find((event) => event.type === "start");
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(parseSupportStreamData(events.findLast((event) => event.type === "data-support")?.data)).toEqual({ handler: "assistant", conversationId, discardedMessageId: started?.messageId, limited: { retryAfter: 86400 } });
    expect(fixture.handoffs).toEqual([]);
  });
  test("save-time hybrid budget hands off only its pending message", async () => {
    const fixture = setup();
    const store = { ...fixture.store, saveAssistant: async () => "budget" as const } as unknown as SupportStore;
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, model })(request("support/chat", "POST", chat));
    expect((await response.text())).toContain('"handler":"operator"');
    expect(fixture.handoffs).toEqual([[alice, true, true, messageId]]);
  });

  test("replay waits up to 35 seconds for its active claim and errors without a second model call", async () => {
    const fixture = setup("assistant");
    let waits = 0, models = 0, now = 0;
    const store = { ...fixture.store, claimAssistantRun: async () => ({ status: "answering" as const }) } as unknown as SupportStore;
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, now: () => now, wait: async (ms) => { now += ms; waits++; }, model: () => { models++; return model(); } })(request("support/chat", "POST", chat));
    const body = await response.text();
    expect(body).toContain('"type":"data-support"');
    expect(body).toContain('"type":"error"');
    expect(body).not.toContain('"type":"text-delta"');
    expect(waits).toBe(70);
    expect(models).toBe(0);
  });
  test("a disabled assistant between claim and model call releases the claim without a model call", async () => {
    const fixture = setup("hybrid");
    let reads = 0, released = 0, models = 0;
    const assistant = {
      effective: async () => {
        reads += 1;
        return reads >= 3
          ? { settings: { mode: "operator" as const, model: "", instructions: "" }, key: null, available: false, capability: { available: false, handoff: false } }
          : { settings: { mode: "hybrid" as const, model: "acme/support", instructions: "" }, key: "fixture-key", available: true, capability };
      },
    } as unknown as SupportAssistantStore;
    const store = { ...fixture.store, releaseAssistantRun: async () => { released += 1; }, handlerForCustomer: async (_id: string, capability: { available: boolean }) => ({ id: conversationId, handler: capability.available ? "assistant" as const : "operator" as const }) } as unknown as SupportStore;
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, assistant: () => assistant, model: () => { models += 1; return model(); } })(request("support/chat", "POST", chat));
    const body = await response.text();
    expect(body).toContain('"type":"data-support"');
    expect(body).toContain('"handler":"operator"');
    expect(body).not.toContain('"type":"text-delta"');
    expect(reads).toBe(3);
    expect(released).toBe(1);
    expect(models).toBe(0);
    expect(fixture.calls).toContain(`handoff:${alice}:true`);
  });
  test("a failing configuration read hands the message to the operator", async () => {
    const fixture = setup("hybrid");
    let reads = 0, released = 0, models = 0;
    const assistant = {
      effective: async () => {
        reads += 1;
        if (reads >= 3) throw new Error("invalid support assistant settings");
        return { settings: { mode: "hybrid" as const, model: "acme/support", instructions: "" }, key: "fixture-key", available: true, capability };
      },
    } as unknown as SupportAssistantStore;
    const store = { ...fixture.store, releaseAssistantRun: async () => { released += 1; } } as unknown as SupportStore;
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, assistant: () => assistant, model: () => { models += 1; return model(); } })(request("support/chat", "POST", chat));
    const body = await response.text();
    expect(body).toContain('"type":"data-support"');
    expect(body).toContain('"handler":"operator"');
    expect(body).not.toContain('"type":"error"');
    expect(reads).toBe(3);
    expect(released).toBe(1);
    expect(models).toBe(0);
    expect(fixture.calls).toContain(`handoff:${alice}:true`);
  });
  test("an unreadable configuration read before the send still queues the message for the operator", async () => {
    const fixture = setup("hybrid");
    let models = 0;
    const capabilities: unknown[] = [];
    const sendCustomer = fixture.store.sendCustomer;
    const store = { ...fixture.store, sendCustomer: async (...args: Parameters<SupportStore["sendCustomer"]>) => { capabilities.push(args[3]); return sendCustomer(...args); } } as unknown as SupportStore;
    const assistant = { effective: async () => { throw new Error("invalid support assistant settings"); } } as unknown as SupportAssistantStore;
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, assistant: () => assistant, model: () => { models += 1; return model(); } })(request("support/chat", "POST", chat));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(capabilities).toEqual([{ available: false, handoff: false }]);
    expect(fixture.calls).toContain(`send:${alice}:Hello:${messageId}`);
    expect(body).toContain('"type":"data-support"');
    expect(body).toContain('"handler":"operator"');
    expect(body).not.toContain('"type":"text-delta"');
    expect(models).toBe(0);
  });
  test("an unreadable configuration still serves the customer conversation and the operator inbox", async () => {
    const fixture = setup("hybrid");
    const seen: unknown[] = [];
    const store = {
      ...fixture.store,
      customerConversation: async (_id: string, _before: string | undefined, capability: unknown) => { seen.push(capability); return customer; },
      list: async (_input: unknown, capability: unknown) => { seen.push(capability); return { version: SUPPORT_CONTRACT_VERSION, conversations: [], nextCursor: null }; },
      operatorConversation: async (_id: string, _before: string | undefined, capability: unknown) => { seen.push(capability); return operator; },
    } as unknown as SupportStore;
    const assistant = { capability: async () => { throw new Error("invalid support assistant settings"); } } as unknown as SupportAssistantStore;
    const options = { ...fixture.options, store: () => store, assistant: () => assistant };
    expect((await createCustomerSupportHandlers(options).GET(request("support"))).status).toBe(200);
    expect((await createOperatorSupportListHandler(options)(request("admin/support/conversations"))).status).toBe(200);
    expect((await createOperatorSupportConversationHandler(options)(request(`admin/support/conversations/${conversationId}`), ctx)).status).toBe(200);
    expect(seen).toEqual([{ available: false, handoff: false }, { available: false, handoff: false }, { available: false, handoff: false }]);
  });
  test("an unavailable assistant hands the pending message to the operator", async () => {
    const fixture = setup("operator");
    let models = 0;
    const response = await createCustomerSupportChatHandler({ ...fixture.options, model: () => { models += 1; return model(); } })(request("support/chat", "POST", chat));
    const body = await response.text();
    expect(body).toContain('"type":"data-support"');
    expect(body).toContain('"handler":"operator"');
    expect(body).not.toContain('"type":"text-delta"');
    expect(fixture.calls).toContain(`handoff:${alice}:true`);
    expect(models).toBe(0);
  });
  test("an empty assistant stream becomes a retryable failure", async () => {
    const fixture = setup("assistant");
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
    const empty = () => new MockLanguageModelV3({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage }] }) }) });
    const body = await (await createCustomerSupportChatHandler({ ...fixture.options, model: empty })(request("support/chat", "POST", chat))).text();
    expect(body).toContain("The assistant couldn't reply. Please try again.");
    expect(body).toContain('"handler":"assistant"');
    expect(fixture.calls.some((call) => call.startsWith("saved:"))).toBe(false);
  });

  test("a provider failure after the assistant is disabled hands the message to the operator", async () => {
    const fixture = setup("assistant");
    let reads = 0, models = 0;
    const assistant = {
      effective: async () => {
        reads += 1;
        return reads <= 3
          ? { settings: { mode: "assistant" as const, model: "acme/support", instructions: "" }, key: "fixture-key", available: true, capability: { available: true, handoff: false } }
          : { settings: { mode: "operator" as const, model: "", instructions: "" }, key: null, available: false, capability: { available: false, handoff: false } };
      },
    } as unknown as SupportAssistantStore;
    const broken = () => new MockLanguageModelV3({ doStream: async () => { throw new Error("private-model-output"); } });
    const response = await createCustomerSupportChatHandler({ ...fixture.options, assistant: () => assistant, model: () => { models += 1; return broken(); } })(request("support/chat", "POST", chat));
    const body = await response.text();
    expect(body).not.toContain("The assistant couldn't reply");
    expect(body).toContain('"handler":"operator"');
    expect(body).not.toContain("private-model-output");
    expect(fixture.calls).toContain(`handoff:${alice}:true`);
    expect(models).toBe(1);
  });

  test("provider errors hand hybrid off but assistant mode emits retryable stream error", async () => {
    const broken = () => new MockLanguageModelV3({ doStream: async () => { throw new Error("private-model-output"); } });
    const hybrid = setup();
    const handed = await createCustomerSupportChatHandler({ ...hybrid.options, model: broken })(request("support/chat", "POST", chat));
    expect((await handed.text())).toContain('"handler":"operator"');
    expect(hybrid.calls).toContain(`handoff:${alice}:true`);
    expect(hybrid.handoffs).toContainEqual([alice, true, true, messageId]);
    const assistant = setup("assistant");
    const error = await createCustomerSupportChatHandler({ ...assistant.options, model: broken })(request("support/chat", "POST", chat));
    const body = await error.text();
    expect(body).toContain("The assistant couldn't reply. Please try again.");
    expect(body).not.toContain("private-model-output");
    expect(assistant.calls).not.toContain(`handoff:${alice}:true`);
  });

  test("SDK abort without a cancelled request is a provider failure in both modes", async () => {
    const aborting = () => new MockLanguageModelV3({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: "abort" as const } as never] }) }) });
    for (const mode of ["assistant", "hybrid"] as const) {
      const fixture = setup(mode);
      const body = await (await createCustomerSupportChatHandler({ ...fixture.options, model: aborting })(request("support/chat", "POST", chat))).text();
      if (mode === "hybrid") {
        expect(body).toContain('"handler":"operator"');
        expect(fixture.calls).toContain(`handoff:${alice}:true`);
      } else {
        expect(body).toContain("The assistant couldn't reply. Please try again.");
        expect(fixture.calls).not.toContain(`handoff:${alice}:true`);
      }
    }
  });

  test("customer abort after text preserves produced text without provider-failure handoff", async () => {
    const fixture = setup("hybrid");
    const controller = new AbortController();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let claimReleased!: () => void;
    const released = new Promise<void>((resolve) => { claimReleased = resolve; });
    const store = { ...fixture.store, releaseAssistantRun: async () => { claimReleased(); } } as unknown as SupportStore;
    const interrupted = () => new MockLanguageModelV3({ doStream: async () => {
      let part = 0;
      return { stream: new ReadableStream({ async pull(stream) {
        if (part++ === 0) stream.enqueue({ type: "text-start", id: "t" });
        else if (part === 2) stream.enqueue({ type: "text-delta", id: "t", delta: "Before abort" });
        else { await hold; stream.enqueue({ type: "abort" } as never); stream.close(); }
      } }) };
    } });
    const original = request("support/chat", "POST", chat);
    const interruptedRequest = new Request(original, { signal: controller.signal });
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, model: interrupted })(interruptedRequest);
    const reader = response.body!.getReader();
    let output = "";
    while (!output.includes("Before abort")) {
      const result = await reader.read();
      if (result.done) throw new Error("Stream closed before the text delta");
      output += new TextDecoder().decode(result.value);
    }
    controller.abort();
    await released;
    expect(fixture.calls).toContain("saved:Before abort");
    release();
    while (true) { const result = await reader.read(); if (result.done) break; output += new TextDecoder().decode(result.value); }
    expect(fixture.calls).toContain("saved:Before abort");
    expect(fixture.calls).not.toContain(`handoff:${alice}:true`);
    expect(output).not.toContain("discardedMessageId");
  });
  test("an abort while the claim is pending releases it and hands off only the pending hybrid message", async () => {
    const fixture = setup("hybrid");
    const controller = new AbortController();
    let claimStarted!: () => void, completeClaim!: () => void;
    const entered = new Promise<void>((resolve) => { claimStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { completeClaim = resolve; });
    const handoffs: Array<Parameters<SupportStore["handoffCustomer"]>> = [];
    let released = 0, models = 0;
    const store = { ...fixture.store,
      claimAssistantRun: async (...args: Parameters<SupportStore["claimAssistantRun"]>) => { claimStarted(); await blocked; return fixture.store.claimAssistantRun(...args); },
      handoffCustomer: async (...args: Parameters<SupportStore["handoffCustomer"]>) => { handoffs.push(args); return fixture.store.handoffCustomer(...args); },
      releaseAssistantRun: async () => { released++; },
    } as unknown as SupportStore;
    const original = request("support/chat", "POST", chat);
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, model: () => { models++; return model(); } })(new Request(original, { signal: controller.signal }));
    const output = response.text();
    await entered;
    controller.abort();
    completeClaim();
    expect(await output).toContain('"handler":"operator"');
    expect(handoffs).toEqual([[alice, true, true, messageId]]);
    expect(released).toBe(1);
    expect(models).toBe(0);
    expect(fixture.calls.some((call) => call.startsWith("saved:"))).toBe(false);
  });
  test("cancelling before the first token hands a hybrid pending message to the operator", async () => {
    const fixture = setup("hybrid");
    const controller = new AbortController();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const modelWithoutToken = () => new MockLanguageModelV3({ doStream: async () => { started(); await hold; return { stream: streamReplyWithoutToken() }; } });
    const original = request("support/chat", "POST", chat);
    const response = await createCustomerSupportChatHandler({ ...fixture.options, model: modelWithoutToken })(new Request(original, { signal: controller.signal }));
    const output = response.text();
    await entered;
    controller.abort();
    release();
    await output;
    expect(fixture.calls).toContain(`handoff:${alice}:true`);
    expect(fixture.calls.some((call) => call.startsWith("saved:"))).toBe(false);
  });

  test("assistant-only cancellation before a claim keeps the message retryable without operator takeover", async () => {
    const fixture = setup("assistant");
    const controller = new AbortController();
    controller.abort();
    let models = 0;
    const original = request("support/chat", "POST", chat);
    const response = await createCustomerSupportChatHandler({ ...fixture.options, model: () => { models++; return model(); } })(new Request(original, { signal: controller.signal }));
    await response.text();
    expect(models).toBe(0);
    expect(fixture.calls).not.toContain(`handoff:${alice}:true`);
    expect(fixture.calls).toContain(`send:${alice}:Hello:${messageId}`);
    expect(fixture.calls.some((call) => call.startsWith("saved:"))).toBe(false);
    expect(await (await createCustomerSupportChatHandler({ ...fixture.options, model: () => { models++; return model(); } })(original)).text()).toContain("Welcome");
    expect(models).toBe(1);
  });

  test("partial text followed by provider error is discarded and replay regenerates", async () => {
    const fixture = setup("assistant");
    let attempts = 0;
    let saved: "sent" | "discarded" | null = null;
    const store = { ...fixture.store,
      sendCustomer: async () => ({ response: { ...customer, assistant: { available: true, handoff: false } }, replayed: attempts > 0, messageId }),
      claimAssistantRun: async () => saved === "sent" ? { status: "skipped" as const } : { status: "claimed" as const, runId: crypto.randomUUID() },
      saveAssistant: async (_id: string, _messageId: string, _text: string, _runId: string, discard: boolean) => { saved = discard ? "discarded" : "sent"; return saved; },
    } as unknown as SupportStore;
    const failing = () => new MockLanguageModelV3({ doStream: async (params) => {
      attempts++;
      if (attempts > 1) return model().doStream(params);
      return { stream: simulateReadableStream({ chunks: [{ type: "text-start" as const, id: "t" }, { type: "text-delta" as const, id: "t", delta: "Partial" }, { type: "error" as const, error: new Error("private-provider-error") }] }) };
    } });
    const handler = createCustomerSupportChatHandler({ ...fixture.options, store: () => store, model: failing });
    const first = await (await handler(request("support/chat", "POST", chat))).text();
    expect(first).toContain("Partial");
    expect(first).toContain('"discardedMessageId"');
    expect(first).toContain("Please try again.");
    expect(first).not.toContain("private-provider-error");
    expect(saved as string | null).toBe("discarded");
    expect(await (await handler(request("support/chat", "POST", chat))).text()).toContain("Welcome");
    expect(saved as string | null).toBe("sent");
    expect(attempts).toBe(2);
  });

  test("a turn whose claim was superseded before the model call never calls the model", async () => {
    const fixture = setup("assistant");
    let modelCalls = 0;
    fixture.store.ownsAssistantRun = async () => false;
    const counted = () => new MockLanguageModelV3({ doStream: async () => { modelCalls += 1; return { stream: simulateReadableStream({ chunks: [] }) }; } });
    const response = await createCustomerSupportChatHandler({ ...fixture.options, model: counted })(request("support/chat", "POST", chat));
    const events: Array<{ type: string }> = (await response.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    expect(modelCalls).toBe(0);
    expect(events.some((event) => event.type === "error" || event.type === "text-delta")).toBe(false);
    expect(fixture.calls.some((call) => call.startsWith("saved:"))).toBe(false);
  });
  test("a streamed reply that fails to persist is identified for the client to discard", async () => {
    const fixture = setup("assistant");
    fixture.store.saveAssistant = async () => { throw new Error("database unavailable"); };
    const response = await createCustomerSupportChatHandler({ ...fixture.options, model })(request("support/chat", "POST", chat));
    const events: Array<{ type: string; messageId?: string; data?: unknown }> = (await response.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    const streamedId = events.find((event) => event.type === "start")?.messageId;
    expect(streamedId).toBeDefined();
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(events.filter((event) => event.type === "data-support").map((event) => parseSupportStreamData(event.data)?.discardedMessageId)).toContain(streamedId);
  });
  test("text streaming stops at 2000 characters and saves exactly the streamed text", async () => {
    const fixture = setup("assistant");
    let saved = "";
    let modelSignal: AbortSignal | undefined;
    const store = { ...fixture.store, saveAssistant: async (_id: string, _mid: string, text: string) => { saved = text; return "sent" as const; } } as unknown as SupportStore;
    const long = () => new MockLanguageModelV3({ doStream: async (params) => { modelSignal = params.abortSignal; return { stream: simulateReadableStream({ chunks: [{ type: "text-start" as const, id: "t" }, { type: "text-delta" as const, id: "t", delta: "A".repeat(1500) }, { type: "text-delta" as const, id: "t", delta: "B".repeat(1000) }, { type: "text-delta" as const, id: "t", delta: "C".repeat(100) }] }) }; } });
    const response = await createCustomerSupportChatHandler({ ...fixture.options, store: () => store, model: long })(request("support/chat", "POST", chat));
    const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as { type: string; delta?: string });
    const streamed = events.filter((event) => event.type === "text-delta").map((event) => event.delta).join("");
    expect(streamed).toBe(saved);
    expect(saved).toBe("A".repeat(1500) + "B".repeat(500));
    expect(streamed).not.toContain("C");
    expect(modelSignal?.aborted).toBe(true);
  });
  test("assistant-only replay after provider failure reruns, but replay after success does not", async () => {
    const fixture = setup("assistant");
    let attempts = 0;
    let completed = false;
    const replayStore = { ...fixture.store,
      sendCustomer: async () => ({ response: { ...customer, assistant: { available: true, handoff: false } }, replayed: attempts > 0, messageId }),
      claimAssistantRun: async () => completed ? { status: "skipped" as const } : { status: "claimed" as const, runId: crypto.randomUUID() },
      saveAssistant: async () => { completed = true; return "sent" as const; },
    } as unknown as SupportStore;
    const responding = model();
    const broken = () => new MockLanguageModelV3({ doStream: async (params) => { attempts++; if (attempts === 1) throw new Error("failed"); return responding.doStream(params); } });
    const handler = createCustomerSupportChatHandler({ ...fixture.options, store: () => replayStore, model: broken });
    expect(await (await handler(request("support/chat", "POST", chat))).text()).toContain("Please try again.");
    expect(await (await handler(request("support/chat", "POST", chat))).text()).toContain("Welcome");
    expect(await (await handler(request("support/chat", "POST", chat))).text()).not.toContain("Welcome");
    expect(attempts).toBe(2);
  });

  test("concurrent chat replays emit only one model turn", async () => {
    const fixture = setup("assistant");
    let claims = 0;
    let generations = 0;
        const replayStore = { ...fixture.store, claimAssistantRun: async () => ++claims === 1 ? { status: "claimed" as const, runId: crypto.randomUUID() } : { status: "skipped" as const } } as unknown as SupportStore;
    const handler = createCustomerSupportChatHandler({ ...fixture.options, store: () => replayStore, model: () => { generations++; return model(); } });
    const [first, second] = await Promise.all([handler(request("support/chat", "POST", chat)), handler(request("support/chat", "POST", chat))]);
    const bodies = await Promise.all([first.text(), second.text()]);
    expect(bodies.filter((body) => body.includes("Welcome"))).toHaveLength(1);
    expect(generations).toBe(1);
  });

  test("AI SDK hybrid tool executes a server-side handoff; assistant-only never offers the tool", async () => {
    const hybrid = setup();
    let calls = 0;
    let toolResult = "";
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const toolModel = () => new MockLanguageModelV3({ doStream: async (params) => {
      calls++;
      if (calls === 2) toolResult = JSON.stringify(params.prompt);
      return { stream: simulateReadableStream({ chunks: [
        ...(calls === 1 ? [{ type: "tool-call" as const, toolCallId: "handoff-1", toolName: "handoff_to_operator", input: "{}" }] : []),
        { type: "finish" as const, finishReason: { unified: calls === 1 ? "tool-calls" as const : "stop" as const, raw: undefined }, usage },
      ] }) };
    } });
    const streamed = await createCustomerSupportChatHandler({ ...hybrid.options, model: toolModel })(request("support/chat", "POST", chat));
    expect((await streamed.text())).toContain('"handler":"operator"');
    expect(hybrid.handoffs).toContainEqual([alice, true, true, messageId]);
    expect(toolResult).toContain('"handler":"operator"');
    expect(hybrid.calls.some((call) => call.startsWith("saved:"))).toBe(false);
    const assistant = setup("assistant");
    const only = await createCustomerSupportChatHandler({ ...assistant.options, model: toolModel })(request("support/chat", "POST", chat));
    await only.text();
    expect(assistant.calls).not.toContain(`handoff:${alice}:true`);
  });


  test("take-over during streaming emits discardedMessageId so the client removes transient text", async () => {
    const fixture = setup();
    const taken = { ...fixture.store, saveAssistant: async () => "discarded" as const, handlerForCustomer: async () => ({ id: conversationId, handler: "operator" as const }) } as unknown as SupportStore;
    const streamed = await createCustomerSupportChatHandler({ ...fixture.options, store: () => taken, model })(request("support/chat", "POST", chat));
    const events = (await streamed.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as { type: string; messageId?: string; data?: { discardedMessageId?: string; handler?: string } });
    const start = events.find((event) => event.type === "start");
    const support = events.find((event) => event.type === "data-support");
    expect(start?.messageId).toBeDefined();
    expect(support?.data).toMatchObject({ handler: "operator", discardedMessageId: start?.messageId });
  });


  test("local fixture stream is deterministic and never opens a provider or database", async () => {
    const previous = process.env.HOME_PLAYWRIGHT_SMOKE;
    process.env.HOME_PLAYWRIGHT_SMOKE = "1";
    try {
      const response = await createCustomerSupportChatHandler({ authorize: async () => { throw new Error("fixture must not authorize remotely"); }, store: () => { throw new Error("fixture must not use the database"); } })(new Request("http://127.0.0.1:3199/api/support/chat", { method: "POST", headers: { origin: "http://127.0.0.1:3199", "content-type": "application/json" }, body: JSON.stringify(chat) }));
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("I can help with that.");
      expect(body).toContain('"type":"data-support"');
    } finally { if (previous === undefined) delete process.env.HOME_PLAYWRIGHT_SMOKE; else process.env.HOME_PLAYWRIGHT_SMOKE = previous; }
  });


  test("AI SDK mock streams and saves a bounded assistant reply without sending model data to observability", async () => {
    const { options, calls } = setup();
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    try {
      const response = await createCustomerSupportChatHandler({ ...options, model })(request("support/chat", "POST", chat));
      const body = await response.text();
      expect(body).toContain("Welcome");
      expect(body).toContain('"type":"data-support"');
      expect(calls).toContain("saved:Welcome");
      expect(lines.join(" ")).not.toContain("Welcome");
    } finally { setObservabilityLogWriterForTests(); }
  });
});

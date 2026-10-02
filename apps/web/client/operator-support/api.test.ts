import { afterEach, expect, test } from "bun:test";
import { operatorSupportTransport, fetchOperatorSupportSummary, SupportConflictError } from "./api";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("operator list, summary and read use same-origin cookie requests", async () => {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (path: string | URL | Request, init?: RequestInit) => {
    calls.push({ path: String(path), init });
    if (String(path).endsWith("/summary")) return Response.json({ version: 2, unreadConversations: 3 });
    if (String(path).endsWith("/read")) return new Response(null, { status: 204 });
    return Response.json({ version: 2, conversations: [], nextCursor: null });
  }) as typeof fetch;
  expect((await fetchOperatorSupportSummary()).unreadConversations).toBe(3);
  expect((await operatorSupportTransport.list("resolved")).conversations).toEqual([]);
  await operatorSupportTransport.read("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  expect(calls.map((call) => call.path)).toEqual([
    "/api/admin/support/summary",
    "/api/admin/support/conversations?status=resolved",
    "/api/admin/support/conversations/11111111-1111-4111-8111-111111111111/read",
  ]);
  expect(calls.every((call) => call.init?.credentials === "same-origin")).toBe(true);
  expect(calls[2].init?.method).toBe("POST");
  expect(calls[2].init?.headers).toEqual({ "Content-Type": "application/json" });
  expect(calls[2].init?.body).toBe(JSON.stringify({ version: 2, lastMessageId: "22222222-2222-4222-8222-222222222222" }));
});

test("invalid API responses are rejected instead of displayed", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return Response.json({ version: 1, unreadConversations: 0 }); }) as typeof fetch;
  expect(fetchOperatorSupportSummary()).rejects.toThrow("Couldn't load support. Try again.");
});

test("an authentication outage is surfaced instead of failing the parser", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return Response.json({ error: { code: "AUTH_UNAVAILABLE" } }, { status: 503 }); }) as typeof fetch;
  expect(operatorSupportTransport.list("open")).rejects.toThrow("Authentication is temporarily unavailable. Try again.");
});

test("a status change carries the observed message and maps a conflict", async () => {
  const bodies: string[] = [];
  globalThis.fetch = (async (_path: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    if (bodies.length === 2) return Response.json({ error: { code: "SUPPORT_CONFLICT" } }, { status: 409 });
    return Response.json({ version: 2, conversation: { id: "11111111-1111-4111-8111-111111111111", status: "resolved", handler: "operator", handedOffAt: null, assistantAvailable: false, createdAt: "2026-01-01T00:00:00.000Z", resolvedAt: "2026-01-01T00:00:00.000Z", messages: [], messagesNextCursor: null, contextRefs: [] }, customer: { status: "active", country: null, firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", emails: [], accountProviders: [], wallets: [], recentEvents: [] } });
  }) as typeof fetch;
  const conversation = "11111111-1111-4111-8111-111111111111";
  expect((await operatorSupportTransport.status(conversation, "resolved", "22222222-2222-4222-8222-222222222222")).conversation.status).toBe("resolved");
  expect(bodies[0]).toBe(JSON.stringify({ version: 2, status: "resolved", observedMessageId: "22222222-2222-4222-8222-222222222222" }));
  expect(operatorSupportTransport.status(conversation, "resolved", "22222222-2222-4222-8222-222222222222")).rejects.toBeInstanceOf(SupportConflictError);
});

test("a handler change posts the requested handler and explains an unavailable assistant", async () => {
  const calls: { path: string; body: string }[] = [];
  const conversation = "11111111-1111-4111-8111-111111111111";
  globalThis.fetch = (async (path: string | URL | Request, init?: RequestInit) => {
    calls.push({ path: String(path), body: String(init?.body) });
    if (calls.length > 1) return Response.json({ error: { code: "SUPPORT_CONFLICT" } }, { status: 409 });
    return Response.json({ version: 2, conversation: { id: conversation, status: "open", handler: "operator", handedOffAt: null, assistantAvailable: true, createdAt: "2026-01-01T00:00:00.000Z", resolvedAt: null, messages: [], messagesNextCursor: null, contextRefs: [] }, customer: { status: "active", country: null, firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", emails: [], accountProviders: [], wallets: [], recentEvents: [] } });
  }) as typeof fetch;
  expect((await operatorSupportTransport.handler(conversation, "operator")).conversation.handler).toBe("operator");
  expect(calls[0]).toEqual({ path: `/api/admin/support/conversations/${conversation}/handler`, body: JSON.stringify({ version: 2, handler: "operator" }) });
  const handBack = operatorSupportTransport.handler(conversation, "assistant");
  expect(handBack).rejects.toBeInstanceOf(SupportConflictError);
  expect(handBack).rejects.toThrow("Can't hand back yet. Reply to the customer first, or check the Support assistant settings.");
  expect(operatorSupportTransport.handler(conversation, "operator")).rejects.toThrow("This conversation changed. Review the latest messages, then try again.");
});

test("a handler response from an older contract is rejected", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return Response.json({ version: 1, conversation: {}, customer: {} }); }) as typeof fetch;
  expect(operatorSupportTransport.handler("11111111-1111-4111-8111-111111111111", "operator")).rejects.toThrow("Couldn't load support. Try again.");
});

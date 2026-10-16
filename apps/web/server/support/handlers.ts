import "server-only";

import { deletionAuthErrorResponse } from "@/server/account-deletion/errors";

import { readDatabaseUrl } from "@/server/config/env";

import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { SUPPORT_CONTRACT_VERSION, parseCustomerSupportChatRequest, parseCustomerSupportHandoffRequest, parseSupportCredentialPutRequest, parseOperatorSupportHandlerRequest, parseOperatorSupportListQuery, parseOperatorSupportReplyRequest, parseOperatorSupportStatusRequest, parseSupportMessageCursor, parseSupportReadRequest, type OperatorSupportConversationResponse, type SupportAssistantCapability, type SupportErrorCode, type SupportHandler, type SupportStreamData } from "@/shared/support/contract";
import { createUIMessageStream, createUIMessageStreamResponse, streamText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { authorizeSession } from "@/server/auth/authorize";
import { HOME_SESSION_COOKIE } from "@/server/auth/native-base-session";
import { readCookie } from "@/server/auth/signed-cookie";
import { resolveCustomer } from "@/server/customers/resolve";
import { getSqlExecutor } from "@/server/db/sql";
import { readSameOriginJson } from "@/server/http/same-origin-mutation";
import { privateJson, withPrivateHeaders } from "@/server/http/private-response";
import { emitServerEvent, observeSafely } from "@/server/observability/log";
import { authorizeOperatorRequest } from "@/server/operator/api";
import { readOperatorConfig, type OperatorConfig } from "@/server/operator/config";
import { AdminAuditLog } from "@/server/operator-settings/audit";
import { SupportCustomerClosedError, SupportRateLimitedError, SupportStore } from "./store";
import { SupportAssistantStore, gatewayModel, type EffectiveAssistant } from "./assistant";

type Dependencies = {
  authorize?: (request: Request) => Promise<VerifiedAccountSession | Response>;
  config?: () => OperatorConfig;
  store?: () => SupportStore | null;
  resolve?: typeof resolveCustomer;
  audit?: () => AdminAuditLog;
  assistant?: () => SupportAssistantStore;
  model?: (key: string, id: string) => LanguageModel;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};
type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(route: string, code: SupportErrorCode, status: number, retryAfter?: number): Response {
  emitServerEvent("support", { route, code, outcome: "failed" });
  const messages: Partial<Record<SupportErrorCode, string>> = {
    INVALID_REQUEST: "Message could not be sent. Check it and try again.",
    CUSTOMER_CLOSED: "Support isn't available for this account.",
    RATE_LIMITED: "Please wait before sending another message.",
    SUPPORT_UNAVAILABLE: "Support is temporarily unavailable. Please try again.",
  };
  const message = route.startsWith("/api/admin/") ? undefined : messages[code];
  const response = privateJson({ error: { code, ...(message ? { message } : {}) } }, status);
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}
function noContent(): Response { return new Response(null, { status: 204, headers: privateJson(null, 200).headers }); }
async function conversationEtag(result: OperatorSupportConversationResponse | null): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(result)));
  return `"${Buffer.from(digest).toString("base64url")}"`;
}
async function conversationJson(result: OperatorSupportConversationResponse | null, status: number): Promise<Response> {
  const response = privateJson(result, status);
  response.headers.set("ETag", await conversationEtag(result));
  return response;
}
function getStore(deps: Dependencies): SupportStore | null { return deps.store ? deps.store() : readDatabaseUrl() ? new SupportStore(getSqlExecutor()) : null; }
function getAudit(deps: Dependencies): AdminAuditLog { return deps.audit ? deps.audit() : new AdminAuditLog(getSqlExecutor()); }
function getAssistant(deps: Dependencies): SupportAssistantStore { return deps.assistant ? deps.assistant() : new SupportAssistantStore(getSqlExecutor()); }
async function effective(deps: Dependencies): Promise<EffectiveAssistant> { return getAssistant(deps).effective(); }
async function capability(deps: Dependencies): Promise<SupportAssistantCapability> {
  try { return await getAssistant(deps).capability(); }
  catch { return { available: false, handoff: false }; }
}
async function effectiveOrNull(deps: Dependencies): Promise<EffectiveAssistant | null> {
  try { return await effective(deps); }
  catch { return null; }
}
async function takeOverWhenUnavailable(deps: Dependencies, store: SupportStore, customerId: string, messageId: string): Promise<boolean> {
  const current = await effectiveOrNull(deps);
  if (current?.capability.available && current.key) return false;
  await store.handoffCustomer(customerId, true, true, messageId);
  return true;
}
function waitForClaim(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
async function customerSession(request: Request, deps: Dependencies): Promise<VerifiedAccountSession | Response> {
  const headers = new Headers(request.headers);
  if (readCookie(request, HOME_SESSION_COOKIE).present && !headers.has(ACCOUNT_PROVIDER_HEADER)) headers.set(ACCOUNT_PROVIDER_HEADER, "base-account");
  return (deps.authorize ?? authorizeSession)(new Request(request.url, { method: request.method, headers }));
}
async function operatorSession(request: Request, deps: Dependencies): Promise<{ address: `0x${string}` } | Response> {
  return authorizeOperatorRequest(request, deps.authorize ?? authorizeSession, deps.config ?? readOperatorConfig);
}
async function run(route: string, operation: () => Promise<Response>): Promise<Response> {
  try { return await operation(); }
  catch (cause) {
    const deletionError = deletionAuthErrorResponse(cause);
    if (deletionError) return deletionError;
    if (cause instanceof SupportCustomerClosedError) return fail(route, "CUSTOMER_CLOSED", 403);
    if (cause instanceof SupportRateLimitedError) return fail(route, "RATE_LIMITED", 429, cause.retryAfter);
    return fail(route, "SUPPORT_UNAVAILABLE", 503);
  }
}
async function customer(request: Request, deps: Dependencies, route: string, create: boolean): Promise<{ session: VerifiedAccountSession; id: string | null; store: SupportStore } | Response> {
  const session = await customerSession(request, deps);
  if (session instanceof Response) return session;
  const store = getStore(deps);
  if (!store) return fail(route, "SUPPORT_UNAVAILABLE", 503);
  const resolved = await (deps.resolve ?? resolveCustomer)(session, create ? { create: true } : { create: false });
  if (resolved?.status === "closed") return fail(route, "CUSTOMER_CLOSED", 403);
  if (create && !resolved) return fail(route, "SUPPORT_UNAVAILABLE", 503);
  return { session, id: resolved?.id ?? null, store };
}
async function operator(request: Request, deps: Dependencies, route: string): Promise<{ address: `0x${string}`; store: SupportStore } | Response> {
  const decision = await operatorSession(request, deps);
  if (decision instanceof Response) return decision;
  const store = getStore(deps);
  return store ? { ...decision, store } : fail(route, "SUPPORT_UNAVAILABLE", 503);
}
async function conversationId(context: Context, route: string): Promise<string | Response> {
  const { id } = await context.params;
  return uuid.test(id) ? id : fail(route, "NOT_FOUND", 404);
}

const SUPPORT_VIEW_AUDIT_WINDOW_SECONDS = 15 * 60;

export function createCustomerSupportHandlers(deps: Dependencies = {}) {
  const GET = async (request: Request): Promise<Response> => run("/api/support", async () => {
    const access = await customer(request, deps, "/api/support", false);
    if (access instanceof Response) return access;
    const cursor = parseSupportMessageCursor(new URL(request.url).searchParams);
    if (!cursor) return fail("/api/support", "INVALID_REQUEST", 400);
    const assistant = await capability(deps);
    return privateJson(access.id ? await access.store.customerConversation(access.id, cursor.before, assistant) : { version: SUPPORT_CONTRACT_VERSION, conversation: null, assistant }, 200);
  });
  return { GET };
}
export function createCustomerSupportSummaryHandler(deps: Dependencies = {}) {
  return async (request: Request): Promise<Response> => run("/api/support/summary", async () => {
    const access = await customer(request, deps, "/api/support/summary", false);
    if (access instanceof Response) return access;
    return privateJson(access.id ? await access.store.customerSummary(access.id) : { version: SUPPORT_CONTRACT_VERSION, unreadCount: 0 }, 200);
  });
}
function supportStream(id: string, handler: SupportHandler, turn?: (writer: Parameters<Parameters<typeof createUIMessageStream>[0]["execute"]>[0]["writer"]) => Promise<SupportStreamData>): Response {
  const stream = createUIMessageStream({ execute: async ({ writer }) => {
    let final: SupportStreamData = { handler, conversationId: id };
    try { if (turn) final = await turn(writer); }
    catch { writer.write({ type: "error", errorText: "Support is temporarily unavailable." }); }
    writer.write({ type: "data-support", data: final });
  }, onError: () => "Support is temporarily unavailable." });
  return withPrivateHeaders(createUIMessageStreamResponse({ stream }));
}

export function createCustomerSupportChatHandler(deps: Dependencies = {}) {
  const route = "/api/support/chat";
  return async (request: Request): Promise<Response> => run(route, async () => {
    const session = await customerSession(request, deps);
    if (session instanceof Response) return session;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail(route, checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    const input = parseCustomerSupportChatRequest(checked.value);
    if (!input) return fail(route, "INVALID_REQUEST", 400);
    const store = getStore(deps);
    if (!store) return fail(route, "SUPPORT_UNAVAILABLE", 503);
    const resolved = await (deps.resolve ?? resolveCustomer)(session, { create: true });
    if (!resolved) return fail(route, "SUPPORT_UNAVAILABLE", 503);
    if (resolved.status === "closed") return fail(route, "CUSTOMER_CLOSED", 403);
    const initial = await effectiveOrNull(deps);
    const sent = await store.sendCustomer(resolved.id, session, { version: SUPPORT_CONTRACT_VERSION, body: input.message.text, clientMessageId: input.message.id, ...(input.context ? { context: input.context } : {}) }, initial?.capability ?? { available: false, handoff: false });
    if (!initial) await store.handoffCustomer(resolved.id, true, true, sent.messageId);
    const conversation = sent.response.conversation;
    return supportStream(conversation.id, conversation.handler, async (writer) => {
      const deadline = (deps.now ?? Date.now)() + 35_000;
      let assistant: EffectiveAssistant;
      let runId: string;
      let waitingForAnswer = false;
      while (true) {
        if (request.signal.aborted) {
          if (initial?.capability.handoff) await store.handoffCustomer(resolved.id, true, true, sent.messageId);
          return { handler: (await store.handlerForCustomer(resolved.id, initial?.capability ?? { available: false, handoff: false }))?.handler ?? "operator", conversationId: conversation.id };
        }
        const usable = await effectiveOrNull(deps);
        if (!usable) {
          await store.handoffCustomer(resolved.id, true, true, sent.messageId);
          return { handler: (await store.handlerForCustomer(resolved.id, { available: false, handoff: false }))?.handler ?? "operator", conversationId: conversation.id };
        }
        assistant = usable;
        const claim = await store.claimAssistantRun(conversation.id, sent.messageId, assistant.capability, waitingForAnswer);
        if (claim.status === "claimed") { runId = claim.runId; break; }
        if (claim.status === "answering") waitingForAnswer = true;
        if (claim.status === "pending") {
          writer.write({ type: "error", errorText: "The assistant couldn't reply. Please try again." });
          return { handler: "assistant", conversationId: conversation.id };
        }
        if (claim.status === "unavailable") {
          if (!assistant.capability.available) await store.handoffCustomer(resolved.id, true, true, sent.messageId);
          return { handler: (await store.handlerForCustomer(resolved.id, assistant.capability))?.handler ?? "operator", conversationId: conversation.id };
        }
        if (claim.status === "skipped") return { handler: (await store.handlerForCustomer(resolved.id, assistant.capability))?.handler ?? "operator", conversationId: conversation.id };
        if (claim.status === "limited") {
          if (assistant.capability.handoff) {
            await store.handoffCustomer(resolved.id, true, true, sent.messageId);
            emitServerEvent("support", { route, code: "ASSISTANT_TURN", assistant: "handoff", outcome: "ok" });
            return { handler: (await store.handlerForCustomer(resolved.id, assistant.capability))?.handler ?? "operator", conversationId: conversation.id };
          }
          return { handler: "assistant", conversationId: conversation.id, limited: { retryAfter: claim.retryAfter } };
        }
        const remaining = deadline - (deps.now ?? Date.now)();
        if (remaining <= 0) {
          writer.write({ type: "error", errorText: "The assistant couldn't reply in time. Please try again." });
          return { handler: (await store.handlerForCustomer(resolved.id, assistant.capability))?.handler ?? "operator", conversationId: conversation.id };
        }
        await (deps.wait ?? waitForClaim)(Math.min(500, remaining), request.signal);
      }
      let text = "";
      let failed = false;
      const messageId = crypto.randomUUID();
      let savedReply: ReturnType<SupportStore["saveAssistant"]> | undefined;
      let abortRelease: Promise<void> | undefined;
      const onAbort = () => {
        abortRelease = (async () => {
          try {
            if (text && !failed) savedReply ??= store.saveAssistant(conversation.id, messageId, text, runId);
            if (savedReply) await savedReply;
            if (!text && assistant.capability.handoff) await store.handoffCustomer(resolved.id, true, true, sent.messageId);
          } finally { await store.releaseAssistantRun(conversation.id, runId); }
        })();
        observeSafely(() => abortRelease?.catch(() => {
          emitServerEvent("support", { route, code: "ASSISTANT_ABORT_CLEANUP", outcome: "failed" });
        }));
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted && !abortRelease) onAbort();
      try {
        if (request.signal.aborted) {
          await abortRelease;
          return { handler: (await store.handlerForCustomer(resolved.id, assistant.capability))?.handler ?? "operator", conversationId: conversation.id };
        }
        const history = await store.assistantHistory(conversation.id, sent.messageId);
        const contexts = await store.assistantContext(conversation.id, sent.messageId);
        if (request.signal.aborted) return { handler: conversation.handler, conversationId: conversation.id };
        const current = await effectiveOrNull(deps);
        if (!current || !current.capability.available || !current.key) {
          await store.handoffCustomer(resolved.id, true, true, sent.messageId);
          return { handler: (await store.handlerForCustomer(resolved.id, { available: false, handoff: false }))?.handler ?? "operator", conversationId: conversation.id };
        }
        if (request.signal.aborted) return { handler: conversation.handler, conversationId: conversation.id };
        if (!(await store.ownsAssistantRun(conversation.id, runId))) return { handler: (await store.handlerForCustomer(resolved.id, current.capability))?.handler ?? "operator", conversationId: conversation.id };
        const assistantKey = current.key;
        assistant = { ...current, key: assistantKey };
        let pending = "";
        let started = false;
        let capped = false;
        let discardedMessageId: string | undefined;
        let limitedRetryAfter: number | undefined;
        const hybrid = assistant.capability.handoff;
        const limit = new AbortController();
        try {
          const result = streamText({
            model: (deps.model ?? gatewayModel)(assistantKey, assistant.settings.model),
            system: `You are the Home support assistant. Answer only from the provided conversation and context. Never ask for or reveal secrets, seed phrases, or keys. Never claim to perform account actions. ${hybrid ? "Call handoff_to_operator if the customer asks for a person or needs account changes." : ""}\nContext facts: ${contexts.join("; ")}\nOperator guidance: ${assistant.settings.instructions}`,
            messages: history, maxOutputTokens: 800, stopWhen: stepCountIs(2), abortSignal: AbortSignal.any([request.signal, limit.signal]), timeout: 30000, onError: () => { if (!capped && !request.signal.aborted) failed = true; },
            tools: hybrid ? { handoff_to_operator: tool({ description: "Hand the conversation to a person", inputSchema: z.object({}), execute: async () => {
              await store.handoffCustomer(resolved.id, true, true, sent.messageId);
              return { handler: (await store.handlerForCustomer(resolved.id, assistant.capability))?.handler ?? "unavailable" };
            } }) } : {},
          });
          for await (const part of result.fullStream) {
            if (request.signal.aborted) break;
            if (part.type === "text-delta") {
              const clean = part.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
              const candidate = (text + pending + clean).replace(/^\s+/, "").slice(0, 2000);
              const visible = candidate.trimEnd();
              const delta = visible.slice(text.length);
              if (delta) {
                if (!started) { writer.write({ type: "start", messageId }); writer.write({ type: "text-start", id: messageId }); started = true; }
                writer.write({ type: "text-delta", id: messageId, delta });
                text += delta;
              }
              pending = candidate.slice(visible.length);
              if (text.length + pending.length >= 2000) { capped = true; limit.abort(); break; }
            } else if ((part.type === "error" || part.type === "abort") && !request.signal.aborted) failed = true;
          }
          if (started) writer.write({ type: "text-end", id: messageId });
        } catch { if (!request.signal.aborted && !capped) failed = true; }
        if (!text && !failed && !request.signal.aborted) {
          const handled = await store.handlerForCustomer(resolved.id, assistant.capability);
          if (!request.signal.aborted && (!handled || handled.handler === "assistant")) failed = true;
        }
        if (text) {
          let saved: Awaited<ReturnType<SupportStore["saveAssistant"]>>;
          try {
            saved = await (savedReply ??= store.saveAssistant(conversation.id, messageId, text, runId, failed));
          } catch (error) {
            writer.write({ type: "data-support", data: { handler: conversation.handler, conversationId: conversation.id, discardedMessageId: messageId } });
            throw error;
          }
          if (failed || saved === "discarded" || saved === "budget") {
            writer.write({ type: "data-support", data: { handler: (await store.handlerForCustomer(resolved.id, assistant.capability))?.handler ?? "operator", conversationId: conversation.id, discardedMessageId: messageId } });
            discardedMessageId = messageId;
          }
          if (saved === "budget") {
            if (!hybrid) limitedRetryAfter = 86400;
            if (hybrid) await store.handoffCustomer(resolved.id, true, true, sent.messageId);
          } else if (saved === "discarded" || failed) emitServerEvent("support", { route, code: "ASSISTANT_TURN", assistant: "discarded", outcome: "ok" });
          else if (saved === "sent") emitServerEvent("support", { route, code: "ASSISTANT_TURN", assistant: "replied", outcome: "ok" });
        }
        if (failed) {
          emitServerEvent("support", { route, code: "ASSISTANT_TURN", assistant: "failed", outcome: "failed" });
          if (hybrid) await store.handoffCustomer(resolved.id, true, true, sent.messageId);
          else if (!(await takeOverWhenUnavailable(deps, store, resolved.id, sent.messageId))) writer.write({ type: "error", errorText: "The assistant couldn't reply. Please try again." });
        }
        return { handler: (await store.handlerForCustomer(resolved.id, assistant.capability))?.handler ?? "operator", conversationId: conversation.id, ...(discardedMessageId ? { discardedMessageId } : {}), ...(limitedRetryAfter ? { limited: { retryAfter: limitedRetryAfter } } : {}) };
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        if (abortRelease) await abortRelease;
        else await store.releaseAssistantRun(conversation.id, runId);
      }
    });
  });
}

export function createCustomerSupportHandoffHandler(deps: Dependencies = {}) {
  const route = "/api/support/handoff";
  return async (request: Request): Promise<Response> => run(route, async () => {
    const session = await customerSession(request, deps);
    if (session instanceof Response) return session;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail(route, checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    if (!parseCustomerSupportHandoffRequest(checked.value)) return fail(route, "INVALID_REQUEST", 400);
    const store = getStore(deps);
    if (!store) return fail(route, "SUPPORT_UNAVAILABLE", 503);
    const resolved = await (deps.resolve ?? resolveCustomer)(session, { create: false });
    if (resolved?.status === "closed") return fail(route, "CUSTOMER_CLOSED", 403);
    if (!resolved) return fail(route, "NOT_FOUND", 404);
    const assistant = await capability(deps);
    const result = await store.handoffCustomer(resolved.id, !assistant.available || assistant.handoff);
    return result === "conflict" ? fail(route, "SUPPORT_CONFLICT", 409) : result === "not-found" ? fail(route, "NOT_FOUND", 404) : privateJson(await store.customerConversation(resolved.id, undefined, assistant), 200);
  });
}

export function createSupportCredentialHandlers(deps: Dependencies = {}) {
  const route = "/api/admin/support/assistant/credential";
  const GET = async (request: Request) => run(route, async () => {
    const decision = await operatorSession(request, deps);
    return decision instanceof Response ? decision : privateJson(await getAssistant(deps).credential(), 200);
  });
  const PUT = async (request: Request) => run(route, async () => {
    const decision = await operatorSession(request, deps);
    if (decision instanceof Response) return decision;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail(route, checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    const input = parseSupportCredentialPutRequest(checked.value);
    if (!input) return fail(route, "INVALID_REQUEST", 400);
    const result = await getAssistant(deps).put(input.apiKey, decision.address);
    return result ? privateJson(result, 200) : fail(route, "SUPPORT_UNAVAILABLE", 503);
  });
  const DELETE = async (request: Request) => run(route, async () => {
    const decision = await operatorSession(request, deps);
    if (decision instanceof Response) return decision;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail(route, checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    if (!parseCustomerSupportHandoffRequest(checked.value)) return fail(route, "INVALID_REQUEST", 400);
    return privateJson(await getAssistant(deps).delete(decision.address), 200);
  });
  return { GET, PUT, DELETE };
}

export function createOperatorSupportHandlerHandler(deps: Dependencies = {}) {
  const route = "/api/admin/support/conversations/[id]/handler";
  return async (request: Request, context: Context): Promise<Response> => run(route, async () => {
    const access = await operator(request, deps, route);
    if (access instanceof Response) return access;
    const id = await conversationId(context, route);
    if (id instanceof Response) return id;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail(route, checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    const input = parseOperatorSupportHandlerRequest(checked.value);
    if (!input) return fail(route, "INVALID_REQUEST", 400);
    const assistant = await capability(deps);
    if (input.handler === "assistant" && !assistant.available) return fail(route, "SUPPORT_CONFLICT", 409);
    const customerId = await access.store.customerIdForConversation(id);
    if (!customerId) return fail(route, "NOT_FOUND", 404);
    await getAudit(deps).recordCustomerRead({ actor: access.address, customerId, purpose: "support" });
    const decision = await access.store.setHandler(id, input.handler);
    if (decision === "not-found") return fail(route, "NOT_FOUND", 404);
    if (decision === "conflict") return fail(route, "SUPPORT_CONFLICT", 409);
    return conversationJson(await access.store.operatorConversation(id, undefined, assistant), 200);
  });
}


export function createCustomerSupportReadHandler(deps: Dependencies = {}) {
  return async (request: Request): Promise<Response> => run("/api/support/read", async () => {
    const session = await customerSession(request, deps);
    if (session instanceof Response) return session;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail("/api/support/read", checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    const parsed = parseSupportReadRequest(checked.value);
    if (!parsed) return fail("/api/support/read", "INVALID_REQUEST", 400);
    const store = getStore(deps);
    if (!store) return fail("/api/support/read", "SUPPORT_UNAVAILABLE", 503);
    const resolved = await (deps.resolve ?? resolveCustomer)(session, { create: false });
    if (resolved?.status === "closed") return fail("/api/support/read", "CUSTOMER_CLOSED", 403);
    if (resolved?.id) await store.readCustomer(resolved.id, parsed.lastMessageId);
    return noContent();
  });
}
export function createOperatorSupportListHandler(deps: Dependencies = {}) {
  return async (request: Request): Promise<Response> => run("/api/admin/support/conversations", async () => {
    const access = await operator(request, deps, "/api/admin/support/conversations");
    if (access instanceof Response) return access;
    const query = parseOperatorSupportListQuery(new URL(request.url).searchParams);
    if (!query) return fail("/api/admin/support/conversations", "INVALID_REQUEST", 400);
    const result = await access.store.list(query, await capability(deps));
    if (result.conversations.length) await getAudit(deps).recordSupportConversationReads({ actor: access.address, conversationIds: result.conversations.map((conversation) => conversation.id), repeatWithinSeconds: SUPPORT_VIEW_AUDIT_WINDOW_SECONDS });
    return privateJson(result, 200);
  });
}
export function createOperatorSupportSummaryHandler(deps: Dependencies = {}) {
  return async (request: Request): Promise<Response> => run("/api/admin/support/summary", async () => {
    const access = await operator(request, deps, "/api/admin/support/summary");
    return access instanceof Response ? access : privateJson(await access.store.operatorSummary(await capability(deps)), 200);
  });
}
export function createOperatorSupportConversationHandler(deps: Dependencies = {}) {
  return async (request: Request, context: Context): Promise<Response> => run("/api/admin/support/conversations/[id]", async () => {
    const access = await operator(request, deps, "/api/admin/support/conversations/[id]");
    if (access instanceof Response) return access;
    const id = await conversationId(context, "/api/admin/support/conversations/[id]");
    if (id instanceof Response) return id;
    const cursor = parseSupportMessageCursor(new URL(request.url).searchParams);
    if (!cursor) return fail("/api/admin/support/conversations/[id]", "INVALID_REQUEST", 400);
    const customerId = await access.store.customerIdForConversation(id);
    if (!customerId) return fail("/api/admin/support/conversations/[id]", "NOT_FOUND", 404);
    const result = await access.store.operatorConversation(id, cursor.before, await capability(deps));
    if (!result) return fail("/api/admin/support/conversations/[id]", "NOT_FOUND", 404);
    const etag = await conversationEtag(result);
    const matches = request.headers.get("If-None-Match")?.split(",").some((entry) => entry.trim().replace(/^W\//, "") === etag);
    if (matches) {
      const headers = privateJson(null, 200).headers;
      headers.set("ETag", etag);
      return new Response(null, { status: 304, headers });
    }
    await getAudit(deps).recordCustomerRead({ actor: access.address, customerId, purpose: "support" });
    return conversationJson(result, 200);
  });
}
export function createOperatorSupportReplyHandler(deps: Dependencies = {}) {
  return async (request: Request, context: Context): Promise<Response> => run("/api/admin/support/conversations/[id]/messages", async () => {
    const access = await operator(request, deps, "/api/admin/support/conversations/[id]/messages");
    if (access instanceof Response) return access;
    const id = await conversationId(context, "/api/admin/support/conversations/[id]/messages");
    if (id instanceof Response) return id;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail("/api/admin/support/conversations/[id]/messages", checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    const parsed = parseOperatorSupportReplyRequest(checked.value);
    if (!parsed) return fail("/api/admin/support/conversations/[id]/messages", "INVALID_REQUEST", 400);
    const customerId = await access.store.customerIdForConversation(id);
    if (!customerId) return fail("/api/admin/support/conversations/[id]/messages", "NOT_FOUND", 404);
    await getAudit(deps).recordCustomerRead({ actor: access.address, customerId, purpose: "support" });
    const sent = await access.store.sendOperator(id, access.address, parsed);
    if (sent.outcome === "conflict") return fail("/api/admin/support/conversations/[id]/messages", "SUPPORT_CONFLICT", 409);
    if (sent.outcome === "not-found") return fail("/api/admin/support/conversations/[id]/messages", "NOT_FOUND", 404);
    const result = await access.store.operatorConversation(id, undefined, await capability(deps));
    return result ? conversationJson(result, sent.replayed ? 200 : 201) : fail("/api/admin/support/conversations/[id]/messages", "NOT_FOUND", 404);
  });
}
export function createOperatorSupportStatusHandler(deps: Dependencies = {}) {
  return async (request: Request, context: Context): Promise<Response> => run("/api/admin/support/conversations/[id]/status", async () => {
    const access = await operator(request, deps, "/api/admin/support/conversations/[id]/status");
    if (access instanceof Response) return access;
    const id = await conversationId(context, "/api/admin/support/conversations/[id]/status");
    if (id instanceof Response) return id;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail("/api/admin/support/conversations/[id]/status", checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    const parsed = parseOperatorSupportStatusRequest(checked.value);
    if (!parsed) return fail("/api/admin/support/conversations/[id]/status", "INVALID_REQUEST", 400);
    const customerId = await access.store.customerIdForConversation(id);
    if (!customerId) return fail("/api/admin/support/conversations/[id]/status", "NOT_FOUND", 404);
    await getAudit(deps).recordCustomerRead({ actor: access.address, customerId, purpose: "support" });
    const outcome = await access.store.setStatus(id, access.address, parsed.status, parsed.observedMessageId);
    if (outcome === "conflict") return fail("/api/admin/support/conversations/[id]/status", "SUPPORT_CONFLICT", 409);
    if (outcome === "not-found") return fail("/api/admin/support/conversations/[id]/status", "NOT_FOUND", 404);
    const result = await access.store.operatorConversation(id, undefined, await capability(deps));
    return result ? conversationJson(result, 200) : fail("/api/admin/support/conversations/[id]/status", "NOT_FOUND", 404);
  });
}
export function createOperatorSupportReadHandler(deps: Dependencies = {}) {
  return async (request: Request, context: Context): Promise<Response> => run("/api/admin/support/conversations/[id]/read", async () => {
    const access = await operator(request, deps, "/api/admin/support/conversations/[id]/read");
    if (access instanceof Response) return access;
    const id = await conversationId(context, "/api/admin/support/conversations/[id]/read");
    if (id instanceof Response) return id;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail("/api/admin/support/conversations/[id]/read", checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    const parsed = parseSupportReadRequest(checked.value);
    if (!parsed) return fail("/api/admin/support/conversations/[id]/read", "INVALID_REQUEST", 400);
    return await access.store.readOperator(id, parsed.lastMessageId) ? noContent() : fail("/api/admin/support/conversations/[id]/read", "NOT_FOUND", 404);
  });
}

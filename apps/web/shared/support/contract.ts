import { parseAddress } from "@/shared/chain/hex";

export const SUPPORT_CONTRACT_VERSION = 2 as const;

export type SupportAuthorType = "customer" | "operator" | "assistant";
export type SupportMessageStatus = "sent" | "draft";
export type SupportContextRef = { kind: "funding_order" | "money_action"; id: string };
export type SupportHandler = "assistant" | "operator";
export type SupportAssistantCapability = { available: boolean; handoff: boolean };
export type SupportMessage = { id: string; authorType: SupportAuthorType; status: SupportMessageStatus; body: string; createdAt: string; clientMessageId?: string };
export type CustomerSupportConversation = { id: string; status: "open" | "resolved"; handler: SupportHandler; assistant: SupportAssistantCapability; messages: SupportMessage[]; messagesNextCursor: string | null; contextRefs: SupportContextRef[]; unreadCount: number };
export type CustomerSupportResponse = { version: typeof SUPPORT_CONTRACT_VERSION; conversation: CustomerSupportConversation | null; assistant: SupportAssistantCapability };
export type CustomerSupportChatRequest = { version: typeof SUPPORT_CONTRACT_VERSION; message: { id: string; text: string }; context?: SupportContextRef };
export type CustomerSupportHandoffRequest = { version: typeof SUPPORT_CONTRACT_VERSION };
/** @public stream metadata consumed by the support chat transport */
export type SupportStreamData = { handler: SupportHandler; conversationId: string; discardedMessageId?: string; limited?: { retryAfter: number } };
/** @public consumed by the support chat stream transport */
export function parseSupportStreamData(value: unknown): SupportStreamData | null {
  if (!object(value) || !keys(value, ["handler", "conversationId"], ["discardedMessageId", "limited"]) || !handler(value.handler) || !uuid(value.conversationId)) return null;
  let discardedMessageId: string | undefined;
  if (Object.hasOwn(value, "discardedMessageId")) {
    if (!uuid(value.discardedMessageId)) return null;
    discardedMessageId = value.discardedMessageId;
  }
  let limited: SupportStreamData["limited"];
  if (Object.hasOwn(value, "limited")) {
    if (!object(value.limited) || !keys(value.limited, ["retryAfter"]) || !count(value.limited.retryAfter) || value.limited.retryAfter <= 0) return null;
    limited = { retryAfter: value.limited.retryAfter };
  }
  return { handler: value.handler, conversationId: value.conversationId, ...(discardedMessageId !== undefined ? { discardedMessageId } : {}), ...(limited ? { limited } : {}) };
}
export type CustomerSupportSummary = { version: typeof SUPPORT_CONTRACT_VERSION; unreadCount: number };
export type CustomerSupportSendRequest = { version: typeof SUPPORT_CONTRACT_VERSION; body: string; clientMessageId: string; context?: SupportContextRef };
export type OperatorSupportListItem = { id: string; status: "open" | "resolved"; handler: SupportHandler; lastMessageAt: string; preview: string; lastAuthorType: SupportAuthorType; unread: boolean; customerLabel: string };
export type OperatorSupportListResponse = { version: typeof SUPPORT_CONTRACT_VERSION; conversations: OperatorSupportListItem[]; nextCursor: string | null };
export type OperatorSupportMessage = SupportMessage & { authorOperator: `0x${string}` | null };
export type OperatorSupportCustomer = { status: string; country: string | null; firstSeenAt: string; lastSeenAt: string; emails: string[]; accountProviders: string[]; wallets: `0x${string}`[]; recentEvents: { name: string; occurredAt: string }[] };
export type OperatorSupportContext = SupportContextRef & { summary: string | null };
export type OperatorSupportConversationResponse = { version: typeof SUPPORT_CONTRACT_VERSION; conversation: { id: string; status: "open" | "resolved"; handler: SupportHandler; handedOffAt: string | null; assistantAvailable: boolean; createdAt: string; resolvedAt: string | null; messages: OperatorSupportMessage[]; messagesNextCursor: string | null; contextRefs: OperatorSupportContext[] }; customer: OperatorSupportCustomer };
export type OperatorSupportHandlerRequest = { version: typeof SUPPORT_CONTRACT_VERSION; handler: SupportHandler };
export type SupportCredentialPutRequest = { version: typeof SUPPORT_CONTRACT_VERSION; apiKey: string };
export type SupportCredentialResponse = { version: typeof SUPPORT_CONTRACT_VERSION; configured: boolean; last4: string | null; updatedAt: string | null; available: boolean };
export type OperatorSupportSummary = { version: typeof SUPPORT_CONTRACT_VERSION; unreadConversations: number };
export type OperatorSupportReplyRequest = { version: typeof SUPPORT_CONTRACT_VERSION; body: string; clientMessageId: string; readThroughMessageId: string };
export type SupportReadRequest = { version: typeof SUPPORT_CONTRACT_VERSION; lastMessageId: string };
export type OperatorSupportStatusRequest = { version: typeof SUPPORT_CONTRACT_VERSION; status: "open" | "resolved"; observedMessageId: string };
export type OperatorSupportListQuery = { status: "open" | "resolved" | "all"; before?: string; limit: number };
export type SupportErrorCode = "UNAUTHENTICATED" | "OPERATOR_FORBIDDEN" | "NOT_FOUND" | "INVALID_REQUEST" | "CROSS_ORIGIN" | "RATE_LIMITED" | "SUPPORT_UNAVAILABLE" | "AUTH_UNAVAILABLE" | "CUSTOMER_CLOSED" | "SUPPORT_CONFLICT";
export type SupportErrorResponse = { error: { code: SupportErrorCode; message?: string } };

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
function timestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
function address(value: unknown): value is `0x${string}` { return typeof value === "string" && parseAddress(value) === value; }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function status(value: unknown): value is "open" | "resolved" { return value === "open" || value === "resolved"; }
function handler(value: unknown): value is SupportHandler { return value === "assistant" || value === "operator"; }
function capability(value: unknown): value is SupportAssistantCapability { return object(value) && keys(value, ["available", "handoff"]) && typeof value.available === "boolean" && typeof value.handoff === "boolean" && (!value.handoff || value.available); }
function author(value: unknown): value is SupportAuthorType { return value === "customer" || value === "operator" || value === "assistant"; }
function refId(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= 128; }
function messageId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value); }
export function normalizeSupportBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body.length >= 1 && body.length <= 2000 && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(body) ? body : null;
}
function context(value: unknown): value is SupportContextRef {
  return object(value) && keys(value, ["kind", "id"]) && (value.kind === "funding_order" || value.kind === "money_action") && refId(value.id);
}
export function parseCustomerSupportChatRequest(value: unknown): CustomerSupportChatRequest | null {
  if (!object(value) || value.version !== SUPPORT_CONTRACT_VERSION || !keys(value, ["version", "message"], ["context"]) || !object(value.message) || !keys(value.message, ["id", "text"]) || !uuid(value.message.id)) return null;
  let supportContext: SupportContextRef | undefined;
  if ("context" in value) {
    const candidate = value.context;
    if (!context(candidate)) return null;
    supportContext = candidate;
  }
  const text = normalizeSupportBody(value.message.text);
  return text === null ? null : { version: SUPPORT_CONTRACT_VERSION, message: { id: value.message.id, text }, ...(supportContext ? { context: supportContext } : {}) };
}
export function parseCustomerSupportHandoffRequest(value: unknown): CustomerSupportHandoffRequest | null {
  return object(value) && keys(value, ["version"]) && value.version === SUPPORT_CONTRACT_VERSION ? { version: SUPPORT_CONTRACT_VERSION } : null;
}
export function parseOperatorSupportHandlerRequest(value: unknown): OperatorSupportHandlerRequest | null {
  return object(value) && keys(value, ["version", "handler"]) && value.version === SUPPORT_CONTRACT_VERSION && handler(value.handler) ? { version: SUPPORT_CONTRACT_VERSION, handler: value.handler } : null;
}
export function parseSupportCredentialPutRequest(value: unknown): SupportCredentialPutRequest | null {
  if (!object(value) || !keys(value, ["version", "apiKey"]) || value.version !== SUPPORT_CONTRACT_VERSION || typeof value.apiKey !== "string") return null;
  const apiKey = value.apiKey.trim();
  return apiKey.length >= 8 && apiKey.length <= 512 && /^[\x20-\x7e]+$/.test(apiKey) ? { version: SUPPORT_CONTRACT_VERSION, apiKey } : null;
}
/** @public consumed by the operator credential settings client */
export function parseSupportCredentialResponse(value: unknown): SupportCredentialResponse | null {
  if (!object(value) || !keys(value, ["version", "configured", "last4", "updatedAt", "available"]) || value.version !== SUPPORT_CONTRACT_VERSION) return null;
  const { configured, last4, updatedAt, available } = value;
  if (typeof configured !== "boolean" || typeof available !== "boolean" || (last4 !== null && (typeof last4 !== "string" || last4.length !== 4)) || (updatedAt !== null && !timestamp(updatedAt)) || (available && !configured)) return null;
  return { version: SUPPORT_CONTRACT_VERSION, configured, last4, updatedAt, available };
}
export function parseOperatorSupportReplyRequest(value: unknown): OperatorSupportReplyRequest | null {
  if (!object(value) || value.version !== SUPPORT_CONTRACT_VERSION || !keys(value, ["version", "body", "clientMessageId", "readThroughMessageId"])) return null;
  const body = normalizeSupportBody(value.body);
  return body === null || !messageId(value.clientMessageId) || !uuid(value.readThroughMessageId) ? null : { version: SUPPORT_CONTRACT_VERSION, body, clientMessageId: value.clientMessageId, readThroughMessageId: value.readThroughMessageId };
}
export function parseSupportReadRequest(value: unknown): SupportReadRequest | null {
  return object(value) && keys(value, ["version", "lastMessageId"]) && value.version === SUPPORT_CONTRACT_VERSION && uuid(value.lastMessageId)
    ? { version: SUPPORT_CONTRACT_VERSION, lastMessageId: value.lastMessageId } : null;
}
export function parseSupportMessageCursor(params: URLSearchParams): { before?: string } | null {
  if ([...params.keys()].some((key) => key !== "before" || params.getAll(key).length !== 1)) return null;
  const before = params.get("before");
  return before === null ? {} : uuid(before) ? { before } : null;
}
export function parseOperatorSupportStatusRequest(value: unknown): OperatorSupportStatusRequest | null {
  return object(value) && keys(value, ["version", "status", "observedMessageId"]) && value.version === SUPPORT_CONTRACT_VERSION && status(value.status) && uuid(value.observedMessageId)
    ? { version: SUPPORT_CONTRACT_VERSION, status: value.status, observedMessageId: value.observedMessageId } : null;
}
export function parseOperatorSupportListQuery(params: URLSearchParams): OperatorSupportListQuery | null {
  if ([...params.keys()].some((key) => !["status", "before", "limit"].includes(key) || params.getAll(key).length !== 1)) return null;
  const rawStatus = params.get("status") ?? "open";
  const rawLimit = params.get("limit");
  const before = params.get("before");
  if (rawStatus !== "open" && rawStatus !== "resolved" && rawStatus !== "all") return null;
  if (rawLimit !== null && (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100)) return null;
  if (before !== null && !decodeSupportCursor(before)) return null;
  return { status: rawStatus, limit: rawLimit === null ? 50 : Number(rawLimit), ...(before === null ? {} : { before }) };
}
export function decodeSupportCursor(value: unknown): { at: string; id: string } | null {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded: unknown = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
    return object(decoded) && keys(decoded, ["at", "id"]) && timestamp(decoded.at) && uuid(decoded.id) ? { at: decoded.at, id: decoded.id } : null;
  } catch { return null; }
}
function message(value: unknown, operator = false): value is OperatorSupportMessage {
  if (!object(value) || !keys(value, ["id", "authorType", "status", "body", "createdAt"], operator ? ["authorOperator", "clientMessageId"] : ["clientMessageId"]) || !uuid(value.id) || !author(value.authorType) || (value.status !== "sent" && value.status !== "draft") || typeof value.body !== "string" || normalizeSupportBody(value.body) !== value.body || !timestamp(value.createdAt) || (value.authorType === "customer" ? !messageId(value.clientMessageId) : Object.hasOwn(value, "clientMessageId"))) return false;
  return operator ? Object.hasOwn(value, "authorOperator") && (value.authorOperator === null || address(value.authorOperator)) : !Object.hasOwn(value, "authorOperator");
}
function operatorSupportMessage(value: unknown): OperatorSupportMessage | null {
  if (!message(value, true)) return null;
  return { id: value.id, authorType: value.authorType, status: value.status, body: value.body, createdAt: value.createdAt, authorOperator: value.authorOperator, ...(value.authorType === "customer" ? { clientMessageId: value.clientMessageId } : {}) };
}
function customerConversation(value: unknown): value is CustomerSupportConversation {
return object(value) && keys(value, ["id", "status", "handler", "assistant", "messages", "messagesNextCursor", "contextRefs", "unreadCount"]) && uuid(value.id) && status(value.status) && handler(value.handler) && capability(value.assistant) && count(value.unreadCount) && (value.messagesNextCursor === null || uuid(value.messagesNextCursor)) && Array.isArray(value.messages) && value.messages.every((item: unknown) => message(item) && item.status === "sent") && Array.isArray(value.contextRefs) && value.contextRefs.every(context);
}
/** @public consumed by the support chat client */
export function parseCustomerSupportResponse(value: unknown): CustomerSupportResponse | null {
  if (!object(value) || !keys(value, ["version", "conversation", "assistant"]) || value.version !== SUPPORT_CONTRACT_VERSION) return null;
  const { conversation, assistant } = value;
  return capability(assistant) && (conversation === null || customerConversation(conversation)) ? { version: SUPPORT_CONTRACT_VERSION, conversation, assistant } : null;
}
/** @public consumed by the support chat client */
export function parseCustomerSupportSummary(value: unknown): CustomerSupportSummary | null {
  return object(value) && keys(value, ["version", "unreadCount"]) && value.version === SUPPORT_CONTRACT_VERSION && count(value.unreadCount) ? { version: SUPPORT_CONTRACT_VERSION, unreadCount: value.unreadCount } : null;
}
export function parseOperatorSupportListResponse(value: unknown): OperatorSupportListResponse | null {
  function isCursor(value: unknown): value is string { return decodeSupportCursor(value) !== null; }
  if (!object(value) || !keys(value, ["version", "conversations", "nextCursor"]) || value.version !== SUPPORT_CONTRACT_VERSION || !Array.isArray(value.conversations)) return null;
  const nextCursor = value.nextCursor;
  if (nextCursor !== null && !isCursor(nextCursor)) return null;
  const conversations: OperatorSupportListItem[] = [];
  for (const row of value.conversations) {
    if (!object(row) || !keys(row, ["id", "status", "handler", "lastMessageAt", "preview", "lastAuthorType", "unread", "customerLabel"]) || !uuid(row.id) || !status(row.status) || !handler(row.handler) || !timestamp(row.lastMessageAt) || typeof row.preview !== "string" || row.preview.length > 140 || !author(row.lastAuthorType) || typeof row.unread !== "boolean" || typeof row.customerLabel !== "string") return null;
    conversations.push({ id: row.id, status: row.status, handler: row.handler, lastMessageAt: row.lastMessageAt, preview: row.preview, lastAuthorType: row.lastAuthorType, unread: row.unread, customerLabel: row.customerLabel });
  }
  return { version: SUPPORT_CONTRACT_VERSION, conversations, nextCursor };
}
export function parseOperatorSupportConversationResponse(value: unknown): OperatorSupportConversationResponse | null {
  if (!object(value) || !keys(value, ["version", "conversation", "customer"]) || value.version !== SUPPORT_CONTRACT_VERSION || !object(value.conversation) || !object(value.customer)) return null;
  const c = value.conversation, person = value.customer;
  if (!keys(c, ["id", "status", "handler", "handedOffAt", "assistantAvailable", "createdAt", "resolvedAt", "messages", "messagesNextCursor", "contextRefs"]) || !uuid(c.id) || !status(c.status) || !handler(c.handler) || (c.handedOffAt !== null && !timestamp(c.handedOffAt)) || typeof c.assistantAvailable !== "boolean" || !timestamp(c.createdAt) || (c.resolvedAt !== null && !timestamp(c.resolvedAt)) || !Array.isArray(c.messages) || (c.messagesNextCursor !== null && !uuid(c.messagesNextCursor)) || !Array.isArray(c.contextRefs)) return null;
  const messages: OperatorSupportMessage[] = [];
  for (const value of c.messages) {
    const message = operatorSupportMessage(value);
    if (!message) return null;
    messages.push(message);
  }
  const contextRefs: OperatorSupportContext[] = [];
  for (const ref of c.contextRefs) {
    if (!object(ref) || !keys(ref, ["kind", "id", "summary"]) || (ref.kind !== "funding_order" && ref.kind !== "money_action") || !refId(ref.id) || (ref.summary !== null && typeof ref.summary !== "string")) return null;
    contextRefs.push({ kind: ref.kind, id: ref.id, summary: ref.summary });
  }
  if (!keys(person, ["status", "country", "firstSeenAt", "lastSeenAt", "emails", "accountProviders", "wallets", "recentEvents"]) || typeof person.status !== "string" || (person.country !== null && typeof person.country !== "string") || !timestamp(person.firstSeenAt) || !timestamp(person.lastSeenAt) || !Array.isArray(person.emails) || !person.emails.every((email: unknown) => typeof email === "string") || !Array.isArray(person.accountProviders) || !person.accountProviders.every((p: unknown) => typeof p === "string") || !Array.isArray(person.wallets) || !person.wallets.every(address) || !Array.isArray(person.recentEvents) || person.recentEvents.length > 10) return null;
  const recentEvents: OperatorSupportCustomer["recentEvents"] = [];
  for (const event of person.recentEvents) {
    if (!object(event) || !keys(event, ["name", "occurredAt"]) || typeof event.name !== "string" || !timestamp(event.occurredAt)) return null;
    recentEvents.push({ name: event.name, occurredAt: event.occurredAt });
  }
  return { version: SUPPORT_CONTRACT_VERSION, conversation: { id: c.id, status: c.status, handler: c.handler, handedOffAt: c.handedOffAt, assistantAvailable: c.assistantAvailable, createdAt: c.createdAt, resolvedAt: c.resolvedAt, messages, messagesNextCursor: c.messagesNextCursor, contextRefs }, customer: { status: person.status, country: person.country, firstSeenAt: person.firstSeenAt, lastSeenAt: person.lastSeenAt, emails: person.emails, accountProviders: person.accountProviders, wallets: person.wallets, recentEvents } };
}
export function parseOperatorSupportSummary(value: unknown): OperatorSupportSummary | null {
  return object(value) && keys(value, ["version", "unreadConversations"]) && value.version === SUPPORT_CONTRACT_VERSION && count(value.unreadConversations) ? { version: SUPPORT_CONTRACT_VERSION, unreadConversations: value.unreadConversations } : null;
}
export function parseSupportErrorResponse(value: unknown): SupportErrorResponse | null {
  const codes: SupportErrorCode[] = ["UNAUTHENTICATED", "OPERATOR_FORBIDDEN", "NOT_FOUND", "INVALID_REQUEST", "CROSS_ORIGIN", "RATE_LIMITED", "SUPPORT_UNAVAILABLE", "AUTH_UNAVAILABLE", "CUSTOMER_CLOSED", "SUPPORT_CONFLICT"];
  if (!object(value) || !keys(value, ["error"]) || !object(value.error) || !keys(value.error, ["code"], ["message"])) return null;
  const error = value.error;
  const code = codes.find((code) => code === error.code);
  if (!code) return null;
  let message: string | undefined;
  if (Object.hasOwn(error, "message")) {
    if (typeof error.message !== "string") return null;
    message = error.message;
  }
  return { error: { code, ...(message !== undefined ? { message } : {}) } };
}

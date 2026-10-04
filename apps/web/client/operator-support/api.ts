import {
  SUPPORT_CONTRACT_VERSION,
  parseOperatorSupportConversationResponse,
  parseOperatorSupportListResponse,
  parseOperatorSupportSummary,
  parseSupportErrorResponse,
  type OperatorSupportConversationResponse,
  type OperatorSupportListResponse,
  type OperatorSupportSummary,
  type SupportHandler,
} from "@/shared/support/contract";

type Parser<T> = (value: unknown, response: Response) => T | null;

export type OperatorConversationResult = { detail: OperatorSupportConversationResponse; etag: string | null };

function parseConversationResult(value: unknown, response: Response): OperatorConversationResult | null {
  const detail = parseOperatorSupportConversationResponse(value);
  return detail ? { detail, etag: response.headers.get("ETag") } : null;
}

export class SupportConflictError extends Error {}
type MutationBody = { version: typeof SUPPORT_CONTRACT_VERSION; status: "open" | "resolved"; observedMessageId: string } | { version: typeof SUPPORT_CONTRACT_VERSION; body: string; clientMessageId: string; readThroughMessageId: string } | { version: typeof SUPPORT_CONTRACT_VERSION; lastMessageId: string } | { version: typeof SUPPORT_CONTRACT_VERSION; handler: SupportHandler };
const conflictMessage = "This conversation changed. Review the latest messages, then try again.";

async function request<T>(path: string, parser: Parser<T>, body?: MutationBody, conflict?: string): Promise<T>;
async function request<T>(path: string, parser: Parser<T>, body: undefined, conflict: string, etag: string | undefined): Promise<T | "unchanged">;
async function request<T>(path: string, parser: Parser<T>, body?: MutationBody, conflict = conflictMessage, etag?: string): Promise<T | "unchanged"> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...(etag ? { headers: { "If-None-Match": etag } } : {}),
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (response.status === 304) return "unchanged";
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = parseSupportErrorResponse(value);
    if (error?.error.code === "AUTH_UNAVAILABLE") throw new Error("Authentication is temporarily unavailable. Try again.");
    if (error?.error.code === "SUPPORT_CONFLICT") throw new SupportConflictError(conflict);
    throw new Error(error?.error.code === "SUPPORT_UNAVAILABLE" ? "Support inbox is unavailable." : "Couldn't load support. Try again.");
  }
  const parsed = parser(value, response);
  if (!parsed) throw new Error("Couldn't load support. Try again.");
  return parsed;
}

export type OperatorSupportTransport = {
  list: (status: "open" | "resolved" | "all", before?: string) => Promise<OperatorSupportListResponse>;
  conversation: (id: string, options?: { before?: string; etag?: string }) => Promise<OperatorConversationResult | "unchanged">;
  read: (id: string, lastMessageId: string) => Promise<void>;
  reply: (id: string, body: string, clientMessageId: string, readThroughMessageId: string) => Promise<OperatorConversationResult>;
  status: (id: string, status: "open" | "resolved", observedMessageId: string) => Promise<OperatorConversationResult>;
  handler: (id: string, handler: SupportHandler) => Promise<OperatorConversationResult>;
};

export const operatorSupportTransport: OperatorSupportTransport = {
  list: (status, before) => request(`/api/admin/support/conversations?status=${status}${before ? `&before=${encodeURIComponent(before)}` : ""}`, parseOperatorSupportListResponse),
  conversation: (id, options) => request(`/api/admin/support/conversations/${encodeURIComponent(id)}${options?.before ? `?before=${encodeURIComponent(options.before)}` : ""}`, parseConversationResult, undefined, conflictMessage, options?.etag),
  read: async (id, lastMessageId) => {
    const response = await fetch(`/api/admin/support/conversations/${encodeURIComponent(id)}/read`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: SUPPORT_CONTRACT_VERSION, lastMessageId }),
    });
    if (!response.ok) throw new Error("Couldn't mark conversation as read.");
  },
  reply: (id, body, clientMessageId, readThroughMessageId) => request(`/api/admin/support/conversations/${encodeURIComponent(id)}/messages`, parseConversationResult, { version: SUPPORT_CONTRACT_VERSION, body, clientMessageId, readThroughMessageId }),
  status: (id, status, observedMessageId) => request(`/api/admin/support/conversations/${encodeURIComponent(id)}/status`, parseConversationResult, { version: SUPPORT_CONTRACT_VERSION, status, observedMessageId }),
  handler: (id, handler) => request(`/api/admin/support/conversations/${encodeURIComponent(id)}/handler`, parseConversationResult, { version: SUPPORT_CONTRACT_VERSION, handler }, handler === "assistant" ? "Can't hand back yet. Reply to the customer first, or check the Support assistant settings." : conflictMessage),
};

export async function fetchOperatorSupportSummary(): Promise<OperatorSupportSummary> {
  return request("/api/admin/support/summary", parseOperatorSupportSummary);
}

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

type Parser<T> = (value: unknown) => T | null;

export class SupportConflictError extends Error {}
type MutationBody = { version: typeof SUPPORT_CONTRACT_VERSION; status: "open" | "resolved"; observedMessageId: string } | { version: typeof SUPPORT_CONTRACT_VERSION; body: string; clientMessageId: string; readThroughMessageId: string } | { version: typeof SUPPORT_CONTRACT_VERSION; lastMessageId: string } | { version: typeof SUPPORT_CONTRACT_VERSION; handler: SupportHandler };
const conflictMessage = "This conversation changed. Review the latest messages, then try again.";

async function request<T>(path: string, parser: Parser<T>, body?: MutationBody, conflict = conflictMessage): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = parseSupportErrorResponse(value);
    if (error?.error.code === "AUTH_UNAVAILABLE") throw new Error("Authentication is temporarily unavailable. Try again.");
    if (error?.error.code === "SUPPORT_CONFLICT") throw new SupportConflictError(conflict);
    throw new Error(error?.error.code === "SUPPORT_UNAVAILABLE" ? "Support inbox is unavailable." : "Couldn't load support. Try again.");
  }
  const parsed = parser(value);
  if (!parsed) throw new Error("Couldn't load support. Try again.");
  return parsed;
}

export type OperatorSupportTransport = {
  list: (status: "open" | "resolved" | "all", before?: string) => Promise<OperatorSupportListResponse>;
  conversation: (id: string, before?: string) => Promise<OperatorSupportConversationResponse>;
  read: (id: string, lastMessageId: string) => Promise<void>;
  reply: (id: string, body: string, clientMessageId: string, readThroughMessageId: string) => Promise<OperatorSupportConversationResponse>;
  status: (id: string, status: "open" | "resolved", observedMessageId: string) => Promise<OperatorSupportConversationResponse>;
  handler: (id: string, handler: SupportHandler) => Promise<OperatorSupportConversationResponse>;
};

export const operatorSupportTransport: OperatorSupportTransport = {
  list: (status, before) => request(`/api/admin/support/conversations?status=${status}${before ? `&before=${encodeURIComponent(before)}` : ""}`, parseOperatorSupportListResponse),
  conversation: (id, before) => request(`/api/admin/support/conversations/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`, parseOperatorSupportConversationResponse),
  read: async (id, lastMessageId) => {
    const response = await fetch(`/api/admin/support/conversations/${encodeURIComponent(id)}/read`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: SUPPORT_CONTRACT_VERSION, lastMessageId }),
    });
    if (!response.ok) throw new Error("Couldn't mark conversation as read.");
  },
  reply: (id, body, clientMessageId, readThroughMessageId) => request(`/api/admin/support/conversations/${encodeURIComponent(id)}/messages`, parseOperatorSupportConversationResponse, { version: SUPPORT_CONTRACT_VERSION, body, clientMessageId, readThroughMessageId }),
  status: (id, status, observedMessageId) => request(`/api/admin/support/conversations/${encodeURIComponent(id)}/status`, parseOperatorSupportConversationResponse, { version: SUPPORT_CONTRACT_VERSION, status, observedMessageId }),
  handler: (id, handler) => request(`/api/admin/support/conversations/${encodeURIComponent(id)}/handler`, parseOperatorSupportConversationResponse, { version: SUPPORT_CONTRACT_VERSION, handler }, handler === "assistant" ? "Can't hand back yet. Reply to the customer first, or check the Support assistant settings." : conflictMessage),
};

export async function fetchOperatorSupportSummary(): Promise<OperatorSupportSummary> {
  return request("/api/admin/support/summary", parseOperatorSupportSummary);
}

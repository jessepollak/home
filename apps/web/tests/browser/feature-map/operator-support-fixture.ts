import type { Page, Route } from "@playwright/test";
import { json } from "../fixtures/api";
import { FIXED_NOW } from "../fixtures/fixed-time";
import { fixtureOperatorAddress } from "../fixtures/session";
import {
  SUPPORT_CONTRACT_VERSION,
  parseOperatorSupportHandlerRequest,
  parseOperatorSupportReplyRequest,
  parseOperatorSupportStatusRequest,
  type OperatorSupportConversationResponse,
  type OperatorSupportListResponse,
  type OperatorSupportMessage,
  type SupportHandler,
} from "../../../shared/support/contract";

export const operatorSupportFixtureConversationId = "11111111-1111-4111-8111-111111111111";
const timestamp = new Date(FIXED_NOW).toISOString();
const customerLabel = "fixture.customer@example.com";
const customerMessage: OperatorSupportMessage = {
  id: "33333333-3333-4333-8333-333333333333",
  authorType: "customer",
  clientMessageId: "fixture_customer_message",
  authorOperator: null,
  status: "sent",
  body: "My funding order needs help",
  createdAt: timestamp,
};
const conversationPath = `/api/admin/support/conversations/${operatorSupportFixtureConversationId}`;
type Status = "open" | "resolved";

function operatorMessage(body = "We can help"): OperatorSupportMessage {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    authorType: "operator",
    authorOperator: fixtureOperatorAddress,
    status: "sent",
    body,
    createdAt: timestamp,
  };
}

function detail(status: Status = "open", handler: SupportHandler = "assistant", messages = [customerMessage]): OperatorSupportConversationResponse {
  return {
    version: SUPPORT_CONTRACT_VERSION,
    conversation: {
      id: operatorSupportFixtureConversationId,
      status,
      handler,
      handedOffAt: null,
      assistantAvailable: true,
      createdAt: timestamp,
      resolvedAt: status === "resolved" ? timestamp : null,
      messages,
      messagesNextCursor: null,
      contextRefs: [{ kind: "funding_order", id: "order-123", summary: "pending · provider · 10 USD" }],
    },
    customer: {
      status: "active",
      country: "US",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      emails: [customerLabel],
      accountProviders: ["base-account"],
      wallets: [],
      recentEvents: [{ name: "Funding order", occurredAt: timestamp }],
    },
  };
}

function clipPreview(body: string): string {
  let text = "";
  for (const point of body) {
    if (text.length + point.length > 140) break;
    text += point;
  }
  return text;
}

function list(status: Status = "open", handler: SupportHandler = "assistant", filter = "open", messages = [customerMessage], unread = true): OperatorSupportListResponse {
  const lastMessage = messages.at(-1) ?? customerMessage;
  return {
    version: SUPPORT_CONTRACT_VERSION,
    conversations: filter !== "all" && filter !== status ? [] : [{
      id: operatorSupportFixtureConversationId,
      status,
      handler,
      lastMessageAt: lastMessage.createdAt,
      preview: clipPreview(lastMessage.body),
      lastAuthorType: lastMessage.authorType,
      unread,
      customerLabel,
    }],
    nextCursor: null,
  };
}

export function operatorSupportFixtureRoutes(): ReadonlyArray<readonly [string, unknown]> {
  return [
    ["**/api/admin/support/summary", { version: SUPPORT_CONTRACT_VERSION, unreadConversations: 1 }],
    ["**/api/admin/support/conversations?**", list()],
    [`**${conversationPath}`, detail()],
    [`**${conversationPath}/messages`, detail("open", "operator", [customerMessage, operatorMessage()])],
    [`**${conversationPath}/status`, detail("resolved")],
    [`**${conversationPath}/handler`, detail("open", "operator")],
    [`**${conversationPath}/read`, {}],
  ];
}

function invalid(route: Route): Promise<void> {
  return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_REQUEST" } }) });
}

export async function installOperatorSupportFixtures(page: Page): Promise<void> {
  let status: Status = "open";
  let handler: SupportHandler = "assistant";
  let messages = [customerMessage];
  let unread = true;
  let replyCounter = 0;
  const replyIds = new Map<string, string>();
  await page.route("**/api/admin/support/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "GET") {
      if (path === "/api/admin/support/summary") return json(route, { version: SUPPORT_CONTRACT_VERSION, unreadConversations: unread ? 1 : 0 });
      if (path === "/api/admin/support/conversations") return json(route, list(status, handler, url.searchParams.get("status") ?? "open", messages, unread));
      if (path === conversationPath) return json(route, detail(status, handler, messages));
    }
    if (request.method() === "POST") {
      if (path === `${conversationPath}/read`) {
        unread = false;
        return json(route, {});
      }
      if (path === `${conversationPath}/messages`) {
        const parsed = parseOperatorSupportReplyRequest(request.postDataJSON());
        if (!parsed) return invalid(route);
        if (!replyIds.has(parsed.clientMessageId)) {
          const id = `55555555-5555-4555-8555-${(++replyCounter).toString(16).padStart(12, "0")}`;
          replyIds.set(parsed.clientMessageId, id);
          handler = "operator";
          unread = false;
          messages = [...messages, { ...operatorMessage(parsed.body), id }];
        }
        return json(route, detail(status, handler, messages));
      }
      if (path === `${conversationPath}/status`) {
        const parsed = parseOperatorSupportStatusRequest(request.postDataJSON());
        if (!parsed) return invalid(route);
        status = parsed.status;
        if (status === "resolved") unread = false;
        return json(route, detail(status, handler, messages));
      }
      if (path === `${conversationPath}/handler`) {
        const parsed = parseOperatorSupportHandlerRequest(request.postDataJSON());
        if (!parsed) return invalid(route);
        handler = parsed.handler;
        return json(route, detail(status, handler, messages));
      }
    }
    return route.fallback();
  });
}

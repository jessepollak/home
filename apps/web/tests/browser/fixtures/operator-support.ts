import type { OperatorSupportConversationResponse, OperatorSupportListResponse, OperatorSupportMessage, OperatorSupportReplyResponse } from "@/shared/support/contract";

export const supportConversationId = "11111111-1111-4111-8111-111111111111";
export const supportOtherConversationId = "22222222-2222-4222-8222-222222222222";
export const supportReplyId = "55555555-5555-4555-8555-555555555555";
const at = "2026-09-27T12:00:00.000Z";
export const supportReply: OperatorSupportMessage = { id: supportReplyId, authorType: "operator", authorOperator: "0x1111111111111111111111111111111111111111", status: "sent", body: "We can help", createdAt: at };
export const supportDetail: OperatorSupportConversationResponse = {
  version: 2,
  conversation: { id: supportConversationId, status: "open", handler: "operator", handedOffAt: null, assistantAvailable: false, createdAt: at, resolvedAt: null, messages: [{ id: "33333333-3333-4333-8333-333333333333", authorType: "customer", clientMessageId: "fixture_33333333", authorOperator: null, status: "sent", body: "My funding order needs help", createdAt: at }], messagesNextCursor: "66666666-6666-4666-8666-666666666666", contextRefs: [] },
  customer: { status: "active", country: "US", firstSeenAt: at, lastSeenAt: at, emails: ["customer@example.com"], accountProviders: ["base-account"], wallets: [], recentEvents: [] },
};
export const supportOlderDetail: OperatorSupportConversationResponse = { ...supportDetail, conversation: { ...supportDetail.conversation, messages: [supportReply], messagesNextCursor: null } };
export const supportReplayResponse: OperatorSupportReplyResponse = { ...supportDetail, version: 3, reply: { messageId: supportReplyId, replayed: true } };
export const supportFreshResponse: OperatorSupportReplyResponse = { ...supportDetail, version: 3, conversation: { ...supportDetail.conversation, messages: [...supportDetail.conversation.messages, supportReply] }, reply: { messageId: supportReplyId, replayed: false } };
export const supportList: OperatorSupportListResponse = { version: 2, conversations: [supportConversationId, supportOtherConversationId].map((id) => ({ id, status: "open", handler: "operator", lastMessageAt: at, preview: "My funding order needs help", lastAuthorType: "customer", unread: false, customerLabel: id === supportConversationId ? "customer@example.com" : "other@example.com" })), nextCursor: null };

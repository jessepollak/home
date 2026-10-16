import { expect, test } from "bun:test";
import { parseOperatorSupportConversationResponse, parseOperatorSupportReplyResponse, type OperatorSupportConversationResponse } from "./contract";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-27T12:00:00.000Z";
const detail: OperatorSupportConversationResponse = { version: 2, conversation: { id, status: "open", handler: "operator", handedOffAt: null, assistantAvailable: false, createdAt: at, resolvedAt: null, messages: [], messagesNextCursor: null, contextRefs: [] }, customer: { status: "active", country: null, firstSeenAt: at, lastSeenAt: at, emails: [], accountProviders: [], wallets: [], recentEvents: [] } };

test("reply parser accepts replay metadata independently of the message page without widening conversation responses", () => {
  expect(parseOperatorSupportReplyResponse({ ...detail, reply: { messageId: id, replayed: true } })?.reply).toEqual({ messageId: id, replayed: true });
  expect(parseOperatorSupportConversationResponse(detail)).toEqual(detail);
  expect(parseOperatorSupportConversationResponse({ ...detail, reply: { messageId: id, replayed: true } })).toBeNull();
});

for (const [name, reply] of Object.entries({ missingId: { replayed: true }, invalidId: { messageId: "bad-id", replayed: true }, missingReplay: { messageId: id }, invalidReplay: { messageId: id, replayed: "true" }, extra: { messageId: id, replayed: true, extra: 1 } })) {
  test(`reply parser rejects ${name}`, () => { expect(parseOperatorSupportReplyResponse({ ...detail, reply })).toBeNull(); });
}
test("reply parser rejects missing metadata, invalid detail and a non-operator match", () => {
  expect(parseOperatorSupportReplyResponse(detail)).toBeNull();
  expect(parseOperatorSupportReplyResponse({ ...detail, customer: null, reply: { messageId: id, replayed: true } })).toBeNull();
  expect(parseOperatorSupportReplyResponse({ ...detail, conversation: { ...detail.conversation, messages: [{ id, authorType: "assistant", authorOperator: null, status: "sent", body: "Reply", createdAt: at }] }, reply: { messageId: id, replayed: true } })).toBeNull();
});

import "@/client/account/dom-test-harness";

import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { shouldSubmitSupportComposer } from "@/client/support/composer-keydown";
import { OperatorSupportInbox } from "./operator-support-inbox";
import { SupportConflictError, type OperatorSupportTransport } from "./api";
import { SUPPORT_CONTRACT_VERSION, type OperatorSupportConversationResponse } from "@/shared/support/contract";

const screen = within(document.body);
const id = "11111111-1111-4111-8111-111111111111";
const time = "2026-09-27T12:00:00.000Z";
const detail: OperatorSupportConversationResponse = {
  version: SUPPORT_CONTRACT_VERSION,
  conversation: { id, status: "open", handler: "operator", handedOffAt: null, assistantAvailable: false, createdAt: time, resolvedAt: null, messages: [
    { id: "22222222-2222-4222-8222-222222222222", authorType: "customer", authorOperator: null, status: "sent", body: "Need help", createdAt: time },
    { id: "33333333-3333-4333-8333-333333333333", authorType: "assistant", authorOperator: null, status: "draft", body: "Proposed reply", createdAt: time },
  ], messagesNextCursor: null, contextRefs: [{ kind: "funding_order", id: "order", summary: "pending · 10 USD" }] },
  customer: { status: "active", country: "US", firstSeenAt: time, lastSeenAt: time, emails: [], accountProviders: [], wallets: [], recentEvents: [] },
};

function setup(overrides: Partial<OperatorSupportTransport> = {}, start: OperatorSupportConversationResponse = detail) {
  const calls = { read: 0, sent: [] as string[], status: [] as string[], list: [] as string[], handler: [] as string[] };
  let current = start;
  const transport: OperatorSupportTransport = {
    list: async (filter) => { calls.list.push(filter); const matches = filter === "all" || current.conversation.status === filter; return { version: 2, conversations: matches ? [{ id, status: current.conversation.status, handler: current.conversation.handler, lastMessageAt: time, preview: "Need help", lastAuthorType: "customer", unread: current.conversation.handler === "operator" && calls.read === 0, customerLabel: "Customer 44444444" }] : [], nextCursor: null }; },
    conversation: async () => current,
    read: async () => { calls.read++; },
    reply: async (_id, body) => { calls.sent.push(body); current = { ...current, conversation: { ...current.conversation, handler: "operator", messages: [...current.conversation.messages, { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", authorOperator: null, status: "sent", body, createdAt: time }] } }; return current; },
    status: async (_id, status) => { calls.status.push(status); current = { ...current, conversation: { ...current.conversation, status } }; return current; },
    handler: async (_id, handler) => { calls.handler.push(handler); current = { ...current, conversation: { ...current.conversation, handler } }; return current; },
    ...overrides,
  };
  return { transport, calls };
}

afterEach(cleanup);
afterEach(() => { delete (document as unknown as { hidden?: boolean }).hidden; });

test("filters and empty inbox provide a recovery path", async () => {
  const { transport, calls } = setup();
  render(<OperatorSupportInbox transport={transport} />);
  await screen.findByRole("link", { name: /Customer 44444444/ });
  expect(screen.getByText("Unread")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
  await screen.findByText("No resolved conversations.");
  expect(calls.list).toContain("resolved");
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  await screen.findByRole("link", { name: /Customer 44444444/ });
});

test("view marks customer message read, separates drafts from log, and exposes customer context", async () => {
  const { transport, calls } = setup();
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByRole("log", { name: "Messages" });
  await waitFor(() => expect(calls.read).toBe(1));
  await screen.findByRole("link", { name: /Customer 44444444/ });
  expect(screen.getByRole("heading", { level: 2, name: "Customer 44444444" })).toBeTruthy();
  expect(within(screen.getByRole("log", { name: "Messages" })).queryByText("Proposed reply")).toBeNull();
  expect(screen.getByRole("region", { name: "Suggested reply" }).textContent).toContain("Proposed reply");
  expect(screen.getByRole("complementary", { name: "Customer details" }).textContent).toContain("pending · 10 USD");
});

test("direct conversation falls back to the customer email, wallet, then conversation id", async () => {
  const wallet = "0x1111111111111111111111111111111111112222" as const;
  for (const [customer, label] of [
    [{ ...detail.customer, emails: ["customer@example.com"], wallets: [wallet] }, "customer@example.com"],
    [{ ...detail.customer, wallets: [wallet] }, "0x1111…2222"],
    [detail.customer, "Customer 11111111"],
  ] satisfies Array<[OperatorSupportConversationResponse["customer"], string]>) {
    const { transport } = setup({
      list: async () => new Promise<never>(() => {}),
      conversation: async () => ({ ...detail, customer }),
    });
    const view = render(<OperatorSupportInbox conversationId={id} transport={transport} />);
    expect(await view.findByRole("heading", { level: 2, name: label })).toBeTruthy();
    view.unmount();
  }
});

test("operator composer uses Enter only with a fine pointer and preserves Shift+Enter", () => {
  const original = window.matchMedia;
  let fine = false;
  window.matchMedia = ((query: string) => ({ matches: fine, media: query })) as typeof window.matchMedia;
  const key = (value: string, shiftKey = false, isComposing = false) =>
    ({ key: value, shiftKey, nativeEvent: { isComposing } }) as KeyboardEvent<HTMLTextAreaElement>;
  try {
    expect(shouldSubmitSupportComposer(key("Enter"))).toBe(false);
    fine = true;
    expect(shouldSubmitSupportComposer(key("Enter", true))).toBe(false);
    expect(shouldSubmitSupportComposer(key("Enter", false, true))).toBe(false);
    expect(shouldSubmitSupportComposer(key("a"))).toBe(false);
    expect(shouldSubmitSupportComposer(key("Enter"))).toBe(true);
  } finally { window.matchMedia = original; }
});

test("operator sends a trimmed reply and resolves then reopens", async () => {
  const { transport, calls } = setup();
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const textbox = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(textbox, { target: { value: "  We can help  " } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls.sent).toEqual(["We can help"]));
  await screen.findByText("We can help");
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  await screen.findByRole("button", { name: "Reopen" });
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await screen.findByRole("button", { name: "Resolve" });
  expect(calls.status).toEqual(["resolved", "open"]);
});

test("unavailable list shows error and a retry control", async () => {
  const { transport } = setup({ list: async () => { throw new Error("Support inbox is unavailable."); } });
  render(<OperatorSupportInbox transport={transport} />);
  await screen.findByRole("alert");
  expect(screen.getByText("Support inbox is unavailable.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("operator reply retry reuses the original client message id", async () => {
  const ids: string[] = [];
  let attempts = 0;
  const { transport } = setup({ reply: async (_id, body, clientMessageId) => {
    ids.push(clientMessageId);
    attempts += 1;
    if (attempts === 1) throw new Error("Network failed");
    return { ...detail, conversation: { ...detail.conversation, messages: [...detail.conversation.messages, { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", authorOperator: null, status: "sent", body, createdAt: time }] } };
  } });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const textbox = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(textbox, { target: { value: "We can help" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("We can help");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

test("resolving removes the conversation from the open list", async () => {
  const { transport } = setup();
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByRole("link", { name: /Customer 44444444/ });
  fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: /Customer 44444444/ })).toBeNull());
}, 15_000);

test("loading earlier marks an older customer message read", async () => {
  const olderCustomer = { id: "66666666-6666-4666-8666-666666666666", authorType: "customer" as const, authorOperator: null, status: "sent" as const, body: "Older question", createdAt: time };
  const operatorOnly = { ...detail, conversation: { ...detail.conversation, messages: [{ id: "77777777-7777-4777-8777-777777777777", authorType: "operator" as const, authorOperator: null, status: "sent" as const, body: "Checking", createdAt: time }], messagesNextCursor: "88888888-8888-4888-8888-888888888888", contextRefs: [] } };
  const reads: string[] = [];
  const { transport } = setup({
    conversation: async (_id, before) => before ? { ...operatorOnly, conversation: { ...operatorOnly.conversation, messages: [olderCustomer], messagesNextCursor: null } } : operatorOnly,
    read: async (_id, lastMessageId) => { reads.push(lastMessageId); },
  });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByRole("button", { name: "Load earlier messages" });
  expect(reads).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
  await screen.findByText("Older question");
  await waitFor(() => expect(reads).toEqual([olderCustomer.id]));
}, 15_000);

test("a reply result is discarded after switching conversations and keeps the new composer text", async () => {
  const other = "99999999-9999-4999-8999-999999999999";
  const otherDetail: OperatorSupportConversationResponse = { ...detail, conversation: { ...detail.conversation, id: other, messages: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorType: "customer", authorOperator: null, status: "sent", body: "Second conversation", createdAt: time }], messagesNextCursor: null, contextRefs: [] } };
  let resolveReply: ((value: OperatorSupportConversationResponse) => void) | undefined;
  const { transport } = setup({
    conversation: async (id) => id === other ? otherDetail : detail,
    reply: () => new Promise<OperatorSupportConversationResponse>((resolve) => { resolveReply = resolve; }),
  });
  const view = render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const first = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(first, { target: { value: "For the first" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  view.rerender(<OperatorSupportInbox conversationId={other} transport={transport} />);
  await screen.findByText("Second conversation");
  const second = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(second, { target: { value: "For the second" } });
  resolveReply!({ ...detail, conversation: { ...detail.conversation, messages: [...detail.conversation.messages, { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", authorOperator: null, status: "sent", body: "For the first", createdAt: time }] } });
  await waitFor(() => expect((second as HTMLTextAreaElement).value).toBe("For the second"));
  expect(screen.getByText("Second conversation")).toBeTruthy();
  expect(screen.queryByText("For the first")).toBeNull();
}, 15_000);

test("a reply that resolves after switching back to its conversation is discarded", async () => {
  const other = "99999999-9999-4999-8999-999999999999";
  const otherDetail: OperatorSupportConversationResponse = { ...detail, conversation: { ...detail.conversation, id: other, messages: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorType: "customer", authorOperator: null, status: "sent", body: "Second conversation", createdAt: time }], messagesNextCursor: null, contextRefs: [] } };
  let resolveReply: ((value: OperatorSupportConversationResponse) => void) | undefined;
  const { transport } = setup({ conversation: async (id) => id === other ? otherDetail : detail, reply: () => new Promise<OperatorSupportConversationResponse>((resolve) => { resolveReply = resolve; }) });
  const view = render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const first = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(first, { target: { value: "For the first" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  view.rerender(<OperatorSupportInbox conversationId={other} transport={transport} />);
  await screen.findByText("Second conversation");
  view.rerender(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByText("Need help");
  const back = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(back, { target: { value: "A newer draft" } });
  resolveReply!({ ...detail, conversation: { ...detail.conversation, messages: [...detail.conversation.messages, { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", authorOperator: null, status: "sent", body: "For the first", createdAt: time }] } });
  await waitFor(() => expect((back as HTMLTextAreaElement).value).toBe("A newer draft"));
  expect(screen.queryByText("For the first")).toBeNull();
}, 15_000);

test("pending replies stay scoped to their conversation", async () => {
  const other = "99999999-9999-4999-8999-999999999999";
  const otherDetail: OperatorSupportConversationResponse = { ...detail, conversation: { ...detail.conversation, id: other, messages: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorType: "customer", authorOperator: null, status: "sent", body: "Second conversation", createdAt: time }], messagesNextCursor: null, contextRefs: [] } };
  const replies: string[] = [];
  let failing = true;
  const { transport } = setup({
    conversation: async (id) => id === other ? otherDetail : detail,
    reply: async (conversation, body, clientMessageId) => {
      replies.push(`${conversation}:${clientMessageId}`);
      if (failing) { failing = false; throw new Error("Network failed"); }
      return { ...detail, conversation: { ...detail.conversation, id: conversation, messages: [...detail.conversation.messages, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", authorType: "operator", authorOperator: null, status: "sent", body, createdAt: time }] } };
    },
  });
  const view = render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const first = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(first, { target: { value: "Reply A" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("alert");
  view.rerender(<OperatorSupportInbox conversationId={other} transport={transport} />);
  await screen.findByText("Second conversation");
  const second = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(second, { target: { value: "Reply B" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Reply B");
  view.rerender(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByText("Need help");
  const back = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(back, { target: { value: "Reply A" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(replies).toHaveLength(3));
  expect(replies[0]).toBe(replies[2]);
  expect(replies[0].startsWith(`${id}:`)).toBe(true);
  expect(replies[1].startsWith(`${other}:`)).toBe(true);
}, 15_000);

test("a read failure for a left conversation does not surface on the current one", async () => {
  const other = "99999999-9999-4999-8999-999999999999";
  const otherDetail: OperatorSupportConversationResponse = { ...detail, conversation: { ...detail.conversation, id: other, messages: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorType: "customer", authorOperator: null, status: "sent", body: "Second conversation", createdAt: time }], messagesNextCursor: null, contextRefs: [] } };
  const rejections: Array<(reason: Error) => void> = [];
  const { transport } = setup({ conversation: async (id) => id === other ? otherDetail : detail, read: () => new Promise<void>((_resolve, reject) => { rejections.push(reject); }) });
  const view = render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByRole("log", { name: "Messages" });
  await waitFor(() => expect(rejections).toHaveLength(1));
  view.rerender(<OperatorSupportInbox conversationId={other} transport={transport} />);
  await screen.findByText("Second conversation");
  rejections[0](new Error("Couldn't mark conversation as read."));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText("Second conversation")).toBeTruthy();
}, 15_000);

test("a pending reply blocks a second submission and keeps its retry id", async () => {
  const other = "99999999-9999-4999-8999-999999999999";
  const otherDetail: OperatorSupportConversationResponse = { ...detail, conversation: { ...detail.conversation, id: other, messages: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorType: "customer", authorOperator: null, status: "sent", body: "Second conversation", createdAt: time }], messagesNextCursor: null, contextRefs: [] } };
  const calls: Array<{ clientMessageId: string; body: string; reject: (error: Error) => void }> = [];
  const { transport } = setup({
    conversation: async (id) => id === other ? otherDetail : detail,
    reply: (_conversation, messageBody, clientMessageId) => new Promise<OperatorSupportConversationResponse>((_resolve, reject) => { calls.push({ body: messageBody, clientMessageId, reject }); }),
  });
  const view = render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const first = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(first, { target: { value: "one" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  view.rerender(<OperatorSupportInbox conversationId={other} transport={transport} />);
  await screen.findByText("Second conversation");
  view.rerender(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByText("Need help");
  const back = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(back, { target: { value: "one" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(calls).toHaveLength(1);
  calls[0].reject(new Error("Network failed"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1].clientMessageId).toBe(calls[0].clientMessageId);
  expect(calls[1].body).toBe("one");
}, 15_000);

test("in-flight mutations are tracked per conversation", async () => {
  const other = "99999999-9999-4999-8999-999999999999";
  const otherDetail: OperatorSupportConversationResponse = { ...detail, conversation: { ...detail.conversation, id: other, messages: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorType: "customer", authorOperator: null, status: "sent", body: "Second conversation", createdAt: time }], messagesNextCursor: null, contextRefs: [] } };
  const calls: Array<{ conversation: string; reject: (error: Error) => void }> = [];
  const { transport } = setup({
    conversation: async (id) => id === other ? otherDetail : detail,
    reply: (conversation, _messageBody, _clientMessageId) => new Promise<OperatorSupportConversationResponse>((_resolve, reject) => { calls.push({ conversation, reject }); }),
  });
  const view = render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const first = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(first, { target: { value: "one" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  view.rerender(<OperatorSupportInbox conversationId={other} transport={transport} />);
  await screen.findByText("Second conversation");
  const second = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(second, { target: { value: "b" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(2));
  view.rerender(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByText("Need help");
  const back = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(back, { target: { value: "two" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(calls.filter((call) => call.conversation === id)).toHaveLength(1);
  expect(calls).toHaveLength(2);
}, 15_000);

test("failed replies keep their own retry id per body", async () => {
  const calls: Array<{ clientMessageId: string; body: string; reject: (error: Error) => void }> = [];
  const { transport } = setup({ reply: (_conversation, messageBody, clientMessageId) => new Promise<OperatorSupportConversationResponse>((_resolve, reject) => { calls.push({ body: messageBody, clientMessageId, reject }); }) });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const composer = () => screen.getByRole("textbox", { name: "Reply" });
  await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(composer(), { target: { value: "one" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  calls[0].reject(new Error("Network failed"));
  await screen.findByRole("alert");
  fireEvent.input(composer(), { target: { value: "two" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(2));
  calls[1].reject(new Error("Network failed"));
  await screen.findByRole("alert");
  fireEvent.input(composer(), { target: { value: "one" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(3));
  expect(calls[2].clientMessageId).toBe(calls[0].clientMessageId);
  calls[2].reject(new Error("Network failed"));
  await screen.findByRole("alert");
  fireEvent.input(composer(), { target: { value: "two" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(4));
  expect(calls[3].clientMessageId).toBe(calls[1].clientMessageId);
}, 15_000);

test("a stale failure does not overwrite the current conversation error", async () => {
  const other = "99999999-9999-4999-8999-999999999999";
  const otherDetail: OperatorSupportConversationResponse = { ...detail, conversation: { ...detail.conversation, id: other, messages: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorType: "customer", authorOperator: null, status: "sent", body: "Second conversation", createdAt: time }], messagesNextCursor: null, contextRefs: [] } };
  const calls: Array<{ reject: (error: Error) => void }> = [];
  const { transport } = setup({
    conversation: async (id) => id === other ? otherDetail : detail,
    reply: () => new Promise<OperatorSupportConversationResponse>((_resolve, reject) => { calls.push({ reject }); }),
  });
  const view = render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const first = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(first, { target: { value: "one" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  view.rerender(<OperatorSupportInbox conversationId={other} transport={transport} />);
  await screen.findByText("Second conversation");
  const second = await screen.findByRole("textbox", { name: "Reply" });
  fireEvent.input(second, { target: { value: "two" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(2));
  calls[1].reject(new Error("B failed"));
  await screen.findByText("B failed");
  calls[0].reject(new Error("A failed"));
  await waitFor(() => expect(screen.queryByText("A failed")).toBeNull());
  expect(screen.getByText("B failed")).toBeTruthy();
}, 15_000);

test("a refresh re-adopts a cursor after the list reached its end", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "88888888-8888-4888-8888-888888888888";
  const row = { id: first, status: "open" as const, handler: "operator" as const, lastMessageAt: time, preview: "Need help", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 11111111" };
  const nextRow = { id: second, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T10:00:00.000Z", preview: "Fresh", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 88888888" };
  let call = 0;
  const { transport } = setup({ list: async () => {
    call += 1;
    if (call === 2) return { version: 2, conversations: [], nextCursor: null };
    if (call >= 3) return { version: 2, conversations: [nextRow], nextCursor: "c-rest" };
    return { version: 2, conversations: [row], nextCursor: "c1" };
  } });
  render(<OperatorSupportInbox transport={transport} />);
  await screen.findByRole("link", { name: /Customer 11111111/ });
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
  document.dispatchEvent(new Event("visibilitychange"));
  await screen.findByRole("link", { name: /Customer 88888888/ });
  expect(await screen.findByRole("button", { name: "Load more" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Customer 11111111/ })).toBeNull();
}, 15_000);

test("a poll with an unchanged first page keeps the deeper cursor", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "88888888-8888-4888-8888-888888888888";
  const row = { id: first, status: "open" as const, handler: "operator" as const, lastMessageAt: time, preview: "Need help", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 11111111" };
  const nextRow = { id: second, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T10:00:00.000Z", preview: "Older", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 88888888" };
  const cursors: (string | undefined)[] = [];
  let firstPageLoads = 0;
  let poll = () => {};
  const setInterval = window.setInterval.bind(window);
  const interval = spyOn(window, "setInterval").mockImplementation(((callback: TimerHandler, delay?: number) => {
    if (delay === 15_000) poll = callback as () => void;
    return setInterval(callback, delay);
  }) as typeof window.setInterval);
  const { transport } = setup({ list: async (_status, cursor) => {
    cursors.push(cursor);
    if (cursor === "c1") return { version: 2, conversations: [nextRow], nextCursor: "c2" };
    if (cursor === "c2") return { version: 2, conversations: [], nextCursor: null };
    firstPageLoads += 1;
    return { version: 2, conversations: [{ ...row, preview: firstPageLoads === 1 ? "Need help" : "Refreshed" }], nextCursor: "c1" };
  } });
  render(<OperatorSupportInbox transport={transport} />);
  await screen.findByRole("link", { name: /Customer 11111111/ });
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await screen.findByRole("link", { name: /Customer 88888888/ });
  await act(async () => { poll(); });
  await screen.findByText("Refreshed");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(cursors).toContain("c2"));
  interval.mockRestore();
}, 15_000);

test("returning to a tab drops a resolved deeper row even when the first page is unchanged", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "88888888-8888-4888-8888-888888888888";
  const row = { id: first, status: "open" as const, handler: "operator" as const, lastMessageAt: time, preview: "Need help", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 11111111" };
  const deeper = { ...row, id: second, lastMessageAt: "2026-09-27T10:00:00.000Z", customerLabel: "Customer 88888888" };
  const cursors: (string | undefined)[] = [];
  let resolved = false;
  const { transport } = setup({ list: async (_status, cursor) => {
    cursors.push(cursor);
    return cursor === "c1" ? { version: 2, conversations: resolved ? [] : [deeper], nextCursor: null } : { version: 2, conversations: [row], nextCursor: "c1" };
  } });
  render(<OperatorSupportInbox transport={transport} />);
  await screen.findByRole("link", { name: /Customer 11111111/ });
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await screen.findByRole("link", { name: /Customer 88888888/ });
  resolved = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await waitFor(() => expect(screen.queryByRole("link", { name: /Customer 88888888/ })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(cursors).toEqual([undefined, "c1", undefined, "c1"]));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
  expect(screen.queryByRole("link", { name: /Customer 88888888/ })).toBeNull();
}, 15_000);

test("a poll drops rows another operator moved out of the filter and keeps deeper pages", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "88888888-8888-4888-8888-888888888888";
  const row = { id: first, status: "open" as const, handler: "operator" as const, lastMessageAt: time, preview: "Need help", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 11111111" };
  const deeper = { id: second, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T10:00:00.000Z", preview: "Older", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 88888888" };
  let firstPageLoads = 0;
  const { transport } = setup({ list: async (_status, cursor) => {
    if (cursor === "c1") return { version: 2, conversations: [deeper], nextCursor: null };
    firstPageLoads += 1;
    return { version: 2, conversations: firstPageLoads === 1 ? [row] : [], nextCursor: firstPageLoads === 1 ? "c1" : null };
  } });
  render(<OperatorSupportInbox transport={transport} />);
  await screen.findByRole("link", { name: /Customer 11111111/ });
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await screen.findByRole("link", { name: /Customer 88888888/ });
  document.dispatchEvent(new Event("visibilitychange"));
  await waitFor(() => expect(screen.queryByRole("link", { name: /Customer 11111111/ })).toBeNull());
}, 15_000);

test("resolving forwards the newest customer message the operator has seen", async () => {
  const observed: string[] = [];
  const { transport } = setup({ status: async (_id, status, observedMessageId) => { observed.push(`${status}:${observedMessageId}`); return detail; } });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
  await waitFor(() => expect(observed).toEqual(["resolved:22222222-2222-4222-8222-222222222222"]));
}, 15_000);

const screenBox = (top: number) => ({ top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;


test("a resolve with the newest customer message below the fold does not claim it was seen", async () => {
  const observed: string[] = [];
  const second = { id: "99999999-9999-4999-8999-999999999999", authorType: "customer" as const, authorOperator: null, status: "sent" as const, body: "Second question", createdAt: time };
  let current = detail;
  const { transport } = setup({ conversation: async () => current, status: async (_id, status, observedMessageId) => { observed.push(`${status}:${observedMessageId}`); return current; } });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findAllByText("Need help");
  const log = screen.getByRole("log", { name: "Messages" });
  log.getBoundingClientRect = () => screenBox(0);
  current = { ...detail, conversation: { ...detail.conversation, messages: [...detail.conversation.messages, second] } };
  document.dispatchEvent(new Event("visibilitychange"));
  await screen.findByText("Second question");
  (log.querySelector(`[data-message-id="22222222-2222-4222-8222-222222222222"]`) as HTMLElement).getBoundingClientRect = () => screenBox(20);
  (log.querySelector(`[data-message-id="${second.id}"]`) as HTMLElement).getBoundingClientRect = () => screenBox(200);
  fireEvent.scroll(log);
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  await waitFor(() => expect(observed).toEqual(["resolved:22222222-2222-4222-8222-222222222222"]));
}, 15_000);

test("a reply with the newest customer message below the fold does not mark it read", async () => {
  const reads: string[] = [];
  const second = { id: "99999999-9999-4999-8999-999999999999", authorType: "customer" as const, authorOperator: null, status: "sent" as const, body: "Second question", createdAt: time };
  let current = detail;
  const { transport } = setup({ conversation: async () => current, reply: async (_id, _body, _clientMessageId, readThroughMessageId) => { reads.push(readThroughMessageId); return current; } });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findAllByText("Need help");
  const log = screen.getByRole("log", { name: "Messages" });
  log.getBoundingClientRect = () => screenBox(0);
  current = { ...detail, conversation: { ...detail.conversation, messages: [...detail.conversation.messages, second] } };
  document.dispatchEvent(new Event("visibilitychange"));
  await screen.findByText("Second question");
  (log.querySelector(`[data-message-id="22222222-2222-4222-8222-222222222222"]`) as HTMLElement).getBoundingClientRect = () => screenBox(20);
  (log.querySelector(`[data-message-id="${second.id}"]`) as HTMLElement).getBoundingClientRect = () => screenBox(200);
  fireEvent.scroll(log);
  fireEvent.input(screen.getByRole("textbox", { name: "Reply" }), { target: { value: "Checking" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(reads).toEqual(["22222222-2222-4222-8222-222222222222"]));
}, 15_000);

test("a resolve conflict refreshes the inbox and reports the change", async () => {
  let lists = 0;
  const { transport } = setup({
    list: async () => { lists += 1; return { version: 2, conversations: [{ id, status: "open", handler: "operator" as const, lastMessageAt: time, preview: "Need help", lastAuthorType: "customer", unread: false, customerLabel: "Customer 44444444" }], nextCursor: null }; },
    status: async () => { throw new SupportConflictError("This conversation changed. Review the latest messages, then try again."); },
  });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const button = await screen.findByRole("button", { name: "Resolve" });
  const before = lists;
  fireEvent.click(button);
  await screen.findByText("This conversation changed. Review the latest messages, then try again.");
  await waitFor(() => expect(lists).toBeGreaterThan(before));
}, 15_000);

test("a poll that pushed the loaded range out adopts the refreshed cursor", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "88888888-8888-4888-8888-888888888888";
  const third = "99999999-9999-4999-8999-999999999999";
  const row = { id: first, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T12:00:00.000Z", preview: "Need help", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 11111111" };
  const older = { id: second, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T10:00:00.000Z", preview: "Older", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 88888888" };
  const newest = { id: third, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T13:00:00.000Z", preview: "Newest", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 99999999" };
  const cursors: (string | undefined)[] = [];
  let pages = 0;
  const { transport } = setup({ list: async (_status, cursor) => {
    cursors.push(cursor);
    if (cursor === "c1") return { version: 2, conversations: [older], nextCursor: "c2" };
    if (cursor === "c0") return { version: 2, conversations: [], nextCursor: null };
    pages += 1;
    return pages === 1 ? { version: 2, conversations: [row], nextCursor: "c1" } : { version: 2, conversations: [newest], nextCursor: "c0" };
  } });
  render(<OperatorSupportInbox transport={transport} />);
  await screen.findByRole("link", { name: /Customer 11111111/ });
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await screen.findByRole("link", { name: /Customer 88888888/ });
  document.dispatchEvent(new Event("visibilitychange"));
  await screen.findByText("Newest");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(cursors).toContain("c0"));
  expect(cursors).not.toContain("c2");
}, 15_000);

test("a changed first page resets the deeper cursor even when it overlaps the loaded range", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "88888888-8888-4888-8888-888888888888";
  const third = "99999999-9999-4999-8999-999999999999";
  const row = { id: first, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T12:00:00.000Z", preview: "Need help", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 11111111" };
  const older = { id: second, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T10:00:00.000Z", preview: "Older", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 88888888" };
  const newest = { id: third, status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T13:00:00.000Z", preview: "Newest", lastAuthorType: "customer" as const, unread: false, customerLabel: "Customer 99999999" };
  const cursors: (string | undefined)[] = [];
  let pages = 0;
  const { transport } = setup({ list: async (_status, cursor) => {
    cursors.push(cursor);
    if (cursor === "c1") return { version: 2, conversations: [older], nextCursor: "c2" };
    if (cursor === "c2") return { version: 2, conversations: [], nextCursor: null };
    pages += 1;
    return pages === 1 ? { version: 2, conversations: [row], nextCursor: "c1" } : { version: 2, conversations: [newest, row], nextCursor: "c0" };
  } });
  render(<OperatorSupportInbox transport={transport} />);
  await screen.findByRole("link", { name: /Customer 11111111/ });
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await screen.findByRole("link", { name: /Customer 88888888/ });
  document.dispatchEvent(new Event("visibilitychange"));
  await screen.findByText("Newest");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(cursors).toContain("c0"));
  expect(cursors).not.toContain("c2");
}, 15_000);

test("a conversation that loads while the tab is hidden is not marked read", async () => {
  let hidden = true;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  const { transport, calls } = setup();
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findAllByText("Need help");
  expect(calls.read).toBe(0);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await waitFor(() => expect(calls.read).toBe(1));
}, 15_000);

test("a conversation whose tab turns hidden before the load completes is not marked read", async () => {
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  const { transport, calls } = setup();
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  hidden = true;
  await screen.findAllByText("Need help");
  expect(calls.read).toBe(0);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await waitFor(() => expect(calls.read).toBe(1));
}, 15_000);

test("a customer message below the fold stays unread until it is scrolled into view", async () => {
  const reads: string[] = [];
  const nextCustomer = { id: "99999999-9999-4999-8999-999999999999", authorType: "customer" as const, authorOperator: null, status: "sent" as const, body: "Second question", createdAt: time };
  let current = detail;
  const { transport } = setup({ conversation: async () => current, read: async (_id, lastMessageId) => { reads.push(lastMessageId); } });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findAllByText("Need help");
  await waitFor(() => expect(reads).toEqual(["22222222-2222-4222-8222-222222222222"]));
  const log = screen.getByRole("log", { name: "Messages" });
  const box = (top: number) => ({ top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  log.getBoundingClientRect = () => box(0);
  current = { ...detail, conversation: { ...detail.conversation, messages: [...detail.conversation.messages, nextCustomer] } };
  document.dispatchEvent(new Event("visibilitychange"));
  await screen.findByText("Second question");
  const element = log.querySelector(`[data-message-id="${nextCustomer.id}"]`) as HTMLElement;
  element.getBoundingClientRect = () => box(200);
  fireEvent.scroll(log);
  expect(reads).toEqual(["22222222-2222-4222-8222-222222222222"]);
  element.getBoundingClientRect = () => box(20);
  fireEvent.scroll(log);
  await waitFor(() => expect(reads).toEqual(["22222222-2222-4222-8222-222222222222", nextCustomer.id]));
}, 15_000);

test("a receipt advances only through an incoming message that is visible", async () => {
  const reads: string[] = [];
  const first = { id: "22222222-2222-4222-8222-222222222222", authorType: "customer" as const, authorOperator: null, status: "sent" as const, body: "Need help", createdAt: time };
  const second = { id: "99999999-9999-4999-8999-999999999999", authorType: "customer" as const, authorOperator: null, status: "sent" as const, body: "Second question", createdAt: time };
  const base = { ...detail, conversation: { ...detail.conversation, messages: [first] } };
  let current = base;
  const { transport } = setup({ conversation: async () => current, read: async (_id, lastMessageId) => { reads.push(lastMessageId); } });
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findAllByText("Need help");
  await waitFor(() => expect(reads).toEqual([first.id]));
  const log = screen.getByRole("log", { name: "Messages" });
  log.getBoundingClientRect = () => screenBox(0);
  (log.querySelector(`[data-message-id="${first.id}"]`) as HTMLElement).getBoundingClientRect = () => screenBox(20);
  current = { ...base, conversation: { ...base.conversation, messages: [first, second] } };
  document.dispatchEvent(new Event("visibilitychange"));
  await screen.findByText("Second question");
  (log.querySelector(`[data-message-id="${second.id}"]`) as HTMLElement).getBoundingClientRect = () => screenBox(200);
  fireEvent.scroll(log);
  expect(reads).toEqual([first.id]);
  (log.querySelector(`[data-message-id="${second.id}"]`) as HTMLElement).getBoundingClientRect = () => screenBox(20);
  fireEvent.scroll(log);
  await waitFor(() => expect(reads).toEqual([first.id, second.id]));
}, 15_000);


test("a filter change discards a list response for the previous filter", async () => {
  let release: (() => void) | null = null;
  let markStarted: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const { transport } = setup({ list: async (status) => {
    if (status !== "open") throw new Error("Couldn't load support. Try again.");
    markStarted!();
    return await new Promise((resolve) => { release = () => resolve({ version: 2, conversations: [{ id, status: "open", handler: "operator" as const, lastMessageAt: time, preview: "Stale", lastAuthorType: "customer", unread: false, customerLabel: "Customer 11111111" }], nextCursor: null }); });
  } });
  render(<OperatorSupportInbox transport={transport} />);
  await started;
  fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
  release!();
  await screen.findByText("Couldn't load support. Try again.");
  expect(screen.queryByText("Stale")).toBeNull();
}, 15_000);

const operatorAddress = "0x1111111111111111111111111111111111112222" as const;
const assistantDetail: OperatorSupportConversationResponse = {
  ...detail,
  conversation: { ...detail.conversation, handler: "assistant", assistantAvailable: true, messages: [
    { id: "22222222-2222-4222-8222-222222222222", authorType: "customer", authorOperator: null, status: "sent", body: "Need help", createdAt: time, clientMessageId: "client_22222222" },
    { id: "66666666-6666-4666-8666-666666666666", authorType: "assistant", authorOperator: null, status: "sent", body: "Here is what I found", createdAt: time },
    { id: "77777777-7777-4777-8777-777777777777", authorType: "operator", authorOperator: operatorAddress, status: "sent", body: "Following up", createdAt: time },
  ] },
};

test("the list shows who is handling each conversation", async () => {
  const rows = [
    { id, status: "open" as const, handler: "assistant" as const, lastMessageAt: time, preview: "Assistant row", lastAuthorType: "assistant" as const, unread: false, customerLabel: "Assisted customer" },
    { id: "88888888-8888-4888-8888-888888888888", status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T11:00:00.000Z", preview: "Waiting row", lastAuthorType: "customer" as const, unread: true, customerLabel: "Waiting customer" },
    { id: "99999999-9999-4999-8999-999999999999", status: "open" as const, handler: "operator" as const, lastMessageAt: "2026-09-27T10:00:00.000Z", preview: "Answered row", lastAuthorType: "operator" as const, unread: false, customerLabel: "Answered customer" },
  ];
  const { transport } = setup({ list: async () => ({ version: 2, conversations: rows, nextCursor: null }) });
  render(<OperatorSupportInbox transport={transport} />);
  const assisted = await screen.findByRole("link", { name: /Assisted customer/ });
  expect(within(assisted).getByText("Assistant")).toBeTruthy();
  expect(within(assisted).queryByText("Needs reply")).toBeNull();
  const waiting = screen.getByRole("link", { name: /Waiting customer/ });
  expect(within(waiting).getByText("Needs reply")).toBeTruthy();
  expect(within(waiting).getByText("Unread")).toBeTruthy();
  const answered = screen.getByRole("link", { name: /Answered customer/ });
  expect(within(answered).queryByText("Needs reply")).toBeNull();
  expect(within(answered).queryByText("Assistant")).toBeNull();
});

test("messages name the customer, the assistant and the replying operator", async () => {
  const { transport } = setup({}, assistantDetail);
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const log = await screen.findByRole("log", { name: "Messages" });
  await within(log).findByText("Here is what I found");
  expect(within(log).getAllByText("Customer").length).toBeGreaterThan(0);
  expect(within(log).getAllByText("Assistant").length).toBeGreaterThan(0);
  expect(within(log).getAllByText("Operator 0x1111…2222").length).toBeGreaterThan(0);
});

test("an operator takes over from the assistant and hands the conversation back", async () => {
  const { transport, calls } = setup({}, assistantDetail);
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  expect(await screen.findByText("Assistant is handling this")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  await screen.findByRole("button", { name: "Hand back to assistant" });
  expect(screen.getByText("An operator is handling this")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hand back to assistant" }));
  await screen.findByRole("button", { name: "Take over" });
  expect(calls.handler).toEqual(["operator", "assistant"]);
});

test("a reply to an assistant-handled conversation takes it over", async () => {
  const { transport, calls } = setup({}, assistantDetail);
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  const textbox = await screen.findByRole("textbox", { name: "Reply" });
  expect(textbox.getAttribute("aria-describedby")).toBe("operator-support-reply-description");
  expect(screen.getByText("Sending takes over from the assistant.")).toBeTruthy();
  fireEvent.input(textbox, { target: { value: "I can take this" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("button", { name: "Hand back to assistant" });
  expect(calls.sent).toEqual(["I can take this"]);
  expect(calls.handler).toEqual([]);
  expect(screen.queryByText("Sending takes over from the assistant.")).toBeNull();
});

test("a hand back conflict explains why and refreshes the conversation", async () => {
  const operatorHandled = { ...assistantDetail, conversation: { ...assistantDetail.conversation, handler: "operator" as const } };
  let loads = 0;
  const { transport } = setup({
    conversation: async () => { loads++; return loads === 1 ? operatorHandled : { ...operatorHandled, conversation: { ...operatorHandled.conversation, assistantAvailable: false } }; },
    handler: async () => { throw new SupportConflictError("Can't hand back yet. Reply to the customer first, or check the Support assistant settings."); },
  }, operatorHandled);
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  fireEvent.click(await screen.findByRole("button", { name: "Hand back to assistant" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Can't hand back yet. Reply to the customer first, or check the Support assistant settings.");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Hand back to assistant" })).toBeNull());
  expect(screen.getByRole("alert").textContent).toBe("Can't hand back yet. Reply to the customer first, or check the Support assistant settings.");
});

test("an operator-only conversation offers no handler control", async () => {
  const { transport } = setup();
  render(<OperatorSupportInbox conversationId={id} transport={transport} />);
  await screen.findByRole("textbox", { name: "Reply" });
  expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Hand back to assistant" })).toBeNull();
  expect(screen.queryByText("Sending takes over from the assistant.")).toBeNull();
});

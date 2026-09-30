import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { TransferExecutionError } from "@/shared/transfers/types";
import { SupportChat } from "./support-chat";
import type { CustomerSupportConversation, SupportAssistantCapability, SupportMessage } from "@/shared/support/contract";

type StreamFetch = AccountWalletClient["fetchAccountResponse"];
type ChatRequest = { version: number; message: { id: string; text: string }; context?: { kind: string; id: string } };

const operator = { id: "22222222-2222-4222-8222-222222222222", authorType: "operator", status: "sent", body: "We can help.", createdAt: "2026-09-27T12:00:00.000Z" } as const;
const id = "11111111-1111-4111-8111-111111111111";
const replyId = "99999999-9999-4999-8999-999999999999";
const operatorOnly: SupportAssistantCapability = { available: false, handoff: false };
const hybrid: SupportAssistantCapability = { available: true, handoff: true };
const noStream: StreamFetch = async () => { throw new Error("Unexpected stream"); };

function customer(messageId: string, body: string, createdAt = "2026-09-27T12:02:00.000Z"): SupportMessage {
  return { id: messageId, authorType: "customer", status: "sent", body, createdAt, clientMessageId: `client-${messageId.slice(0, 8)}` };
}

function snapshot(messages: SupportMessage[], overrides: Partial<CustomerSupportConversation> = {}, assistant = operatorOnly) {
  return { version: 2, assistant, conversation: { id, status: "open", handler: "operator", assistant, unreadCount: 0, messagesNextCursor: null, contextRefs: [], messages, ...overrides } };
}

function stream(chunks: UIMessageChunk[], hold?: Promise<void>): Response {
  return createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: async ({ writer }) => {
    for (const chunk of chunks) writer.write(chunk);
    await hold;
  } }) });
}

function assistantReply(text: string, handler: "assistant" | "operator" = "assistant", discardedMessageId?: string): UIMessageChunk[] {
  return [
    { type: "start", messageId: replyId },
    { type: "text-start", id: replyId },
    { type: "text-delta", id: replyId, delta: text },
    { type: "text-end", id: replyId },
    { type: "data-support", data: { handler, conversationId: id, ...(discardedMessageId ? { discardedMessageId } : {}) } },
  ];
}

function requestOf(options: { body: string }): ChatRequest {
  return JSON.parse(options.body) as ChatRequest;
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test("opening marks operator messages read and retry resends the same message id and context", async () => {
  let read = 0;
  const requests: ChatRequest[] = [];
  const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path) => {
    if (path === "/api/support") return snapshot([operator], { unreadCount: read ? 0 : 1 });
    if (path === "/api/support/read") { read++; return null; }
    throw new Error(`Unexpected request: ${path}`);
  };
  const fetchAccountResponse: StreamFetch = async (path, options) => {
    expect(path).toBe("/api/support/chat");
    requests.push(requestOf(options));
    if (requests.length === 1) throw Object.assign(new TransferExecutionError("unavailable"), { kind: "network" });
    return stream([{ type: "data-support", data: { handler: "operator", conversationId: id } }]);
  };
  const view = render(<SupportChat open ownerKey="support-chat-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={fetchAccountResponse} context={{ kind: "funding_order", id: "order-private" }} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("We can help.");
  expect(within(within(dialog).getByRole("log", { name: "Support messages" })).getByText("Support")).toBeTruthy();
  await waitFor(() => expect(read).toBe(1));
  const composer = within(dialog).getByRole("textbox", { name: "Message support" });
  fireEvent.input(composer, { target: { value: "  Help with this order  " } });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await within(dialog).findByRole("button", { name: "Retry" });
  expect(within(dialog).getByText("Not sent")).toBeTruthy();
  expect(within(dialog).getByRole("alert").textContent).toContain("Message not sent.");
  expect(within(dialog).getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(within(dialog).getByText("Sent")).toBeTruthy());
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual({ version: 2, message: { id: requests[0].message.id, text: "Help with this order" }, context: { kind: "funding_order", id: "order-private" } });
  expect(requests[1]).toEqual(requests[0]);
});

test("a rate-limited send explains the limit and keeps the message for retry", async () => {
  const view = render(<SupportChat open ownerKey="support-rate-unit" fetchAccountResource={async () => ({ version: 2, assistant: operatorOnly, conversation: null })} fetchAccountResponse={async () => { throw Object.assign(new TransferExecutionError("unavailable"), { kind: "http", status: 429, code: "RATE_LIMITED" }); }} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Send us a message.");
  fireEvent.input(within(dialog).getByRole("textbox", { name: "Message support" }), { target: { value: "Hello" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Too many messages. Try again later."));
  expect(within(dialog).getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("assistant turn budget in stream shows limit without a regenerate action", async () => {
  let requests = 0;
  const view = render(<SupportChat open ownerKey="support-stream-limit-unit" fetchAccountResource={async () => ({ version: 2, assistant: { available: true, handoff: false }, conversation: null })} fetchAccountResponse={async () => {
    requests++;
    return stream([{ type: "data-support", data: { handler: "assistant", conversationId: id, limited: { retryAfter: 600 } } }]);
  }} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Why did a payment fail?" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Too many messages. Try again later."));
  expect(within(dialog).queryByRole("button", { name: "Try again" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Retry" })).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  expect(requests).toBe(1);
});

for (const [mode, capability] of [["takeover", hybrid], ["disabled", operatorOnly]] as const) {
  test(`a poll showing operator after an assistant limit unblocks the composer (${mode})`, async () => {
    const ownerKey = `support-limit-${mode}-unit`;
    const question = customer("44444444-4444-4444-8444-444444444444", "First question");
    let operatorMode = false;
    const requests: ChatRequest[] = [];
    const view = render(<SupportChat open ownerKey={ownerKey} fetchAccountResource={async (path) => {
      if (path !== "/api/support") throw new Error(`Unexpected request: ${path}`);
      return operatorMode ? snapshot([question], { handler: "operator", assistant: capability }, capability) : snapshot([question], { handler: "assistant" }, hybrid);
    }} fetchAccountResponse={async (_path, options) => {
      requests.push(requestOf(options));
      return stream([{ type: "data-support", data: { handler: requests.length === 1 ? "assistant" : "operator", conversationId: id, ...(requests.length === 1 ? { limited: { retryAfter: 600 } } : {}) } }]);
    }} onClose={() => {}} />);
    const dialog = await view.findByRole("dialog", { name: "Support" });
    await within(dialog).findByText("First question");
    const composer = within(dialog).getByRole("textbox", { name: "Message support" });
    fireEvent.input(composer, { target: { value: "Question while limited" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Too many messages."));
    fireEvent.input(composer, { target: { value: "Message for a person" } });
    expect(within(dialog).getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    operatorMode = true;
    await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(ownerKey, "support-conversation") });
    const currentDialog = await view.findByRole("dialog", { name: "Support" });
    await waitFor(() => expect(within(currentDialog).queryByRole("alert")).toBeNull());
    expect((within(currentDialog).getByRole("textbox", { name: "Message support" }) as HTMLTextAreaElement).value).toBe("Message for a person");
    const sendButton = within(currentDialog).getByRole("button", { name: "Send" });
    expect(sendButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(sendButton);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((request) => request.message.text)).toEqual(["Question while limited", "Message for a person"]);
  });
}

test("the empty state offers suggested questions only when the assistant is available", async () => {
  const requests: ChatRequest[] = [];
  const view = render(<SupportChat open ownerKey="support-suggest-unit" fetchAccountResource={async () => ({ version: 2, assistant: hybrid, conversation: null })} fetchAccountResponse={async (_path, options) => { requests.push(requestOf(options)); return stream(assistantReply("Your deposit is on its way.")); }} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  const suggestions = await within(dialog).findByRole("list", { name: "Suggested questions" });
  expect(within(suggestions).getAllByRole("button")).toHaveLength(3);
  fireEvent.click(within(suggestions).getByRole("button", { name: "Where is my money?" }));
  await within(dialog).findByText("Your deposit is on its way.");
  expect(requests.map((request) => request.message.text)).toEqual(["Where is my money?"]);
  expect(within(dialog).queryByRole("list", { name: "Suggested questions" })).toBeNull();
  expect(within(dialog).getByText("Assistant")).toBeTruthy();
  cleanup();
  const operatorView = render(<SupportChat open ownerKey="support-operator-empty-unit" fetchAccountResource={async () => ({ version: 2, assistant: operatorOnly, conversation: null })} fetchAccountResponse={noStream} onClose={() => {}} />);
  const operatorDialog = await operatorView.findByRole("dialog", { name: "Support" });
  await within(operatorDialog).findByText("Send us a message.");
  expect(within(operatorDialog).queryByRole("list", { name: "Suggested questions" })).toBeNull();
  expect(within(operatorDialog).queryByRole("button", { name: "Talk to a person" })).toBeNull();
});

test("Send becomes Stop while the assistant streams and the polled copy does not duplicate it", async () => {
  let release: () => void = () => {};
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let sent: ChatRequest | null = null;
  let polled = false;
  const question = customer("44444444-4444-4444-8444-444444444444", "Question");
  const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path) => {
    if (path === "/api/support/read") return null;
    if (path !== "/api/support") throw new Error(`Unexpected request: ${path}`);
    if (!sent || !polled) return snapshot([question], { handler: "assistant" }, hybrid);
    const request: ChatRequest = sent;
    return snapshot([question, { ...customer("55555555-5555-4555-8555-555555555555", request.message.text, "2026-09-27T12:03:00.000Z"), clientMessageId: request.message.id }, { id: replyId, authorType: "assistant", status: "sent", body: "Streaming answer", createdAt: "2026-09-27T12:03:01.000Z" }], { handler: "assistant" }, hybrid);
  };
  const view = render(<SupportChat open ownerKey="support-stream-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={async (_path, options) => {
    sent = requestOf(options);
    return stream([{ type: "start", messageId: replyId }, { type: "text-start", id: replyId }, { type: "text-delta", id: replyId, delta: "Streaming answer" }], hold.then(() => undefined));
  }} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Question");
  fireEvent.input(within(dialog).getByRole("textbox", { name: "Message support" }), { target: { value: "Where is it?" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await within(dialog).findByText("Streaming answer");
  expect(within(dialog).getByRole("button", { name: "Stop" })).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Send" })).toBeNull();
  expect(within(dialog).getByRole("log", { name: "Support messages" }).getAttribute("aria-busy")).toBe("true");
  release();
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Send" })).toBeTruthy());
  polled = true;
  await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey("support-stream-unit", "support-conversation") });
  await waitFor(() => expect(within(dialog).getAllByText("Where is it?")).toHaveLength(1));
  expect(within(dialog).getAllByText("Streaming answer")).toHaveLength(1);
}, 15_000);

test("Stop aborts the streaming request", async () => {
  let aborted = false;
  const view = render(<SupportChat open ownerKey="support-stop-unit" fetchAccountResource={async () => ({ version: 2, assistant: hybrid, conversation: null })} fetchAccountResponse={async (_path, options) => {
    options.signal?.addEventListener("abort", () => { aborted = true; });
    return stream([{ type: "start", messageId: replyId }, { type: "text-start", id: replyId }, { type: "text-delta", id: replyId, delta: "Partial" }], new Promise(() => {}));
  }} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "How do I add money?" }));
  await within(dialog).findByText("Partial");
  fireEvent.click(within(dialog).getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(aborted).toBe(true));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Send" })).toBeTruthy());
});

test("a reply the server discards after an operator takes over is removed", async () => {
  let sent: ChatRequest | null = null;
  const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path) => {
    if (path === "/api/support/read") return null;
    if (!sent) return { version: 2, assistant: hybrid, conversation: null };
    const request: ChatRequest = sent;
    return snapshot([{ ...customer("44444444-4444-4444-8444-444444444444", request.message.text), clientMessageId: request.message.id }], { handler: "operator", assistant: { available: true, handoff: false } }, hybrid);
  };
  const view = render(<SupportChat open ownerKey="support-discard-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={async (_path, options) => { sent = requestOf(options); return stream(assistantReply("Draft answer", "operator", replyId)); }} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Where is my money?" }));
  await within(dialog).findByText("A person will reply here.");
  await waitFor(() => expect(within(dialog).queryByText("Draft answer")).toBeNull());
  expect(within(dialog).getAllByText("Where is my money?")).toHaveLength(1);
  expect(within(dialog).queryByRole("button", { name: "Talk to a person" })).toBeNull();
});

test("an assistant failure offers a retry of the same turn", async () => {
  const requests: ChatRequest[] = [];
  const view = render(<SupportChat open ownerKey="support-no-reply-unit" fetchAccountResource={async () => ({ version: 2, assistant: { available: true, handoff: false }, conversation: null })} fetchAccountResponse={async (_path, options) => {
    requests.push(requestOf(options));
    return requests.length === 1 ? stream([{ type: "error", errorText: "failed" }]) : stream(assistantReply("Here is the answer."));
  }} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Why did a payment fail?" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("The assistant couldn't reply."));
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  await within(dialog).findByText("Here is the answer.");
  expect(requests[1]).toEqual(requests[0]);
});

test("Talk to a person hands the conversation off and shows who replies next", async () => {
  let handedOff = false;
  const question = customer("44444444-4444-4444-8444-444444444444", "Question");
  const answer: SupportMessage = { id: "66666666-6666-4666-8666-666666666666", authorType: "assistant", status: "sent", body: "I can help with the next step.", createdAt: "2026-09-27T12:03:00.000Z" };
  const current = () => handedOff ? snapshot([question, answer], { handler: "operator", assistant: { available: true, handoff: false } }, hybrid) : snapshot([question, answer], { handler: "assistant" }, hybrid);
  const bodies: unknown[] = [];
  const view = render(<SupportChat open ownerKey="support-handoff-unit" fetchAccountResource={async (path, options) => {
    if (path === "/api/support") return current();
    if (path === "/api/support/read") return null;
    if (path === "/api/support/handoff") { bodies.push(options?.body); handedOff = true; return current(); }
    throw new Error(`Unexpected request: ${path}`);
  }} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("I can help with the next step.");
  expect(within(dialog).queryByText("A person will reply here.")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Talk to a person" }));
  await within(dialog).findByText("A person will reply here.");
  expect(bodies).toEqual([{ version: 2 }]);
  expect(within(dialog).queryByRole("button", { name: "Talk to a person" })).toBeNull();
  expect(document.activeElement).toBe(within(dialog).getByRole("textbox", { name: "Message support" }));
});

test("a failed handoff keeps the control and explains the failure", async () => {
  const answer: SupportMessage = { id: "66666666-6666-4666-8666-666666666666", authorType: "assistant", status: "sent", body: "I can help.", createdAt: "2026-09-27T12:03:00.000Z" };
  const view = render(<SupportChat open ownerKey="support-handoff-fail-unit" fetchAccountResource={async (path) => {
    if (path === "/api/support") return snapshot([answer], { handler: "assistant" }, hybrid);
    if (path === "/api/support/read") return null;
    throw Object.assign(new TransferExecutionError("submission-pending"), { kind: "http", status: 409, code: "SUPPORT_CONFLICT" });
  }} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Talk to a person" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Couldn't reach a person."));
  expect(within(dialog).getByRole("button", { name: "Talk to a person" })).toBeTruthy();
});

test("composer reports the 2000 character boundary", async () => {
  const view = render(<SupportChat open ownerKey="support-limit-unit" fetchAccountResource={async () => ({ version: 2, assistant: operatorOnly, conversation: null })} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  const composer = within(dialog).getByRole("textbox", { name: "Message support" });
  expect(composer.getAttribute("maxlength")).toBe("2000");
  fireEvent.input(composer, { target: { value: "a".repeat(2000) } });
  expect((composer as HTMLTextAreaElement).value).toBe("a".repeat(2000));
  await waitFor(() => expect(within(dialog).getByText("2000 of 2000 characters")).toBeTruthy());
});

test("loads earlier messages in pages without dropping the live window", async () => {
  const cursor = "33333333-3333-4333-8333-333333333333";
  const latest = customer("44444444-4444-4444-8444-444444444444", "Latest");
  const older: SupportMessage = { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", status: "sent", body: "Earlier", createdAt: "2026-09-27T12:00:00.000Z" };
  const paths: string[] = [];
  const view = render(<SupportChat open ownerKey="support-history-unit" fetchAccountResource={async (path) => {
    paths.push(path);
    if (path === "/api/support") return snapshot([latest], { messagesNextCursor: cursor });
    if (path === `/api/support?before=${cursor}`) return snapshot([older]);
    if (path === "/api/support/read") return null;
    throw new Error(`Unexpected request: ${path}`);
  }} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Latest");
  fireEvent.click(within(dialog).getByRole("button", { name: "Load earlier messages" }));
  await within(dialog).findByText("Earlier");
  expect(within(dialog).queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  expect(paths).toContain(`/api/support?before=${cursor}`);
});

test("a shifted page boundary resets loaded history instead of hiding a message", async () => {
  const cursor = "33333333-3333-4333-8333-333333333333";
  const shifted = "66666666-6666-4666-8666-666666666666";
  const latest = customer("44444444-4444-4444-8444-444444444444", "Latest");
  const older: SupportMessage = { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", status: "sent", body: "Earlier", createdAt: "2026-09-27T12:00:00.000Z" };
  const view = render(<SupportChat open ownerKey="support-shift-unit" fetchAccountResource={async (path) => {
    if (path === "/api/support") return snapshot([latest], { messagesNextCursor: cursor });
    if (path === `/api/support?before=${cursor}`) return snapshot([older]);
    if (path === "/api/support/read") return null;
    throw new Error(`Unexpected request: ${path}`);
  }} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Latest");
  fireEvent.click(within(dialog).getByRole("button", { name: "Load earlier messages" }));
  await within(dialog).findByText("Earlier");
  getHomeQueryClient().setQueryData(ownerQueryKey("support-shift-unit", "support-conversation"), snapshot([latest], { messagesNextCursor: shifted }));
  await waitFor(() => expect(within(dialog).queryByText("Earlier")).toBeNull(), { timeout: 2_000 });
  await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Load earlier messages" })).not.toBeNull(), { timeout: 2_000 });
}, 15_000);

test("loading an earlier page marks an observed operator reply read", async () => {
  const cursor = "33333333-3333-4333-8333-333333333333";
  const latest = customer("44444444-4444-4444-8444-444444444444", "Latest");
  const older: SupportMessage = { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", status: "sent", body: "Earlier", createdAt: "2026-09-27T12:00:00.000Z" };
  const reads: string[] = [];
  const view = render(<SupportChat open ownerKey="support-older-read-unit" fetchAccountResource={async (path, options) => {
    if (path === "/api/support") return snapshot([latest], { unreadCount: 1, messagesNextCursor: cursor });
    if (path === `/api/support?before=${cursor}`) return snapshot([older], { unreadCount: 1 });
    if (path === "/api/support/read") { reads.push((options?.body as { lastMessageId: string }).lastMessageId); return null; }
    throw new Error(`Unexpected request: ${path}`);
  }} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Latest");
  expect(reads).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Load earlier messages" }));
  await within(dialog).findByText("Earlier");
  await waitFor(() => expect(reads).toEqual([older.id]));
}, 15_000);

test("an earlier page that arrives after the drawer closes is not marked read", async () => {
  const cursor = "33333333-3333-4333-8333-333333333333";
  const latest = customer("44444444-4444-4444-8444-444444444444", "Latest");
  const older: SupportMessage = { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", status: "sent", body: "Earlier", createdAt: "2026-09-27T12:00:00.000Z" };
  const reads: string[] = [];
  let release: (() => void) | null = null;
  const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path, options) => {
    if (path === "/api/support") return snapshot([latest], { unreadCount: 1, messagesNextCursor: cursor });
    if (path === `/api/support?before=${cursor}`) return await new Promise((resolve) => { release = () => resolve(snapshot([older], { unreadCount: 1 })); });
    if (path === "/api/support/read") { reads.push((options?.body as { lastMessageId: string }).lastMessageId); return null; }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = render(<SupportChat open ownerKey="support-close-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Latest");
  fireEvent.click(within(dialog).getByRole("button", { name: "Load earlier messages" }));
  view.rerender(<SupportChat open={false} ownerKey="support-close-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={noStream} onClose={() => {}} />);
  release!();
  await Promise.resolve();
  await Promise.resolve();
  expect(reads).toEqual([]);
}, 15_000);

test("an unread reply in loaded history is marked read when the chat reopens", async () => {
  const cursor = "33333333-3333-4333-8333-333333333333";
  const latest = customer("44444444-4444-4444-8444-444444444444", "Latest");
  const older: SupportMessage = { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", status: "sent", body: "Earlier", createdAt: "2026-09-27T12:00:00.000Z" };
  const reads: string[] = [];
  let release: (() => void) | null = null;
  const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path, options) => {
    if (path === "/api/support") return snapshot([latest], { unreadCount: 1, messagesNextCursor: cursor });
    if (path === `/api/support?before=${cursor}`) return await new Promise((resolve) => { release = () => resolve(snapshot([older], { unreadCount: 1 })); });
    if (path === "/api/support/read") { reads.push((options?.body as { lastMessageId: string }).lastMessageId); return null; }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = render(<SupportChat open ownerKey="support-reopen-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Latest");
  fireEvent.click(within(dialog).getByRole("button", { name: "Load earlier messages" }));
  view.rerender(<SupportChat open={false} ownerKey="support-reopen-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={noStream} onClose={() => {}} />);
  release!();
  await Promise.resolve();
  await Promise.resolve();
  expect(reads).toEqual([]);
  view.rerender(<SupportChat open ownerKey="support-reopen-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={noStream} onClose={() => {}} />);
  await waitFor(() => expect(reads).toEqual([older.id]));
}, 15_000);

test("a reply below the fold stays unread until it is scrolled into view", async () => {
  const question = customer("44444444-4444-4444-8444-444444444444", "Question");
  const reply: SupportMessage = { id: "66666666-6666-4666-8666-666666666666", authorType: "operator", status: "sent", body: "Reply", createdAt: "2026-09-27T12:04:00.000Z" };
  const reads: string[] = [];
  let unread = false;
  const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path, options) => {
    if (path === "/api/support") return snapshot([question, reply], { unreadCount: unread ? 1 : 0 });
    if (path === "/api/support/read") { reads.push((options?.body as { lastMessageId: string }).lastMessageId); return null; }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = render(<SupportChat open ownerKey="support-fold-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Reply");
  expect(reads).toEqual([]);
  const log = within(dialog).getByRole("log", { name: "Support messages" });
  const box = (top: number) => ({ top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  log.getBoundingClientRect = () => box(0);
  const replyElement = log.querySelector(`[data-message-id="${reply.id}"]`) as HTMLElement;
  replyElement.getBoundingClientRect = () => box(200);
  unread = true;
  await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey("support-fold-unit", "support-conversation") });
  fireEvent.scroll(log);
  expect(reads).toEqual([]);
  replyElement.getBoundingClientRect = () => box(20);
  fireEvent.scroll(log);
  await waitFor(() => expect(reads).toEqual([reply.id]));
}, 15_000);

test("a new message scrolls the log only while it is already at its end", async () => {
  const question = customer("44444444-4444-4444-8444-444444444444", "Question");
  const second = customer("77777777-7777-4777-8777-777777777777", "Second", "2026-09-27T12:05:00.000Z");
  const third = customer("88888888-8888-4888-8888-888888888888", "Third", "2026-09-27T12:06:00.000Z");
  let sent: SupportMessage[] = [question];
  const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path) => {
    if (path === "/api/support") return snapshot(sent);
    if (path === "/api/support/read") return null;
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = render(<SupportChat open ownerKey="support-scroll-unit" fetchAccountResource={fetchAccountResource} fetchAccountResponse={noStream} onClose={() => {}} />);
  const dialog = await view.findByRole("dialog", { name: "Support" });
  await within(dialog).findByText("Question");
  const log = within(dialog).getByRole("log", { name: "Support messages" });
  Object.defineProperties(log, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 400, configurable: true } });
  sent = [question, second];
  await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey("support-scroll-unit", "support-conversation") });
  await within(dialog).findByText("Second");
  expect(log.scrollTop).toBe(1000);
  log.scrollTop = 0;
  fireEvent.scroll(log);
  Object.defineProperty(log, "scrollHeight", { value: 1400, configurable: true });
  sent = [question, second, third];
  await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey("support-scroll-unit", "support-conversation") });
  await within(dialog).findByText("Third");
  expect(log.scrollTop).toBe(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Scroll to latest message" }));
  expect(log.scrollTop).toBe(1400);
  expect(within(dialog).queryByRole("button", { name: "Scroll to latest message" })).toBeNull();
}, 15_000);

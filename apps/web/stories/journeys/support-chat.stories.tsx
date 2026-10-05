import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { Button } from "@/components/ui/button";
import { SupportChat } from "@/client/support/support-chat";
import { TransferExecutionError } from "@/shared/transfers/types";
import type { CustomerSupportResponse, SupportAssistantCapability, SupportContextRef, SupportHandler, SupportMessage } from "@/shared/support/contract";

const conversationId = "11111111-1111-4111-8111-111111111111";
const operatorMessage: SupportMessage = { id: "22222222-2222-4222-8222-222222222222", authorType: "operator", status: "sent", body: "We can help with your order.", createdAt: "2026-09-27T12:00:00.000Z" };
const assistantMessage: SupportMessage = { id: "33333333-3333-4333-8333-333333333333", authorType: "assistant", status: "sent", body: "Your deposit is processing. Bank transfers usually arrive within one business day.", createdAt: "2026-09-27T12:01:00.000Z" };
const olderMessage: SupportMessage = { id: "55555555-5555-4555-8555-555555555555", authorType: "customer", status: "sent", body: "I still need help.", createdAt: "2026-09-27T11:59:00.000Z", clientMessageId: "66666666-6666-4666-8666-666666666666" };
const assistantReply = "I can help with that. Deposits usually arrive within one business day; I'll check the latest status for you.";

type Scenario = "empty" | "streaming" | "assistant" | "handoff" | "reply" | "operator" | "order" | "rate-limit" | "retry" | "history";
type Mode = "operator" | "assistant" | "hybrid";

const modes: Record<Scenario, Mode> = { empty: "hybrid", streaming: "hybrid", assistant: "assistant", handoff: "hybrid", reply: "operator", operator: "operator", order: "operator", "rate-limit": "operator", retry: "operator", history: "operator" };
const seeded: Partial<Record<Scenario, SupportMessage[]>> = { assistant: [assistantMessage], handoff: [assistantMessage], history: [operatorMessage] };

function createSupportServer(scenario: Scenario) {
  const mode = modes[scenario];
  let messages = [...(seeded[scenario] ?? [])];
  let handler: SupportHandler = mode === "operator" ? "operator" : "assistant";
  let attempts = 0;
  const capability = (): SupportAssistantCapability => ({ available: mode !== "operator", handoff: mode === "hybrid" && handler === "assistant" });
  const snapshot = (page = messages, cursor: string | null = scenario === "history" && page === messages ? olderMessage.id : null): CustomerSupportResponse => ({
    version: 2,
    assistant: { available: mode !== "operator", handoff: mode === "hybrid" },
    conversation: page.length ? { id: conversationId, status: "open", handler, assistant: capability(), messages: page, messagesNextCursor: cursor, contextRefs: [], unreadCount: 0 } : null,
  });
  const fetchAccountResource = async (path: string, options?: { method?: string; body?: unknown }): Promise<unknown> => {
    if (path === "/api/support") return snapshot();
    if (path === `/api/support?before=${olderMessage.id}`) return snapshot([olderMessage], null);
    if (path === "/api/support/handoff" && options?.method === "POST") { handler = "operator"; return snapshot(); }
    throw new Error("Unexpected support request");
  };
  const fetchAccountResponse = async (path: string, options: { body: string; signal?: AbortSignal }): Promise<Response> => {
    if (path === "/api/support/read") return new Response(null, { status: 204 });
    attempts++;
    if (scenario === "rate-limit") throw Object.assign(new TransferExecutionError("unavailable"), { kind: "http", status: 429, code: "RATE_LIMITED" });
    if (scenario === "retry" && attempts === 1) throw Object.assign(new TransferExecutionError("unavailable"), { kind: "network" });
    const request = JSON.parse(options.body) as { message: { id: string; text: string } };
    const at = new Date(Date.UTC(2026, 8, 27, 12, 2, attempts)).toISOString();
    messages = [...messages, { id: crypto.randomUUID(), authorType: "customer", status: "sent", body: request.message.text, createdAt: at, clientMessageId: request.message.id }];
    const replyId = crypto.randomUUID();
    return createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: async ({ writer }) => {
      if (handler === "assistant") {
        writer.write({ type: "start", messageId: replyId });
        writer.write({ type: "text-start", id: replyId });
        if (scenario === "streaming") {
          writer.write({ type: "text-delta", id: replyId, delta: "I can help with that. Let me check" });
          await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve()));
          return;
        }
        writer.write({ type: "text-delta", id: replyId, delta: assistantReply });
        writer.write({ type: "text-end", id: replyId });
        messages = [...messages, { id: replyId, authorType: "assistant", status: "sent", body: assistantReply, createdAt: at }];
      } else if (scenario === "reply") {
        messages = [...messages, { ...operatorMessage, createdAt: at }];
      }
      writer.write({ type: "data-support", data: { handler, conversationId } });
    } }) });
  };
  return { fetchAccountResource, fetchAccountResponse };
}

function SupportJourney({ scenario }: { scenario: Scenario }) {
  const [open, setOpen] = useState(false);
  const server = useMemo(() => createSupportServer(scenario), [scenario]);
  const context: SupportContextRef | undefined = scenario === "order" ? { kind: "funding_order", id: "fixture-funding-order" } : undefined;
  return <main className="mx-auto w-full max-w-lg p-4">
    <Button size="touch" onClick={() => setOpen(true)}>{context ? "Message support" : "Open support"}</Button>
    <SupportChat open={open} ownerKey={`story-support-${scenario}`} context={context} onClose={() => setOpen(false)} fetchAccountResource={server.fetchAccountResource} fetchAccountResponse={server.fetchAccountResponse} />
  </main>;
}

const meta = {
  id: "journeys-support-chat",
  title: "Journeys/Support chat",
  component: SupportJourney,
  args: { scenario: "empty" },
  parameters: { viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof SupportJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openChat(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /open support|message support/i }));
  const dialog = within(document.body).getByRole("dialog", { name: "Support" });
  await expect(within(dialog).getByRole("log", { name: "Support messages" })).toBeVisible();
  return dialog;
}

async function sendMessage(dialog: HTMLElement, text = "Where is my order?") {
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Message support" }), text);
  await userEvent.click(within(dialog).getByRole("button", { name: "Send" }));
}

export const EmptyWithSuggestions: Story = { play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await expect(await within(dialog).findByText("How can we help?")).toBeVisible();
  const suggestions = within(dialog).getByRole("list", { name: "Suggested questions" });
  await expect(within(suggestions).getAllByRole("button")).toHaveLength(3);
  await userEvent.click(within(suggestions).getByRole("button", { name: "Where is my money?" }));
  await expect(await within(dialog).findByText(assistantReply)).toBeVisible();
  await expect(within(dialog).getByText("Assistant")).toBeVisible();
  await expect(within(dialog).getByRole("button", { name: "Talk to a person" })).toBeVisible();
} };
export const AssistantStreaming: Story = { args: { scenario: "streaming" }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await userEvent.click(await within(dialog).findByRole("button", { name: "How do I add money?" }));
  await expect(await within(dialog).findByText("I can help with that. Let me check")).toBeVisible();
  const stop = within(dialog).getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  await userEvent.click(stop);
  await expect(await within(dialog).findByRole("button", { name: "Send" })).toBeVisible();
} };
export const AssistantReply: Story = { args: { scenario: "assistant" }, parameters: { viewport: { defaultViewport: "desktop" } }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await expect(await within(dialog).findByText(assistantMessage.body)).toBeVisible();
  await sendMessage(dialog, "When will it arrive?");
  await expect(await within(dialog).findByText(assistantReply)).toBeVisible();
  await expect(within(dialog).queryByRole("button", { name: "Talk to a person" })).toBeNull();
} };
export const HybridHandoff: Story = { args: { scenario: "handoff" }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await expect(await within(dialog).findByText(assistantMessage.body)).toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "Talk to a person" }));
  await expect(await within(dialog).findByText("A person will reply here.")).toBeVisible();
  await expect(within(dialog).queryByRole("button", { name: "Talk to a person" })).toBeNull();
  await expect(within(dialog).getByRole("textbox", { name: "Message support" })).toHaveFocus();
} };
export const OperatorReplyDesktop: Story = { args: { scenario: "reply" }, parameters: { viewport: { defaultViewport: "desktop" } }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Message support" }), "Where is my{Shift>}{Enter}{/Shift}order?{Enter}");
  await waitForReady(() => expect(within(dialog).getByText(/Where is my\s+order\?/).textContent).toContain("Where is my\norder?"));
  await expect(await within(dialog).findByText("We can help with your order.")).toBeVisible();
  await expect(within(dialog).getByText("Support", { selector: "span" })).toBeVisible();
} };
export const OperatorOnly: Story = { args: { scenario: "operator" }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await expect(await within(dialog).findByText("Send us a message.")).toBeVisible();
  await expect(within(dialog).queryByRole("list", { name: "Suggested questions" })).toBeNull();
  await sendMessage(dialog);
  await expect(await within(dialog).findByText("Sent")).toBeVisible();
  await expect(within(dialog).queryByText("A person will reply here.")).toBeNull();
} };
export const FundingOrder: Story = { args: { scenario: "order" }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await expect(within(dialog).getByText("About your add money order")).toBeVisible();
  await sendMessage(dialog);
  await expect(await within(dialog).findByText("Sent")).toBeVisible();
} };
export const RateLimited: Story = { args: { scenario: "rate-limit" }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await sendMessage(dialog);
  await expect(await within(dialog).findByRole("alert")).toHaveTextContent("Too many messages. Try again later.");
  await expect(within(dialog).getByRole("button", { name: "Retry" })).toBeVisible();
} };
export const SendFailureRetry: Story = { args: { scenario: "retry" }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await sendMessage(dialog);
  await expect(await within(dialog).findByText("Not sent")).toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  await expect(await within(dialog).findByText("Sent")).toBeVisible();
} };
export const LoadEarlierMessages: Story = { args: { scenario: "history" }, parameters: { viewport: { defaultViewport: "desktop" } }, play: async ({ canvasElement }) => {
  const dialog = await openChat(canvasElement);
  await expect(await within(dialog).findByText("We can help with your order.")).toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "Load earlier messages" }));
  await expect(await within(dialog).findByText("I still need help.")).toBeVisible();
  await expect(within(dialog).queryByRole("button", { name: "Load earlier messages" })).toBeNull();
} };

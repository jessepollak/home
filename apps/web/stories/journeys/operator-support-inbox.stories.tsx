import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useRef } from "react";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { OperatorSupportInbox } from "@/client/operator-support/operator-support-inbox";
import { SupportAssistantSettings } from "@/client/operator-support/assistant-settings";
import { SupportConflictError, type OperatorSupportTransport } from "@/client/operator-support/api";
import type { SupportAssistantSettingsSnapshot, SupportAssistantSettingsTransport } from "@/client/operator-support/assistant-settings-api";
import { SUPPORT_CONTRACT_VERSION, type OperatorSupportConversationResponse, type OperatorSupportListItem, type SupportCredentialResponse } from "@/shared/support/contract";

const id = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-27T12:00:00.000Z";
const row: OperatorSupportListItem = { id, status: "open", handler: "operator", lastMessageAt: timestamp, preview: "My funding order needs help", lastAuthorType: "customer", unread: true, customerLabel: "customer@example.com" };
const assistantRow: OperatorSupportListItem = { id: "77777777-7777-4777-8777-777777777777", status: "open", handler: "assistant", lastMessageAt: "2026-09-27T11:30:00.000Z", preview: "Your deposit is pending with the provider.", lastAuthorType: "assistant", unread: false, customerLabel: "assisted@example.com" };
const olderMessageId = "66666666-6666-4666-8666-666666666666";
const fixture: OperatorSupportConversationResponse = {
  version: SUPPORT_CONTRACT_VERSION,
  conversation: { id, status: "open", handler: "operator", handedOffAt: null, assistantAvailable: false, createdAt: timestamp, resolvedAt: null, messages: [{ id: "33333333-3333-4333-8333-333333333333", authorType: "customer", clientMessageId: "fixture_33333333", authorOperator: null, status: "sent", body: "My funding order needs help", createdAt: timestamp }], messagesNextCursor: olderMessageId, contextRefs: [{ kind: "funding_order", id: "order-123", summary: "pending · provider · 10 USD" }] },
  customer: { status: "active", country: "US", firstSeenAt: timestamp, lastSeenAt: timestamp, emails: ["customer@example.com"], accountProviders: ["base-account"], wallets: [], recentEvents: [{ name: "Funding order", occurredAt: timestamp }] },
};
const assistantReply = { id: "88888888-8888-4888-8888-888888888888", authorType: "assistant" as const, authorOperator: null, status: "sent" as const, body: "Your deposit is pending with the provider. It usually settles within an hour.", createdAt: timestamp };

type Assistant = "off" | "handling" | "available" | "conflict";
type Settings = "unavailable" | "configured";

function settingsTransport(settings: Settings): SupportAssistantSettingsTransport {
  let credential: SupportCredentialResponse = settings === "configured" ? { version: SUPPORT_CONTRACT_VERSION, configured: true, last4: "9f2c", updatedAt: timestamp, available: true } : { version: SUPPORT_CONTRACT_VERSION, configured: false, last4: null, updatedAt: null, available: false };
  let current: SupportAssistantSettingsSnapshot = { value: { mode: "hybrid", model: "provider/model-name", instructions: "Keep answers short and point to the funding order status." }, revision: 3 };
  return {
    settings: async () => current,
    saveSettings: async (value, revision) => { current = { value, revision: revision + 1 }; return current; },
    credential: async () => credential,
    saveCredential: async (apiKey) => { credential = { version: SUPPORT_CONTRACT_VERSION, configured: true, last4: apiKey.slice(-4), updatedAt: timestamp, available: true }; return credential; },
    removeCredential: async () => { credential = { version: SUPPORT_CONTRACT_VERSION, configured: false, last4: null, updatedAt: null, available: false }; return credential; },
  };
}

function Journey({ state = "open", empty = false, draft = false, assistant = "off", list = false, settings }: { state?: "open" | "resolved"; empty?: boolean; draft?: boolean; assistant?: Assistant; list?: boolean; settings?: Settings }) {
  const handling = assistant === "handling";
  const baseMessages = handling ? [...fixture.conversation.messages, assistantReply] : fixture.conversation.messages;
  const initial: OperatorSupportConversationResponse = { ...fixture, conversation: { ...fixture.conversation, status: state, handler: handling ? "assistant" : "operator", assistantAvailable: assistant !== "off", messages: draft ? [...baseMessages, { id: "44444444-4444-4444-8444-444444444444", authorType: "assistant", authorOperator: null, status: "draft", body: "Suggested response", createdAt: timestamp }] : baseMessages } };
  const current = useRef(initial);
  const listRow = (conversation: OperatorSupportConversationResponse["conversation"]): OperatorSupportListItem => ({ ...row, status: conversation.status, handler: conversation.handler, unread: conversation.handler === "operator" && row.unread, ...(handling ? { lastAuthorType: "assistant" as const, preview: assistantReply.body } : {}) });
  const rows = (filter: "open" | "resolved" | "all", conversation: OperatorSupportConversationResponse["conversation"]) => empty || filter === "resolved" && conversation.status !== "resolved" || filter === "open" && conversation.status !== "open" ? [] : list ? [listRow(conversation), assistantRow] : [listRow(conversation)];
  const transport: OperatorSupportTransport = {
    list: async (filter) => ({ version: SUPPORT_CONTRACT_VERSION, conversations: rows(filter, current.current.conversation), nextCursor: null }),
    conversation: async (_id, options) => ({ detail: options?.before ? { ...current.current, conversation: { ...current.current.conversation, messages: [{ id: olderMessageId, authorType: "customer", authorOperator: null, status: "sent", body: "Earlier note from the customer.", createdAt: "2026-09-27T11:00:00.000Z" }], messagesNextCursor: null } } : current.current, etag: null }),
    read: async () => {},
    reply: async (_id, body) => { current.current = { ...current.current, conversation: { ...current.current.conversation, handler: "operator", messages: [...current.current.conversation.messages, { id: "55555555-5555-4555-8555-555555555555", authorType: "operator", authorOperator: "0x1111111111111111111111111111111111111111", status: "sent", body, createdAt: timestamp }] } }; return { detail: current.current, etag: null }; },
    status: async (_id, status) => { current.current = { ...current.current, conversation: { ...current.current.conversation, status, resolvedAt: status === "resolved" ? timestamp : null } }; return { detail: current.current, etag: null }; },
    handler: async (_id, handler) => {
      if (assistant === "conflict" && handler === "assistant") { current.current = { ...current.current, conversation: { ...current.current.conversation, assistantAvailable: false } }; throw new SupportConflictError("Can't hand back yet. Reply to the customer first, or check the Support assistant settings."); }
      current.current = { ...current.current, conversation: { ...current.current.conversation, handler } };
      return { detail: current.current, etag: null };
    },
  };
  const conversationId = empty || list ? undefined : id;
  return <main className="grid gap-8 p-4"><h1>Support</h1><OperatorSupportInbox key={`${state}-${empty}-${draft}-${assistant}-${list}`} conversationId={conversationId} transport={transport} initialList={{ version: SUPPORT_CONTRACT_VERSION, conversations: rows("open", initial.conversation), nextCursor: null }} initialConversation={conversationId ? initial : undefined} />{settings ? <SupportAssistantSettings key={settings} transport={settingsTransport(settings)} operator="0x1111111111111111111111111111111111111111" /> : null}</main>;
}

const meta = { id: "journeys-operator-support-inbox", title: "Journeys/Operator support inbox", component: Journey, parameters: { viewport: { defaultViewport: "mobile" } } } satisfies Meta<typeof Journey>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyInbox: Story = { args: { empty: true }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText("No open conversations.")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Resolved" })); await expect(await canvas.findByText("No resolved conversations.")).toBeVisible(); } };
export const UnreadList: Story = { args: { empty: false }, parameters: { viewport: { defaultViewport: "desktop" } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText("Unread")).toBeVisible(); await expect(canvas.getByRole("link", { name: /customer@example.com/ })).toHaveAttribute("href", `/admin/support/${id}`); } };
export const OpenConversation: Story = { args: { empty: false }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByRole("log", { name: "Messages" })).toHaveTextContent("My funding order needs help"); await expect(canvas.getByRole("heading", { level: 2, name: "customer@example.com" })).toBeVisible(); await userEvent.click(canvas.getByText("Customer details", { selector: "summary" })); await expect(within(canvas.getByText("Customer details", { selector: "summary" }).closest("details")!).getByText(/pending · provider · 10 USD/)).toBeVisible(); } };
export const ReplySent: Story = { args: { empty: false }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.type(await canvas.findByRole("textbox", { name: "Reply" }), "We can help"); await userEvent.click(canvas.getByRole("button", { name: "Send" })); await expect(await canvas.findByText("We can help")).toBeVisible(); } };
export const EnterSendsOnFinePointer: Story = { args: { empty: false }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(window.matchMedia("(pointer: fine)").matches).toBe(true); await userEvent.type(await canvas.findByRole("textbox", { name: "Reply" }), "We can help{Enter}"); await expect(await canvas.findByText("We can help")).toBeVisible(); } };
export const ResolveReopen: Story = { args: { empty: false }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Resolve" })); await expect(await canvas.findByRole("button", { name: "Reopen" })).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Reopen" })); await expect(await canvas.findByRole("button", { name: "Resolve" })).toBeVisible(); } };
export const SuggestedDraft: Story = { args: { draft: true }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByRole("region", { name: "Suggested reply" })).toHaveTextContent("Suggested response"); await expect(canvas.getByRole("log", { name: "Messages" })).not.toHaveTextContent("Suggested response"); } };
export const DesktopConversation: Story = { args: { empty: false }, parameters: { viewport: { defaultViewport: "desktop" } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByRole("log", { name: "Messages" })).toBeVisible(); await expect(canvas.getByRole("complementary", { name: "Customer details" })).toHaveTextContent("Funding order"); } };
export const LoadEarlierMessages: Story = { args: { empty: false }, parameters: { viewport: { defaultViewport: "desktop" } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Load earlier messages" })); await expect(await canvas.findByText("Earlier note from the customer.")).toBeVisible(); await expect(canvas.queryByRole("button", { name: "Load earlier messages" })).toBeNull(); } };
export const NeedsReplyList: Story = { args: { list: true }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); const waiting = await canvas.findByRole("link", { name: /customer@example.com/ }); await expect(within(waiting).getByText("Needs reply")).toBeVisible(); await expect(within(waiting).getByText("Unread")).toBeVisible(); const assisted = canvas.getByRole("link", { name: /assisted@example.com/ }); await expect(within(assisted).getByText("Assistant")).toBeVisible(); await expect(within(assisted).queryByText("Needs reply")).toBeNull(); } };
export const NeedsReplyListDesktop: Story = { ...NeedsReplyList, parameters: { viewport: { defaultViewport: "desktop" } } };
export const AssistantHandled: Story = { args: { assistant: "handling" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText("Assistant is handling this")).toBeVisible(); await expect(canvas.getByRole("log", { name: "Messages" })).toHaveTextContent("It usually settles within an hour."); await expect(canvas.getByRole("button", { name: "Take over" })).toBeVisible(); await expect(canvas.getByText("Sending takes over from the assistant.")).toBeVisible(); } };
export const AssistantHandledDesktop: Story = { ...AssistantHandled, parameters: { viewport: { defaultViewport: "desktop" } }, play: async (context) => { await AssistantHandled.play?.(context); const canvas = within(context.canvasElement); await expect(within(canvas.getByRole("link", { name: /customer@example.com/ })).getByText("Assistant")).toBeVisible(); } };
export const TakeOver: Story = { args: { assistant: "handling" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Take over" })); await expect(await canvas.findByText("An operator is handling this")).toBeVisible(); await expect(canvas.getByRole("button", { name: "Hand back to assistant" })).toBeVisible(); await expect(canvas.queryByText("Sending takes over from the assistant.")).toBeNull(); } };
export const TakeOverDesktop: Story = { ...TakeOver, parameters: { viewport: { defaultViewport: "desktop" } } };
export const ReplyTakesOver: Story = { args: { assistant: "handling" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.type(await canvas.findByRole("textbox", { name: "Reply" }), "I'll check this for you"); await userEvent.click(canvas.getByRole("button", { name: "Send" })); await expect(await canvas.findByText("I'll check this for you")).toBeVisible(); await expect(await canvas.findByRole("button", { name: "Hand back to assistant" })).toBeVisible(); } };
export const HandBackUnavailable: Story = { args: { assistant: "conflict" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Hand back to assistant" })); await expect(await canvas.findByRole("alert")).toHaveTextContent("Can't hand back yet. Reply to the customer first, or check the Support assistant settings."); } };
export const SettingsUnavailable: Story = { args: { empty: true, settings: "unavailable" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); const settings = await canvas.findByRole("region", { name: "Support assistant" }); await expect(await within(settings).findByText("Assistant unavailable")).toBeVisible(); await expect(within(settings).getByRole("radio", { name: "Assistant with handoff" })).toBeChecked(); await expect(within(settings).getByLabelText("AI Gateway API key")).toHaveAttribute("type", "password"); } };
export const SettingsUnavailableDesktop: Story = { ...SettingsUnavailable, parameters: { viewport: { defaultViewport: "desktop" } } };
export const SettingsConfigured: Story = { args: { empty: true, settings: "configured" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); const settings = await canvas.findByRole("region", { name: "Support assistant" }); await expect(await within(settings).findByText("Configured · ends in 9f2c")).toBeVisible(); await expect(within(settings).queryByText("Assistant unavailable")).toBeNull(); await expect(within(settings).getByRole("button", { name: "Replace key" })).toBeVisible(); await expect(within(settings).getByRole("button", { name: "Remove key" })).toBeVisible(); } };
export const SettingsConfiguredDesktop: Story = { ...SettingsConfigured, parameters: { viewport: { defaultViewport: "desktop" } } };

let pollInbox: () => void = () => {};
let refreshPhase = false;
let requestedPages: string[] = [];
let heldPage: (() => void) | null = null;
let heldRefresh: (() => void) | null = null;
function controlledPoll() {
  const browserWindow: Window = window;
  const original = browserWindow.setInterval;
  refreshPhase = false;
  requestedPages = [];
  heldPage = null;
  heldRefresh = null;
  browserWindow.setInterval = (callback, delay, ...args) => {
    if (delay === 15_000 && typeof callback === "function") { pollInbox = () => { Reflect.apply(callback, undefined, args); }; return 987654; }
    return original(callback, delay, ...args);
  };
  return () => { browserWindow.setInterval = original; pollInbox = () => {}; };
}
function PaginatedInbox({ scenario = "refresh" }: { scenario?: "refresh" | "failure" | "cycle" | "race" | "filter" | "slow" }) {
  const pageRow = (page: number): OperatorSupportListItem => ({ ...row, id: `page-${page}`, customerLabel: `Customer page ${page}`, lastMessageAt: `2026-09-${27 - page}T12:00:00.000Z`, preview: refreshPhase ? "Refreshed preview" : "Original preview" });
  const transport: OperatorSupportTransport = {
    list: async (filter, before) => {
      const page = before ? Number(before) : 1;
      requestedPages.push(`${filter}:${page}`);
      if (scenario === "race" && page === 2 && !refreshPhase) await new Promise<void>((resolve) => { heldPage = resolve; });
      if (refreshPhase && (scenario === "slow" || scenario === "race" && page === 1)) await new Promise<void>((resolve) => { heldRefresh = resolve; });
      if (refreshPhase && scenario === "failure" && page === 3) throw new Error("Deeper page unavailable");
      if (filter === "resolved") return { version: 2, conversations: [], nextCursor: null };
      return { version: 2, conversations: refreshPhase && (scenario === "refresh" || scenario === "slow") && page === 2 ? [] : [pageRow(page)], nextCursor: refreshPhase && scenario === "cycle" && page === 2 ? "2" : page < (scenario === "slow" ? 21 : 4) ? String(page + 1) : null };
    },
    conversation: async () => ({ detail: fixture, etag: null }), read: async () => {},
    reply: async () => ({ detail: fixture, etag: null }), status: async () => ({ detail: fixture, etag: null }), handler: async () => ({ detail: fixture, etag: null }),
  };
  return <main className="p-4"><h1>Support</h1><OperatorSupportInbox transport={transport} /></main>;
}
const paginationStory = { render: () => <PaginatedInbox />, beforeEach: controlledPoll };
async function loadPages(canvasElement: HTMLElement, depth: number) {
  const canvas = within(canvasElement);
  await canvas.findByRole("link", { name: /Customer page 1/ });
  for (let page = 2; page <= depth; page++) {
    await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
    await canvas.findByRole("link", { name: new RegExp(`Customer page ${page}`) });
  }
  return canvas;
}
export const PollRevalidatesDeeperRows: Story = { ...paginationStory, play: async ({ canvasElement }) => {
  const canvas = await loadPages(canvasElement, 2);
  refreshPhase = true;
  pollInbox();
  await waitForReady(() => expect(canvas.queryByRole("link", { name: /Customer page 2/ })).toBeNull());
  await expect(canvas.getByRole("link", { name: /Customer page 1/ })).toHaveTextContent("Refreshed preview");
  await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
  await canvas.findByRole("link", { name: /Customer page 3/ });
  pollInbox();
  await waitForReady(() => expect(requestedPages.slice(-3)).toEqual(["open:1", "open:2", "open:3"]));
  await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
  await canvas.findByRole("link", { name: /Customer page 4/ });
  await expect(canvas.queryByRole("button", { name: "Load more" })).toBeNull();
} };
export const FailedDeepPollIsAtomic: Story = { ...paginationStory, render: () => <PaginatedInbox scenario="failure" />, play: async ({ canvasElement }) => {
  const canvas = await loadPages(canvasElement, 3);
  refreshPhase = true;
  pollInbox();
  await expect(await canvas.findByRole("alert")).toHaveTextContent("Deeper page unavailable");
  for (const page of [1, 2, 3]) await expect(canvas.getByRole("link", { name: new RegExp(`Customer page ${page}`) })).toHaveTextContent("Original preview");
  refreshPhase = false;
  await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
  await waitForReady(() => expect(canvas.queryByRole("alert")).toBeNull());
} };
export const CursorCycleRetainsRows: Story = { ...paginationStory, render: () => <PaginatedInbox scenario="cycle" />, play: async ({ canvasElement }) => {
  const canvas = await loadPages(canvasElement, 3);
  const count = requestedPages.length;
  refreshPhase = true;
  pollInbox();
  await expect(await canvas.findByRole("alert")).toHaveTextContent("Couldn't refresh support pages");
  await expect(requestedPages.length - count).toBe(2);
  await expect(canvas.getByRole("link", { name: /Customer page 3/ })).toHaveTextContent("Original preview");
} };
export const VisibilityFencesInterleavedLoad: Story = { ...paginationStory, render: () => <PaginatedInbox scenario="race" />, play: async ({ canvasElement }) => {
  const canvas = await loadPages(canvasElement, 1);
  await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
  await waitForReady(() => expect(heldPage).not.toBeNull());
  pollInbox();
  await expect(requestedPages).toEqual(["open:1", "open:2"]);
  refreshPhase = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await waitForReady(() => expect(heldRefresh).not.toBeNull());
  heldPage?.();
  await waitForReady(() => expect(canvas.queryByRole("link", { name: /Customer page 2/ })).toBeNull());
  pollInbox();
  await expect(requestedPages).toEqual(["open:1", "open:2", "open:1"]);
  heldRefresh?.();
  await waitForReady(() => expect(canvas.getByRole("link", { name: /Customer page 1/ })).toHaveTextContent("Refreshed preview"));
  await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
  await canvas.findByRole("link", { name: /Customer page 2/ });
  await expect(requestedPages).toEqual(["open:1", "open:2", "open:1", "open:2"]);
} };
export const SlowDepthPollPublishesAtomically: Story = { ...paginationStory, render: () => <PaginatedInbox scenario="slow" />, play: async ({ canvasElement }) => {
  const canvas = await loadPages(canvasElement, 20);
  const count = requestedPages.length;
  refreshPhase = true;
  pollInbox();
  for (let page = 1; page <= 20; page++) {
    await waitForReady(() => expect(heldRefresh).not.toBeNull());
    await expect(requestedPages.slice(count)).toEqual(Array.from({ length: page }, (_, index) => `open:${index + 1}`));
    pollInbox();
    await expect(requestedPages.length).toBe(count + page);
    await expect(canvas.getAllByRole("link")).toHaveLength(20);
    for (const link of canvas.getAllByRole("link")) await expect(link).toHaveTextContent("Original preview");
    const release = heldRefresh;
    heldRefresh = null;
    release?.();
  }
  await waitForReady(() => expect(canvas.queryByRole("link", { name: /Customer page 2\b/ })).toBeNull());
  await expect(canvas.getAllByRole("link")).toHaveLength(19);
  for (const link of canvas.getAllByRole("link")) await expect(link).toHaveTextContent("Refreshed preview");
  refreshPhase = false;
  await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
  await canvas.findByRole("link", { name: /Customer page 21/ });
  await expect(requestedPages.at(-1)).toBe("open:21");
  pollInbox();
  await waitForReady(() => expect(requestedPages.length).toBe(count + 42));
  await expect(requestedPages.slice(count + 21)).toEqual(Array.from({ length: 21 }, (_, index) => `open:${index + 1}`));
} };
export const FilterRoundTripFencesLoad: Story = { ...paginationStory, render: () => <PaginatedInbox scenario="race" />, play: async ({ canvasElement }) => {
  const canvas = await loadPages(canvasElement, 1);
  await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
  await waitForReady(() => expect(heldPage).not.toBeNull());
  await userEvent.click(canvas.getByRole("button", { name: "Resolved" }));
  await canvas.findByText("No resolved conversations.");
  await userEvent.click(canvas.getByRole("button", { name: "Open" }));
  await canvas.findByRole("link", { name: /Customer page 1/ });
  heldPage?.();
  await waitForReady(() => expect(canvas.queryByRole("link", { name: /Customer page 2/ })).toBeNull());
} };

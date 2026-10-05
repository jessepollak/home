"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { X } from "lucide-react";
import { AppDrawer } from "@/client/money-modal";
import { reportPageClientError } from "@/client/observability/client-reporter";
import { Button } from "@/components/ui/button";
import { ConversationScrollButton } from "@/components/ui/conversation";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Skeleton } from "@/components/ui/skeleton";
import { SupportMessageBubble } from "@/components/ui/support-message";
import {
  SUPPORT_CONTRACT_VERSION,
  normalizeSupportBody,
  parseCustomerSupportResponse,
  parseSupportStreamData,
  type SupportAuthorType,
  type SupportContextRef,
  type SupportHandler,
  type SupportMessage,
  type SupportStreamData,
} from "@/shared/support/contract";
import { TransferExecutionError } from "@/shared/transfers/types";
import { shouldSubmitSupportComposer } from "./composer-keydown";
import { SupportContextChip } from "./support-context-chip";
import { logAtLatest, newestVisibleMessageId } from "./log-visibility";
import { useSupportCache, useSupportConversation, type SupportFetch, type SupportStreamFetch } from "./use-support";

type SupportUIMessage = UIMessage<{ author: SupportAuthorType; serverId?: string; context?: SupportContextRef }, { support: SupportStreamData }>;
type TurnFailure = "rate-limited" | "not-sent" | "no-reply";

const suggestedPrompts = ["Where is my money?", "How do I add money?", "Why did a payment fail?"];

function messageText(message: SupportUIMessage): string {
  return message.parts.map((part) => part.type === "text" ? part.text : "").join("");
}

function toUIMessage(message: SupportMessage): SupportUIMessage {
  return {
    id: message.authorType === "customer" ? message.clientMessageId ?? message.id : message.id,
    role: message.authorType === "customer" ? "user" : "assistant",
    metadata: { author: message.authorType, serverId: message.id },
    parts: [{ type: "text", text: message.body }],
  };
}

function turnFailure(error: Error | undefined): TurnFailure | null {
  if (!error) return null;
  if (!(error instanceof TransferExecutionError)) return "no-reply";
  return "code" in error && error.code === "RATE_LIMITED" ? "rate-limited" : "not-sent";
}

export function SupportChat({ open, context, ownerKey, fetchAccountResource, fetchAccountResponse, onClose }: {
  open: boolean;
  context?: SupportContextRef;
  ownerKey: string;
  fetchAccountResource: SupportFetch;
  fetchAccountResponse: SupportStreamFetch;
  onClose: () => void;
}) {
  const cache = useSupportCache(ownerKey);
  const [streamed, setStreamed] = useState<{ handler: SupportHandler; at: number } | null>(null);
  const [discarded, setDiscarded] = useState<ReadonlySet<string>>(() => new Set());
  const [limitedUntil, setLimitedUntil] = useState<number | null>(null);
  const [stoppedBeforeReply, setStoppedBeforeReply] = useState(false);
  const transport = useMemo(() => {
    const accountFetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => fetchAccountResponse(String(input), { body: String(init?.body ?? "{}"), ...(init?.signal ? { signal: init.signal } : {}) }),
      { preconnect: fetch.preconnect },
    );
    return new DefaultChatTransport<SupportUIMessage>({
      api: "/api/support/chat",
      fetch: accountFetch,
      prepareSendMessagesRequest: ({ messages }) => {
        const message = [...messages].reverse().find((item) => item.role === "user");
        const messageContext = message?.metadata?.context;
        return { body: { version: SUPPORT_CONTRACT_VERSION, message: { id: message?.id ?? "", text: message ? messageText(message) : "" }, ...(messageContext ? { context: messageContext } : {}) } };
      },
    });
  }, [fetchAccountResponse]);
  const chat = useChat<SupportUIMessage>({
    id: `support:${ownerKey}`,
    transport,
    generateId: () => crypto.randomUUID(),
    onData: (part) => {
      if (part.type !== "data-support") return;
      const data = parseSupportStreamData(part.data);
      if (!data) return;
      setStreamed({ handler: data.handler, at: Date.now() });
      if (data.limited) setLimitedUntil(Date.now() + data.limited.retryAfter * 1000);
      const discardedId = data.discardedMessageId;
      if (discardedId) setDiscarded((current) => new Set(current).add(discardedId));
    },
    onFinish: () => cache.refresh(),
  });
  useEffect(() => {
    if (limitedUntil === null) return;
    const timer = setTimeout(() => setLimitedUntil(null), Math.max(0, limitedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [limitedUntil]);
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const conversation = useSupportConversation(ownerKey, fetchAccountResource, open, busy);
  const [body, setBody] = useState("");
  const [handoff, setHandoff] = useState<"idle" | "pending" | "failed">("idle");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const readRef = useRef<string | null>(null);
  const readFailedRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [logMounted, setLogMounted] = useState(false);
  const attachLog = useCallback((node: HTMLDivElement | null) => { logRef.current = node; setLogMounted(node !== null); }, []);
  const atLatestRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [scrollRevision, setScrollRevision] = useState(0);
  const [history, setHistory] = useState<SupportMessage[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyBoundary, setHistoryBoundary] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState("");
  const serverConversation = conversation.data?.conversation ?? null;
  const messages = serverConversation?.messages ?? [];
  const unreadCount = serverConversation?.unreadCount ?? 0;
  const historyIds = new Set(history.map((message) => message.id));
  const serverMessages = [...history, ...messages.filter((message) => !historyIds.has(message.id))];
  const newestObservedId = [...serverMessages].reverse().find((item) => item.authorType !== "customer")?.id;
  const serverUIMessages = serverMessages.map(toUIMessage);
  const serverIds = new Set(serverUIMessages.map((message) => message.id));
  const localMessages = chat.messages.filter((message) => !serverIds.has(message.id) && messageText(message).trim());
  const display = [...serverUIMessages, ...localMessages].filter((message) => !discarded.has(message.id));
  const lastLocalUser = [...localMessages].reverse().find((message) => message.role === "user");
  const tail = display.at(-1);
  const capability = serverConversation?.assistant ?? conversation.data?.assistant ?? { available: false, handoff: false };
  const handler: SupportHandler = streamed && streamed.at >= conversation.dataUpdatedAt ? streamed.handler : serverConversation?.handler ?? (capability.available ? "assistant" : "operator");
  const limited = limitedUntil !== null && handler === "assistant";
  const failure = limited ? "rate-limited" : chat.status === "error" ? turnFailure(chat.error) : stoppedBeforeReply && !busy && handler === "assistant" ? "no-reply" : null;
  const blocked = failure === "not-sent" || failure === "rate-limited";
  const hasConversation = Boolean(serverConversation) || streamed !== null;
  const conversationOpen = !serverConversation || serverConversation.status === "open" || (streamed !== null && streamed.at >= conversation.dataUpdatedAt);
  const offerHandoff = capability.handoff && handler === "assistant" && hasConversation && conversationOpen;
  const withPerson = capability.available && handler === "operator" && hasConversation && conversationOpen;
  const typing = chat.status === "submitted" && handler === "assistant";
  const tailKey = `${tail?.id ?? ""}:${tail ? messageText(tail).length : 0}:${typing}`;
  const oldestMessagesCursor = serverConversation?.messagesNextCursor ?? null;
  if (historyLoaded && historyBoundary !== oldestMessagesCursor) {
    setHistory([]);
    setHistoryCursor(null);
    setHistoryLoaded(false);
    setHistoryBoundary(null);
  }
  const olderCursor = historyLoaded ? historyCursor : oldestMessagesCursor;

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (atLatestRef.current) log.scrollTop = log.scrollHeight;
    atLatestRef.current = logAtLatest(log);
  }, [open, tailKey]);

  const markRead = useCallback((messageId: string) => {
    if (readRef.current === messageId) return;
    readRef.current = messageId;
    void fetchAccountResponse("/api/support/read", { body: JSON.stringify({ version: SUPPORT_CONTRACT_VERSION, lastMessageId: messageId }) }).then(() => {
      readFailedRef.current = false;
      return cache.refresh();
    }, (error) => {
      readRef.current = null;
      if (!readFailedRef.current) {
        readFailedRef.current = true;
        reportPageClientError({ name: error instanceof Error ? error.name : "Error", message: "Support read receipt failed", route: window.location.pathname });
      }
      return null;
    });
  }, [fetchAccountResponse, cache]);

  useEffect(() => {
    if (!open || document.hidden || unreadCount === 0 || !newestObservedId) return;
    const visible = newestVisibleMessageId(logRef.current, (author) => author !== "customer");
    if (visible !== null) markRead(visible);
  }, [open, unreadCount, newestObservedId, scrollRevision, markRead, conversation.dataUpdatedAt, logMounted]);

  function send(text: string) {
    setLimitedUntil(null);
    setStoppedBeforeReply(false);
    void chat.sendMessage({ text, metadata: { author: "customer", ...(context ? { context } : {}) } });
  }

  function retryTurn() {
    setStoppedBeforeReply(false);
    void chat.regenerate();
  }

  function stopTurn() {
    if (chat.messages.at(-1)?.role === "user") setStoppedBeforeReply(true);
    void chat.stop();
  }

  async function loadEarlier() {
    if (!olderCursor || loadingEarlier) return;
    const from = olderCursor;
    setLoadingEarlier(true);
    setEarlierError("");
    try {
      const response = parseCustomerSupportResponse(await fetchAccountResource(`/api/support?before=${encodeURIComponent(from)}`));
      if (!response?.conversation) throw new Error("Invalid support response");
      const conversation = response.conversation;
      setHistory((previous) => [...conversation.messages, ...previous]);
      setHistoryCursor(conversation.messagesNextCursor);
      setHistoryLoaded(true);
      if (!historyLoaded) setHistoryBoundary(from);
    } catch {
      setEarlierError("Couldn't load earlier messages. Try again.");
    } finally { setLoadingEarlier(false); }
  }

  async function talkToPerson() {
    setHandoff("pending");
    try {
      const response = parseCustomerSupportResponse(await fetchAccountResource("/api/support/handoff", { method: "POST", body: { version: SUPPORT_CONTRACT_VERSION } }));
      if (!response) throw new Error("Invalid support response");
      await cache.conversation(response);
      setHandoff("idle");
      composerRef.current?.focus();
    } catch {
      setHandoff("failed");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = normalizeSupportBody(body);
    if (!text || busy || blocked) return;
    setBody("");
    send(text);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (shouldSubmitSupportComposer(event)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function scrollToLatest() {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
    atLatestRef.current = true;
    setPinned(true);
  }

  function delivery(message: SupportUIMessage): "sending" | "failed" | "sent" | undefined {
    if (message.role !== "user") return undefined;
    if (message.id === lastLocalUser?.id && chat.status === "submitted") return "sending";
    if (message.id === lastLocalUser?.id && blocked && !limited) return "failed";
    return message.id === tail?.id && !busy ? "sent" : undefined;
  }

  return (
    <AppDrawer open={open} labelledBy="support-chat-title" onCancel={onClose}>
      <div className="flex min-h-0 flex-1 flex-col" data-initial-focus="" tabIndex={-1}>
        <div className="flex shrink-0 items-center gap-2 p-4">
          <h2 id="support-chat-title" className="me-auto text-base font-semibold">Support</h2>
          {offerHandoff ? <Button variant="outline" size="sm-touch" loading={handoff === "pending"} onClick={() => void talkToPerson()}>Talk to a person</Button> : null}
          <Button variant="ghost" size="touch" aria-label="Close support" onClick={onClose}><X aria-hidden="true" /></Button>
        </div>
        {context ? <div className="px-4"><SupportContextChip context={context} /></div> : null}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={attachLog} onScroll={(event) => { const latest = logAtLatest(event.currentTarget); atLatestRef.current = latest; setPinned(latest); setScrollRevision((revision) => revision + 1); }} role="log" aria-label="Support messages" aria-live="polite" aria-busy={busy} className="flex min-h-32 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            {conversation.isPending && !conversation.data ? (
              <div role="status" aria-label="Loading support messages" className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="ms-auto h-10 w-2/3" /></div>
            ) : conversation.isError && !conversation.data ? (
              <div role="alert" className="grid justify-items-start gap-2 text-sm">Couldn&apos;t load support messages.<Button variant="outline" size="touch" onClick={() => void conversation.refetch()}>Try again</Button></div>
            ) : display.length === 0 && !busy ? (
              capability.available ? (
                <div className="m-auto grid w-full justify-items-center gap-4 text-center">
                  <p className="text-lg font-semibold">How can we help?</p>
                  <ul aria-label="Suggested questions" className="flex flex-wrap justify-center gap-2">
                    {suggestedPrompts.map((prompt) => <li key={prompt}><Button variant="outline" size="touch" onClick={() => send(prompt)}>{prompt}</Button></li>)}
                  </ul>
                </div>
              ) : <p className="text-sm text-muted-foreground">Send us a message.</p>
            ) : null}
            {conversation.isError && conversation.data ? <div role="alert" className="grid justify-items-start gap-2 text-sm">Couldn&apos;t refresh support messages.<Button variant="outline" size="touch" onClick={() => void conversation.refetch()}>Try again</Button></div> : null}
            {olderCursor ? <div className="grid justify-items-center gap-1"><Button variant="outline" size="touch" loading={loadingEarlier} onClick={() => void loadEarlier()}>Load earlier messages</Button>{earlierError ? <p role="alert" className="text-sm text-destructive">{earlierError}</p> : null}</div> : null}
            {display.map((message, index) => {
              const author = message.metadata?.author ?? (message.role === "user" ? "customer" : "assistant");
              const previous = display[index - 1];
              const continued = previous !== undefined && (previous.metadata?.author ?? (previous.role === "user" ? "customer" : "assistant")) === author;
              const state = delivery(message);
              return <div key={message.id} data-message-id={message.metadata?.serverId} data-message-author={message.metadata?.serverId ? author : undefined}>
                <SupportMessageBubble author={author} side="customer" continued={continued} delivery={state} onRetry={state === "failed" ? retryTurn : undefined}>{messageText(message)}</SupportMessageBubble>
              </div>;
            })}
            {typing ? <SupportMessageBubble author="assistant" side="customer" continued={tail?.role === "assistant"}>
              <span className="flex h-5 items-center gap-1" aria-hidden="true"><span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" /><span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" /><span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" /></span>
              <span className="sr-only">Assistant is replying</span>
            </SupportMessageBubble> : null}
          </div>
          {!pinned && display.length > 0 ? <ConversationScrollButton onClick={scrollToLatest} /> : null}
        </div>
        <div className="shrink-0 space-y-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {failure === "rate-limited" ? <p role="alert" className="text-sm text-destructive">Too many messages. Try again later.</p> : null}
          {failure === "not-sent" ? <p role="alert" className="text-sm text-destructive">Message not sent. Retry above.</p> : null}
          {failure === "no-reply" ? <div role="alert" className="flex flex-wrap items-center gap-x-2 text-sm text-destructive">The assistant couldn&apos;t reply.<Button variant="link" size="touch" onClick={retryTurn}>Try again</Button></div> : null}
          {handoff === "failed" ? <p role="alert" className="text-sm text-destructive">Couldn&apos;t reach a person. Try again.</p> : null}
          {withPerson ? <p role="status" className="text-center text-xs text-muted-foreground">A person will reply here.</p> : null}
          <PromptInput onSubmit={submit}>
            <PromptInputTextarea ref={composerRef} aria-label="Message support" value={body} maxLength={2000} onInput={(event) => setBody(event.currentTarget.value)} onKeyDown={onComposerKeyDown} placeholder={capability.available && handler === "assistant" ? "Ask a question" : "Message"} />
            <PromptInputSubmit busy={busy} disabled={blocked || !normalizeSupportBody(body)} onStop={stopTurn} />
          </PromptInput>
          {body.length >= 1900 ? <p role="status" className="text-xs text-muted-foreground">{body.length} of 2000 characters</p> : null}
        </div>
      </div>
    </AppDrawer>
  );
}

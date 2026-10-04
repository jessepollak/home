"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { SupportMessageBubble } from "@/components/ui/support-message";
import { Textarea } from "@/components/ui/textarea";
import { normalizeSupportBody, type OperatorSupportConversationResponse, type OperatorSupportListItem, type OperatorSupportListResponse, type OperatorSupportMessage } from "@/shared/support/contract";
import { operatorSupportTransport, SupportConflictError, type OperatorConversationResult, type OperatorSupportTransport } from "./api";
import { CustomerDetail } from "./customer-detail";
import { shouldSubmitSupportComposer } from "@/client/support/composer-keydown";
import { logAtLatest, newestVisibleMessageId } from "@/client/support/log-visibility";

type Filter = "open" | "resolved" | "all";
type GenerationError = { generation: number; message: string; source?: "handler" };
type InboxProps = { conversationId?: string; transport?: OperatorSupportTransport; initialList?: OperatorSupportListResponse; initialConversation?: OperatorSupportConversationResponse };
type InboxList = OperatorSupportListResponse & { firstPageIds?: string[]; loadedPages?: number; pageCursors?: string[] };
const maxInboxPages = 100;
function needsReply(item: OperatorSupportListItem): boolean {
  return item.handler === "operator" && item.status === "open" && item.lastAuthorType === "customer";
}
function authorLabel(message: OperatorSupportMessage): string {
  if (message.authorType === "customer") return "Customer";
  if (message.authorType === "assistant") return "Assistant";
  return message.authorOperator ? `Operator ${message.authorOperator.slice(0, 6)}…${message.authorOperator.slice(-4)}` : "Operator";
}
function byNewest(first: { lastMessageAt: string; id: string }, second: { lastMessageAt: string; id: string }): number {
  return second.lastMessageAt.localeCompare(first.lastMessageAt) || second.id.localeCompare(first.id);
}

export function OperatorSupportInbox({ conversationId, transport = operatorSupportTransport, initialList, initialConversation }: InboxProps) {
  const [filter, setFilter] = useState<Filter>("open");
  const [list, setList] = useState<InboxList | null>(initialList ? { ...initialList, firstPageIds: initialList.conversations.map((row) => row.id) } : null);
  const [detail, setDetail] = useState<OperatorSupportConversationResponse | null>(initialConversation ?? null);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState<GenerationError | null>(null);
  const [busyConversations, setBusyConversations] = useState<Map<string, number>>(() => new Map());
  const [body, setBody] = useState("");
  const [actionError, setActionError] = useState<GenerationError | null>(null);
  const readMessage = useRef("");
  const listSeq = useRef(0);
  const listPending = useRef<number | null>(null);
  const listRef = useRef(list);
  useLayoutEffect(() => { listRef.current = list; }, [list]);
  const detailSeq = useRef(0);
  const detailTag = useRef<{ id: string; etag: string | null } | null>(null);
  const detailPending = useRef<number | null>(null);
  const filterRef = useRef(filter);
  const pendingReplies = useRef(new Map<string, { clientMessageId: string; body: string }>());
  const conversationRef = useRef(conversationId);
  const generationRef = useRef(0);
  const busyToken = useRef(0);
  const mounted = useRef(true);

  const conversationLogRef = useRef<HTMLDivElement>(null);
  const logOwnerRef = useRef(conversationId);
  const atLatestRef = useRef(true);
  const [scrollRevision, setScrollRevision] = useState(0);
  const [history, setHistory] = useState<OperatorSupportMessage[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<GenerationError | null>(null);
  const [viewGeneration, setViewGeneration] = useState(0);
  const [historyOwner, setHistoryOwner] = useState(conversationId);
  if (historyOwner !== conversationId) {
    setHistoryOwner(conversationId);
    setViewGeneration((generation) => generation + 1);
    setHistory([]);
    setHistoryCursor(null);
    setHistoryLoaded(false);
    setLoadingEarlier(false);
    setEarlierError(null);
    setActionError(null);
    setDetailError(null);
    setBody("");
  }
  const [historyBoundary, setHistoryBoundary] = useState<string | null>(null);
  useLayoutEffect(() => {
    conversationRef.current = conversationId;
    generationRef.current = viewGeneration;
  }, [conversationId, viewGeneration]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const [visibilityEpoch, setVisibilityEpoch] = useState(0);
  useEffect(() => {
    const update = () => setVisibilityEpoch((epoch) => epoch + 1);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const loadList = useCallback(async (status: Filter, before?: string, resetPages = false) => {
    const seq = ++listSeq.current;
    listPending.current = seq;
    const previous = listRef.current;
    const active = () => mounted.current && seq === listSeq.current && status === filterRef.current;
    try {
      if (before && (previous?.loadedPages ?? 1) >= maxInboxPages) throw new Error("Too many support pages. Switch filters to refresh the inbox.");
      const result = await transport.list(status, before);
      if (!active()) return;
      const firstPageIds = result.conversations.map((row) => row.id);
      const priorIds = previous?.firstPageIds ?? previous?.conversations.map((row) => row.id);
      const firstPageChanged = !priorIds || firstPageIds.length !== priorIds.length || firstPageIds.some((id, index) => id !== priorIds[index]);
      let next: InboxList;
      if (before && previous) {
        const pageCursors = [...(previous.pageCursors ?? []), before];
        if (result.nextCursor && pageCursors.includes(result.nextCursor)) throw new Error("Couldn't refresh support pages. Try again.");
        const seen = new Set(previous.conversations.map((row) => row.id));
        next = { ...result, firstPageIds: previous.firstPageIds, loadedPages: (previous.loadedPages ?? 1) + 1, pageCursors, conversations: [...previous.conversations, ...result.conversations.filter((row) => !seen.has(row.id))].sort(byNewest) };
      } else {
        const depth = resetPages || firstPageChanged ? 1 : previous?.loadedPages ?? 1;
        if (depth > maxInboxPages) throw new Error("Too many support pages. Switch filters to refresh the inbox.");
        const conversations = [...result.conversations];
        const seenIds = new Set(firstPageIds);
        const seenCursors = new Set<string>();
        let cursor = result.nextCursor;
        let loadedPages = 1;
        while (cursor && loadedPages < depth) {
          if (seenCursors.has(cursor)) throw new Error("Couldn't refresh support pages. Try again.");
          seenCursors.add(cursor);
          const page = await transport.list(status, cursor);
          if (!active()) return;
          for (const row of page.conversations) {
            if (!seenIds.has(row.id)) { conversations.push(row); seenIds.add(row.id); }
          }
          cursor = page.nextCursor;
          ++loadedPages;
        }
        if (cursor && seenCursors.has(cursor)) throw new Error("Couldn't refresh support pages. Try again.");
        next = { ...result, firstPageIds, loadedPages, pageCursors: [...seenCursors], conversations: conversations.sort(byNewest), nextCursor: cursor };
      }
      if (!active()) return;
      listRef.current = next;
      setList(next);
      setListError("");
    } catch (error) {
      setListError((previous) => seq === listSeq.current && status === filterRef.current && mounted.current ? error instanceof Error ? error.message : "Couldn't load support. Try again." : previous);
    } finally {
      if (listPending.current === seq) listPending.current = null;
    }
  }, [transport]);

  const loadDetail = useCallback(async (id: string, before?: string, etag?: string) => {
    const seq = ++detailSeq.current;
    const generation = generationRef.current;
    if (!before) detailPending.current = seq;
    try {
      const result = await transport.conversation(id, { before, etag });
      if (seq !== detailSeq.current || generationRef.current !== generation) return;
      if (result !== "unchanged") {
        if (before) {
          setHistory((previous) => [...result.detail.conversation.messages, ...previous]);
          setHistoryCursor(result.detail.conversation.messagesNextCursor);
          setHistoryLoaded(true);
        } else {
          detailTag.current = { id, etag: result.etag };
          setDetail(result.detail);
        }
      }
      if (generationRef.current === generation) setDetailError(null);
    } catch (error) {
      setDetailError((previous) => seq === detailSeq.current && generationRef.current === generation ? { generation, message: error instanceof Error ? error.message : "Couldn't load support. Try again." } : previous);
    } finally {
      if (detailPending.current === seq) detailPending.current = null;
    }
  }, [transport]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadList(filter), 0);
    const poll = () => { if (!document.hidden && listPending.current === null) void loadList(filter); };
    const onVisibility = () => { if (!document.hidden) void loadList(filter, undefined, true); };
    const timer = window.setInterval(poll, 15_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [filter, loadList]);

  useEffect(() => {
    if (!conversationId) return;
    const initial = window.setTimeout(() => void loadDetail(conversationId), 0);
    const poll = () => {
      if (document.hidden) return;
      if (detailPending.current !== null) return;
      void loadDetail(conversationId, undefined, detailTag.current?.id === conversationId ? detailTag.current.etag ?? undefined : undefined);
    };
    const timer = window.setInterval(poll, 5_000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [conversationId, loadDetail]);

  const mutate = async (targetId: string, operation: () => Promise<OperatorConversationResult>, source?: "handler") => {
    if (busyConversations.has(targetId)) return;
    const generation = generationRef.current;
    const token = ++busyToken.current;
    setBusyConversations((current) => new Map(current).set(targetId, token));
    setActionError(null);
    try {
      const result = await operation();
      if (filterRef.current !== "all" && result.detail.conversation.status !== filterRef.current) {
        setList((previous) => previous ? { ...previous, conversations: previous.conversations.filter((row) => row.id !== result.detail.conversation.id) } : previous);
      }
      void loadList(filterRef.current);
      if (generationRef.current !== generation) return;
      ++detailSeq.current;
      detailTag.current = { id: targetId, etag: result.etag };
      setDetail(result.detail);
    } catch (error) {
      if (error instanceof SupportConflictError && generationRef.current === generation) {
        void loadDetail(targetId);
        void loadList(filterRef.current);
      }
      setActionError((previous) => generationRef.current === generation ? { generation, message: error instanceof Error ? error.message : "Couldn't update conversation. Try again.", ...(source ? { source } : {}) } : previous);
    } finally { setBusyConversations((current) => { if (current.get(targetId) !== token) return current; const next = new Map(current); next.delete(targetId); return next; }); }
  };
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = normalizeSupportBody(body);
    if (!conversationId || !trimmed || busy) return;
    const targetId = conversationId;
    const generation = generationRef.current;
    const observed = (detail && detail.conversation.id === targetId ? newestVisibleMessageId(conversationLogRef.current, (author) => author === "customer") : null) ?? targetId;
    const pendingKey = JSON.stringify([targetId, trimmed]);
    const existing = pendingReplies.current.get(pendingKey);
    const pending = existing ?? { clientMessageId: crypto.randomUUID(), body: trimmed };
    pendingReplies.current.set(pendingKey, pending);
    void mutate(targetId, async () => {
      const result = await transport.reply(targetId, trimmed, pending.clientMessageId, observed);
      if (pendingReplies.current.get(pendingKey)?.clientMessageId === pending.clientMessageId) pendingReplies.current.delete(pendingKey);
      if (generationRef.current === generation) setBody((current) => normalizeSupportBody(current) === trimmed ? "" : current);
      return result;
    });
  };
  const loadEarlier = async () => {
    if (!conversationId || !olderCursor || loadingEarlier) return;
    const targetId = conversationId;
    const generation = generationRef.current;
    const from = olderCursor;
    setLoadingEarlier(true);
    setEarlierError(null);
    try {
      const result = await transport.conversation(targetId, { before: from });
      if (generationRef.current !== generation || result === "unchanged") return;
      setHistory((previous) => [...result.detail.conversation.messages, ...previous]);
      setHistoryCursor(result.detail.conversation.messagesNextCursor);
      setHistoryLoaded(true);
      if (!historyLoaded) setHistoryBoundary(from);
    } catch (error) {
      setEarlierError((previous) => generationRef.current === generation ? { generation, message: error instanceof Error ? error.message : "Couldn't load earlier messages. Try again." } : previous);
    } finally {
      if (generationRef.current === generation) setLoadingEarlier(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldSubmitSupportComposer(event)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  const current = detail?.conversation.id === conversationId ? detail : null;
  const oldestMessagesCursor = current?.conversation.messagesNextCursor ?? null;
  if (historyLoaded && historyBoundary !== oldestMessagesCursor) {
    setHistory([]);
    setHistoryCursor(null);
    setHistoryLoaded(false);
    setHistoryBoundary(null);
  }
  const drafts = current?.conversation.messages.filter((message) => message.status === "draft") ?? [];
  const sentMessages = current ? [...history, ...current.conversation.messages].filter((message, index, list) => message.status === "sent" && list.findIndex((item) => item.id === message.id) === index) : [];
  const newestObservedCustomer = current ? [...sentMessages].reverse().find((message) => message.authorType === "customer")?.id ?? null : null;
  const newestMessageId = current?.conversation.messages.at(-1)?.id ?? null;
  useLayoutEffect(() => {
    const log = conversationLogRef.current;
    if (!log) return;
    if (logOwnerRef.current !== conversationId) {
      logOwnerRef.current = conversationId;
      atLatestRef.current = true;
    }
    if (atLatestRef.current) log.scrollTop = log.scrollHeight;
    atLatestRef.current = logAtLatest(log);
  }, [conversationId, newestMessageId]);
  useEffect(() => {
    if (!conversationId || document.hidden || !mounted.current || newestObservedCustomer === null) return;
    const visible = newestVisibleMessageId(conversationLogRef.current, (author) => author === "customer");
    if (visible === null) return;
    const marker = `${conversationId}:${visible}`;
    if (marker === readMessage.current) return;
    readMessage.current = marker;
    const generation = generationRef.current;
    void transport.read(conversationId, visible).then(
      () => void loadList(filterRef.current),
      (error) => {
        if (readMessage.current === marker) readMessage.current = "";
        setDetailError((previous) => generationRef.current === generation ? { generation, message: error instanceof Error ? error.message : "Couldn't mark conversation as read." } : previous);
      },
    );
  }, [conversationId, newestObservedCustomer, visibilityEpoch, scrollRevision, detail, transport, loadList]);
  const olderCursor = historyLoaded ? historyCursor : oldestMessagesCursor;
  const busy = conversationId !== undefined && busyConversations.has(conversationId);
  const visibleDetailError = detailError && detailError.generation === viewGeneration ? detailError.message : "";
  const visibleEarlierError = earlierError && earlierError.generation === viewGeneration ? earlierError.message : "";
  const visibleActionError = actionError && actionError.generation === viewGeneration && !actionError.source ? actionError.message : "";
  const visibleHandlerError = actionError && actionError.generation === viewGeneration && actionError.source === "handler" ? actionError.message : "";
  const wallet = current?.customer.wallets[0];
  const customerLabel = list?.conversations.find((item) => item.id === conversationId)?.customerLabel
    ?? current?.customer.emails[0]
    ?? (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : `Customer ${current?.conversation.id.slice(0, 8)}`);

  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
    <section aria-label="Conversations" className={conversationId ? "hidden min-w-0 lg:block" : "min-w-0"}>
      <div role="group" aria-label="Conversation status" className="mb-4 flex flex-wrap gap-2">
        {(["open", "resolved", "all"] as const).map((status) => <Button key={status} variant={filter === status ? "secondary" : "ghost"} size="touch" aria-pressed={filter === status} onClick={() => { ++listSeq.current; filterRef.current = status; listRef.current = null; setFilter(status); setList(null); setListError(""); }}>{status[0].toUpperCase() + status.slice(1)}</Button>)}
      </div>
      {listError && <div role="alert" className="grid gap-2"><p>{listError}</p><Button variant="outline" size="touch" onClick={() => void loadList(filter)}>Try again</Button></div>}
      {!list && !listError && <Skeleton className="h-24 w-full" />}
      {list?.conversations.length === 0 && !listError && <p>No {filter === "all" ? "" : `${filter} `}conversations.</p>}
      {list && <div className="grid gap-1">{list.conversations.map((item) => <Item key={item.id} variant={item.id === conversationId ? "muted" : "default"} render={<Link href={`/admin/support/${item.id}`} aria-current={item.id === conversationId ? "page" : undefined} />}>
        <ItemContent><ItemTitle truncate="wrap">{item.customerLabel}</ItemTitle><ItemDescription lines={2}>{item.preview}</ItemDescription></ItemContent>
        {item.handler === "assistant" || item.unread || needsReply(item) ? <span className="flex shrink-0 flex-col items-end gap-1">{item.handler === "assistant" ? <Badge variant="outline">Assistant</Badge> : needsReply(item) ? <Badge variant="warning">Needs reply</Badge> : null}{item.unread && <Badge variant="secondary">Unread</Badge>}</span> : null}
      </Item>)}{list.nextCursor && <Button variant="outline" size="touch" onClick={() => void loadList(filter, list.nextCursor ?? undefined)}>Load more</Button>}</div>}
    </section>
    {conversationId ? <>
      <section aria-label="Conversation" className="grid min-w-0 content-start gap-4">
        <Link href="/admin/support" className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring lg:hidden">Back to inbox</Link>
        {visibleDetailError && <div role="alert" className="grid gap-2"><p>{visibleDetailError}</p><Button variant="outline" size="touch" onClick={() => void loadDetail(conversationId)}>Try again</Button></div>}
        {!current && !visibleDetailError && <Skeleton className="h-64 w-full" />}
        {current && <>
          <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{customerLabel}</h2><Button variant="outline" size="touch" loading={busy} onClick={() => void mutate(conversationId, () => transport.status(conversationId, current.conversation.status === "open" ? "resolved" : "open", newestVisibleMessageId(conversationLogRef.current, (author) => author === "customer") ?? conversationId))}>{current.conversation.status === "open" ? "Resolve" : "Reopen"}</Button></div>
          {current.conversation.handler === "assistant" || current.conversation.assistantAvailable ? <Item variant="outline" size="sm"><ItemContent><ItemTitle>{current.conversation.handler === "assistant" ? "Assistant is handling this" : "An operator is handling this"}</ItemTitle></ItemContent><ItemActions><Button variant="outline" size="touch" loading={busy} onClick={() => void mutate(conversationId, () => transport.handler(conversationId, current.conversation.handler === "assistant" ? "operator" : "assistant"), "handler")}>{current.conversation.handler === "assistant" ? "Take over" : "Hand back to assistant"}</Button></ItemActions></Item> : null}
          {visibleHandlerError ? <p role="alert">{visibleHandlerError}</p> : null}
          <div ref={conversationLogRef} onScroll={(event) => { atLatestRef.current = logAtLatest(event.currentTarget); setScrollRevision((revision) => revision + 1); }} role="log" aria-label="Messages" aria-live="polite" className="grid max-h-[50dvh] content-start gap-3 overflow-y-auto py-2">
            {olderCursor ? <div className="grid justify-items-center gap-1"><Button variant="outline" size="touch" loading={loadingEarlier} onClick={() => void loadEarlier()}>Load earlier messages</Button>{visibleEarlierError ? <p role="alert" className="text-sm text-destructive">{visibleEarlierError}</p> : null}</div> : null}
            {sentMessages.map((message) => <div key={message.id} data-message-id={message.id} data-message-author={message.authorType} className="grid">{message.authorType === "assistant" ? null : <span aria-hidden="true" className={message.authorType === "operator" ? "ms-auto text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>{authorLabel(message)}</span>}<SupportMessageBubble author={message.authorType} side="operator" speaker={message.authorType === "operator" ? authorLabel(message) : undefined}>{message.body}</SupportMessageBubble></div>)}
          </div>
          {drafts.length > 0 && <section aria-label="Suggested reply" className="grid gap-2"><h3 className="font-medium">Suggested reply</h3>{drafts.map((draft) => <SupportMessageBubble key={draft.id} author="assistant" side="operator">{draft.body}</SupportMessageBubble>)}</section>}
          <form onSubmit={send} className="grid gap-2"><label htmlFor="operator-support-reply" className="text-sm font-medium">Reply</label>{current.conversation.handler === "assistant" ? <p id="operator-support-reply-description" className="text-sm text-muted-foreground">Sending takes over from the assistant.</p> : null}<Textarea id="operator-support-reply" value={body} onInput={(event) => setBody(event.currentTarget.value)} onKeyDown={onKeyDown} maxLength={2000} aria-invalid={Boolean(body && !normalizeSupportBody(body))} aria-describedby={current.conversation.handler === "assistant" ? "operator-support-reply-description" : undefined} /><Button type="submit" size="touch" loading={busy} disabled={!normalizeSupportBody(body)}>Send</Button>{visibleActionError ? <p role="alert">{visibleActionError}</p> : null}</form>
        </>}
      </section>
      {current && <aside aria-label="Customer details" className="min-w-0"><CustomerDetail data={current} /></aside>}
    </> : <div className="hidden lg:col-span-2 lg:flex lg:items-center lg:justify-center"><p>Select a conversation.</p></div>}
  </div>;
}

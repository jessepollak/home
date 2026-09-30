import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { environmentManager } from "@tanstack/react-query";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { queryScopes } from "@/client/query/query-scopes";
import { parseRecentActionsPayload } from "@/shared/actions/contracts/list";
import { getRecentActionsReadSequence, recentActionsQuery } from "@/client/actions/recent-actions-query";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { ActionToasts } from "@/client/home/action-toasts";
import { buildBalancesSnapshotFixture } from "@/shared/balances/fixtures";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

const { act, cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { usePendingCashoutEscrow } = await import("./pending-cashout");

const snapshot = buildBalancesSnapshotFixture();
const NOW = Date.parse("2026-09-15T12:00:00Z");

const session: VerifiedAccountSession = { user: { subject: "subject-a" },
  smartAccount: { address: snapshot.owner.address, chainId: 8453 }, accountProvider: "cdp-embedded" };
const action = {
  id: "cashout-a", provider: "cdp-embedded", kind: "cash-out", status: "confirmed", createdAt: "2026-09-15T12:00:00Z",
  confirmedAt: "2026-09-15T12:00:00Z", owner: { subject: session.user.subject, address: snapshot.owner.address,
    chainId: 8453, accountProvider: session.accountProvider },
  summary: { title: "Cash out", amounts: [], warnings: [], expiresAt: "" },
  cashout: { version: 1, providerId: "peer", region: "US", depositId: "escrow-1", depositBlockNumber: snapshot.block.number, progressConfirmed: true,
    state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000", filledAtomic: "0",
    returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, withdrawing: false, etaSeconds: 1800,
    settledAt: null, updatedAt: "2026-09-15T12:00:00Z" },
};
const pendingCashoutKey = ownerQueryKey(dataOwnerKey(session), "actions");
const cachedActions = (actions: unknown[]) => ({
  ...parseRecentActionsPayload({ actions }, session), readSequence: 0,
});

beforeEach(() => setSystemTime(NOW));
afterEach(() => { cleanup(); getHomeQueryClient().clear(); jest.useRealTimers(); setSystemTime(); });

test("pending-cashout reads keep the owner actions key and memory-only freshness policy", async () => {
  const client = getHomeQueryClient();
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, async () => ({ actions: [action] })));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  const query = client.getQueryCache().find({ queryKey: pendingCashoutKey, exact: true });
  expect(query?.queryKey).toEqual([activityOwnerKey(session), "actions"]);
  expect(query?.meta).toEqual({ ownerKey: dataOwnerKey(session), persistence: "memory" });
  expect(query?.observers[0]?.options.staleTime).toBe(queryScopes.actions.staleTime);
  expect(client.getQueryData<ReturnType<typeof cachedActions>>(pendingCashoutKey)).toEqual({ ...cachedActions([action]), readSequence: expect.any(Number) });
});

test("signed-out pending-cashout observers never fetch or refetch a painted snapshot", async () => {
  let calls = 0;
  const client = getHomeQueryClient();
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(null, currentSnapshot, async () => {
    calls++;
    return { actions: [] };
  }), { initialProps: { currentSnapshot: snapshot } });
  const disabledKey = ["unauthenticated", "actions-disabled"];
  expect(hook.result.current).toEqual({ state: "loading" });
  hook.rerender({ currentSnapshot: { ...snapshot, fetchedAt: new Date(NOW + 100).toISOString() } });
  await client.refetchQueries({ queryKey: disabledKey, type: "all" });
  expect(calls).toBe(0);
  expect(client.getQueryState(disabledKey)?.fetchStatus).toBe("idle");
  expect(client.getQueryData(disabledKey)).toBeUndefined();
  expect(hook.result.current).toEqual({ state: "loading" });
});

test("uses the pending-cashout actions cache but never applies it to another wallet snapshot", async () => {
  let calls = 0;
  const fetchOperations = async () => { calls++; return { actions: [action] }; };
  getHomeQueryClient().setQueryData(pendingCashoutKey, cachedActions([action]));
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, fetchOperations),
    { initialProps: { currentSnapshot: snapshot } });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  await waitFor(() => expect(calls).toBe(1));
  hook.rerender({ currentSnapshot: { ...snapshot, owner: { ...snapshot.owner, address: "0x2222222222222222222222222222222222222222" } } });
  expect(hook.result.current).toBeNull();
});

test("foreign-owner operations and unavailable action reads contribute nothing", async () => {
  const fetchOperations = async () => ({ actions: [{ ...action, owner: { ...action.owner, subject: "other" } }] });
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, fetchOperations));
  expect(hook.result.current).toEqual({ state: "loading" });
  await waitFor(() => expect(getHomeQueryClient().getQueryData(pendingCashoutKey)).toBeDefined());
  expect(hook.result.current).toBeNull();
});

test("an unavailable first actions read becomes unreadable instead of complete", async () => {
  const failures: Array<(error: Error) => void> = [];
  const fetchOperations = () => new Promise<unknown>((_resolve, reject) => { failures.push(reject); });
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, fetchOperations));
  expect(hook.result.current).toEqual({ state: "loading" });
  await waitFor(() => expect(failures).toHaveLength(1));
  failures[0]!(new Error("Actions unavailable"));
  await waitFor(() => expect(failures).toHaveLength(2));
  failures[1]!(new Error("Actions unavailable"));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "unreadable" }));
});

test("a cached empty actions list reconciles once, then shows escrow without looping", async () => {
  const key = pendingCashoutKey;
  getHomeQueryClient().setQueryData(key, cachedActions([]), { updatedAt: NOW - 500 });
  let resolve!: (value: unknown) => void;
  let calls = 0;
  const fetchOperations = () => { calls++; return new Promise<unknown>((done) => { resolve = done; }); };
  const newer = { ...snapshot, fetchedAt: new Date(NOW - 100).toISOString() };
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, fetchOperations),
    { initialProps: { currentSnapshot: newer } });
  await waitFor(() => expect(calls).toBe(1));
  expect(hook.result.current).toEqual({ state: "loading" });
  resolve({ actions: [action] });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  const escrow = hook.result.current;
  hook.rerender({ currentSnapshot: { ...newer } });
  expect(hook.result.current).toBe(escrow);
  expect(calls).toBe(1);
});

test("a newer snapshot stays loading during reconcile and removes escrow when the return is observed", async () => {
  const key = pendingCashoutKey;
  getHomeQueryClient().setQueryData(key, cachedActions([action]), { updatedAt: NOW - 500 });
  let resolve!: (value: unknown) => void;
  const fetchOperations = () => new Promise<unknown>((done) => { resolve = done; });
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, fetchOperations),
    { initialProps: { currentSnapshot: snapshot } });
  const newer = { ...snapshot, fetchedAt: new Date(NOW - 100).toISOString() };
  hook.rerender({ currentSnapshot: newer });
  await waitFor(() => expect(resolve).toBeDefined());
  expect(hook.result.current).toEqual({ state: "loading" });
  const returned = { actions: [{ ...action, cashout: { ...action.cashout, state: "returned", remainingAtomic: "0" } }] };
  resolve(returned);
  await waitFor(() => expect(getHomeQueryClient().getQueryData<ReturnType<typeof cachedActions>>(key)?.operations[0]?.cashout?.state).toBe("returned"));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "loading" }));
  resolve(returned);
  await waitFor(() => expect(hook.result.current).toBeNull());
});

test("a failed reconcile becomes unreadable and does not retry for the same snapshot", async () => {
  const key = pendingCashoutKey;
  getHomeQueryClient().setQueryData(key, cachedActions([action]), { updatedAt: NOW - 500 });
  let reject!: (error: Error) => void;
  let calls = 0;
  const fetchOperations = () => { calls++; return new Promise<unknown>((_resolve, fail) => { reject = fail; }); };
  const newer = { ...snapshot, fetchedAt: new Date(NOW - 100).toISOString() };
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, fetchOperations),
    { initialProps: { currentSnapshot: newer } });
  await waitFor(() => expect(calls).toBe(1));
  expect(hook.result.current).toEqual({ state: "loading" });
  reject(new Error("Actions unavailable"));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "unreadable" }));
  hook.rerender({ currentSnapshot: { ...newer } });
  expect(calls).toBe(1);
});


test("a cancelled confirming read turns the estimate unreadable, then a later own read recovers", async () => {
  const client = getHomeQueryClient();
  const key = pendingCashoutKey;
  client.setQueryData(key, cachedActions([]), { updatedAt: NOW });
  const reads: Array<{ resolve: (value: unknown) => void; signal?: AbortSignal }> = [];
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot,
    (signal) => new Promise((resolve) => { reads.push({ resolve, signal }); })));
  await waitFor(() => expect(reads).toHaveLength(1));
  await client.cancelQueries({ queryKey: key });
  expect(reads[0]!.signal?.aborted).toBe(true);
  reads[0]!.resolve({ actions: [] });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "unreadable" }));
  void client.refetchQueries({ queryKey: key });
  await waitFor(() => expect(reads).toHaveLength(2));
  reads[1]!.resolve({ actions: [action] });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  hook.rerender();
  expect(reads).toHaveLength(2);
});

test("a capped actions read leaves the escrow unreadable instead of definite", async () => {
  const key = pendingCashoutKey;
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, async () => ({ actions: [action], truncated: true })));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "unreadable" }));
  expect(getHomeQueryClient().getQueryData(key)).toMatchObject({ truncated: true });
});
test("a failed own read after the snapshot cannot trust the cached estimate", async () => {
  const key = pendingCashoutKey;
  getHomeQueryClient().setQueryData(key, cachedActions([action]), { updatedAt: NOW - 30_000 });
  let calls = 0;
  const fetchOperations = async () => { calls++; throw new Error("Actions unavailable"); };
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, fetchOperations));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "unreadable" }));
  await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
});

test("an unparseable actions read never confirms the snapshot as absent", async () => {
  const key = pendingCashoutKey;
  getHomeQueryClient().setQueryData(key, cachedActions([]), { updatedAt: Date.now() });
  const seen: Array<ReturnType<typeof usePendingCashoutEscrow>> = [];
  const hook = renderHook(() => {
    const estimate = usePendingCashoutEscrow(session, snapshot, async () => ({ actions: null }));
    seen.push(estimate);
    return estimate;
  });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "unreadable" }));
  expect(seen).not.toContain(null);
});

test("a read already in flight across a snapshot advance is followed by one post-snapshot read", async () => {
  const reads: Array<{ resolve: (value: unknown) => void }> = [];
  const fetchOperations = () => new Promise<unknown>((resolve) => { reads.push({ resolve }); });
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, fetchOperations),
    { initialProps: { currentSnapshot: snapshot } });
  await waitFor(() => expect(reads).toHaveLength(1));
  const newer = { ...snapshot, fetchedAt: new Date(NOW + 100).toISOString() };
  hook.rerender({ currentSnapshot: newer });
  setSystemTime(new Date(NOW + 200));
  reads[0]!.resolve({ actions: [] });
  await waitFor(() => expect(reads).toHaveLength(2));
  reads[1]!.resolve({ actions: [action] });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  hook.rerender({ currentSnapshot: { ...newer } });
  expect(reads).toHaveLength(2);
});

test("a shared actions read started before the snapshot cannot present cached or completed escrow", async () => {
  const key = pendingCashoutKey;
  const client = getHomeQueryClient();
  client.setQueryData(key, cachedActions([]));
  const started = NOW;
  let finishExternal!: (value: unknown) => void;
  const external = client.fetchQuery({ ...recentActionsQuery({ owner: dataOwnerKey(session), session, fetchOperations: () =>
    new Promise<unknown>((resolve) => { finishExternal = resolve; }) }), staleTime: 0 });
  await waitFor(() => expect(finishExternal).toBeDefined());
  const newer = { ...snapshot, fetchedAt: new Date(started + 100).toISOString() };
  const reads: Array<(value: unknown) => void> = [];
  const hook = renderHook(() => usePendingCashoutEscrow(session, newer, () =>
    new Promise<unknown>((resolve) => { reads.push(resolve); })));
  setSystemTime(new Date(started + 200));
  expect(reads).toHaveLength(0);
  expect(hook.result.current).toEqual({ state: "loading" });
  finishExternal({ actions: [action] });
  await external;
  await waitFor(() => expect(reads).toHaveLength(1));
  expect(hook.result.current).toEqual({ state: "loading" });
  reads[0]!({ actions: [action] });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  hook.rerender();
  expect(reads).toHaveLength(1);
});

test("shared pending-cashout consumers confirm absence from the same post-snapshot read", async () => {
  getHomeQueryClient().setQueryData(pendingCashoutKey, cachedActions([]));
  const reads: Array<(value: unknown) => void> = [];
  const fetchOperations = () => new Promise<unknown>((resolve) => { reads.push(resolve); });
  const hook = renderHook(() => {
    const first = usePendingCashoutEscrow(session, snapshot, fetchOperations);
    const second = usePendingCashoutEscrow(session, snapshot, fetchOperations);
    return [first, second];
  });
  await waitFor(() => expect(reads).toHaveLength(1));
  reads[0]!({ actions: [] });
  await waitFor(() => expect(hook.result.current).toEqual([null, null]));
  hook.rerender();
  expect(reads).toHaveLength(1);
});

test("an aborted old-owner read cannot confirm the replacement owner's snapshot", async () => {
  const client = getHomeQueryClient();
  const replacementSnapshot: typeof snapshot = { ...snapshot, owner: { ...snapshot.owner, address: "0x2222222222222222222222222222222222222222" } };
  const replacementSession: VerifiedAccountSession = { ...session, user: { subject: "subject-b" },
    smartAccount: { address: replacementSnapshot.owner.address, chainId: replacementSnapshot.owner.chainId } };
  const reads: Array<{ resolve: (value: unknown) => void; signal?: AbortSignal }> = [];
  const fetchOperations = (signal?: AbortSignal) => new Promise<unknown>((resolve) => { reads.push({ resolve, signal }); });
  const hook = renderHook(({ currentSession, currentSnapshot }) => usePendingCashoutEscrow(currentSession, currentSnapshot, fetchOperations),
    { initialProps: { currentSession: session, currentSnapshot: snapshot } });
  await waitFor(() => expect(reads).toHaveLength(1));
  hook.rerender({ currentSession: replacementSession, currentSnapshot: replacementSnapshot });
  await waitFor(() => expect(reads).toHaveLength(2));
  expect(reads[0]!.signal?.aborted).toBe(true);
  reads[0]!.resolve({ actions: [] });
  expect(hook.result.current).toEqual({ state: "loading" });
  reads[1]!.resolve({ actions: [] });
  await waitFor(() => expect(hook.result.current).toBeNull());
  expect(client.getQueryData(pendingCashoutKey)).toBeUndefined();
  expect(client.getQueryData<ReturnType<typeof cachedActions>>(ownerQueryKey(dataOwnerKey(replacementSession), "actions")))
    .toEqual({ ...cachedActions([]), readSequence: expect.any(Number) });
  hook.rerender({ currentSession: replacementSession, currentSnapshot: replacementSnapshot });
  expect(reads).toHaveLength(2);
});


test("a read for an earlier snapshot does not confirm a newer one", async () => {
  const key = pendingCashoutKey;
  getHomeQueryClient().setQueryData(key, cachedActions([]));
  const started = NOW;
  const old = { ...snapshot, fetchedAt: new Date(started - 100).toISOString() };
  const reads: Array<(value: unknown) => void> = [];
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, () =>
    new Promise<unknown>((resolve) => { reads.push(resolve); })), { initialProps: { currentSnapshot: old } });
  await waitFor(() => expect(reads).toHaveLength(1));
  reads[0]!({ actions: [] });
  await waitFor(() => expect(getHomeQueryClient().getQueryState(key)?.fetchStatus).toBe("idle"));
  const newer = { ...snapshot, fetchedAt: new Date(started + 100).toISOString() };
  setSystemTime(new Date(started + 200));
  hook.rerender({ currentSnapshot: newer });
  await waitFor(() => expect(reads).toHaveLength(2));
  reads[1]!({ actions: [action] });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  hook.rerender({ currentSnapshot: { ...newer } });
  expect(reads).toHaveLength(2);
});

test("a fresh snapshot reconciles with its own read and does not repeat it", async () => {
  const fresh = { ...snapshot, fetchedAt: new Date(NOW - 100).toISOString() };
  let calls = 0;
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, async () => {
    calls++;
    return { actions: [action] };
  }), { initialProps: { currentSnapshot: fresh } });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  expect(calls).toBe(1);
  hook.rerender({ currentSnapshot: { ...fresh } });
  expect(calls).toBe(1);
});

test("the partial estimate stays stable when an unresolved order accompanies known escrow", async () => {
  const fresh = { ...snapshot, fetchedAt: new Date(NOW - 100).toISOString() };
  let calls = 0;
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, async () => {
    calls++;
    return { actions: [action, { ...action, id: "cashout-b", status: "unknown", cashout: undefined }] };
  }), { initialProps: { currentSnapshot: fresh } });
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: true }));
  expect(calls).toBeGreaterThanOrEqual(1);
  const estimate = hook.result.current;
  hook.rerender({ currentSnapshot: { ...fresh } });
  expect(hook.result.current).toBe(estimate);
  expect(calls).toBe(1);
});

test("a new wallet snapshot consumes exactly one actions read and does not loop", async () => {
  const key = pendingCashoutKey;
  getHomeQueryClient().setQueryData(key, cachedActions([]), { updatedAt: NOW - 500 });
  let calls = 0;
  const hook = renderHook(({ currentSnapshot }) => usePendingCashoutEscrow(session, currentSnapshot, async () => { calls++; return { actions: [] }; }),
    { initialProps: { currentSnapshot: snapshot } });
  await waitFor(() => expect(calls).toBe(1));
  const newer = { ...snapshot, block: { ...snapshot.block, number: (BigInt(snapshot.block.number) + BigInt(1)).toString() } };
  hook.rerender({ currentSnapshot: newer });
  await waitFor(() => expect(calls).toBe(2));
  await waitFor(() => expect(getHomeQueryClient().getQueryState(key)?.fetchStatus).toBe("idle"));
  expect(hook.result.current).toBeNull();
  hook.rerender({ currentSnapshot: { ...newer } });
  expect(calls).toBe(2);
});

test("a background actions failure after its confirming read keeps the estimate", async () => {
  const key = pendingCashoutKey;
  let reject!: (error: Error) => void;
  let calls = 0;
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, () => {
    calls++;
    return calls === 1 ? Promise.resolve({ actions: [action] }) : new Promise<unknown>((_resolve, fail) => { reject = fail; });
  }));
  await waitFor(() => expect(calls).toBe(1));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
  void getHomeQueryClient().invalidateQueries({ queryKey: key });
  await waitFor(() => expect(reject).toBeDefined());
  reject(new Error("Background actions failure"));
  expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false });
});

test("an unconfirmed stored record produces an indeterminate estimate", async () => {
  const fresh = { ...snapshot, fetchedAt: new Date(NOW - 100).toISOString() };
  const hook = renderHook(() => usePendingCashoutEscrow(session, fresh, async () => ({
    actions: [{ ...action, cashout: { ...action.cashout, progressConfirmed: false } }],
  })));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "indeterminate" }));
});

test.each([
  ["a null amount entry", { amounts: [null] }],
  ["a non-numeric amount base units", { amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "broken", direction: "spend" }] }],
  ["a missing required summary field", { warnings: undefined }],
] as const)("a cash-out row with %s leaves the estimate unreadable instead of crashing", async (_label, patch) => {
  const malformed = { ...action, summary: { ...action.summary, ...patch } };
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, async () => ({ actions: [malformed] })));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "unreadable" }));
});

test("an in-flight first actions read stays loading until resolved", async () => {
  let resolve!: (value: unknown) => void;
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, () => new Promise<unknown>((done) => { resolve = done; })));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "loading" }));
  resolve({ actions: [] });
  await waitFor(() => expect(hook.result.current).toBeNull());
});

test("a painted snapshot before owner verification stays loading", async () => {
  const hook = renderHook(() => usePendingCashoutEscrow(null, snapshot, async () => ({ actions: [] })));
  expect(hook.result.current).toEqual({ state: "loading" });
});

test("no session and no painted snapshot yields no estimate", () => {
  const hook = renderHook(() => usePendingCashoutEscrow(null, null, async () => ({ actions: [] })));
  expect(hook.result.current).toBeNull();
});

test("a provisional snapshot stays loading until the post-verification read establishes absence", async () => {
  const key = pendingCashoutKey;
  getHomeQueryClient().setQueryData(key, cachedActions([]), { updatedAt: NOW - 500 });
  let resolve!: (value: unknown) => void;
  const fetchOperations = () => new Promise<unknown>((done) => { resolve = done; });
  const hook = renderHook(({ currentSession }) => usePendingCashoutEscrow(currentSession, snapshot, fetchOperations),
    { initialProps: { currentSession: null as VerifiedAccountSession | null } });
  expect(hook.result.current).toEqual({ state: "loading" });
  hook.rerender({ currentSession: session });
  await waitFor(() => expect(resolve).toBeDefined());
  expect(hook.result.current).toEqual({ state: "loading" });
  resolve({ actions: [] });
  await waitFor(() => expect(hook.result.current).toBeNull());
});

test("ActionToasts and pending escrow share one initial fetch and one poll per 15 seconds", async () => {
  jest.useFakeTimers({ now: NOW });
  const isServer = environmentManager.isServer();
  environmentManager.setIsServer(() => false);
  const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  let calls = 0;
  const fetchOperations = async () => { calls++; return { actions: [action] }; };
  try {
    const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, fetchOperations), {
      wrapper: ({ children }) => <>{children}<ActionToasts session={session} regionId="US" fetchOperations={fetchOperations} /></>,
    });
    await act(async () => { jest.advanceTimersByTime(0); });
    await act(async () => { jest.advanceTimersByTime(0); });
    expect(calls).toBe(1);
    expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false });
    expect(getHomeQueryClient().getQueryCache().findAll({ queryKey: pendingCashoutKey })).toHaveLength(1);
    const estimate = hook.result.current;
    for (let interval = 1; interval <= 3; interval++) {
      await act(async () => { jest.advanceTimersByTime(15_000); });
      await act(async () => { jest.advanceTimersByTime(0); });
      expect(calls).toBe(interval + 1);
      expect(hook.result.current).toBe(estimate);
    }
  } finally {
    cleanup();
    environmentManager.setIsServer(() => isServer);
    if (visibility) Object.defineProperty(document, "visibilityState", visibility);
    else Reflect.deleteProperty(document, "visibilityState");
  }
});

test("a later shared observer read recovers a failed snapshot binding", async () => {
  getHomeQueryClient().setQueryData(pendingCashoutKey, cachedActions([action]));
  const hook = renderHook(() => usePendingCashoutEscrow(session, snapshot, async () => { throw new Error("Actions unavailable"); }));
  await waitFor(() => expect(hook.result.current).toEqual({ state: "unreadable" }));
  const beforeRead = getRecentActionsReadSequence();
  await act(async () => {
    await getHomeQueryClient().fetchQuery({ ...recentActionsQuery({ owner: activityOwnerKey(session), session,
      fetchOperations: async () => ({ actions: [action] }) }), staleTime: 0 });
  });
  expect(getRecentActionsReadSequence()).toBeGreaterThan(beforeRead);
  await waitFor(() => expect(hook.result.current).toEqual({ state: "escrow", baseUnits: "50000000", partial: false }));
});

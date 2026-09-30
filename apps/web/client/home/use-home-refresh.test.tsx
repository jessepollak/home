import "@/client/account/dom-test-harness";

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { getHomeQueryClient, ownerQueryKey, publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { useActivity } from "@/client/activity/use-activity";
import { usePendingCashoutEscrow } from "@/client/balances/pending-cashout";
import { buildBalancesSnapshotFixture } from "@/shared/balances/fixtures";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { invalidateAfterAction, nextActivityWindowEnd } from "@/client/query/after-action";
import type { ActivityPage, ActivityTransfer, FetchActivity } from "@/client/activity/types";
import { ACTIVITY_CONTRACT_VERSION, type ActivityResponse } from "@/shared/activity/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { homeRefreshScopes, useHomeRefresh } = await import("./use-home-refresh");
const walletA = "0x1111111111111111111111111111111111111111" as const;
const walletB = "0x2222222222222222222222222222222222222222" as const;
const other = "0x3333333333333333333333333333333333333333" as const;
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
beforeEach(() => setSystemTime(new Date(NOW)));

function session(subject: string, address: typeof walletA | typeof walletB): VerifiedAccountSession {
  return { user: { subject }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" };
}

function transfer(wallet: typeof walletA | typeof walletB, block: number, time: number): ActivityTransfer {
  const hash = `0x${block.toString(16).padStart(64, "0")}` as `0x${string}`;
  return {
    id: `8453:${token}:event-${block}`, logId: `event-${block}`, chainId: 8453, assetId: "usdc",
    tokenAddress: token, tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null,
    walletAddress: wallet, fromAddress: other, toAddress: wallet, direction: "incoming",
    amountBaseUnits: `${block}`, blockNumber: `${block}`, blockHash: hash, transactionHash: hash,
    logIndex: "1", blockTimestamp: new Date(time).toISOString(),
    valuation: { status: "unpriced", currency: "USD", reason: "unknown-token" },
  };
}

function page(query: string, wallet: typeof walletA | typeof walletB, rows: ActivityTransfer[], cursor: string | null): ActivityResponse {
  const to = new URLSearchParams(query).get("to")!;
  return {
    version: ACTIVITY_CONTRACT_VERSION, walletAddress: wallet, chainId: 8453,
    window: { from: new Date(Date.parse(to) - 31 * 24 * 60 * 60 * 1000).toISOString(), to },
    currency: (new URLSearchParams(query).get("currency") ?? "USD") as ActivityPage["currency"],
    transfers: rows, nextCursor: cursor,
    source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

type HarnessProps = {
  owner: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  reads: Record<"balances" | "actions" | "vaults" | "borrow", (signal: AbortSignal) => Promise<string>> & { borrowMarket?: (signal: AbortSignal) => Promise<string> };
  capture: (hook: ReturnType<typeof useHomeRefresh>) => void;
  regionId?: RegionId;
  enabled?: boolean;
  manageActions?: boolean;
};

function Harness({ owner, fetchActivity, reads, capture, regionId = "GLOBAL", enabled = true, manageActions = true }: HarnessProps) {
  const key = owner?.smartAccount ? dataOwnerKey(owner) : null;
  const activity = useActivity(owner, fetchActivity, regionId);
  const balances = useHomeQuery({ queryKey: ownerQueryKey(key ?? "unauthenticated", "balances", regionId),
    enabled: !!key, queryFn: ({ signal }) => reads.balances(signal) });
  useHomeQuery({ queryKey: publicQueryKey("savings-vaults"), queryFn: ({ signal }) => reads.vaults(signal) });
  useHomeQuery({ queryKey: ownerQueryKey(key ?? "unauthenticated", "borrow", "overview"),
    enabled: !!key, queryFn: ({ signal }) => reads.borrow(signal) });
  useHomeQuery({ queryKey: ownerQueryKey(key ?? "unauthenticated", "borrow-market", "market-1"),
    enabled: !!key && !!reads.borrowMarket, queryFn: ({ signal }) => reads.borrowMarket ? reads.borrowMarket(signal) : Promise.reject(new Error("No market read")) });
  const refresh = useHomeRefresh({ session: owner, regionId, fetchActivity, enabled });
  useEffect(() => capture(refresh));
  return <div>
    <output data-testid="refresh">{refresh.state.phase}</output>
    <output data-testid="activity">{activity.status === "ready" ? activity.page.transfers.map((row) => row.logId).join(",") : activity.status}</output>
    <output data-testid="cursor">{activity.status === "ready" ? activity.page.nextCursor ?? "end" : "missing"}</output>
    <output data-testid="balance">{balances.data ?? "missing"}</output>
    {manageActions ? <ActionsProbe ownerKey={key} read={reads.actions} /> : null}
    {activity.status === "ready" ? <>
      <button type="button" onClick={() => activity.setSentinelVisible(true)}>load more</button>
      <button type="button" onClick={() => activity.setSentinelVisible(false)}>stop loading</button>
    </> : null}
  </div>;
}

function ActionsProbe({ ownerKey, read }: { ownerKey: string | null; read: HarnessProps["reads"]["actions"] }) {
  const actions = useHomeQuery({
    queryKey: ownerQueryKey(ownerKey ?? "unauthenticated", "actions"),
    enabled: !!ownerKey,
    queryFn: ({ signal }) => read(signal),
  });
  return <output data-testid="actions">{actions.data ?? actions.status}</output>;
}

function ForeignCashoutHistory({ owner, onRead }: { owner: VerifiedAccountSession; onRead: () => Promise<string> }) {
  const cashout = useHomeQuery({
    queryKey: ownerQueryKey(dataOwnerKey(owner), "actions"),
    queryFn: onRead,
  });
  return <output data-testid="foreign-cashout">{cashout.data ?? "missing"}</output>;
}

function PendingCashoutEstimateProbe({ owner, snapshot, fetchOperations }: {
  owner: VerifiedAccountSession;
  snapshot: BalancesSnapshot;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
}) {
  const estimate = usePendingCashoutEscrow(owner, snapshot, fetchOperations);
  return <output data-testid="cashout-estimate">{JSON.stringify(estimate)}</output>;
}

function fixture() {
  const owner = session("subject-a", walletA);
  const key = dataOwnerKey(owner);
  const oldEnd = new Date(NOW - 120_000).toISOString();
  getHomeQueryClient().setQueryData(ownerQueryKey(key, "activity-window"), oldEnd);
  const calls = { balances: 0, actions: 0, vaults: 0, borrow: 0, activity: [] as string[] };
  const reads = {
    balances: async () => `balances-${++calls.balances}`,
    actions: async () => `actions-${++calls.actions}`,
    vaults: async () => `vaults-${++calls.vaults}`,
    borrow: async () => `borrow-${++calls.borrow}`,
  };
  const fetchActivity: FetchActivity = async (query) => {
    calls.activity.push(query);
    const to = new URLSearchParams(query).get("to")!;
    const cursor = new URLSearchParams(query).get("cursor");
    const newest = to !== oldEnd;
    const oldRow = transfer(walletA, 30, Date.parse(oldEnd) - 30_000);
    return cursor
      ? page(query, walletA, [oldRow, transfer(walletA, 20, Date.parse(oldEnd) - 60_000)], newest ? "next-cursor" : null)
      : page(query, walletA, newest
        ? [transfer(walletA, 40, Date.parse(oldEnd) + 30_000), oldRow]
        : [oldRow], newest ? "new-cursor" : "old-first");
  };
  let latest!: ReturnType<typeof useHomeRefresh>;
  const capture = (hook: ReturnType<typeof useHomeRefresh>) => { latest = hook; };
  return { owner, key, oldEnd, calls, reads, fetchActivity, capture, current: () => latest };
}

function movingWindowFixture(newPage: (query: string) => ActivityResponse) {
  const f = fixture();
  const second = deferred<ActivityResponse>();
  const fetchActivity: FetchActivity = async (query) => {
    f.calls.activity.push(query);
    const params = new URLSearchParams(query);
    if (params.get("to") !== f.oldEnd) return newPage(query);
    if (params.get("cursor") === "old-second") return second.promise;
    return page(query, walletA, [
      transfer(walletA, 50, Date.parse(f.oldEnd) - 30_000),
      transfer(walletA, 40, Date.parse(f.oldEnd) - 40_000),
    ], "old-second");
  };
  return { ...f, fetchActivity, second };
}

async function loadTwoFullPages(view: ReturnType<typeof render>, f: ReturnType<typeof movingWindowFixture>) {
  await waitFor(() => expect(view.getByTestId("activity").textContent).toBe("event-50,event-40"));
  act(() => view.getByText("load more").click());
  await waitFor(() => expect(f.calls.activity).toHaveLength(2));
  act(() => view.getByText("stop loading").click());
  await act(async () => {
    f.second.resolve(page(f.calls.activity[1]!, walletA, [
      transfer(walletA, 30, Date.parse(f.oldEnd) - 50_000),
      transfer(walletA, 20, Date.parse(f.oldEnd) - 60_000),
    ], "old-after20"));
    await f.second.promise;
  });
  await waitFor(() => expect(view.getByTestId("activity").textContent).toBe("event-50,event-40,event-30,event-20"));
  expect(view.getByTestId("cursor").textContent).toBe("old-after20");
}

async function ready(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.getByTestId("activity").textContent).toContain("event-30"));
  await waitFor(() => expect(view.getByTestId("balance").textContent).toBe("balances-1"));
}

afterEach(() => {
  setSystemTime();
  cleanup();
  getHomeQueryClient().clear();
});

describe("useHomeRefresh", () => {
  test.each(["success", "failure"] as const)("a pull waits for its coalesced controller read after an after-action read: %s", async (outcome) => {
    const f = fixture();
    const afterAction = deferred<ActivityResponse>();
    const pull = deferred<ActivityResponse>();
    const fetchActivity: FetchActivity = async (query) => {
      f.calls.activity.push(query);
      if (f.calls.activity.length === 2) return afterAction.promise;
      if (f.calls.activity.length === 3) {
        const response = await pull.promise;
        if (outcome === "failure") throw new Error("Latest activity unavailable");
        return response;
      }
      return page(query, walletA, [transfer(walletA, 30, Date.parse(f.oldEnd) - 30_000)], null);
    };
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={fetchActivity} capture={f.capture} />);
    await ready(view);
    await act(async () => { await invalidateAfterAction(getHomeQueryClient(), f.key); });
    expect(f.calls.activity).toHaveLength(2);
    setSystemTime(new Date(NOW + 2_000));
    const pullStart = NOW + 2_000;
    let settled = false;
    let pending!: ReturnType<ReturnType<typeof useHomeRefresh>["refresh"]>;
    act(() => {
      pending = f.current().refresh();
      void pending.then(() => { settled = true; });
    });
    expect(f.calls.activity).toHaveLength(2);
    expect(settled).toBe(false);
    await act(async () => {
      afterAction.resolve(page(f.calls.activity[1]!, walletA, [transfer(walletA, 40, NOW - 30_000)], null));
    });
    await waitFor(() => expect(f.calls.activity).toHaveLength(3));
    await waitFor(() => expect(view.getByTestId("activity").textContent).toBe("event-40"));
    expect(settled).toBe(false);
    expect(view.getByTestId("refresh").textContent).toBe("refreshing");
    const finalEnd = new URLSearchParams(f.calls.activity[2]).get("to")!;
    expect(Date.parse(finalEnd)).toBeGreaterThanOrEqual(pullStart);
    await act(async () => {
      pull.resolve(page(f.calls.activity[2]!, walletA, [transfer(walletA, 50, NOW + 1_000)], null));
      expect(await pending).toEqual(outcome === "success" ? { phase: "complete" } : { phase: "partial", failed: ["activity"] });
    });
    await waitFor(() => expect(view.getByTestId("activity").textContent).toBe(outcome === "success" ? "event-50" : "event-40"));
    expect(getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window"))).toBe(
      outcome === "success" ? finalEnd : new URLSearchParams(f.calls.activity[1]).get("to")!,
    );
  });

  test("refresh fetches every advertised scope without touching inactive or foreign market detail", async () => {
    const f = fixture();
    const client = getHomeQueryClient();
    const inactiveKey = ownerQueryKey(f.key, "borrow-market", "market-2");
    const foreignKey = ownerQueryKey(dataOwnerKey(session("subject-b", walletB)), "borrow-market", "market-1");
    client.setQueryData(inactiveKey, "inactive-detail");
    client.setQueryData(foreignKey, "foreign-detail");
    let marketReads = 0;
    const view = render(<Harness owner={f.owner} reads={{ ...f.reads, borrowMarket: async () => `detail-${++marketReads}` }}
      fetchActivity={f.fetchActivity} capture={f.capture} />);
    await ready(view);
    await waitFor(() => expect(marketReads).toBe(1));
    const fetchedScopes = new Set<unknown>();
    const unsubscribe = getHomeQueryClient().getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "fetch") fetchedScopes.add(event.query.queryKey[1]);
    });
    try {
      await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    } finally {
      unsubscribe();
    }
    expect(fetchedScopes).toEqual(new Set(homeRefreshScopes));
    expect(marketReads).toBe(2);
    expect(client.getQueryData<string>(ownerQueryKey(f.key, "borrow-market", "market-1"))).toBe("detail-2");
    expect(client.getQueryData<string>(inactiveKey)).toBe("inactive-detail");
    expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(false);
    expect(client.getQueryData<string>(foreignKey)).toBe("foreign-detail");
    expect(client.getQueryState(foreignKey)?.isInvalidated).toBe(false);
  });

  test("a Home pull recovers an unreadable pending-cashout estimate", async () => {
    const f = fixture();
    const snapshot = buildBalancesSnapshotFixture();
    const action = {
      id: "cashout-a", provider: "cdp-embedded", kind: "cash-out", status: "confirmed", createdAt: "2026-09-15T12:00:00Z",
      confirmedAt: "2026-09-15T12:00:00Z", owner: { subject: f.owner.user.subject, address: snapshot.owner.address,
        chainId: 8453, accountProvider: f.owner.accountProvider },
      summary: { title: "Cash out", amounts: [], warnings: [], expiresAt: "" },
      cashout: { version: 1, providerId: "peer", region: "US", depositId: "escrow-1", depositBlockNumber: snapshot.block.number, progressConfirmed: true,
        state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000", filledAtomic: "0",
        returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, withdrawing: false, etaSeconds: 1800,
        settledAt: null, updatedAt: "2026-09-15T12:00:00Z" },
    };
    let unavailable = true;
    const fetchOperations = async () => {
      if (unavailable) throw new Error("Cash-out history unavailable");
      return { actions: [action] };
    };
    const view = render(<><Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} manageActions={false} />
      <PendingCashoutEstimateProbe owner={f.owner} snapshot={snapshot} fetchOperations={fetchOperations} /></>);
    await ready(view);
    await waitFor(() => expect(view.getByTestId("cashout-estimate").textContent).toBe('{"state":"unreadable"}'));
    unavailable = false;
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    await waitFor(() => expect(view.getByTestId("cashout-estimate").textContent).toBe('{"state":"escrow","baseUnits":"50000000","partial":false}'));
  });

  test("Home pull refreshes the shared pending-cashout actions cache exactly once", async () => {
    const f = fixture();
    const key = ownerQueryKey(f.key, "actions");
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await ready(view);
    await waitFor(() => expect(view.getByTestId("actions").textContent).toBe("actions-1"));
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    expect(f.calls.actions).toBe(2);
    expect(getHomeQueryClient().getQueryData<string>(key)).toBe("actions-2");
    expect(getHomeQueryClient().getQueryState(key)?.isInvalidated).toBe(false);
  });

  test("a Home pull joins an active shared actions read instead of starting another", async () => {
    const f = fixture();
    const key = ownerQueryKey(f.key, "actions");
    const inFlight = deferred<string>();
    const reads = { ...f.reads, actions: () => ++f.calls.actions === 1 ? Promise.resolve("funded-stale") : inFlight.promise };
    const view = render(<Harness owner={f.owner} reads={reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await ready(view);
    act(() => { void getHomeQueryClient().refetchQueries({ queryKey: key }); });
    await waitFor(() => expect(f.calls.actions).toBe(2));
    let pull!: Promise<unknown>;
    act(() => { pull = f.current().refresh(); });
    expect(f.calls.actions).toBe(2);
    await act(async () => { inFlight.resolve("funded-fresh"); expect(await pull).toEqual({ phase: "complete" }); });
    expect(getHomeQueryClient().getQueryData<string>(key)).toBe("funded-fresh");
    expect(f.calls.actions).toBe(2);
  });

  test("a failed shared actions refresh reports partial and retains cached history", async () => {
    const f = fixture();
    const key = ownerQueryKey(f.key, "actions");
    const reads = { ...f.reads, actions: async () => {
      if (++f.calls.actions > 1) throw new Error("Actions unavailable");
      return "funded-cached";
    } };
    const view = render(<Harness owner={f.owner} reads={reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await ready(view);
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "partial", failed: ["actions"] }); });
    expect(getHomeQueryClient().getQueryState(key)?.status).toBe("error");
    expect(getHomeQueryClient().getQueryData<string>(key)).toBe("funded-cached");
    expect(f.calls.actions).toBe(2);
  });

  test("refresh invalidates inactive shared actions history only for the current owner", async () => {
    const f = fixture();
    const client = getHomeQueryClient();
    const ownerB = session("subject-b", walletB);
    const staleKey = ownerQueryKey(f.key, "actions");
    const foreignKey = ownerQueryKey(dataOwnerKey(ownerB), "actions");
    client.setQueryData(staleKey, "inactive-stale");
    client.setQueryData(foreignKey, "foreign-stale");
    let foreignReads = 0;
    const view = render(<><Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} manageActions={false} />
      <ForeignCashoutHistory owner={ownerB} onRead={async () => `foreign-${++foreignReads}`} /></>);
    await ready(view);
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    expect(client.getQueryData<string>(staleKey)).toBe("inactive-stale");
    expect(client.getQueryState(staleKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(foreignKey)?.isInvalidated).toBe(false);
    expect(client.getQueryData<string>(foreignKey)).toBe("foreign-stale");
    expect(foreignReads).toBe(0);
    expect(f.calls.actions).toBe(0);
    view.rerender(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await waitFor(() => expect(view.getByTestId("actions").textContent).toBe("actions-1"));
  });

  test("Home pull cancels inactive in-flight shared actions history and leaves it stale", async () => {
    const f = fixture();
    const client = getHomeQueryClient();
    const key = ownerQueryKey(f.key, "actions");
    client.setQueryData(key, "funded-stale");
    const inFlight = deferred<string>();
    let signal: AbortSignal | undefined;
    const read = client.fetchQuery({ queryKey: key, staleTime: 0, queryFn: (context) => { signal = context.signal; return inFlight.promise; } }).catch(() => undefined);
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} manageActions={false} />);
    await ready(view);
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    expect(signal?.aborted).toBe(true);
    await act(async () => { inFlight.resolve("funded-late"); await read; });
    expect(client.getQueryData<string>(key)).toBe("funded-stale");
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  test("an interleaved owner switch cannot refresh the new owner's shared actions history with the old cycle", async () => {
    const f = fixture();
    const client = getHomeQueryClient();
    const ownerB = session("subject-b", walletB);
    const keyB = ownerQueryKey(dataOwnerKey(ownerB), "actions");
    const pending = deferred<string>();
    const readsA = { ...f.reads, actions: () => ++f.calls.actions === 1 ? Promise.resolve("a-home") : pending.promise };
    let bReads = 0;
    const readsB = { ...f.reads, actions: async () => `b-${++bReads}` };
    const fetchB: FetchActivity = async (query) => page(query, walletB, [], null);
    const view = render(<Harness owner={f.owner} reads={readsA} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await ready(view);
    client.setQueryData(keyB, "b-cached");
    let oldCycle!: Promise<unknown>;
    act(() => { oldCycle = f.current().refresh(); });
    await waitFor(() => expect(f.calls.actions).toBe(2));
    view.rerender(<Harness owner={ownerB} reads={readsB} fetchActivity={fetchB} capture={f.capture} />);
    expect(view.getByTestId("refresh").textContent).toBe("idle");
    expect(client.getQueryState(keyB)?.isInvalidated).toBe(false);
    expect(bReads).toBe(0);
    await act(async () => { pending.resolve("a-late"); expect(await oldCycle).toEqual({ phase: "superseded" }); });
    expect(client.getQueryData<string>(keyB)).toBe("b-cached");
    expect(client.getQueryState(keyB)?.isInvalidated).toBe(false);
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    expect(client.getQueryData<string>(keyB)).toBe("b-1");
    expect(bReads).toBe(1);
  });

  test("issues every active read, coalesces a cycle, and preserves two pages without a loading transition", async () => {
    const f = fixture();
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await ready(view);
    act(() => view.getByText("load more").click());
    await waitFor(() => expect(f.calls.activity).toHaveLength(2));
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"));
    const observed: string[] = [];
    const observer = new MutationObserver(() => observed.push(view.getByTestId("activity").textContent ?? ""));
    observer.observe(view.container, { subtree: true, childList: true, characterData: true });
    await act(async () => {
      const first = f.current().refresh();
      const second = f.current().refresh();
      expect(second).toBe(first);
      expect(await first).toEqual({ phase: "complete" });
    });
    observer.disconnect();
    expect(f.calls).toEqual({ balances: 2, actions: 2, vaults: 2, borrow: 2, activity: expect.any(Array) });
    expect(f.calls.activity.map((query) => [new URLSearchParams(query).get("to") === f.oldEnd ? "old" : "new", new URLSearchParams(query).get("cursor")])).toEqual([
      ["old", null], ["old", "old-first"], ["new", null], ["new", "new-cursor"],
    ]);
    const newEnd = getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window"));
    expect(newEnd).not.toBe(f.oldEnd);
    const data = getHomeQueryClient().getQueryData<{ pages: ActivityPage[]; pageParams: unknown[] }>(ownerQueryKey(f.key, "activity", newEnd, "USD"));
    expect(data?.pages).toHaveLength(2);
    expect(data?.pageParams).toEqual([null, "new-cursor"]);
    expect(view.getByTestId("activity").textContent).toBe("event-40,event-30,event-20");
    expect(view.getByTestId("cursor").textContent).toBe("next-cursor");
    expect(observed).not.toContain("loading");
    expect(view.getByTestId("refresh").textContent).toBe("complete");
    act(() => f.current().dismiss());
    expect(view.getByTestId("refresh").textContent).toBe("idle");
  });

  test("refresh extends beyond the old page count to retain every loaded transfer", async () => {
    const f = movingWindowFixture((query) => {
      const cursor = new URLSearchParams(query).get("cursor");
      const index = cursor ? Number(cursor.slice("new-".length)) : 0;
      const rows = [[80, 70], [60, 50], [50, 40], [30, 20]][index]!;
      return page(query, walletA, rows.map((block) => transfer(walletA, block,
        Date.parse(f.oldEnd) + (block > 50 ? 30_000 : -block * 1_000))),
      index === 3 ? "new-after20" : `new-${index + 1}`);
    });
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await loadTwoFullPages(view, f);
    const oldData = getHomeQueryClient().getQueryData<{ pages: ActivityPage[] }>(ownerQueryKey(f.key, "activity", f.oldEnd, "USD"));
    expect(oldData?.pages).toHaveLength(2);
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    const end = getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window"));
    expect(end).not.toBe(f.oldEnd);
    const data = getHomeQueryClient().getQueryData<{ pages: ActivityPage[]; pageParams: unknown[] }>(ownerQueryKey(f.key, "activity", end, "USD"));
    expect(data?.pages).toHaveLength(4);
    expect(data?.pageParams).toEqual([null, "new-1", "new-2", "new-3"]);
    expect(f.calls.activity.map((query) => new URLSearchParams(query).get("cursor"))).toEqual([
      null, "old-second", null, "new-1", "new-2", "new-3",
    ]);
    const ids = view.getByTestId("activity").textContent!.split(",");
    expect(ids).toEqual(["event-80", "event-70", "event-60", "event-50", "event-40", "event-30", "event-20"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(view.getByTestId("cursor").textContent).toBe("new-after20");
  });

  test("refresh fails at the extra-page bound without replacing the old window or cursor", async () => {
    const f = movingWindowFixture((query) => {
      const cursor = new URLSearchParams(query).get("cursor");
      const index = cursor ? Number(cursor.slice("new-".length)) : 0;
      const blocks = [100 - index * 2, 99 - index * 2];
      return page(query, walletA, blocks.map((block) => transfer(walletA, block, Date.parse(f.oldEnd) + 30_000)), `new-${index + 1}`);
    });
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await loadTwoFullPages(view, f);
    const oldData = getHomeQueryClient().getQueryData<{ pages: ActivityPage[]; pageParams: unknown[] }>(ownerQueryKey(f.key, "activity", f.oldEnd, "USD"));
    let outcome: unknown;
    await act(async () => { outcome = await f.current().refresh(); });
    expect(outcome).toEqual({ phase: "partial", failed: ["activity"] });
    expect(f.calls.activity).toHaveLength(14);
    const nextEnd = new URLSearchParams(f.calls.activity[2]!).get("to");
    expect(getHomeQueryClient().getQueryData(ownerQueryKey(f.key, "activity", nextEnd, "USD"))).toBeUndefined();
    expect(getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window"))).toBe(f.oldEnd);
    expect(getHomeQueryClient().getQueryData<{ pages: ActivityPage[]; pageParams: unknown[] }>(ownerQueryKey(f.key, "activity", f.oldEnd, "USD"))).toBe(oldData);
    expect(view.getByTestId("activity").textContent).toBe("event-50,event-40,event-30,event-20");
    expect(view.getByTestId("cursor").textContent).toBe("old-after20");
  });

  test("one failed source returns partial while other reads update and failed data remains", async () => {
    const f = fixture();
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await ready(view);
    const reads = { ...f.reads, balances: async () => { f.calls.balances++; throw new Error("offline"); } };
    view.rerender(<Harness owner={f.owner} reads={reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    let outcome: unknown;
    await act(async () => { outcome = await f.current().refresh(); });
    expect(outcome).toEqual({ phase: "partial", failed: ["balances"] });
    expect(view.getByTestId("refresh").textContent).toBe("partial");
    expect(view.getByTestId("balance").textContent).toBe("balances-1");
    expect(f.calls).toMatchObject({ balances: 2, actions: 2, vaults: 2, borrow: 2 });
    expect(f.calls.activity).toHaveLength(2);
  });

  test("failed activity prefetch keeps the old window, both pages and cursor", async () => {
    const f = fixture();
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    await ready(view);
    act(() => view.getByText("load more").click());
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"));
    const oldData = getHomeQueryClient().getQueryData(ownerQueryKey(f.key, "activity", f.oldEnd, "USD"));
    const failing: FetchActivity = async (query, signal) => {
      if (new URLSearchParams(query).get("to") !== f.oldEnd) throw new Error("activity offline");
      return f.fetchActivity(query, signal);
    };
    view.rerender(<Harness owner={f.owner} reads={f.reads} fetchActivity={failing} capture={f.capture} />);
    let outcome: unknown;
    await act(async () => { outcome = await f.current().refresh(); });
    expect(outcome).toEqual({ phase: "partial", failed: ["activity"] });
    expect(getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window")) === f.oldEnd).toBe(true);
    expect(getHomeQueryClient().getQueryData(ownerQueryKey(f.key, "activity", f.oldEnd, "USD")) === oldData).toBe(true);
    expect(view.getByTestId("activity").textContent).toBe("event-30,event-20");
    expect(view.getByTestId("cursor").textContent).toBe("end");
  });

  test("retains a known valuation from the old window when the fresh quote is unavailable", async () => {
    const f = fixture();
    const fetchActivity: FetchActivity = async (query, signal) => {
      const response = await f.fetchActivity(query, signal) as ActivityResponse;
      const row = response.transfers.find((entry) => entry.logId === "event-30");
      if (row) row.valuation = new URLSearchParams(query).get("to") === f.oldEnd
        ? { status: "priced", currency: "USD", amount: computeActivityValuationAmount({ amountBaseUnits: row.amountBaseUnits, tokenDecimals: 6, unitPrice: null, fxRate: null }), method: "peg", peg: "USD", close: null, fx: null }
        : { status: "unpriced", currency: "USD", reason: "quote-unavailable" };
      return response;
    };
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={fetchActivity} capture={f.capture} />);
    await ready(view);
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    const end = getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window"));
    const data = getHomeQueryClient().getQueryData<{ pages: ActivityPage[] }>(ownerQueryKey(f.key, "activity", end, "USD"));
    expect(data?.pages[0]?.transfers.find((row) => row.logId === "event-30")?.valuation.status).toBe("priced");
  });

  test("an activity error without data refreshes into a fresh window that includes newer transfers", async () => {
    const f = fixture();
    let failFirst = true;
    const fetchActivity: FetchActivity = (query, signal) => {
      if (failFirst) { failFirst = false; return Promise.reject(new Error("offline")); }
      return f.fetchActivity(query, signal);
    };
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={fetchActivity} capture={f.capture} />);
    await waitFor(() => expect(view.getByTestId("activity").textContent).toBe("error"));
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "complete" }); });
    expect(view.getByTestId("activity").textContent).toBe("event-40,event-30");
    expect(view.getByTestId("cursor").textContent).toBe("new-cursor");
    expect(f.calls.activity.map((query) => new URLSearchParams(query).get("to") === f.oldEnd ? "old" : "new")).toEqual(["new"]);
    expect(getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window"))).not.toBe(f.oldEnd);
  });

  test("a failed fresh window after an initial activity error keeps the old window and reports failure", async () => {
    const f = fixture();
    const fetchActivity: FetchActivity = () => Promise.reject(new Error("offline"));
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={fetchActivity} capture={f.capture} />);
    await waitFor(() => expect(view.getByTestId("activity").textContent).toBe("error"));
    await act(async () => { expect(await f.current().refresh()).toEqual({ phase: "partial", failed: ["activity"] }); });
    expect(view.getByTestId("activity").textContent).toBe("error");
    expect(getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window"))).toBe(f.oldEnd);
  });

  test("owner change cancels controller prefetch and supersedes the previous cycle", async () => {
    const f = fixture();
    const pending = deferred<unknown>();
    let oldSignal: AbortSignal | undefined;
    const fetchActivity: FetchActivity = (query, signal) => {
      if (new URLSearchParams(query).get("to") !== f.oldEnd) {
        oldSignal = signal;
        return pending.promise;
      }
      return f.fetchActivity(query, signal);
    };
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={fetchActivity} capture={f.capture} />);
    await ready(view);
    let oldCycle!: Promise<unknown>;
    act(() => { oldCycle = f.current().refresh(); });
    await waitFor(() => expect(oldSignal).toBeDefined());
    const ownerB = session("subject-b", walletB);
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(ownerB), "activity-window"), "1900-01-01T00:00:00.000Z");
    const fetchB: FetchActivity = async (query) => page(query, walletB, [], null);
    view.rerender(<Harness owner={ownerB} reads={f.reads} fetchActivity={fetchB} capture={f.capture} />);
    await waitFor(() => expect(view.getByTestId("activity").textContent).toBe(""));
    expect(view.getByTestId("refresh").textContent).toBe("idle");
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { pending.resolve(page(`to=${encodeURIComponent(new Date(NOW).toISOString())}&currency=USD`, walletA, [], null)); expect(await oldCycle).toEqual({ phase: "superseded" }); });
    expect(Date.parse(getHomeQueryClient().getQueryData<string>(ownerQueryKey(f.key, "activity-window"))!)).toBeGreaterThan(Date.parse(f.oldEnd));
    expect(view.getByTestId("refresh").textContent).toBe("idle");
  });

  test("disabled or unverified sessions do not request refresh sources", async () => {
    const f = fixture();
    const view = render(<Harness owner={f.owner} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} enabled={false} />);
    await ready(view);
    expect(await f.current().refresh()).toEqual({ phase: "superseded" });
    expect(f.calls.activity).toHaveLength(1);
    view.rerender(<Harness owner={null} reads={f.reads} fetchActivity={f.fetchActivity} capture={f.capture} />);
    expect(await f.current().refresh()).toEqual({ phase: "superseded" });
    expect(view.getByTestId("refresh").textContent).toBe("idle");
  });

  test("next activity end is pure and monotonic within the same minute", () => {
    const end = "2026-09-12T12:00:00.000Z";
    expect(nextActivityWindowEnd(end, Date.parse(end))).toBe("2026-09-12T12:00:00.001Z");
    expect(nextActivityWindowEnd(undefined, Date.parse(end) + 12_345)).toBe(end);
    expect(nextActivityWindowEnd(end, Date.parse(end) + 12_345)).toBe("2026-09-12T12:00:12.345Z");
  });
});

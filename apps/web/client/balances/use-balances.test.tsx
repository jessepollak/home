import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { timeoutManager } from "@tanstack/react-query";
import {
  clearOwnerQueryBoundary,
  getHomeQueryClient,
  ownerQueryKey,
  shouldPersistOwnerQuery,
} from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { invalidateAfterAction, type BalanceActionMarker } from "@/client/query/after-action";
import { balancesSnapshotFixture, borrowPosition, buildBalancesSnapshotFixture, FIXTURE_FETCHED_AT, priced } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { FetchBalances } from "@/shared/balances/types";
import type { RegionId } from "@/config/regions";
import {
  nextStaleRefetchDelay,
  useBalances,
  useBalancesData,
  type RecoverableBalancesState,
} from "./use-balances";

const session = {
  subject: "subject-a",
  smartAccountAddress: balancesSnapshotFixture.owner.address,
  chainId: 8453 as const,
};
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const ACTION_AT = Date.parse(FIXTURE_FETCHED_AT) + 1;
const freshBalancesSnapshotFixture = { ...balancesSnapshotFixture, fetchedAt: new Date(ACTION_AT + 1).toISOString() };
beforeEach(() => setSystemTime(new Date(NOW)));

function ActionStaleHarness({ fetchBalances, onState, owner = session, dataOnly = false, held = false, region = "US" }: {
  fetchBalances: FetchBalances;
  onState: (state: { status: string; actionStale?: true; refreshError?: true; retry: () => Promise<void> }) => void;
  owner?: typeof session;
  dataOnly?: boolean;
  held?: boolean;
  region?: RegionId;
}) {
  const recoverable = useBalances(owner, region, fetchBalances, { enabled: !dataOnly, held, paintCachedWhileHeld: held });
  const data = useBalancesData(owner, region, fetchBalances, { enabled: dataOnly, held });
  const state = dataOnly ? data : recoverable;
  onState(state);
  return <output aria-label={region}>{state.status}:{state.actionStale === true ? "action-stale" : "current"}</output>;
}

function Harness({ fetchBalances }: { fetchBalances: FetchBalances }) {
  const state = useBalances(session, "US", fetchBalances);
  return <output>{state.status === "ready" ? `${state.snapshot.region}:${state.snapshot.holdings.filter((holding) => holding.source === "catalog").length}` : state.status}</output>;
}

function ProvisionalHarness({ fetchBalances, provisional }: {
  fetchBalances: FetchBalances;
  provisional: boolean;
}) {
  const state = useBalances(session, "US", fetchBalances, { provisional });
  return <output>{state.status === "ready"
    ? `${state.snapshot.fetchedAt}:${state.refreshError === true ? "refresh-error" : "ready"}`
    : state.status}</output>;
}

function HeldHarness({ fetchBalances, held, paintCachedWhileHeld = false, region = "US", owner = session }: {
  fetchBalances: FetchBalances;
  held: boolean;
  paintCachedWhileHeld?: boolean;
  region?: RegionId;
  owner?: typeof session;
}) {
  const state = useBalances(owner, region, fetchBalances, { held, paintCachedWhileHeld });
  return <output data-failure-eligible={state.observation.failureEligible}>{state.status === "ready"
    ? `ready:${state.snapshot.region}:${state.snapshot.fetchedAt}:${state.revalidating === true ? "revalidating" : "settled"}:${state.observation.hasData ? "observed" : "missing"}`
    : state.status}</output>;
}

function RegionHarness({ region, fetchBalances }: { region: RegionId; fetchBalances: FetchBalances }) {
  const state = useBalances(session, region, fetchBalances);
  return <output>{state.status === "ready" ? state.snapshot.region : state.status}</output>;
}

function RetryHarness({ fetchBalances }: { fetchBalances: FetchBalances }) {
  const state = useBalances(session, "US", fetchBalances);
  return (
    <>
      <output>{state.status === "ready"
        ? `${state.snapshot.fetchedAt}:${state.snapshot.stale === true ? "stale" : "current"}:${state.refreshError === true ? "refresh-error" : "current"}`
        : state.status}</output>
      <span data-status-label="">{presentBalances(state, { showSmallBalances: false }).statusLabel}</span>
      <button type="button" onClick={() => void state.retry()}>retry balances</button>
    </>
  );
}

function BorrowHarness({ fetchBalances }: { fetchBalances: FetchBalances }) {
  const state = useBalances(session, "US", fetchBalances);
  const borrow = presentBalances(state, { showSmallBalances: false }).summary?.borrow;
  return <output>{state.status}:{state.revalidating === true ? "revalidating" : "settled"}:{borrow?.kind === "position" ? borrow.value : borrow?.kind}</output>;
}

function IdentityHarness({
  fetchBalances,
  revision,
  onState,
}: {
  fetchBalances: FetchBalances;
  revision: number;
  onState: (state: RecoverableBalancesState) => void;
}) {
  const state = useBalances(session, "US", fetchBalances);
  onState(state);
  return <output>{state.status}:{revision}</output>;
}

afterEach(() => {
  setSystemTime();
  cleanup();
  getHomeQueryClient().clear();
});

describe("useBalances", () => {
  for (const dataOnly of [false, true]) {
    test(`post-action failed refresh retains the snapshot with an action marker, then clears on successful retry (dataOnly=${dataOnly})`, async () => {
      const key = ownerQueryKey(dataOwnerKey(session), "balances", "US");
      getHomeQueryClient().setQueryData(key, balancesSnapshotFixture, { updatedAt: NOW - 1000 });
      let fail = true;
      let state!: Parameters<Parameters<typeof ActionStaleHarness>[0]["onState"]>[0];
      const view = render(<ActionStaleHarness dataOnly={dataOnly} onState={(value) => { state = value; }} fetchBalances={async () => {
        if (fail) throw new Error("refresh unavailable");
        return freshBalancesSnapshotFixture;
      }} />);
      expect(state.actionStale).toBeUndefined();
      await act(async () => { await invalidateAfterAction(getHomeQueryClient(), dataOwnerKey(session), NOW); });
      await waitFor(() => expect(state.refreshError).toBe(true));
      expect(view.getByRole("status").textContent).toBe("ready:action-stale");
      expect(state.actionStale).toBe(true);
      fail = false;
      setSystemTime(new Date(NOW + 100));
      await act(async () => { await state.retry(); });
      await waitFor(() => expect(state.actionStale).toBeUndefined());
      expect(view.getByRole("status").textContent).toBe("ready:current");
    });
  }

  for (const dataOnly of [false, true]) {
    test(`a fresh US read does not clear a failed GB region's action qualification (dataOnly=${dataOnly})`, async () => {
      const client = getHomeQueryClient();
      const owner = dataOwnerKey(session);
      const markerKey = ownerQueryKey(owner, "balances-action");
      client.setQueryData(ownerQueryKey(owner, "balances", "US"), balancesSnapshotFixture, { updatedAt: NOW - 1000 });
      client.setQueryData(ownerQueryKey(owner, "balances", "GB"), buildBalancesSnapshotFixture({ region: "GB" }), { updatedAt: NOW - 1000 });
      let finish!: (snapshot: typeof balancesSnapshotFixture) => void;
      const deferred = new Promise<typeof balancesSnapshotFixture>((resolve) => { finish = resolve; });
      const fetchBalances: FetchBalances = async (region) => {
        if (region === "GB") throw new Error("GB refresh unavailable");
        return deferred;
      };
      let us!: Parameters<Parameters<typeof ActionStaleHarness>[0]["onState"]>[0];
      let gb!: Parameters<Parameters<typeof ActionStaleHarness>[0]["onState"]>[0];
      const view = render(<>
        <ActionStaleHarness dataOnly={dataOnly} onState={(state) => { us = state; }} fetchBalances={fetchBalances} />
        <ActionStaleHarness dataOnly={dataOnly} region="GB" onState={(state) => { gb = state; }} fetchBalances={fetchBalances} />
      </>);
      let invalidation!: Promise<void>;
      act(() => { invalidation = invalidateAfterAction(client, owner, NOW); });
      await waitFor(() => expect(gb.refreshError).toBe(true));
      expect(us.actionStale).toBe(true);
      expect(gb.actionStale).toBe(true);
      setSystemTime(new Date(NOW + 100));
      await act(async () => { finish(freshBalancesSnapshotFixture); await invalidation; });
      await waitFor(() => expect(us.actionStale).toBeUndefined());
      expect(gb.actionStale).toBe(true);
      expect(gb.refreshError).toBe(true);
      expect(view.getByLabelText("US").textContent).toBe("ready:current");
      expect(view.getByLabelText("GB").textContent).toBe("ready:action-stale");
      expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: ACTION_AT, fresh: { US: true } });
    });

    test(`a cached success at the action boundary is not proof of freshness (dataOnly=${dataOnly})`, async () => {
      const client = getHomeQueryClient();
      const owner = dataOwnerKey(session);
      const markerKey = ownerQueryKey(owner, "balances-action");
      const queryKey = ownerQueryKey(owner, "balances", "US");
      client.setQueryData(queryKey, balancesSnapshotFixture, { updatedAt: NOW });
      let snapshot = { ...balancesSnapshotFixture, fetchedAt: new Date(ACTION_AT).toISOString() };
      let state!: Parameters<Parameters<typeof ActionStaleHarness>[0]["onState"]>[0];
      render(<ActionStaleHarness dataOnly={dataOnly} onState={(value) => { state = value; }} fetchBalances={async () => snapshot} />);
      await act(async () => { await invalidateAfterAction(client, owner, NOW); });
      expect(client.getQueryState(queryKey)?.status).toBe("success");
      expect(client.getQueryState(queryKey)?.dataUpdatedAt).toBe(NOW);
      expect(state.actionStale).toBe(true);
      expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: ACTION_AT, fresh: {} });
      snapshot = freshBalancesSnapshotFixture;
      setSystemTime(new Date(NOW + 100));
      await act(async () => { await state.retry(); });
      await waitFor(() => expect(state.actionStale).toBeUndefined());
      expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: ACTION_AT, fresh: { US: true } });
    });
  }

  for (const existingMarker of [false, true]) {
    test(`the action marker survives scheduled GC while refreshes fail (existingMarker=${existingMarker})`, async () => {
      const client = getHomeQueryClient();
      const defaults = client.getDefaultOptions();
      client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, gcTime: 300_000 } });
      const scheduledGc = new Map<ReturnType<typeof timeoutManager.setTimeout>, () => void>();
      const setTimer = timeoutManager.setTimeout.bind(timeoutManager);
      const clearTimer = timeoutManager.clearTimeout.bind(timeoutManager);
      const setTimerSpy = spyOn(timeoutManager, "setTimeout").mockImplementation((callback, delay) => {
        const timer = setTimer(callback, delay);
        if (delay === 300_000) scheduledGc.set(timer, () => callback(undefined));
        return timer;
      });
      const clearTimerSpy = spyOn(timeoutManager, "clearTimeout").mockImplementation((timer) => {
        if (timer !== undefined) scheduledGc.delete(timer);
        clearTimer(timer);
      });
      try {
        const owner = dataOwnerKey(session);
        const markerKey = ownerQueryKey(owner, "balances-action");
        client.setQueryData(ownerQueryKey(owner, "balances", "US"), balancesSnapshotFixture, { updatedAt: NOW - 1000 });
        if (existingMarker) client.setQueryData<BalanceActionMarker>(markerKey, { at: ACTION_AT - 500, fresh: {} });
        let state!: Parameters<Parameters<typeof ActionStaleHarness>[0]["onState"]>[0];
        const view = render(<ActionStaleHarness onState={(value) => { state = value; }} fetchBalances={async () => { throw new Error("refresh unavailable"); }} />);
        await act(async () => { await invalidateAfterAction(client, owner, NOW); });
        await waitFor(() => expect(state.refreshError).toBe(true));
        expect(scheduledGc.size).toBeGreaterThan(0);
        setSystemTime(new Date(NOW + 300_001));
        act(() => { for (const callback of [...scheduledGc.values()]) callback(); });
        expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: ACTION_AT, fresh: {} });
        expect(state.refreshError).toBe(true);
        expect(view.getByRole("status").textContent).toBe("ready:action-stale");
        act(() => { clearOwnerQueryBoundary(client, undefined, "another-owner"); });
        expect(client.getQueryData(markerKey)).toBeUndefined();
      } finally {
        client.clear();
        client.setDefaultOptions(defaults);
        setTimerSpy.mockRestore();
        clearTimerSpy.mockRestore();
      }
    });
  }

  for (const dataOnly of [false, true]) {
    test(`a stale successful fallback keeps the action marker until a fresh read, then routine stale reads stay unmarked (dataOnly=${dataOnly})`, async () => {
      const client = getHomeQueryClient();
      const owner = dataOwnerKey(session);
      const markerKey = ownerQueryKey(owner, "balances-action");
      client.setQueryData(ownerQueryKey(owner, "balances", "US"), balancesSnapshotFixture, { updatedAt: NOW - 1000 });
      let stale = true;
      let reads = 0;
      let state!: Parameters<Parameters<typeof ActionStaleHarness>[0]["onState"]>[0];
      const view = render(<ActionStaleHarness dataOnly={dataOnly} onState={(value) => { state = value; }} fetchBalances={async () => {
        reads += 1;
        return stale ? { ...freshBalancesSnapshotFixture, stale: true } : freshBalancesSnapshotFixture;
      }} />);
      setSystemTime(new Date(NOW + 100));
      await act(async () => { await invalidateAfterAction(client, owner, NOW); });
      await waitFor(() => expect(reads).toBe(1));
      expect(state.actionStale).toBe(true);
      expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: ACTION_AT, fresh: {} });
      expect(view.getByRole("status").textContent).toBe("ready:action-stale");
      stale = false;
      await act(async () => { await state.retry(); });
      await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: ACTION_AT, fresh: { US: true } }));
      expect(state.actionStale).toBeUndefined();
      stale = true;
      await act(async () => { await state.retry(); });
      expect(reads).toBe(3);
      expect(state.actionStale).toBeUndefined();
      expect(view.getByRole("status").textContent).toBe("ready:current");
    });
  }

  test("a late inactive balances response started before the action cannot clear its marker", async () => {
    const client = getHomeQueryClient();
    const owner = dataOwnerKey(session);
    const queryKey = ownerQueryKey(owner, "balances", "US");
    const markerKey = ownerQueryKey(owner, "balances-action");
    client.setQueryData(queryKey, balancesSnapshotFixture, { updatedAt: NOW - 1000 });
    const view = render(<ActionStaleHarness held onState={() => {}} fetchBalances={async () => { throw new Error("held snapshot must not fetch"); }} />);
    let finish!: (snapshot: typeof balancesSnapshotFixture) => void;
    const deferred = new Promise<typeof balancesSnapshotFixture>((resolve) => { finish = resolve; });
    let readSignal!: AbortSignal;
    const read = client.fetchQuery({ queryKey, staleTime: 0, queryFn: ({ signal }) => {
      readSignal = signal;
      return deferred;
    } });
    expect(client.getQueryState(queryKey)?.fetchStatus).toBe("fetching");
    await act(async () => { await invalidateAfterAction(client, owner, NOW); });
    expect(readSignal.aborted).toBe(true);
    expect(await read).toEqual(balancesSnapshotFixture);
    expect(view.getByRole("status").textContent).toBe("ready:action-stale");
    setSystemTime(new Date(NOW + 100));
    await act(async () => { finish(balancesSnapshotFixture); await deferred; });
    expect(client.getQueryState(queryKey)?.dataUpdatedAt).toBe(NOW - 1000);
    expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: ACTION_AT, fresh: {} });
    expect(view.getByRole("status").textContent).toBe("ready:action-stale");
  });

  test("a routine failed refresh without an action marker stays ready without actionStale", async () => {
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(session), "balances", "US"), balancesSnapshotFixture, { updatedAt: NOW - 1000 });
    let state!: Parameters<Parameters<typeof ActionStaleHarness>[0]["onState"]>[0];
    render(<ActionStaleHarness onState={(value) => { state = value; }} fetchBalances={async () => { throw new Error("routine failure"); }} />);
    await act(async () => { await state.retry(); });
    await waitFor(() => expect(state.refreshError).toBe(true));
    expect(state.status).toBe("ready");
    expect(state.actionStale).toBeUndefined();
  });

  test("held snapshots react to an owner marker and another owner does not inherit it", async () => {
    const ownerB = { ...session, subject: "subject-b" };
    const client = getHomeQueryClient();
    client.setQueryData(ownerQueryKey(dataOwnerKey(session), "balances", "US"), balancesSnapshotFixture, { updatedAt: NOW - 1000 });
    client.setQueryData(ownerQueryKey(dataOwnerKey(ownerB), "balances", "US"), { ...balancesSnapshotFixture, owner: { ...balancesSnapshotFixture.owner, subject: "subject-b" } }, { updatedAt: NOW - 1000 });
    const fetchBalances = async () => { throw new Error("held snapshots must not fetch"); };
    const onState = () => {};
    const view = render(<ActionStaleHarness held onState={onState} fetchBalances={fetchBalances} />);
    act(() => { client.setQueryData<BalanceActionMarker>(ownerQueryKey(dataOwnerKey(session), "balances-action"), { at: ACTION_AT, fresh: {} }); });
    expect(view.getByRole("status").textContent).toBe("ready:action-stale");
    view.rerender(<ActionStaleHarness held owner={ownerB} onState={onState} fetchBalances={fetchBalances} />);
    expect(view.getByRole("status").textContent).toBe("ready:current");
  });

  test("a successful fetchQuery refresh keeps actionStale for an unchanged snapshot and clears it for a newer snapshot", async () => {
    const client = getHomeQueryClient();
    const queryKey = ownerQueryKey(dataOwnerKey(session), "balances", "US");
    client.setQueryData(queryKey, balancesSnapshotFixture, { updatedAt: NOW - 1000 });
    client.setQueryData<BalanceActionMarker>(ownerQueryKey(dataOwnerKey(session), "balances-action"), { at: ACTION_AT, fresh: {} });
    const view = render(<ActionStaleHarness dataOnly onState={() => {}} fetchBalances={async () => balancesSnapshotFixture} />);
    expect(view.getByRole("status").textContent).toBe("ready:action-stale");
    setSystemTime(new Date(NOW + 100));
    await act(async () => { await client.fetchQuery({ queryKey, staleTime: 0, queryFn: async () => balancesSnapshotFixture }); });
    expect(view.getByRole("status").textContent).toBe("ready:action-stale");
    expect(client.getQueryData<BalanceActionMarker>(ownerQueryKey(dataOwnerKey(session), "balances-action"))).toEqual({ at: ACTION_AT, fresh: {} });
    await act(async () => { await client.fetchQuery({ queryKey, staleTime: 0, queryFn: async () => freshBalancesSnapshotFixture }); });
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("ready:current"));
    expect(client.getQueryData<BalanceActionMarker>(ownerQueryKey(dataOwnerKey(session), "balances-action"))).toEqual({ at: ACTION_AT, fresh: { US: true } });
  });

  test("a money-action invalidation keeps the Borrow position during refetch and shows the new position afterward", async () => {
    const position = borrowPosition({
      collateralBaseUnits: "100000", collateralValue: priced("USD", "5000"),
      debtBaseUnits: "30010000", debtValue: priced("USD", "3001"),
    });
    const first = buildBalancesSnapshotFixture({ borrow: { coverage: "complete", positions: [position] } });
    const second = buildBalancesSnapshotFixture({
      fetchedAt: "2026-09-13T12:00:30.000Z",
      borrow: { coverage: "complete", positions: [{
        ...position, debt: { ...position.debt, balance: { status: "ready", baseUnits: "40010000" }, value: priced("USD", "4001") },
      }] },
    });
    let calls = 0;
    let finish!: (snapshot: typeof first) => void;
    const fetchBalances: FetchBalances = () => {
      calls += 1;
      return calls === 1 ? Promise.resolve(first) : new Promise((resolve) => { finish = resolve; });
    };
    const view = render(<BorrowHarness fetchBalances={fetchBalances} />);
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("ready:settled:$30.01"));

    const ownerKey = dataOwnerKey(session);
    act(() => { void getHomeQueryClient().invalidateQueries({ queryKey: ownerQueryKey(ownerKey, "balances") }); });
    await waitFor(() => expect(calls).toBe(2));
    expect(view.getByRole("status").textContent).toBe("ready:revalidating:$30.01");
    await act(async () => { finish(second); });
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("ready:settled:$40.01"));
  });

  test("cached balances remain ready while a provisional refresh is pending", async () => {
    const ownerKey = dataOwnerKey(session);
    const key = ownerQueryKey(ownerKey, "balances", "US");
    getHomeQueryClient().setQueryData(key, balancesSnapshotFixture, {
      updatedAt: NOW - 60_000,
    });
    let reads = 0;
    const view = render(<ProvisionalHarness provisional fetchBalances={() => {
      reads += 1;
      return new Promise(() => {});
    }} />);
    await waitFor(() => expect(reads).toBe(1));
    expect(view.getByRole("status").textContent).toBe(`${balancesSnapshotFixture.fetchedAt}:ready`);
  });

  test("held balances paint exact-key cached data only when opted in, without a read", () => {
    const ownerKey = dataOwnerKey(session);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    let reads = 0;
    const fetchBalances: FetchBalances = async () => {
      reads += 1;
      return balancesSnapshotFixture;
    };
    const view = render(<HeldHarness held fetchBalances={fetchBalances} />);
    expect(view.getByRole("status").textContent).toBe("loading");
    view.rerender(<HeldHarness held paintCachedWhileHeld fetchBalances={fetchBalances} />);
    expect(view.getByRole("status").textContent).toBe(`ready:US:${balancesSnapshotFixture.fetchedAt}:revalidating:observed`);
    expect(view.getByRole("status").getAttribute("data-failure-eligible")).toBe("false");
    expect(reads).toBe(0);
  });

  test("held balances never paint another region's or owner's cached snapshot", () => {
    const ownerKey = dataOwnerKey(session);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "balances", "DE"), buildBalancesSnapshotFixture({ region: "DE" }));
    getHomeQueryClient().setQueryData(ownerQueryKey("different-owner", "balances", "US"), balancesSnapshotFixture);
    let reads = 0;
    const view = render(<HeldHarness held paintCachedWhileHeld fetchBalances={async () => {
      reads += 1;
      return balancesSnapshotFixture;
    }} />);
    expect(view.getByRole("status").textContent).toBe("loading");
    expect(reads).toBe(0);
  });

  test("release to the same region keeps cached data visible during one background fetch", async () => {
    const ownerKey = dataOwnerKey(session);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture, { updatedAt: NOW - 60_000 });
    let reads = 0;
    let finishRead!: (snapshot: typeof balancesSnapshotFixture) => void;
    const fetchBalances: FetchBalances = () => {
      reads += 1;
      return new Promise((resolve) => { finishRead = resolve; });
    };
    const view = render(<HeldHarness held paintCachedWhileHeld fetchBalances={fetchBalances} />);
    expect(view.getByRole("status").textContent).toBe(`ready:US:${balancesSnapshotFixture.fetchedAt}:revalidating:observed`);
    expect(reads).toBe(0);
    view.rerender(<HeldHarness held={false} paintCachedWhileHeld fetchBalances={fetchBalances} />);
    await waitFor(() => expect(reads).toBe(1));
    expect(view.getByRole("status").textContent).toBe(`ready:US:${balancesSnapshotFixture.fetchedAt}:revalidating:observed`);
    await act(async () => { finishRead(balancesSnapshotFixture); });
    await waitFor(() => expect(view.getByRole("status").textContent).toBe(`ready:US:${balancesSnapshotFixture.fetchedAt}:settled:observed`));
    expect(reads).toBe(1);
  });

  test("release to a different region does not use the held region as placeholder", async () => {
    const ownerKey = dataOwnerKey(session);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    let reads = 0;
    let finishRead!: (snapshot: typeof balancesSnapshotFixture) => void;
    const fetchBalances: FetchBalances = () => {
      reads += 1;
      return new Promise((resolve) => { finishRead = resolve; });
    };
    const view = render(<HeldHarness held paintCachedWhileHeld fetchBalances={fetchBalances} />);
    expect(view.getByRole("status").textContent).toContain("ready:US:");
    view.rerender(<HeldHarness held={false} paintCachedWhileHeld region="DE" fetchBalances={fetchBalances} />);
    expect(view.getByRole("status").textContent).toBe("loading");
    await waitFor(() => expect(reads).toBe(1));
    await act(async () => { finishRead(buildBalancesSnapshotFixture({ region: "DE" })); });
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("ready:DE:"));
  });
  test("keeps visible region balances during an ordinary country switch", async () => {
    const ownerKey = dataOwnerKey(session);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    let finishRead!: (snapshot: typeof balancesSnapshotFixture) => void;
    const pendingRead = new Promise<typeof balancesSnapshotFixture>((resolve) => { finishRead = resolve; });
    const fetchBalances: FetchBalances = async (region) => region === "DE"
      ? pendingRead
      : balancesSnapshotFixture;
    const view = render(<RegionHarness region="US" fetchBalances={fetchBalances} />);
    expect(view.getByRole("status").textContent).toBe("US");

    view.rerender(<RegionHarness region="DE" fetchBalances={fetchBalances} />);
    expect(view.getByRole("status").textContent).toBe("US");

    await act(async () => { finishRead(buildBalancesSnapshotFixture({ region: "DE" })); });
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("DE"));
  });

  test("a cached provisional failure stays ready without an error before verification refetches", async () => {
    const ownerKey = dataOwnerKey(session);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture, {
      updatedAt: NOW - 60_000,
    });
    let reads = 0;
    const fetchBalances: FetchBalances = async () => {
      reads += 1;
      if (reads === 1) throw new Error("unauthorized");
      return balancesSnapshotFixture;
    };
    const view = render(<ProvisionalHarness provisional fetchBalances={fetchBalances} />);
    await waitFor(() => expect(reads).toBe(1));
    expect(view.getByRole("status").textContent).toBe(`${balancesSnapshotFixture.fetchedAt}:ready`);
    view.rerender(<ProvisionalHarness provisional={false} fetchBalances={fetchBalances} />);
    await waitFor(() => expect(reads).toBe(2));
    expect(view.getByRole("status").textContent).toBe(`${balancesSnapshotFixture.fetchedAt}:ready`);
  });

  test("a failed provisional read remains loading until verification refetch succeeds", async () => {
    let reads = 0;
    const fetchBalances: FetchBalances = async () => {
      reads += 1;
      if (reads === 1) throw new Error("unauthorized");
      return balancesSnapshotFixture;
    };
    const view = render(<ProvisionalHarness provisional fetchBalances={fetchBalances} />);
    await waitFor(() => expect(reads).toBe(1));
    expect(view.getByRole("status").textContent).toBe("loading");
    await act(async () => {
      view.rerender(<ProvisionalHarness provisional={false} fetchBalances={fetchBalances} />);
    });
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(view.getByRole("status").textContent).toBe(`${balancesSnapshotFixture.fetchedAt}:ready`));
  });

  test("a provisional read that fails after verification triggers a verified refetch", async () => {
    let reads = 0;
    let rejectFirst: (error: Error) => void = () => {};
    const fetchBalances: FetchBalances = () => {
      reads += 1;
      if (reads === 1) {
        return new Promise((_, reject) => {
          rejectFirst = reject;
        });
      }
      return Promise.resolve(balancesSnapshotFixture);
    };
    const view = render(<ProvisionalHarness provisional fetchBalances={fetchBalances} />);
    await waitFor(() => expect(reads).toBe(1));
    await act(async () => {
      view.rerender(<ProvisionalHarness provisional={false} fetchBalances={fetchBalances} />);
    });
    expect(reads).toBe(1);
    expect(view.getByRole("status").textContent).toBe("loading");
    await act(async () => {
      rejectFirst(new Error("unauthorized"));
    });
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(view.getByRole("status").textContent).toBe(`${balancesSnapshotFixture.fetchedAt}:ready`));
  });

  test("a failed provisional read refetches only once when verification enables the query", async () => {
    let reads = 0;
    const fetchBalances: FetchBalances = async () => {
      reads += 1;
      if (reads === 1) throw new Error("unauthorized");
      return balancesSnapshotFixture;
    };
    const view = render(<ProvisionalHarness provisional fetchBalances={fetchBalances} />);
    await waitFor(() => expect(reads).toBe(1));
    await act(async () => {
      view.rerender(<ProvisionalHarness provisional={false} fetchBalances={fetchBalances} />);
    });
    await waitFor(() => expect(view.getByRole("status").textContent).toBe(`${balancesSnapshotFixture.fetchedAt}:ready`));
    expect(reads).toBe(2);
  });

  test("bounds completed stale refetches and ignores interval recomputation", () => {
    const polling = { identity: "", dataUpdatedAt: 0, completedRefetches: 0 };
    const stale = { ...balancesSnapshotFixture, stale: true as const };
    expect(nextStaleRefetchDelay(polling, stale, "owner-a", 100)).toBe(3_000);
    expect(nextStaleRefetchDelay(polling, stale, "owner-a", 100)).toBe(3_000);
    for (const dataUpdatedAt of [101, 102, 103]) {
      expect(nextStaleRefetchDelay(polling, stale, "owner-a", dataUpdatedAt)).toBe(3_000);
      expect(nextStaleRefetchDelay(polling, stale, "owner-a", dataUpdatedAt)).toBe(3_000);
    }
    expect(nextStaleRefetchDelay(polling, stale, "owner-a", 104)).toBeFalse();
    expect(nextStaleRefetchDelay(polling, stale, "owner-a", 105)).toBeFalse();
    expect(nextStaleRefetchDelay(polling, stale, "owner-b", 109)).toBe(3_000);
    expect(nextStaleRefetchDelay(polling, { ...stale, fetchedAt: "2026-09-13T12:00:30.000Z" }, "owner-b", 109))
      .toBe(3_000);
    expect(nextStaleRefetchDelay(polling, balancesSnapshotFixture, "owner-b", 110)).toBeFalse();
    expect(nextStaleRefetchDelay(polling, stale, "owner-b", 110)).toBe(3_000);
  });
  test("uses the owner balances key and persists the whole snapshot", async () => {
    render(<Harness fetchBalances={async () => balancesSnapshotFixture} />);
    await waitFor(() => expect(document.body.textContent).toBe("US:3"));

    const ownerKey = dataOwnerKey(session);
    const query = getHomeQueryClient().getQueryCache().find({
      queryKey: ownerQueryKey(ownerKey, "balances", "US"),
    });
    expect(query?.meta).toEqual({ persistence: "owner", ownerKey });
    expect(query && shouldPersistOwnerQuery(query, ownerKey)).toBe(true);
    expect((query?.state.data as typeof balancesSnapshotFixture).holdings.filter((holding) => holding.source === "catalog")).toHaveLength(3);
  });

  test("keeps the returned state identity stable across unrelated rerenders", async () => {
    const states: RecoverableBalancesState[] = [];
    const fetchBalances = async () => balancesSnapshotFixture;
    const view = render(
      <IdentityHarness
        fetchBalances={fetchBalances}
        revision={0}
        onState={(state) => states.push(state)}
      />,
    );
    await waitFor(() => expect(states.at(-1)?.status).toBe("ready"));
    const readyState = states.at(-1);

    view.rerender(
      <IdentityHarness
        fetchBalances={fetchBalances}
        revision={1}
        onState={(state) => states.push(state)}
      />,
    );

    expect(states.at(-1)).toBe(readyState);
  });

  test("retains the last verified snapshot quietly after a refresh error, then recovers on manual retry", async () => {
    let calls = 0;
    const fetchBalances: FetchBalances = async () => {
      calls += 1;
      if (calls === 2) throw new Error("temporary failure");
      return balancesSnapshotFixture;
    };
    const view = render(<RetryHarness fetchBalances={fetchBalances} />);
    await waitFor(() => expect(view.getByText(/:current:current$/)).toBeTruthy());

    view.getByRole("button", { name: "retry balances" }).click();
    await waitFor(() => expect(view.getByText(/:stale:refresh-error$/)).toBeTruthy());
    expect(view.getByText(/:stale:refresh-error$/).textContent).toContain(
      balancesSnapshotFixture.fetchedAt,
    );
    expect(view.container.querySelector("[data-status-label]")?.textContent).toBe("Some balances are unavailable");
    expect(document.body.textContent).not.toContain("Updated");
    expect(document.body.textContent).not.toContain("ago");

    view.getByRole("button", { name: "retry balances" }).click();
    await waitFor(() => expect(view.getByText(/:current:current$/)).toBeTruthy());
    expect(calls).toBe(3);
  });

  test("two retries while one balances request is in flight issue only one GET", async () => {
    let calls = 0;
    let finish: ((value: typeof balancesSnapshotFixture) => void) | undefined;
    const fetchBalances: FetchBalances = () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(balancesSnapshotFixture);
      return new Promise((resolve) => { finish = resolve; });
    };
    const view = render(<RetryHarness fetchBalances={fetchBalances} />);
    await waitFor(() => expect(view.getByText(/:current:current$/)).toBeTruthy());
    view.getByRole("button", { name: "retry balances" }).click();
    await waitFor(() => expect(calls).toBe(2));
    view.getByRole("button", { name: "retry balances" }).click();
    expect(calls).toBe(2);
    finish?.(balancesSnapshotFixture);
    await waitFor(() => expect(view.getByText(/:current:current$/)).toBeTruthy());
  });

  test("fails closed when the response scope does not match the verified owner", async () => {
    const mismatched = {
      ...balancesSnapshotFixture,
      owner: { ...balancesSnapshotFixture.owner, address: "0x2222222222222222222222222222222222222222" as const },
    };
    render(<Harness fetchBalances={async () => mismatched} />);
    await waitFor(() => expect(document.body.textContent).toBe("error"));
  });
});

test("failed refresh status updates preserve the stale snapshot until data changes", async () => {
  let calls = 0;
  let rejectPending: (error: Error) => void = () => {};
  const fetchBalances = () => ++calls === 1 ? Promise.resolve(balancesSnapshotFixture)
    : calls === 2 ? Promise.reject(new Error("first failure"))
    : new Promise<never>((_resolve, reject) => { rejectPending = reject; });
  let current: RecoverableBalancesState;
  render(<IdentityHarness fetchBalances={fetchBalances} revision={0} onState={(state) => { current = state; }} />);
  await waitFor(() => expect(current.status).toBe("ready"));
  await act(async () => { await current.retry(); });
  await waitFor(() => expect(current.refreshError).toBe(true));
  const stale = current!.snapshot;
  expect(stale?.stale).toBe(true);
  act(() => { void current.retry(); });
  await waitFor(() => expect(current.revalidating).toBe(true));
  expect(current!.snapshot).toBe(stale);
  await act(async () => { rejectPending(new Error("second failure")); });
  await waitFor(() => expect(current.revalidating).not.toBe(true));
  expect(current!.snapshot).toBe(stale);
  const ownerKey = dataOwnerKey(session);
  act(() => { getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "balances", "US"), { ...balancesSnapshotFixture, fetchedAt: "2026-09-28T12:01:00.000Z" }); });
  await waitFor(() => expect(current.snapshot?.fetchedAt).toBe("2026-09-28T12:01:00.000Z"));
  expect(current!.snapshot).not.toBe(stale);
  expect(current!.refreshError).not.toBe(true);
});

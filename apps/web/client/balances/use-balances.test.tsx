import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  getHomeQueryClient,
  ownerQueryKey,
  shouldPersistOwnerQuery,
} from "@/client/query/query-client";
import { balancesSnapshotFixture, borrowPosition, buildBalancesSnapshotFixture, priced } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { FetchBalances } from "@/shared/balances/types";
import type { RegionId } from "@/config/regions";
import {
  nextStaleRefetchDelay,
  useBalances,
  type RecoverableBalancesState,
} from "./use-balances";

const session = {
  subject: "subject-a",
  smartAccountAddress: balancesSnapshotFixture.owner.address,
  chainId: 8453 as const,
};
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
beforeEach(() => setSystemTime(new Date(NOW)));

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

    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
    act(() => { void getHomeQueryClient().invalidateQueries({ queryKey: ownerQueryKey(ownerKey, "balances") }); });
    await waitFor(() => expect(calls).toBe(2));
    expect(view.getByRole("status").textContent).toBe("ready:revalidating:$30.01");
    await act(async () => { finish(second); });
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("ready:settled:$40.01"));
  });

  test("cached balances remain ready while a provisional refresh is pending", async () => {
    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
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
    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
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
    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
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
    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
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
    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
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
    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
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
    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
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

    const ownerKey = `${session.subject}\u0000${session.smartAccountAddress}\u00008453`;
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

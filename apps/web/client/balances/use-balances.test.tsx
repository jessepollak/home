import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  getHomeQueryClient,
  ownerQueryKey,
  shouldPersistOwnerQuery,
} from "@/client/query/query-client";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { FetchBalances } from "@/shared/balances/types";
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

function Harness({ fetchBalances }: { fetchBalances: FetchBalances }) {
  const state = useBalances(session, "US", fetchBalances);
  return <output>{state.status === "ready" ? `${state.snapshot.region}:${state.snapshot.holdings.filter((holding) => holding.source === "catalog").length}` : state.status}</output>;
}

function RetryHarness({ fetchBalances }: { fetchBalances: FetchBalances }) {
  const state = useBalances(session, "US", fetchBalances);
  return (
    <>
      <output>{state.status === "ready"
        ? `${state.snapshot.fetchedAt}:${state.snapshot.stale === true ? "stale" : "current"}:${state.refreshError === true ? "refresh-error" : "current"}`
        : state.status}</output>
      <span>{presentBalances(state, {
        showSmallBalances: false,
        nowMs: Date.parse("2026-09-13T12:03:00.000Z"),
      }).statusLabel}</span>
      <button type="button" onClick={() => void state.retry()}>retry balances</button>
    </>
  );
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
  cleanup();
  getHomeQueryClient().clear();
});

describe("useBalances", () => {
  test("bounds completed stale refetches and ignores interval recomputation", () => {
    const polling = { identity: "", dataUpdatedAt: 0, completedRefetches: 0 };
    const stale = { ...balancesSnapshotFixture, stale: true as const };
    expect(nextStaleRefetchDelay(polling, stale, "owner-a", 100))
      .toBe(3_000);
    expect(nextStaleRefetchDelay(polling, stale, "owner-a", 100))
      .toBe(3_000);
    for (const dataUpdatedAt of [101, 102, 103]) {
      expect(nextStaleRefetchDelay(polling, stale, "owner-a", dataUpdatedAt))
        .toBe(3_000);
    }
    expect(nextStaleRefetchDelay(polling, stale, "owner-a", 104)).toBeFalse();
    expect(nextStaleRefetchDelay(polling, stale, "owner-b", 104))
      .toBe(3_000);
    expect(nextStaleRefetchDelay(polling, balancesSnapshotFixture, "owner-b", 105))
      .toBeFalse();
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

  test("retains the last verified snapshot with an explicit refresh error and manual retry", async () => {
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
    expect(view.getByText(/Updated .* ago/).textContent).toContain("Updated");

    view.getByRole("button", { name: "retry balances" }).click();
    await waitFor(() => expect(view.getByText(/:current:current$/)).toBeTruthy());
    expect(calls).toBe(3);
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

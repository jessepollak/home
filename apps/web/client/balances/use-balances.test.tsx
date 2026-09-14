import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  getHomeQueryClient,
  ownerQueryKey,
  shouldPersistOwnerQuery,
} from "@/client/query/query-client";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import type { BalancesState, FetchBalances } from "@/shared/balances/types";
import { useBalances } from "./use-balances";

const session = {
  subject: "subject-a",
  smartAccountAddress: balancesSnapshotFixture.owner.address,
  chainId: 8453 as const,
};

function Harness({ fetchBalances }: { fetchBalances: FetchBalances }) {
  const state = useBalances(session, "US", fetchBalances);
  return <output>{state.status === "ready" ? `${state.snapshot.region}:${state.snapshot.holdings.filter((holding) => holding.source === "catalog").length}` : state.status}</output>;
}

function IdentityHarness({
  fetchBalances,
  revision,
  onState,
}: {
  fetchBalances: FetchBalances;
  revision: number;
  onState: (state: BalancesState & { revalidating?: true }) => void;
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
    const states: Array<BalancesState & { revalidating?: true }> = [];
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

  test("fails closed when the response scope does not match the verified owner", async () => {
    const mismatched = {
      ...balancesSnapshotFixture,
      owner: { ...balancesSnapshotFixture.owner, address: "0x2222222222222222222222222222222222222222" as const },
    };
    render(<Harness fetchBalances={async () => mismatched} />);
    await waitFor(() => expect(document.body.textContent).toBe("error"));
  });
});

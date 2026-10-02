import "@/client/account/dom-test-harness";
import { useLayoutEffect } from "react";
import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { balancesSnapshotFixture, buildBalancesSnapshotFixture } from "@/shared/balances/fixtures";
import type { BalancesSnapshot, FetchBalances } from "@/shared/balances/types";
import type { RegionId } from "@/config/regions";
import { useBalances, useBalancesData, type BalancesDataState, type RecoverableBalancesState } from "./use-balances";
import { useVaultPositions, VaultPositionsProvider } from "./vault-positions";
const owner = { subject: "subject-a", smartAccountAddress: balancesSnapshotFixture.owner.address, chainId: 8453 as const };
const unavailable: FetchBalances = async () => { throw new Error("offline"); };
afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test("two data subscribers skip fetch-only renders while the full observer shows retry and failure", async () => {
  const client = getHomeQueryClient();
  const key = ownerQueryKey(dataOwnerKey(owner), "balances", "US");
  client.setQueryData(key, balancesSnapshotFixture);
  let resolve!: (value: BalancesSnapshot) => void;
  let reject!: (reason: Error) => void;
  let fetches = 0;
  const fetchBalances: FetchBalances = () => { fetches++; return new Promise((yes, no) => { resolve = yes; reject = no; }); };
  let full!: RecoverableBalancesState;
  const observations: BalancesDataState[][] = [[], []];
  function Status() { const state = useBalances(owner, "US", fetchBalances); useLayoutEffect(() => { full = state; }); return <output>{state.revalidating ? "refreshing" : "settled"}</output>; }
  function Data({ index }: { index: number }) {
    const state = useBalancesData(owner, "US", fetchBalances);
    observations[index]!.push(state);
    return <span>{state.snapshot?.stale ? "stale" : "current"}</span>;
  }
  const view = render(<><Status /><Data index={0} /><Data index={1} /></>);
  const initial = observations.map((items) => items.length);
  act(() => { void full.retry(); void full.retry(); });
  await waitFor(() => expect(view.getByText("refreshing")).toBeTruthy());
  expect(fetches).toBe(1);
  expect(observations.map((items) => items.length)).toEqual(initial);
  await act(async () => { resolve(balancesSnapshotFixture); });
  await waitFor(() => expect(view.getByText("settled")).toBeTruthy());
  expect(observations.map((items) => items.length)).toEqual(initial);
  act(() => { void full.retry(); });
  await waitFor(() => expect(view.getByText("refreshing")).toBeTruthy());
  await act(async () => { reject(new Error("refresh failed")); });
  await waitFor(() => expect(view.getAllByText("stale")).toHaveLength(2));
  for (const items of observations) expect(items.at(-1)?.refreshError).toBe(true);
  act(() => { client.setQueryData(key, { ...balancesSnapshotFixture, fetchedAt: "2026-09-30T00:01:00.000Z" }); });
  await waitFor(() => expect(view.getAllByText("current")).toHaveLength(2));
  for (const items of observations) expect(items.at(-1)?.snapshot?.fetchedAt).toBe("2026-09-30T00:01:00.000Z");
});

test("data-only observers clear on owner replacement, held region, and sign-out", () => {
  getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(owner), "balances", "US"), balancesSnapshotFixture);
  let current!: BalancesDataState;
  function Data({ session = owner, region = "US", held = false }: { session?: typeof owner | null; region?: RegionId; held?: boolean }) {
    const state = useBalancesData(session, region, unavailable, { enabled: false, held });
    useLayoutEffect(() => { current = state; });
    return <output>{state.status}:{state.snapshot?.region ?? "none"}</output>;
  }
  const view = render(<Data />);
  expect(current.snapshot).toBe(balancesSnapshotFixture);
  view.rerender(<Data session={{ ...owner, subject: "replacement-owner" }} />);
  expect(current.snapshot).toBeNull();
  view.rerender(<Data />);
  expect(current.snapshot).toBe(balancesSnapshotFixture);
  view.rerender(<Data region="GB" held />);
  expect(current.snapshot).toBeNull();
  expect(current.status).toBe("loading");
  view.rerender(<Data session={null} />);
  expect(current.snapshot).toBeNull();
  expect(current.status).toBe("unavailable");
});

test("vault positions are derived once for simultaneous consumers and invalidated by holdings replacement", () => {
  const snapshot = buildBalancesSnapshotFixture();
  let scans = 0;
  const holding = snapshot.holdings[0]!;
  const kind = holding.kind;
  Object.defineProperty(holding, "kind", { get: () => { scans++; return kind; } });
  const results: Array<ReturnType<typeof useVaultPositions>> = [];
  function Consumer({ data }: { data: BalancesSnapshot }) {
    const positions = useVaultPositions(data); results.push(positions); return <output>{positions?.length}</output>;
  }
  function Surface({ data }: { data: BalancesSnapshot }) {
    return <VaultPositionsProvider snapshot={data}><Consumer data={data} /><Consumer data={data} /></VaultPositionsProvider>;
  }
  const view = render(<Surface data={snapshot} />);
  expect(scans).toBe(1);
  expect(results[0]).toBe(results[1]);
  view.rerender(<Surface data={{ ...snapshot, stale: true }} />);
  expect(scans).toBe(1);
  const before = results.at(-1);
  view.rerender(<Surface data={buildBalancesSnapshotFixture()} />);
  expect(results.at(-1)).not.toBe(before);
  expect(results.at(-1)).toBe(results.at(-2));
});

test("a mismatched shared snapshot falls back to the consumer's own owner and region", () => {
  const first = buildBalancesSnapshotFixture();
  const second = buildBalancesSnapshotFixture();
  second.owner = { ...second.owner, address: "0x9999999999999999999999999999999999999999" };
  second.region = "GB";
  second.holdings = [];
  let positions: ReturnType<typeof useVaultPositions>;
  function Consumer() { const selected = useVaultPositions(second); useLayoutEffect(() => { positions = selected; }); return <output>{selected?.length}</output>; }
  const view = render(<VaultPositionsProvider snapshot={first}><Consumer /></VaultPositionsProvider>);
  expect(view.getByText("0")).toBeTruthy();
  expect(positions!).toEqual([]);
});

test("a data-only subscriber recovers when a provisional request fails after verification", async () => {
  let reads = 0;
  let rejectFirst!: (error: Error) => void;
  const fetchBalances: FetchBalances = () => {
    reads++;
    return reads === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve(balancesSnapshotFixture);
  };
  function Provisional() { useBalances(owner, "US", fetchBalances, { provisional: true }); return null; }
  function Data() { const state = useBalancesData(owner, "US", fetchBalances); return <output>{state.status}</output>; }
  const view = render(<Provisional />);
  await waitFor(() => expect(reads).toBe(1));
  view.rerender(<><Provisional /><Data /></>);
  expect(view.getByText("loading")).toBeTruthy();
  await act(async () => { rejectFirst(new Error("provisional unauthorized")); });
  await waitFor(() => expect(view.getByText("ready")).toBeTruthy());
  expect(reads).toBe(2);
});

import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { dataOwnerKey } from "@/client/account/owner-keys";
import type { BalanceActionMarker } from "@/client/query/after-action";
import { clearOwnerQueryBoundary, getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { parseRecentActionsPayload, type RecentActionsPayload } from "@/shared/actions/contracts/list";
import { refetchIntervalFor } from "@/tests/helpers/query-interval";

const { act, cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { moneyResultOutcome, useMoneyActionOutcome } = await import("./money-action-outcome");

const action: PreparedMoneyAction = {
  id: "prepared-1", kind: "send", title: "Send", calls: [], amounts: [], warnings: [],
  owner: { subject: "subject", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  createdAt: "2026-09-23T00:00:00.000Z", expiresAt: "2099-09-23T00:00:00.000Z",
};
const row = { id: action.id, status: "pending", owner: action.owner, kind: action.kind,
  createdAt: action.createdAt, confirmedAt: action.createdAt,
  summary: { title: action.title, amounts: action.amounts, warnings: action.warnings, expiresAt: action.expiresAt } };
const parsed = (rows: unknown[]) => parseRecentActionsPayload({ actions: rows }, {
  user: { subject: action.owner.subject },
  smartAccount: { address: action.owner.address, chainId: action.owner.chainId },
  accountProvider: action.owner.accountProvider,
});
const ownerKey = dataOwnerKey({ subject: action.owner.subject, smartAccountAddress: action.owner.address, chainId: action.owner.chainId, accountProvider: action.owner.accountProvider });
const key = ownerQueryKey(ownerKey, "actions");
const observationKey = ownerQueryKey(ownerKey, "action-result-observation", action.id);

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("result outcome mapping", () => {
  for (const [submission, status, expected] of [
    ["submitted", "confirmed", "success"],
    ["ambiguous", "confirmed", "success"],
    ["submitted", "failed", "failed"],
    ["ambiguous", "failed", "failed"],
    ["submitted", "unknown", "unknown"],
    ["ambiguous", "unknown", "unknown"],
    ["submitted", "pending", "pending"],
    ["ambiguous", "pending", "unknown"],
    ["submitted", undefined, "pending"],
    ["ambiguous", undefined, "unknown"],
    ["failed", undefined, "failed"],
    ["failed", "confirmed", "failed"],
  ] as const) {
    test(`${submission} / ${status ?? "no row"} → ${expected}`, () => {
      expect(moneyResultOutcome({ submission, ...(status ? { row: { status } } : {}) })).toBe(expected);
    });
  }
});

test("matches both action id and the complete owner tuple, then adopts terminal status", async () => {
  const fetchOperations = async () => ({ actions: [
    { ...row, status: "confirmed", id: "other" },
    { ...row, status: "confirmed", owner: { ...action.owner, subject: "other" } },
    { ...row, status: "confirmed", owner: { ...action.owner, chainId: 1 } },
    { ...row, status: "confirmed", owner: { ...action.owner, accountProvider: "other" } },
    { ...row, status: "confirmed", owner: { ...action.owner, address: "0x2222222222222222222222222222222222222222" } },
  ] });
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations }));
  await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
  expect(result.current).toEqual({ outcome: "pending" });
  void act(() => getHomeQueryClient().setQueryData(key, {
    ...parsed([row]),
    operations: [...getHomeQueryClient().getQueryData<RecentActionsPayload>(key)!.operations, ...parsed([row]).operations],
  }));
  await waitFor(() => expect(result.current.row).toMatchObject({ id: row.id, status: row.status, owner: row.owner }));
  expect(result.current.outcome).toBe("pending");
  void act(() => getHomeQueryClient().setQueryData(key, parsed([{ ...row, status: "confirmed" }])));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
});

test.each(["confirmed", "failed"] as const)("a retained-only savings deposit resolves as %s and stops polling", async (status) => {
  const deposit = { ...action, kind: "savings-deposit" as const };
  const payload = (status: string) => ({ actions: [], retainedSavingsDeposits: [{ ...row, kind: deposit.kind, status }] });
  const { result } = renderHook(() => useMoneyActionOutcome({ action: deposit, submission: "submitted", fetchOperations: async () => payload("unknown") }));
  await waitFor(() => expect(result.current.row?.status).toBe("unknown"));
  expect(refetchIntervalFor(key)).toBe(5_000);
  const session = { user: { subject: action.owner.subject }, smartAccount: { address: action.owner.address, chainId: action.owner.chainId }, accountProvider: action.owner.accountProvider };
  void act(() => getHomeQueryClient().setQueryData(key, parseRecentActionsPayload(payload(status), session)));
  await waitFor(() => expect(result.current.outcome).toBe(status === "confirmed" ? "success" : "failed"));
  expect(result.current.row).toMatchObject({ id: deposit.id, status });
  expect(getHomeQueryClient().getQueryData<RecentActionsPayload>(key)?.operations).toEqual([]);
  expect(refetchIntervalFor(key)).toBe(false);
});

test("ambiguous submission stays unknown until the same owner's row is terminal", async () => {
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "ambiguous", fetchOperations: async () => ({ actions: [row] }) }));
  await waitFor(() => expect(result.current.row?.status).toBe("pending"));
  expect(result.current.outcome).toBe("unknown");
  void act(() => getHomeQueryClient().setQueryData(key, parsed([{ ...row, status: "failed" }])));
  await waitFor(() => expect(result.current.outcome).toBe("failed"));
});

test("typed pre-dispatch failure does not query actions", () => {
  let fetchCount = 0;
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "failed", fetchOperations: async () => { fetchCount++; return { actions: [] }; } }));
  expect(result.current).toEqual({ outcome: "failed" });
  expect(fetchCount).toBe(0);
});

test("a present correction wins, but a later list without the row retains the latest observation", async () => {
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [row] }) }));
  await waitFor(() => expect(result.current.outcome).toBe("pending"));
  void act(() => getHomeQueryClient().setQueryData(key, parsed([{ ...row, status: "confirmed" }])));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  void act(() => getHomeQueryClient().setQueryData(key, parsed([])));
  expect(result.current).toMatchObject({ outcome: "success", row: { status: "confirmed" } });
  void act(() => getHomeQueryClient().setQueryData(key, parsed([row])));
  await waitFor(() => expect(result.current.outcome).toBe("pending"));
  void act(() => getHomeQueryClient().setQueryData(key, parsed([])));
  expect(result.current).toMatchObject({ outcome: "pending", row: { status: "pending" } });
});

test("a failed refresh retains the last confirmed data", async () => {
  let fail = false;
  const fetchOperations = async () => {
    if (fail) throw new Error("unavailable");
    return { actions: [{ ...row, status: "confirmed" }] };
  };
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations }));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  fail = true;
  await act(async () => { await getHomeQueryClient().invalidateQueries({ queryKey: key }); });
  expect(getHomeQueryClient().getQueryState(key)?.status).toBe("error");
  expect(result.current.outcome).toBe("success");
});

test("an ambiguous submission without a row remains unknown, even with other owners' rows", async () => {
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "ambiguous", fetchOperations: async () => ({ actions: [{ ...row, status: "confirmed", owner: { ...row.owner, subject: "other" } }] }) }));
  await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
  expect(result.current).toEqual({ outcome: "unknown" });
});

test("a confirmed observation survives remount and an omitted row", async () => {
  const fetchOperations = async () => ({ actions: [{ ...row, status: "confirmed" }] });
  const first = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations }));
  await waitFor(() => expect(first.result.current.outcome).toBe("success"));
  await waitFor(() => expect(getHomeQueryClient().getQueryData(observationKey)).toMatchObject({ status: "confirmed" }));
  first.unmount();
  getHomeQueryClient().setQueryData(key, parsed([]));
  const second = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations }));
  expect(second.result.current.outcome).toBe("success");
});

test("the owner boundary clears observations and another owner cannot inherit one", async () => {
  const fetchOperations = async () => ({ actions: [{ ...row, status: "confirmed" }] });
  const otherAction = { ...action, owner: { ...action.owner, subject: "new-subject" } };
  const hook = renderHook(({ currentAction }: { currentAction: PreparedMoneyAction }) => useMoneyActionOutcome({ action: currentAction, submission: "submitted", fetchOperations }), { initialProps: { currentAction: action } });
  await waitFor(() => expect(hook.result.current.outcome).toBe("success"));
  hook.rerender({ currentAction: otherAction });
  expect(hook.result.current.outcome).toBe("pending");
  void act(() => clearOwnerQueryBoundary(getHomeQueryClient(), undefined, dataOwnerKey({ subject: otherAction.owner.subject, smartAccountAddress: otherAction.owner.address, chainId: otherAction.owner.chainId, accountProvider: otherAction.owner.accountProvider })));
  expect(getHomeQueryClient().getQueryData(observationKey)).toBeUndefined();
});

test("another action id on the same owner cannot inherit the confirmed row", async () => {
  const hook = renderHook(({ currentAction }: { currentAction: PreparedMoneyAction }) => useMoneyActionOutcome({ action: currentAction, submission: "submitted", fetchOperations: async () => ({ actions: [{ ...row, status: "confirmed" }] }) }), { initialProps: { currentAction: action } });
  await waitFor(() => expect(hook.result.current.outcome).toBe("success"));
  hook.rerender({ currentAction: { ...action, id: "prepared-2" } });
  expect(hook.result.current.outcome).toBe("pending");
  expect(hook.result.current.row).toBeUndefined();
});

test("clearing the current owner's cache removes the retained result", async () => {
  const hook = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [{ ...row, status: "confirmed" }] }) }));
  await waitFor(() => expect(hook.result.current.outcome).toBe("success"));
  void act(() => getHomeQueryClient().setQueryData(key, parsed([])));
  expect(hook.result.current.outcome).toBe("success");
  void act(() => clearOwnerQueryBoundary(getHomeQueryClient()));
  expect(getHomeQueryClient().getQueryData(observationKey)).toBeUndefined();
  hook.unmount();
  getHomeQueryClient().setQueryData(key, parsed([]));
  const reopened = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [] }) }));
  expect(reopened.result.current.outcome).toBe("pending");
});

test("an invalidated slow response is cancelled and cannot replace the newer confirmation", async () => {
  let resolveOld: ((value: unknown) => void) | undefined;
  let cancelled = false;
  let requests = 0;
  const fetchOperations = (signal?: AbortSignal): Promise<unknown> => {
    requests++;
    if (requests === 1) return Promise.resolve({ actions: [row] });
    if (requests > 2) return Promise.resolve({ actions: [{ ...row, status: "confirmed" }] });
    return new Promise((resolve, reject) => {
      resolveOld = resolve;
      signal?.addEventListener("abort", () => { cancelled = true; reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
    });
  };
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations }));
  await waitFor(() => expect(result.current.row?.status).toBe("pending"));
  void act(() => { void getHomeQueryClient().invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(resolveOld).toBeDefined());
  await act(async () => { await getHomeQueryClient().invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  expect(cancelled).toBe(true);
  await act(async () => { resolveOld?.({ actions: [row] }); });
  expect(result.current.outcome).toBe("success");
  expect(getHomeQueryClient().getQueryData(key)).toMatchObject({ operations: [{ status: "confirmed" }], unparsedSavingsDeposits: [] });
});

test("polling stops on reconciled success even when the row disappears", async () => {
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [row] }) }));
  await waitFor(() => expect(result.current.row?.status).toBe("pending"));
  expect(refetchIntervalFor(key)).toBe(5_000);
  void act(() => getHomeQueryClient().setQueryData(key, parsed([{ ...row, status: "confirmed" }])));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  void act(() => getHomeQueryClient().setQueryData(key, parsed([])));
  expect(result.current.outcome).toBe("success");
  expect(refetchIntervalFor(key)).toBe(false);
});

test("an ambiguous submission qualifies the owner's balances once until a fresh read succeeds", async () => {
  const client = getHomeQueryClient();
  const markerKey = ownerQueryKey(ownerKey, "balances-action");
  let status: "pending" | "confirmed" = "pending";
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "ambiguous", fetchOperations: async () => ({ actions: [{ ...row, status }] }) }));
  await waitFor(() => expect(client.getQueryData(markerKey)).toBeDefined());
  expect(result.current.outcome).toBe("unknown");
  const marker = client.getQueryData<BalanceActionMarker>(markerKey);
  status = "confirmed";
  await act(async () => { await client.invalidateQueries({ queryKey: key }); });
  expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual(marker);
});

test("a failed submission does not qualify balances", () => {
  const client = getHomeQueryClient();
  renderHook(() => useMoneyActionOutcome({ action, submission: "failed", fetchOperations: async () => ({ actions: [] }) }));
  expect(client.getQueryData(ownerQueryKey(ownerKey, "balances-action"))).toBeUndefined();
});

test("a confirmed result without a marker creates the qualification", async () => {
  const client = getHomeQueryClient();
  const markerKey = ownerQueryKey(ownerKey, "balances-action");
  const balancesKey = ownerQueryKey(ownerKey, "balances", "US");
  client.setQueryData(balancesKey, { version: 5, holdings: [] });
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [{ ...row, status: "confirmed" }] }) }));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)).toMatchObject({ fresh: {} }));
  expect(client.getQueryState(balancesKey)?.isInvalidated).toBe(true);
});

test("an ambiguous submission qualifies only the action owner's balances", async () => {
  const client = getHomeQueryClient();
  const otherMarker = ownerQueryKey("other-owner", "balances-action");
  client.setQueryData(otherMarker, { at: 1, fresh: {} });
  renderHook(() => useMoneyActionOutcome({ action, submission: "ambiguous", fetchOperations: async () => ({ actions: [] }) }));
  await waitFor(() => expect(client.getQueryData(ownerQueryKey(ownerKey, "balances-action"))).toBeDefined());
  expect(client.getQueryData<BalanceActionMarker>(otherMarker)).toEqual({ at: 1, fresh: {} });
});

test("a settlement after a region recovered re-qualifies that region", async () => {
  const client = getHomeQueryClient();
  const markerKey = ownerQueryKey(ownerKey, "balances-action");
  let status: "pending" | "confirmed" = "pending";
  const fetchOperations = async () => ({ actions: [{ ...row, status }] });
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "ambiguous", fetchOperations }));
  await waitFor(() => expect(client.getQueryData(markerKey)).toBeDefined());
  const marked = client.getQueryData<BalanceActionMarker>(markerKey)!;
  client.setQueryData<BalanceActionMarker>(markerKey, { at: marked.at, fresh: { US: true } });
  status = "confirmed";
  await act(async () => { await client.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)).toMatchObject({ fresh: {} }));
});

test("a settlement re-qualifies once while the same settlement is observed again", async () => {
  const client = getHomeQueryClient();
  const markerKey = ownerQueryKey(ownerKey, "balances-action");
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [{ ...row, status: "confirmed" }] }) }));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  const marked = client.getQueryData<BalanceActionMarker>(markerKey)!;
  client.setQueryData<BalanceActionMarker>(markerKey, { at: marked.at, fresh: { US: true } });
  await act(async () => { await client.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: marked.at, fresh: { US: true } }));
});

test("a confirmed result observed on mount re-qualifies balances", async () => {
  const client = getHomeQueryClient();
  const markerKey = ownerQueryKey(ownerKey, "balances-action");
  client.setQueryData<BalanceActionMarker>(markerKey, { at: 1, fresh: { US: true } });
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [{ ...row, status: "confirmed" }] }) }));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)).toMatchObject({ fresh: {} }));
});

test("a status regression and re-confirmation re-qualifies balances", async () => {
  const client = getHomeQueryClient();
  const markerKey = ownerQueryKey(ownerKey, "balances-action");
  let status: "pending" | "confirmed" = "confirmed";
  const fetchOperations = async () => ({ actions: [{ ...row, status }] });
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations }));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  const marked = client.getQueryData<BalanceActionMarker>(markerKey)!;
  client.setQueryData<BalanceActionMarker>(markerKey, { at: marked.at, fresh: { US: true } });
  status = "pending";
  await act(async () => { await client.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(result.current.row?.status).toBe("pending"));
  expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: marked.at, fresh: { US: true } });
  status = "confirmed";
  await act(async () => { await client.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(result.current.outcome).toBe("success"));
  await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)).toMatchObject({ fresh: {} }));
});


import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { act, cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { moneyResultOutcome, useMoneyActionOutcome } = await import("./money-action-outcome");

const action: PreparedMoneyAction = {
  id: "prepared-1", kind: "send", title: "Send", calls: [], amounts: [], warnings: [],
  owner: { subject: "subject", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  createdAt: "2026-09-23T00:00:00.000Z", expiresAt: "2099-09-23T00:00:00.000Z",
};
const row = { id: action.id, status: "pending", owner: action.owner };
const key = ownerQueryKey(dataOwnerKey({ subject: action.owner.subject, smartAccountAddress: action.owner.address, chainId: action.owner.chainId, accountProvider: action.owner.accountProvider }), "actions");

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("result outcome mapping", () => {
  for (const [submission, status, expected] of [
    ["submitted", "confirmed", "success"],
    ["ambiguous", "confirmed", "success"],
    ["submitted", "failed", "failed"],
    ["ambiguous", "failed", "failed"],
    ["submitted", "unknown", "unknown"],
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
  void act(() => getHomeQueryClient().setQueryData(key, { actions: [...(getHomeQueryClient().getQueryData(key) as { actions: unknown[] }).actions, row] }));
  await waitFor(() => expect(result.current.row).toMatchObject(row));
  expect(result.current.outcome).toBe("pending");
  void act(() => getHomeQueryClient().setQueryData(key, { actions: [{ ...row, status: "confirmed" }] }));
  await waitFor(() => expect(result.current.outcome).toBe("success"));
});

test("ambiguous submission stays unknown until the same owner's row is terminal", async () => {
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "ambiguous", fetchOperations: async () => ({ actions: [row] }) }));
  await waitFor(() => expect(result.current.row?.status).toBe("pending"));
  expect(result.current.outcome).toBe("unknown");
  void act(() => getHomeQueryClient().setQueryData(key, { actions: [{ ...row, status: "failed" }] }));
  await waitFor(() => expect(result.current.outcome).toBe("failed"));
});

test("typed pre-dispatch failure does not query actions", () => {
  let fetchCount = 0;
  const { result } = renderHook(() => useMoneyActionOutcome({ action, submission: "failed", fetchOperations: async () => { fetchCount++; return { actions: [] }; } }));
  expect(result.current).toEqual({ outcome: "failed" });
  expect(fetchCount).toBe(0);
});


import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { invalidateAfterAction, requalifyBalancesAfterSettlement, snapshotProvesFreshness, type BalanceActionMarker } from "@/client/query/after-action";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { parseRecentActionsPayload } from "@/shared/actions/contracts/list";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

function isBalanceActionMarker(value: unknown): value is BalanceActionMarker {
  return typeof value === "object" && value !== null && "at" in value && typeof value.at === "number" && "fresh" in value;
}

function readMarker(client: { getQueryData: (key: readonly unknown[]) => unknown }, key: readonly unknown[]): BalanceActionMarker {
  const marker = client.getQueryData(key);
  if (!isBalanceActionMarker(marker)) throw new Error("The balance marker is missing.");
  return marker;
}

const { act, cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { createMoneyActionQualification, nextMoneyActionQualification, useMoneyActionOutcome } = await import("./money-action-outcome");

const action: PreparedMoneyAction = {
  id: "prepared-1", kind: "send", title: "Send", calls: [], amounts: [], warnings: [],
  owner: { subject: "subject", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  createdAt: "2026-09-23T00:00:00.000Z", expiresAt: "2099-09-23T00:00:00.000Z",
};
const row = {
  id: action.id, status: "confirmed", owner: action.owner, kind: action.kind,
  createdAt: action.createdAt, confirmedAt: action.createdAt,
  settledAt: "2026-09-23T00:00:01.000Z", settledBlockNumber: "35123457",
  summary: { title: action.title, amounts: action.amounts, warnings: action.warnings, expiresAt: action.expiresAt },
};
const session = {
  user: { subject: action.owner.subject },
  smartAccount: { address: action.owner.address, chainId: action.owner.chainId },
  accountProvider: action.owner.accountProvider,
};
const parsed = (rows: unknown[]) => parseRecentActionsPayload({ actions: rows }, session);
const ownerKey = dataOwnerKey(session);
const actionsKey = ownerQueryKey(ownerKey, "actions");
const markerKey = ownerQueryKey(ownerKey, "balances-action");

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test.each([
  [row.settledAt, row.settledBlockNumber],
  [row.settledAt, undefined],
  [undefined, undefined],
] as const)("a settled row with instant %s and block %s keeps its server boundary when it disappears and returns", async (settledAt, settledBlockNumber) => {
  const submittedAt = "2026-09-23T00:00:00.500Z";
  const settledRow = { ...row, settledAt, settledBlockNumber, submittedAt };
  const client = getHomeQueryClient();
  client.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
  const invalidate = spyOn(client, "invalidateQueries");
  const balancesInvalidations = () => invalidate.mock.calls.filter(([filters]) =>
    filters?.queryKey?.length === 2 && filters.queryKey[0] === ownerKey && filters.queryKey[1] === "balances",
  ).length;
  try {
    const hook = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [settledRow] }) }));
    const { result } = hook;
    await waitFor(() => expect(result.current.outcome).toBe("success"));
    await waitFor(() => expect(balancesInvalidations()).toBe(1));
    expect(client.getQueryData(ownerQueryKey(ownerKey, "action-result-observation", action.id))).toMatchObject({ status: "confirmed" });
    const marker = client.getQueryData<BalanceActionMarker>(markerKey);
    expect(marker).toEqual({
      at: Date.parse(settledAt ?? submittedAt), fresh: {}, settledActionIds: [action.id],
      ...(settledBlockNumber ? { settledBlock: settledBlockNumber } : { dispatchedActionIds: [action.id], dispatchedAt: { [action.id]: expect.any(Number) } }),
    });

    await act(async () => { client.setQueryData(actionsKey, parsed([])); hook.rerender(); });
    expect(result.current).toMatchObject({ outcome: "success", row: { status: "confirmed" } });
    expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual(marker);
    expect(balancesInvalidations()).toBe(1);

    await act(async () => { client.setQueryData(actionsKey, parsed([settledRow])); hook.rerender(); });
    expect(result.current.outcome).toBe("success");
    expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual(marker);
    expect(balancesInvalidations()).toBe(1);
  } finally {
    invalidate.mockRestore();
  }
});

test("a settled row that later omits its block keeps the proof without another requalification", async () => {
  const client = getHomeQueryClient();
  client.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
  const invalidate = spyOn(client, "invalidateQueries");
  const balancesInvalidations = () => invalidate.mock.calls.filter(([filters]) =>
    filters?.queryKey?.length === 2 && filters.queryKey[0] === ownerKey && filters.queryKey[1] === "balances",
  ).length;
  const settledRow = { ...row, settledBlockNumber: "105" };
  try {
    const hook = renderHook(() => useMoneyActionOutcome({ action, submission: "submitted", fetchOperations: async () => ({ actions: [settledRow] }) }));
    await waitFor(() => expect(hook.result.current.outcome).toBe("success"));
    await waitFor(() => expect(balancesInvalidations()).toBe(1));
    const marker = client.getQueryData<BalanceActionMarker>(markerKey);
    expect(marker?.settledBlock).toBe("105");
    expect(marker?.settledActionIds).toEqual([action.id]);

    await act(async () => {
      client.setQueryData(actionsKey, parsed([{ ...settledRow, settledBlockNumber: undefined, settledAt: "2026-09-23T00:00:02.000Z" }]));
      hook.rerender();
    });
    expect(hook.result.current.outcome).toBe("success");
    expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual(marker);
    expect(client.getQueryData<BalanceActionMarker>(markerKey)?.settledBlock).toBe("105");
    expect(balancesInvalidations()).toBe(1);
  } finally {
    invalidate.mockRestore();
  }
});

test("a reused hook instance qualifies the new action's owner", async () => {
  const client = getHomeQueryClient();
  client.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
  const fetchOperations = async () => ({ actions: [row] });
  const hook = renderHook(({ currentAction, submission }: { currentAction: PreparedMoneyAction; submission: "submitted" | "ambiguous" }) =>
    useMoneyActionOutcome({ action: currentAction, submission, fetchOperations }),
  { initialProps: { currentAction: action, submission: "ambiguous" } });
  await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)?.settledBlock).toBe("35123457"));

  hook.rerender({ currentAction: { ...action, id: "prepared-2" }, submission: "ambiguous" });
  await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({
    at: Date.parse(row.settledAt), fresh: {}, dispatchedActionIds: ["prepared-2"], dispatchedAt: { "prepared-2": expect.any(Number) },
    settledBlock: "35123457", settledActionIds: [action.id],
  }));
  expect(hook.result.current).toEqual({ outcome: "unknown" });
});

test.each([
  ["2026-09-23T00:00:02.000Z", "2026-09-23T00:00:02.000Z"],
  [undefined, "2026-09-23T00:00:01.000Z"],
] as const)("an unknown polled action uses submittedAt %s or its server-issued update instant", async (submittedAt, expectedAt) => {
  const client = getHomeQueryClient();
  client.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
  const unknownRow = { ...row, status: "unknown", confirmedAt: "2026-09-23T00:00:01.000Z", submittedAt, settledAt: undefined, settledBlockNumber: undefined };
  client.setQueryData(actionsKey, parsed([unknownRow]));
  const hook = renderHook(() => useMoneyActionOutcome({ action, submission: "ambiguous", fetchOperations: async () => ({ actions: [unknownRow] }) }));
  await waitFor(() => expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({
    at: Date.parse(expectedAt), fresh: {}, dispatchedActionIds: [action.id], dispatchedAt: { [action.id]: expect.any(Number) },
  }));
  expect(hook.result.current).toMatchObject({ outcome: "unknown", row: { status: "unknown" } });
});

test.each(["submittedAt", "updatedAt"] as const)("an ambiguous boundary upgrades when the row's %s arrives and identical polls do not rewrite it", async (instant) => {
  const client = getHomeQueryClient();
  client.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
  const write = spyOn(client, "setQueryData");
  const markerWrites = () => write.mock.calls.filter(([key]) => key[0] === ownerKey && key[1] === "balances-action").length;
  const unknownRow = {
    ...row, status: "unknown", settledAt: undefined, settledBlockNumber: undefined,
    confirmedAt: "2026-09-23T00:00:01.000Z",
    ...(instant === "submittedAt" ? { submittedAt: "2026-09-23T00:00:02.000Z" } : {}),
  };
  const expectedAt = Date.parse(instant === "submittedAt" ? "2026-09-23T00:00:02.000Z" : "2026-09-23T00:00:01.000Z");
  try {
    const hook = renderHook(() => useMoneyActionOutcome({ action, submission: "ambiguous", fetchOperations: async () => ({ actions: [] }) }));
    await waitFor(() => expect(markerWrites()).toBe(1));
    expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: [action.id], dispatchedAt: { [action.id]: expect.any(Number) },
    });

    await act(async () => { client.setQueryData(actionsKey, parsed([unknownRow])); hook.rerender(); });
    await waitFor(() => expect(markerWrites()).toBe(2));
    const marker = client.getQueryData<BalanceActionMarker>(markerKey);
    expect(marker).toEqual({ at: expectedAt, fresh: {}, dispatchedActionIds: [action.id], dispatchedAt: { [action.id]: expect.any(Number) } });
    expect(hook.result.current).toMatchObject({ outcome: "unknown", row: { status: "unknown" } });

    await act(async () => { client.setQueryData(actionsKey, parsed([unknownRow])); hook.rerender(); });
    expect(markerWrites()).toBe(2);
    await act(async () => {
      client.setQueryData(actionsKey, parsed([{ ...unknownRow, summary: { ...unknownRow.summary, title: "Updated send" } }]));
      hook.rerender();
    });
    expect(markerWrites()).toBe(2);
    expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual(marker);
  } finally {
    write.mockRestore();
  }
});

describe("money-action qualification transitions", () => {
  const settledInput = {
    actionId: "action-a", submission: "submitted", outcome: "success", settled: true,
  } as const;

  test("the initial state has no remembered qualifications", () => {
    expect(createMoneyActionQualification("action-a")).toEqual({
      actionId: "action-a", settlement: null, settlementBlock: null, qualifiedSettlement: null, qualifiedUnknown: false, unknownServerAt: null,
    });
  });

  test("the first settled observation requalifies with its server-issued block", () => {
    expect(nextMoneyActionQualification({
      ...settledInput, current: createMoneyActionQualification("action-a"),
      operation: { settledBlockNumber: "35123457", settledAt: "2026-09-23T00:00:01.000Z" },
    })).toEqual({
      qualification: { actionId: "action-a", settlement: "action-a\u000035123457", settlementBlock: "35123457", qualifiedSettlement: "action-a\u000035123457", qualifiedUnknown: false, unknownServerAt: null },
      action: "settlement", settledBlock: "35123457",
    });
  });

  test.each([
    [{ settledAt: "2026-09-23T00:00:01.000Z" }, "action-a\u00002026-09-23T00:00:01.000Z"],
    [{}, "action-a\u0000"],
    [undefined, "action-a\u0000"],
  ] as const)("a settled row without a block falls back to %j", (operation, identity) => {
    expect(nextMoneyActionQualification({ ...settledInput, current: createMoneyActionQualification("action-a"), operation })).toEqual({
      qualification: { actionId: "action-a", settlement: identity, settlementBlock: null, qualifiedSettlement: identity, qualifiedUnknown: false, unknownServerAt: null },
      action: "settlement",
    });
  });

  test("an absent row and a changed timestamp keep the same block identity", () => {
    const first = nextMoneyActionQualification({
      ...settledInput, current: createMoneyActionQualification("action-a"), operation: { settledBlockNumber: "35123457" },
    });
    const absent = nextMoneyActionQualification({ ...settledInput, current: first.qualification });
    expect(absent).toEqual({ qualification: first.qualification, action: "none" });
    expect(nextMoneyActionQualification({
      ...settledInput, current: absent.qualification,
      operation: { settledBlockNumber: "35123457", settledAt: "2026-09-23T00:00:02.000Z" },
    })).toEqual({ qualification: first.qualification, action: "none" });
  });

  test.each([undefined, "invalid", "0105", "104"])("a later block %s keeps the highest settlement identity and block", (settledBlockNumber) => {
    const first = nextMoneyActionQualification({
      ...settledInput, current: createMoneyActionQualification("action-a"), operation: { settledBlockNumber: "105" },
    });
    const later = nextMoneyActionQualification({
      ...settledInput, current: first.qualification,
      operation: { settledBlockNumber, settledAt: "2026-09-23T00:00:02.000Z" },
    });
    expect(later).toEqual({ qualification: first.qualification, action: "none" });
    expect(later.qualification.settlement).toBe("action-a\u0000105");
    expect(later.qualification.settlementBlock).toBe("105");
  });

  test.each(["pending", "unknown"] as const)("a reorg drop to %s reopens the boundary and re-inclusion at the same block requalifies", async (outcome) => {
    const client = getHomeQueryClient();
    const first = nextMoneyActionQualification({ ...settledInput, current: createMoneyActionQualification("action-a"), operation: { settledBlockNumber: "35123457" } });
    requalifyBalancesAfterSettlement({ queryClient: client, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: first.settledBlock });
    const drop = nextMoneyActionQualification({ ...settledInput, current: first.qualification, settled: false, outcome });
    expect(drop.action).toBe("reopen");
    expect(drop.qualification).toEqual({ ...first.qualification, settlement: null, settlementBlock: null, qualifiedSettlement: null });
    await invalidateAfterAction({ queryClient: client, dataOwnerKey: ownerKey, actionId: "action-a", reopen: true });
    const reopened = readMarker(client, markerKey);
    expect(reopened.settledActionIds).toBeUndefined();
    expect(reopened.dispatchedActionIds).toEqual(["action-a"]);
    expect(reopened.settledBlock).toBe("35123457");
    expect(snapshotProvesFreshness(balancesSnapshotFixture, reopened)).toBe(false);
    const reincluded = nextMoneyActionQualification({ ...settledInput, current: drop.qualification, operation: { settledBlockNumber: "35123457" } });
    expect(reincluded.action).toBe("settlement");
    requalifyBalancesAfterSettlement({ queryClient: client, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: reincluded.settledBlock });
    const settled = readMarker(client, markerKey);
    expect(settled.dispatchedActionIds).toBeUndefined();
    expect(settled.dispatchedAt).toBeUndefined();
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, block: { ...balancesSnapshotFixture.block, number: "35123457" } }, settled)).toBe(true);
  });

  test.each([undefined, { settledAt: "2026-09-23T00:00:02.000Z" }, { settledBlockNumber: "0105" }])("a block-less re-inclusion %j after a reorg drop keeps the reopened boundary", async (operation) => {
    const client = getHomeQueryClient();
    const first = nextMoneyActionQualification({ ...settledInput, current: createMoneyActionQualification("action-a"), operation: { settledBlockNumber: "35123457" } });
    requalifyBalancesAfterSettlement({ queryClient: client, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: first.settledBlock });
    const drop = nextMoneyActionQualification({ ...settledInput, current: first.qualification, settled: false, outcome: "pending" });
    await invalidateAfterAction({ queryClient: client, dataOwnerKey: ownerKey, actionId: "action-a", reopen: true });
    const reincluded = nextMoneyActionQualification({ ...settledInput, current: drop.qualification, ...(operation ? { operation } : {}) });
    expect(reincluded.action).toBe("settlement");
    expect(reincluded.settledBlock).toBeUndefined();
    requalifyBalancesAfterSettlement({ queryClient: client, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: reincluded.settledBlock });
    const marker = readMarker(client, markerKey);
    expect(marker.dispatchedActionIds).toEqual(["action-a"]);
    expect(marker.settledBlock).toBe("35123457");
    const atBoundary = { ...balancesSnapshotFixture, fetchedAt: new Date(marker.at).toISOString(), block: { ...balancesSnapshotFixture.block, number: "35123457" } };
    expect(snapshotProvesFreshness(atBoundary, marker)).toBe(false);
  });

  test("a different settlement block requalifies", () => {
    const first = nextMoneyActionQualification({
      ...settledInput, current: createMoneyActionQualification("action-a"), operation: { settledBlockNumber: "35123457" },
    });
    expect(nextMoneyActionQualification({
      ...settledInput, current: first.qualification, operation: { settledBlockNumber: "35123458" },
    })).toEqual({
      qualification: { actionId: "action-a", settlement: "action-a\u000035123458", settlementBlock: "35123458", qualifiedSettlement: "action-a\u000035123458", qualifiedUnknown: false, unknownServerAt: null },
      action: "settlement", settledBlock: "35123458",
    });
  });

  test("a different action id resets remembered settlement and unknown qualification", () => {
    expect(nextMoneyActionQualification({
      ...settledInput, actionId: "action-b",
      current: { actionId: "action-a", settlement: "action-a\u000035123457", settlementBlock: "35123457", qualifiedSettlement: "action-a\u000035123457", qualifiedUnknown: true, unknownServerAt: Date.parse("2026-09-23T00:00:01.000Z") },
    })).toEqual({
      qualification: { actionId: "action-b", settlement: "action-b\u0000", settlementBlock: null, qualifiedSettlement: "action-b\u0000", qualifiedUnknown: false, unknownServerAt: null },
      action: "settlement",
    });
  });

  test.each([
    ["failed", "success", true],
    ["submitted", "failed", true],
    ["ambiguous", "failed", false],
  ] as const)("failed submission/outcome never qualifies: %s / %s", (submission, outcome, settled) => {
    expect(nextMoneyActionQualification({
      current: { actionId: "action-a", settlement: "old", settlementBlock: "105", qualifiedSettlement: "old", qualifiedUnknown: true, unknownServerAt: Date.parse("2026-09-23T00:00:01.000Z") },
      actionId: "action-b", submission, outcome, settled, operation: { settledBlockNumber: "35123457" },
    })).toEqual({
      qualification: { actionId: "action-b", settlement: null, settlementBlock: null, qualifiedSettlement: null, qualifiedUnknown: false, unknownServerAt: null }, action: "none",
    });
  });

  test("ambiguous unknown qualifies only once per action without a newer server instant", () => {
    const input = { actionId: "action-a", submission: "ambiguous", outcome: "unknown", settled: false } as const;
    const first = nextMoneyActionQualification({ ...input, current: createMoneyActionQualification("action-a") });
    expect(first).toEqual({
      qualification: { actionId: "action-a", settlement: null, settlementBlock: null, qualifiedSettlement: null, qualifiedUnknown: true, unknownServerAt: null }, action: "unknown",
    });
    expect(nextMoneyActionQualification({ ...input, current: first.qualification })).toEqual({ qualification: first.qualification, action: "none" });
    expect(nextMoneyActionQualification({ ...input, actionId: "action-b", current: first.qualification })).toEqual({
      qualification: { actionId: "action-b", settlement: null, settlementBlock: null, qualifiedSettlement: null, qualifiedUnknown: true, unknownServerAt: null }, action: "unknown",
    });
  });

  test("an ambiguous qualification remembers each strictly newer server instant without resetting its guard", () => {
    const input = { actionId: "action-a", submission: "ambiguous", outcome: "unknown", settled: false } as const;
    const initial = nextMoneyActionQualification({ ...input, current: createMoneyActionQualification("action-a") });
    const first = nextMoneyActionQualification({ ...input, current: initial.qualification, operation: { updatedAt: "2026-09-23T00:00:01.000Z" } });
    expect(first.action).toBe("unknown");
    expect(first.qualification).toEqual({ ...initial.qualification, unknownServerAt: Date.parse("2026-09-23T00:00:01.000Z") });
    const newer = nextMoneyActionQualification({ ...input, current: first.qualification, operation: { submittedAt: "2026-09-23T00:00:02.000Z" } });
    expect(newer.action).toBe("unknown");
    expect(newer.qualification).toEqual({ ...first.qualification, unknownServerAt: Date.parse("2026-09-23T00:00:02.000Z") });
    for (const submittedAt of ["2026-09-23T00:00:02.000Z", "2026-09-23T00:00:01.000Z", "invalid", undefined]) {
      expect(nextMoneyActionQualification({ ...input, current: newer.qualification, operation: { submittedAt } })).toEqual({
        qualification: newer.qualification, action: "none",
      });
    }
  });

  test.each([
    ["submitted", "pending"],
    ["submitted", "unknown"],
    ["ambiguous", "pending"],
  ] as const)("a nonsettled %s / %s observation does not qualify", (submission, outcome) => {
    expect(nextMoneyActionQualification({
      ...settledInput, current: createMoneyActionQualification("action-a"), submission, outcome, settled: false,
    })).toEqual({
      qualification: { actionId: "action-a", settlement: null, settlementBlock: null, qualifiedSettlement: null, qualifiedUnknown: false, unknownServerAt: null }, action: "none",
    });
  });
});

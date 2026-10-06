import { afterEach, beforeEach, expect, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";
import type { BalanceActionMarker } from "@/client/query/after-action";
import { createHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import { handleRequestShowsBroadcast, qualifyBalancesForUnrecordedHandle } from "./cdp-authenticated-transport";

const ownerKey = "subject\u00000x1111111111111111111111111111111111111111\u00008453\u0000cdp-embedded";
const balancesKey = ownerQueryKey(ownerKey, "balances", "US");
const markerKey = ownerQueryKey(ownerKey, "balances-action");
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = createHomeQueryClient();
  queryClient.setQueryData(balancesKey, balancesSnapshotFixture);
});
afterEach(() => queryClient.clear());

const uncertainHandles: Array<{ status: number | null; unreadable: boolean }> = [
  { status: null, unreadable: false },
  { status: 409, unreadable: false },
  { status: 503, unreadable: false },
  { status: 200, unreadable: true },
];

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

test.each([
  undefined,
  "",
  "{}",
  "{",
  '{"transactionHash":""}',
  '{"providerHandle":""}',
  '{"transactionHash":123}',
  "null",
  "[]",
  '"abc"',
])("a handle body without broadcast evidence returns false: %j", (body) => {
  expect(handleRequestShowsBroadcast(body)).toBe(false);
});

test.each([
  '{"transactionHash":"0xabc"}',
  '{"providerHandle":"abc"}',
])("a handle body with broadcast evidence returns true: %j", (body) => {
  expect(handleRequestShowsBroadcast(body)).toBe(true);
});

test.each(uncertainHandles)("an undispatched handle does not qualify balances: %j", ({ status, unreadable }) => {
  qualifyBalancesForUnrecordedHandle({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", recordsHandle: true, status, unreadable, dispatched: false });
  expect(queryClient.getQueryData(markerKey)).toBeUndefined();
  expect(queryClient.getQueryState(balancesKey)?.isInvalidated).toBe(false);
});

test.each(uncertainHandles)("a dispatched uncertain handle qualifies balances: %j", async ({ status, unreadable }) => {
  qualifyBalancesForUnrecordedHandle({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", recordsHandle: true, status, unreadable, dispatched: true });
  await flushMicrotasks();
  expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-a"] });
  expect(queryClient.getQueryState(balancesKey)?.isInvalidated).toBe(true);
});

test("omitting dispatched preserves uncertain-handle qualification", async () => {
  qualifyBalancesForUnrecordedHandle({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", recordsHandle: true, status: null, unreadable: false });
  await flushMicrotasks();
  expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-a"] });
  expect(queryClient.getQueryState(balancesKey)?.isInvalidated).toBe(true);
});

test.each([
  { recordsHandle: false, status: null, unreadable: true },
  { recordsHandle: true, status: 200, unreadable: false },
  { recordsHandle: true, status: 400, unreadable: false },
])("a non-handle or readable ordinary response does not qualify: %j", ({ recordsHandle, status, unreadable }) => {
  qualifyBalancesForUnrecordedHandle({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", recordsHandle, status, unreadable, dispatched: true });
  expect(queryClient.getQueryData(markerKey)).toBeUndefined();
  expect(queryClient.getQueryState(balancesKey)?.isInvalidated).toBe(false);
});

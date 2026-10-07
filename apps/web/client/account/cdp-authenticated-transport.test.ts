import "./dom-test-harness";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import { getHomeQueryClient } from "@/client/query/query-client";
const { renderHook, cleanup } = await import("@testing-library/react");
const { useAuthenticatedTransport } = await import("./cdp-authenticated-transport");
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
afterEach(() => { cleanup(); queryClient.clear(); getHomeQueryClient().clear(); });

test.each([
  ["transaction hash", { transactionHash: "0xabc" }, false, true],
  ["provider handle only", { providerHandle: "abc" }, false, false],
  ["empty hash", { transactionHash: "" }, false, false],
  ["no hash", {}, false, false],
  ["switched owner", { transactionHash: "0xabc" }, true, false],
] as const)("404 handle with %s qualifies and starts freshness only with a current owner's transaction hash", async (_label, body, switchOwner, qualifies) => {
  const client = getHomeQueryClient();
  client.setQueryData(balancesKey, balancesSnapshotFixture);
  let active = true;
  let reads = 0;
  const ownerFence: OwnerGenerationFence = { capture: () => 1, isCurrent: () => active, advance: () => 1, assertCurrent: () => {}, updateAuthorizationBoundary: () => {}, updateOwnerKey: () => false };
  const session = { user: { subject: "subject" }, smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };
  const hook = renderHook(() => useAuthenticatedTransport({ session, status: "verified", verification: "server", ownerKey, ownerFence, getAccessToken: async () => "fixture-token", sessionFetch: async (path) => {
    if (path === "/api/actions/action-a/handle") {
      if (switchOwner) active = false;
      return Response.json({ error: { code: "ACTION_NOT_FOUND", message: "Not found" } }, { status: 404 });
    }
    if (path === "/api/actions") { reads += 1; return Response.json({ actions: [] }); }
    throw new Error("Unexpected request");
  } }), { wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children) });
  await expect(hook.result.current.fetchAccountResource("/api/actions/action-a/handle", { method: "POST", body })).rejects.toMatchObject(switchOwner ? { reason: "stale-session" } : { status: 404 });
  await flushMicrotasks();
  expect(client.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedActionIds).toEqual(qualifies ? ["action-a"] : undefined);
  expect(client.getQueryState(balancesKey)?.isInvalidated).toBe(qualifies);
  expect(reads).toBe(qualifies ? 1 : 0);
});

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
  expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": expect.any(Number) } });
  expect(queryClient.getQueryState(balancesKey)?.isInvalidated).toBe(true);
});

test("omitting dispatched preserves uncertain-handle qualification", async () => {
  qualifyBalancesForUnrecordedHandle({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", recordsHandle: true, status: null, unreadable: false });
  await flushMicrotasks();
  expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": expect.any(Number) } });
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

import "./dom-test-harness";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import { getHomeQueryClient } from "@/client/query/query-client";
const { renderHook, cleanup, act, waitFor } = await import("@testing-library/react");
const { useAuthenticatedTransport } = await import("./cdp-authenticated-transport");
import type { QueryClient } from "@tanstack/react-query";
import { freshRegionMarker, createBalanceFreshnessState, startBalanceFreshness, resetBalanceFreshness, type BalanceActionMarker } from "@/client/query/after-action";
import { useBalances, useBalancesData } from "@/client/balances";
import { resolveDisplayCurrency, type PresentationScope } from "@/shared/account/display-currency";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { parseBalancesScope } from "@/client/query/balances-scope";
import { trustRestoredBalances, trustRestoredBalanceActionMarker } from "@/client/query/restored-cache";
import { createHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { balancesSnapshotFixture, buildBalancesSnapshotFixture, ready } from "@/shared/balances/fixtures";
import { handleRequestShowsBroadcast, qualifyBalancesForUnrecordedHandle } from "./cdp-authenticated-transport";

const ownerKey = "subject\u00000x1111111111111111111111111111111111111111\u00008453\u0000cdp-embedded";
const balancesKey = ownerQueryKey(ownerKey, "balances", "US", "USD");
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


const verifiedSession = { user: { subject: "subject" }, smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };
function generationFence() {
  let generation = 0;
  const fence: OwnerGenerationFence = { capture: () => generation, isCurrent: (value) => value === generation, advance: () => ++generation, assertCurrent: (value) => { if (value !== generation) throw new Error("stale-session"); }, updateAuthorizationBoundary: () => {}, updateOwnerKey: () => false };
  return fence;
}

const walletFreeSession = { ...verifiedSession, smartAccount: null };
const privacyRoutes: Array<{ path: string; method: "GET" | "POST" }> = [
  { path: "/api/account/deletion", method: "GET" },
  { path: "/api/account/deletion", method: "POST" },
  { path: "/api/account/export", method: "GET" },
];

test.each(privacyRoutes)("verified wallet-free sessions can reach $method $path", async ({ path, method }) => {
  const hook = renderHook(() => useAuthenticatedTransport({ session: walletFreeSession, status: "verified", verification: "server", ownerKey: null, ownerFence: generationFence(), getAccessToken: async () => "fixture-token", sessionFetch: async () => Response.json({ available: true }) }));
  await expect(hook.result.current.fetchAccountResource(path, { method })).resolves.toEqual({ available: true });
});

test.each([
  { status: "validating", verification: "provisional" },
  { status: "unavailable", verification: "server" },
  { status: "signed-out", verification: null },
] as const)("wallet-free privacy routes reject $status sessions before sending", async ({ status, verification }) => {
  let requests = 0;
  const hook = renderHook(() => useAuthenticatedTransport({ session: walletFreeSession, status, verification, ownerKey: null, ownerFence: generationFence(), getAccessToken: async () => "fixture-token", sessionFetch: async () => { requests += 1; return Response.json({}); } }));
  for (const { path, method } of privacyRoutes) await expect(hook.result.current.fetchAccountResource(path, { method })).rejects.toMatchObject({ reason: "stale-session" });
  expect(requests).toBe(0);
});

test("wallet-free privacy access does not authorize wallet-required resources", async () => {
  let requests = 0;
  const hook = renderHook(() => useAuthenticatedTransport({ session: walletFreeSession, status: "verified", verification: "server", ownerKey: null, ownerFence: generationFence(), getAccessToken: async () => "fixture-token", sessionFetch: async () => { requests += 1; return Response.json({}); } }));
  for (const path of ["/api/actions/prepare", "/api/invites/link", "/api/funding/orders"]) await expect(hook.result.current.fetchAccountResource(path)).rejects.toMatchObject({ reason: "stale-session" });
  expect(requests).toBe(0);
});

test.each(privacyRoutes)("wallet-free late $method $path responses and bodies remain generation-fenced", async ({ path, method }) => {
  for (const delayedBody of [false, true]) {
    const fence = generationFence();
    const pending = Promise.withResolvers<Response>();
    const body = Promise.withResolvers<unknown>();
    let parsing = false;
    let recoveries = 0;
    const response = Response.json({ available: true });
    if (delayedBody) response.json = () => { parsing = true; return body.promise; };
    const hook = renderHook(() => useAuthenticatedTransport({ session: walletFreeSession, status: "verified", verification: "server", ownerKey: null, ownerFence: fence, getAccessToken: async () => "fixture-token", onAccountDeleted: () => { recoveries += 1; }, sessionFetch: async () => pending.promise }));
    const result = hook.result.current.fetchAccountResource(path, { method }).catch((error: unknown) => error);
    await flushMicrotasks();
    if (delayedBody) { pending.resolve(response); await flushMicrotasks(); expect(parsing).toBe(true); }
    fence.advance();
    fence.advance();
    if (delayedBody) body.resolve({ available: true }); else pending.resolve(response);
    expect(await result).toMatchObject({ reason: "stale-session" });
    expect(recoveries).toBe(0);
    hook.unmount();
  }
});

test.each(["confirm", "handle", "funding"] as const)("ACCOUNT_DELETED crosses the %s route parser and recovers only the receipt", async (route) => {
  const path = route === "funding" ? "/api/funding/orders" : `/api/actions/action-a/${route}`;
  const fence = generationFence();
  let recovery: () => Promise<unknown> = async () => { throw new Error("recovery not registered"); };
  const requests: string[] = [];
  const hook = renderHook(() => useAuthenticatedTransport({ session: verifiedSession, status: "verified", verification: "server", ownerKey, ownerFence: fence, getAccessToken: async () => "fixture-token", onAccountDeleted: (recover, isCurrent) => { expect(isCurrent()).toBe(true); recovery = recover; }, sessionFetch: async (input) => {
    requests.push(String(input));
    return input === "/api/account/deletion" ? Response.json({ receipt: true }) : Response.json({ error: { code: "ACCOUNT_DELETED" } }, { status: 401 });
  } }));
  await expect(hook.result.current.fetchAccountResource(path, { method: "POST" })).rejects.toMatchObject({ status: 401, code: "ACCOUNT_DELETED" });
  await expect(recovery()).resolves.toEqual({ receipt: true });
  expect(requests).toEqual([path, "/api/account/deletion"]);
  fence.advance();
  await expect(recovery()).rejects.toThrow("stale-session");
  expect(requests).toHaveLength(2);
});

test.each(["balances", "activity", "actions", "confirm", "handle", "funding"] as const)("late %s revocation is fenced across A→B and A→B→A, including body parsing", async (route) => {
  for (const parseLate of [false, true]) {
    for (const backToA of [false, true]) {
      const fence = generationFence();
      let finish: (response: Response) => void = () => {};
      let finishBody: (body: unknown) => void = () => {};
      let parsing = false;
      let recoveries = 0;
      const response = Response.json({ error: { code: "ACCOUNT_DELETED" } }, { status: 401 });
      if (parseLate) response.json = async () => { parsing = true; return new Promise((resolve) => { finishBody = resolve; }); };
      const hook = renderHook(() => useAuthenticatedTransport({ session: verifiedSession, status: "verified", verification: "server", ownerKey, ownerFence: fence, getAccessToken: async () => "fixture-token", onAccountDeleted: () => { recoveries += 1; }, sessionFetch: async () => new Promise((resolve) => { finish = resolve; }) }));
      const work = route === "balances" ? hook.result.current.fetchBalances({ region: "US", currency: "USD" }) : route === "activity" ? hook.result.current.fetchActivity("") : hook.result.current.fetchAccountResource(route === "funding" ? "/api/funding/orders" : route === "actions" ? "/api/actions" : `/api/actions/action-a/${route}`, { method: route === "actions" ? "GET" : "POST" });
      const failure = work.catch((error: unknown) => error);
      await flushMicrotasks();
      if (parseLate) { finish(response); await flushMicrotasks(); expect(parsing).toBe(true); }
      fence.advance();
      if (backToA) fence.advance();
      if (parseLate) finishBody({ error: { code: "ACCOUNT_DELETED" } }); else finish(response);
      const error = await failure;
      expect(error).toMatchObject(route === "balances" || route === "activity" ? { kind: "session" } : { reason: "stale-session" });
      expect(recoveries).toBe(0);
      hook.unmount();
    }
  }
});


test.each([useBalances, useBalancesData])("balance money is partitioned by resolved currency and never crosses owners (%p)", (useBalanceHook) => {
  queryClient = getHomeQueryClient();
  const session = { subject: "subject", smartAccountAddress: balancesSnapshotFixture.owner.address, chainId: 8453 as const, accountProvider: "cdp-embedded" };
  const usd = buildBalancesSnapshotFixture({ registry: { usdc: { balance: ready("2500000") } } });
  queryClient.setQueryData(balancesKey, usd);
  const scope: PresentationScope = { region: "US", currency: resolveDisplayCurrency("US", null).currency };
  const hook = renderHook(({ scope, owner }) => useBalanceHook(owner, scope, async () => { throw new Error("Disabled"); }, { enabled: false }), {
    initialProps: { scope, owner: session },
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  });
  expect(hook.result.current.snapshot?.holdings.find((holding) => holding.id === "usdc")?.balance.baseUnits).toBe("2500000");
  hook.rerender({ scope: { region: "US", currency: resolveDisplayCurrency("US", "USD").currency }, owner: session });
  expect(queryClient.getQueryCache().findAll({ queryKey: [ownerKey, "balances"] })).toHaveLength(1);
  expect(hook.result.current.snapshot?.quoteCurrency).toBe("USD");
  hook.rerender({ scope: { region: "CA", currency: "USD" }, owner: session });
  expect(hook.result.current.snapshot?.quoteCurrency).toBe("USD");
  hook.rerender({ scope: { region: "US", currency: "EUR" }, owner: session });
  expect(hook.result.current.snapshot).toBeNull();
  expect(hook.result.current.status).toBe("loading");
  hook.rerender({ scope: { region: "US", currency: "USD" }, owner: { ...session, subject: "different-owner" } });
  expect(hook.result.current.snapshot).toBeNull();
  expect(queryClient.getQueryData(balancesKey)).toBe(usd);
});

test("a currency fetch cannot relabel another currency's snapshot as current money", async () => {
  queryClient = getHomeQueryClient();
  const session = { subject: "subject", smartAccountAddress: balancesSnapshotFixture.owner.address, chainId: 8453 as const, accountProvider: "cdp-embedded" };
  const hook = renderHook(() => useBalances(session, { region: "US", currency: "EUR" }, async () => balancesSnapshotFixture), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  });
  await waitFor(() => expect(hook.result.current.status).toBe("error"));
  expect(hook.result.current.snapshot).toBeNull();
  expect(queryClient.getQueryData(ownerQueryKey(ownerKey, "balances", "US", "EUR"))).toBeUndefined();
});

test("settlement proof consumed for one valuation scope leaves other scopes unconsumed", () => {
  const marker: BalanceActionMarker = { at: 0, fresh: {}, settledBlock: "35123456" };
  const usdScope = { region: "US", currency: "USD" } as const;
  const eurScope = { region: "US", currency: "EUR" } as const;
  const usd = freshRegionMarker(marker, marker, usdScope, balancesSnapshotFixture);
  expect(usd?.fresh).toEqual({ "US|USD": true });
  expect(freshRegionMarker(usd, marker, usdScope, balancesSnapshotFixture)).toBeUndefined();
  expect(freshRegionMarker(usd, marker, eurScope, buildBalancesSnapshotFixture({ currency: "EUR" }))?.fresh)
    .toEqual({ "US|USD": true, "US|EUR": true });
});

test("restored balances reject legacy, unknown and mismatched valuation scopes", () => {
  const trust = (queryKey: readonly unknown[], snapshot: unknown = balancesSnapshotFixture) => trustRestoredBalances(snapshot, { ownerKey, queryKey });
  expect(trust(balancesKey)?.data).toEqual(balancesSnapshotFixture);
  for (const key of [
    [ownerKey, "balances", "US"], [ownerKey, "balances", "US", "XYZ"], [ownerKey, "balances", "NO", "USD"],
    [ownerKey, "balances", "US", "none"], [ownerKey, "balances", "US", "USD", "extra"],
    [ownerKey, "balances", "US", "EUR"], [ownerKey, "balances", "GLOBAL", "USD"],
  ]) expect(trust(key)).toBeNull();
  const euroKey = [ownerKey, "balances", "US", "EUR"];
  const euro = buildBalancesSnapshotFixture({ currency: "EUR" });
  expect(trust(euroKey, euro)?.data).toEqual(euro);
  expect(trust(balancesKey, euro)).toBeNull();
  expect(trust(euroKey, { ...balancesSnapshotFixture, quoteCurrency: "EUR" })).toBeNull();
  const global = buildBalancesSnapshotFixture({ region: "GLOBAL" });
  expect(trust([ownerKey, "balances", "GLOBAL", "none"], global)?.data).toEqual(global);
  for (const key of ["US", "US|XYZ", "GLOBAL|", "US|none", "US|USD|extra", "NO|USD"]) {
    expect(trustRestoredBalanceActionMarker({ at: 0, fresh: { [key]: true } }, { ownerKey, queryKey: markerKey })).toBeNull();
  }
  expect(trustRestoredBalanceActionMarker({ at: 0, fresh: { "US|EUR": true, "GLOBAL|none": true } }, { ownerKey, queryKey: markerKey }))
    .toEqual({ data: { at: 0, fresh: { "US|EUR": true, "GLOBAL|none": true } } });
});

test("after-action freshness updates each region/currency cache entry without reviving old keys", async () => {
  const scopes: PresentationScope[] = [{ region: "US", currency: "USD" }, { region: "US", currency: "EUR" }, { region: "GLOBAL", currency: null }];
  for (const scope of scopes) queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", scope.region, scope.currency ?? "none"), buildBalancesSnapshotFixture(scope));
  const legacyKey = ownerQueryKey(ownerKey, "balances", "US");
  const invalidKey = ownerQueryKey(ownerKey, "balances", "US", "XYZ");
  queryClient.setQueryData(legacyKey, balancesSnapshotFixture);
  queryClient.setQueryData(invalidKey, balancesSnapshotFixture);
  let poll: (() => void) | undefined;
  const state = createBalanceFreshnessState();
  await startBalanceFreshness({ actionId: "action-a", session: verifiedSession, queryClient, state,
    clock: { now: () => 0, setTimer: (callback) => { poll = callback; return callback; }, clearTimer: () => {} },
    fetchVerifiedResource: async (endpoint, _signal, query) => {
      if (endpoint === "/api/actions") return { actions: [{ id: "action-a", summary: { amounts: [{ assetId: "usdc" }] } }] };
      const params = new URLSearchParams(query);
      const scope = parseBalancesScope(params.get("region"), params.get("currency") ?? "none");
      if (!scope) throw new Error("Invalid requested valuation scope");
      return buildBalancesSnapshotFixture({ ...scope, registry: { usdc: { balance: ready("1000000") } } });
    },
  });
  expect(poll).toBeFunction();
  await act(async () => { poll?.(); await flushMicrotasks(); });
  await waitFor(() => expect(state.moved.has("action-a")).toBe(true));
  for (const scope of scopes) {
    const snapshot = queryClient.getQueryData<BalancesSnapshot>(ownerQueryKey(ownerKey, "balances", scope.region, scope.currency ?? "none"));
    expect(snapshot?.quoteCurrency).toBe(scope.currency);
    expect(snapshot?.holdings.find((holding) => holding.id === "usdc")?.balance.baseUnits).toBe("1000000");
  }
  expect(queryClient.getQueryData(legacyKey)).toBe(balancesSnapshotFixture);
  expect(queryClient.getQueryData(invalidKey)).toBe(balancesSnapshotFixture);
  resetBalanceFreshness(state);
});


test.each([
  { region: "US", currency: "EUR" }, { region: "GLOBAL", currency: "USD" }, { region: "GLOBAL", currency: null },
] as const)("authenticated balances retain the requested valuation scope $region/$currency", async (scope) => {
  queryClient = getHomeQueryClient();
  const hook = renderHook(() => {
    const transport = useAuthenticatedTransport({ session: verifiedSession, status: "verified", verification: "server", ownerKey,
      ownerFence: generationFence(), getAccessToken: async () => "fixture-token", sessionFetch: async (path) => {
        const url = new URL(String(path), "https://home.invalid");
        if (url.pathname !== "/api/balances") throw new Error("Unexpected request");
        const requested = parseBalancesScope(url.searchParams.get("region"), url.searchParams.get("currency") ?? "none");
        if (!requested) return Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
        return Response.json(buildBalancesSnapshotFixture({ ...requested, registry: { usdc: { balance: ready("5000000") } } }));
      },
    });
    return useBalances({ subject: "subject", smartAccountAddress: balancesSnapshotFixture.owner.address, chainId: 8453, accountProvider: "cdp-embedded" }, scope, transport.fetchBalances);
  });
  await waitFor(() => expect(hook.result.current.status).toBe("ready"));
  expect(hook.result.current.snapshot?.region).toBe(scope.region);
  expect(hook.result.current.snapshot?.quoteCurrency).toBe(scope.currency);
  expect(hook.result.current.snapshot?.holdings.find((holding) => holding.id === "usdc")?.balance.baseUnits).toBe("5000000");
});

import { expect, test } from "bun:test";
import { skipToken, type QueryKey } from "@tanstack/react-query";
import { activityWindowScope, afterActionScopes, applyActionHandleEffects, indexedScopes, invalidateAfterAction, registerActivityWindowAdvancer, requalifyBalancesAfterSettlement, type BalanceActionMarker } from "./after-action";
import { homeRefreshScopes } from "@/client/home/use-home-refresh";
import { createHomeQueryClient, dehydrateOwnerQueries, ownerQueryKey, publicQueryKey } from "./query-client";
import { ownerQuery } from "./query-options";
import { queryScopes, type OwnerQueryScope, type PublicQueryScope, type QueryScope } from "./query-scopes";

const owner = "scope-test-owner";
const handledPath = "/api/actions/action-123/handle";
const ownerScopes = Object.keys(queryScopes).filter((scope): scope is OwnerQueryScope =>
  queryScopes[scope as QueryScope].audience === "owner");

test("borrow market detail is immediately stale while the overview retains its short freshness window", () => {
  expect(queryScopes["borrow-market"].staleTime).toBe(0);
  expect(queryScopes["borrow-market"].audience).toBe("owner");
  expect(queryScopes["borrow-market"].persistence).toBe("owner");
  expect(queryScopes["borrow-market"].mutatedByActions).toBe(true);
  expect(queryScopes.borrow.staleTime).toBe(15_000);
});

for (const scope of Object.keys(queryScopes) as QueryScope[]) {
  if (!queryScopes[scope].mutatedByActions) continue;
  test(`${scope} is invalidated after a confirmed action or refreshed on pull`, async () => {
    const client = createHomeQueryClient();
    const key = queryScopes[scope].audience === "owner"
      ? ownerQueryKey(owner, scope as OwnerQueryScope)
      : publicQueryKey(scope as PublicQueryScope);
    client.setQueryData(key, { value: 1 });
    await applyActionHandleEffects({
      path: handledPath, body: { transactionHash: "0x1234" }, dataOwnerKey: owner,
      queryClient: client, startBalanceFreshness: () => {},
    });
    const invalidated = client.getQueryState(key)?.isInvalidated === true;
    const refreshed = homeRefreshScopes.some((refreshScope) => refreshScope === scope);
    expect(invalidated || refreshed, `${scope} is neither invalidated after actions nor refreshed on pull`).toBe(true);
    client.clear();
  });
}

test("after-action marks only its owner's balances before invalidating without invalidating the marker", async () => {
  const client = createHomeQueryClient();
  const markerKey = ownerQueryKey(owner, "balances-action");
  const otherMarkerKey = ownerQueryKey("other-owner", "balances-action");
  client.setQueryData<BalanceActionMarker>(otherMarkerKey, { at: 12, fresh: { GB: true } });
  client.setQueryData<BalanceActionMarker>(markerKey, { at: 10, fresh: { US: true, GB: true } });
  const observedAt = Date.parse("2026-09-28T12:00:00.000Z");
  client.setQueryData(ownerQueryKey(owner, "balances", "US"), { fetchedAt: new Date(observedAt).toISOString(), total: 1 });
  let markerAtInvalidation: unknown;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    const queryKey: unknown = event.query.queryKey;
    if (!Array.isArray(queryKey)) return;
    const parts: unknown[] = queryKey;
    if (parts[1] === "balances" && event.query.state.isInvalidated) {
      markerAtInvalidation = client.getQueryData(markerKey);
    }
  });
  await invalidateAfterAction(client, owner, 1234);
  expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: observedAt + 1, fresh: {} });
  expect(markerAtInvalidation).toEqual({ at: observedAt + 1, fresh: {} });
  expect(client.getQueryData<BalanceActionMarker>(otherMarkerKey)).toEqual({ at: 12, fresh: { GB: true } });
  expect(client.getQueryData(ownerQueryKey("unmarked-owner", "balances-action"))).toBeUndefined();
  expect(client.getQueryState(markerKey)?.isInvalidated).toBe(false);
  expect(queryScopes["balances-action"]).toEqual({ audience: "owner", persistence: "memory", staleTime: Infinity, mutatedByActions: false });
  expect(dehydrateOwnerQueries(client, owner).queries.some((query) => query.queryKey[1] === "balances-action")).toBe(false);
  unsubscribe();
  client.clear();
});

test("a settlement event cancels an outstanding balances read and keeps the boundary monotone", async () => {
  const client = createHomeQueryClient();
  const markerKey = ownerQueryKey(owner, "balances-action");
  const balancesKey = ownerQueryKey(owner, "balances", "US");
  const observedAt = Date.parse("2026-09-28T12:00:00.000Z");
  client.setQueryData(balancesKey, { fetchedAt: new Date(observedAt).toISOString(), holdings: [] });
  client.setQueryData<BalanceActionMarker>(markerKey, { at: observedAt + 1, fresh: { US: true } });
  let aborted = false;
  const read = client.fetchQuery({ queryKey: balancesKey, staleTime: 0, queryFn: ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
  }) });
  expect(client.getQueryState(balancesKey)?.fetchStatus).toBe("fetching");
  requalifyBalancesAfterSettlement({ queryClient: client, dataOwnerKey: owner });
  expect(aborted).toBe(true);
  expect(client.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: observedAt + 1, fresh: {} });
  await read.catch(() => undefined);
  client.clear();
});

test("after-action delegation selects one advancer for its client and owner and skips old activity invalidation", async () => {
  const client = createHomeQueryClient();
  const otherClient = createHomeQueryClient();
  const windowKey = ownerQueryKey(owner, activityWindowScope);
  const windowEnd = "2026-09-28T12:00:00.000Z";
  client.setQueryData(windowKey, windowEnd);
  for (const scope of afterActionScopes) client.setQueryData(ownerQueryKey(owner, scope), { value: 1 });
  let firstCalls = 0;
  let secondCalls = 0;
  let otherCalls = 0;
  let finish!: () => void;
  const read = new Promise<void>((resolve) => { finish = resolve; });
  const unregisterFirst = registerActivityWindowAdvancer(client, owner, async () => { firstCalls++; await read; });
  const unregisterSecond = registerActivityWindowAdvancer(client, owner, async () => { secondCalls++; });
  const unregisterOther = registerActivityWindowAdvancer(otherClient, owner, async () => { otherCalls++; });
  let finished = false;
  const pending = invalidateAfterAction(client, owner).then(() => { finished = true; });
  expect(firstCalls).toBe(1);
  expect(secondCalls).toBe(0);
  expect(otherCalls).toBe(0);
  expect(finished).toBe(false);
  expect(client.getQueryData<string>(windowKey)).toBe(windowEnd);
  finish();
  await pending;
  for (const scope of afterActionScopes) expect(client.getQueryState(ownerQueryKey(owner, scope))?.isInvalidated).toBe(scope !== "activity");
  unregisterFirst();
  await invalidateAfterAction(client, owner);
  expect(secondCalls).toBe(1);
  unregisterSecond();
  unregisterOther();
  const now = Date.parse(windowEnd) + 1000;
  await invalidateAfterAction(client, owner, now);
  expect(client.getQueryData<string>(windowKey)).toBe(new Date(now).toISOString());
  expect(client.getQueryState(ownerQueryKey(owner, "activity"))?.isInvalidated).toBe(true);
  client.clear();
  otherClient.clear();
});

test("action and refresh scopes belong to the registered audiences", () => {
  for (const scope of [...afterActionScopes, ...indexedScopes]) {
    expect(queryScopes[scope]?.audience, scope).toBe("owner");
  }
  for (const scope of homeRefreshScopes) {
    expect(queryScopes[scope], scope).toBeDefined();
  }
});

export function rejectedScopeKeys() {
  // @ts-expect-error misspelled owner scope
  ownerQueryKey("o", "balanecs");
  // @ts-expect-error public scope used as an owner scope
  ownerQueryKey("o", "savings-vaults");
  // @ts-expect-error misspelled public scope
  publicQueryKey("savings-vault");
}

test("registered scopes build their keys", () => {
  expect(ownerQueryKey(owner, "balances")).toEqual([owner, "balances"]);
  expect(ownerQueryKey(owner, "borrow-market", "market-1")).toEqual([owner, "borrow-market", "market-1"]);
  expect(publicQueryKey("savings-vaults")).toEqual(["unauthenticated", "savings-vaults"]);
});

test("every signed-out owner scope disables its scoped key, function, and meta", () => {
  const client = createHomeQueryClient();
  const queryKey: QueryKey = [owner, "balances"];
  const query = client.getQueryCache().build(client, { queryKey, queryFn: async () => "value" });
  for (const scope of ownerScopes) {
    const options = ownerQuery({ owner: null, scope, key: ["suffix"], queryFn: async () => "value" });
    expect([...options.queryKey], scope).toEqual(["unauthenticated", `${scope}-disabled`, "suffix"]);
    expect(options.queryFn, scope).toBe(skipToken);
    expect(typeof options.enabled === "function" && options.enabled(query), scope).toBe(false);
    expect(options.meta, scope).toBeUndefined();
  }
  client.clear();
});

test("owner and disabled keys cannot collide across owners or registered scopes", () => {
  const otherOwner = "scope-test-other-owner";
  for (const scope of ownerScopes) {
    const ownerKey = ownerQuery({ owner, scope, key: ["suffix"], queryFn: async () => "value" }).queryKey;
    const otherOwnerKey = ownerQuery({ owner: otherOwner, scope, key: ["suffix"], queryFn: async () => "value" }).queryKey;
    const disabledKey = ownerQuery({ owner: null, scope, key: ["suffix"], queryFn: async () => "value" }).queryKey;
    expect(ownerKey, scope).not.toEqual(otherOwnerKey);
    for (const otherScope of Object.keys(queryScopes) as QueryScope[]) {
      if (otherScope === scope) continue;
      const otherKey: QueryKey = queryScopes[otherScope].audience === "owner"
        ? ownerQueryKey(owner, otherScope as OwnerQueryScope, "suffix")
        : publicQueryKey(otherScope as PublicQueryScope, "suffix");
      expect(disabledKey, `${scope} vs ${otherScope}`).not.toEqual(otherKey);
    }
  }
});

test("owner dehydration excludes memory scopes built from the registry", async () => {
  const client = createHomeQueryClient();
  const memory = ownerQuery({ owner, scope: "invite-link", queryFn: async () => "private-link" });
  const persisted = ownerQuery({ owner, scope: "balances", queryFn: async () => ({ total: 1 }) });
  await client.fetchQuery(memory);
  await client.fetchQuery(persisted);
  expect(dehydrateOwnerQueries(client, owner).queries.map((query) => query.queryKey)).toEqual([[owner, "balances"]]);
  client.clear();
});

import { expect, test } from "bun:test";
import { QueryObserver, skipToken, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { createHomeQueryClient, ownerQueryKey, ownerQueryMeta } from "./query-client";
import { ownerInfiniteQuery, ownerQuery, publicInfiniteQuery, publicQuery } from "./query-options";
import { queryScopes, type OwnerQueryScope } from "./query-scopes";
import { invalidateAfterAction, invalidateIndexedScopes } from "./after-action";

const owner = "owner-a";

test("owner query receives its owner and signal with registered key, meta, and stale time", async () => {
  const client = createHomeQueryClient();
  let receivedOwner: string | null = null;
  let receivedSignal: AbortSignal | null = null;
  const options = ownerQuery({
    owner, scope: "balances", key: ["US"],
    queryFn: async ({ signal }, queryOwner) => {
      receivedOwner = queryOwner;
      receivedSignal = signal;
      return { total: 3 };
    },
  });
  expect([...options.queryKey]).toEqual([owner, "balances", "US"]);
  expect(options.meta).toEqual(ownerQueryMeta(owner, "owner"));
  expect(options.staleTime).toBe(15_000);
  expect(await client.fetchQuery(options)).toEqual({ total: 3 });
  expect(String(receivedOwner)).toBe(owner);
  expect(receivedSignal).toBeInstanceOf(AbortSignal);
  client.clear();
});

test("borrow market observers revalidate a seeded cache on every mount", async () => {
  const client = createHomeQueryClient();
  let reads = 0;
  const options = ownerQuery({ owner, scope: "borrow-market", key: ["market-1"],
    queryFn: async () => `detail-${++reads}` });
  expect(options.meta).toEqual(ownerQueryMeta(owner, "owner"));
  client.setQueryData(options.queryKey, "seeded-detail");
  const first = new QueryObserver(client, options);
  const unsubscribeFirst = first.subscribe(() => {});
  expect(reads).toBe(1);
  await first.refetch({ cancelRefetch: false });
  expect(first.getCurrentResult().data).toBe("detail-1");
  unsubscribeFirst();
  const second = new QueryObserver(client, options);
  const unsubscribeSecond = second.subscribe(() => {});
  expect(reads).toBe(2);
  await second.refetch({ cancelRefetch: false });
  expect(second.getCurrentResult().data).toBe("detail-2");
  unsubscribeSecond();
  client.clear();
});

test.each([invalidateAfterAction, invalidateIndexedScopes])("action convergence revalidates active market detail without touching another owner", async (invalidate) => {
  const client = createHomeQueryClient();
  let reads = 0;
  const options = ownerQuery({ owner, scope: "borrow-market", key: ["market-1"],
    queryFn: async () => `detail-${++reads}` });
  const otherKey = ownerQueryKey("owner-b", "borrow-market", "market-1");
  client.setQueryData(otherKey, "other-owner-detail");
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch({ cancelRefetch: false });
  expect(observer.getCurrentResult().data).toBe("detail-1");
  await invalidate(client, owner);
  expect(reads).toBe(2);
  expect(observer.getCurrentResult().data).toBe("detail-2");
  expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  expect(client.getQueryData<string>(otherKey)).toBe("other-owner-detail");
  unsubscribe();
  client.clear();
});

test("parsed action and activity-order queries keep owner keys but remain memory-only", () => {
  for (const scope of ["actions", "activity-orders"] as const) {
    const options = ownerQuery({ owner, scope, queryFn: async () => [] });
    expect([...options.queryKey]).toEqual([owner, scope]);
    expect(options.meta).toEqual(ownerQueryMeta(owner, "memory"));
  }
});

test("action invalidation reaches both the default actions query and a pending-cashout subkey", async () => {
  const client = createHomeQueryClient();
  const actionsKey = ownerQueryKey(owner, "actions");
  const cashoutKey = ownerQueryKey(owner, "actions", "pending-cashout");
  let cashoutReads = 0;
  await client.fetchQuery({ queryKey: actionsKey, queryFn: async () => [] });
  await client.fetchQuery({ queryKey: cashoutKey, queryFn: async () => ({ operations: [++cashoutReads], unparsedSavingsDeposits: [] }) });
  await invalidateAfterAction(client, owner);
  expect(client.getQueryState(actionsKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(cashoutKey)?.isInvalidated).toBe(true);
  await client.refetchQueries({ queryKey: actionsKey, type: "all" });
  expect(cashoutReads).toBe(2);
  expect(client.getQueryState(cashoutKey)?.isInvalidated).toBe(false);
  await invalidateIndexedScopes(client, owner);
  expect(client.getQueryState(cashoutKey)?.isInvalidated).toBe(true);
  await client.refetchQueries({ queryKey: actionsKey, type: "all" });
  expect(cashoutReads).toBe(3);
  client.clear();
});

test("owner query keeps a late owner-a response out of owner-b cache", async () => {
  const client = createHomeQueryClient();
  let resolveOwnerA!: (value: { total: number }) => void;
  const pendingOwnerA = new Promise<{ total: number }>((resolve) => { resolveOwnerA = resolve; });
  const ownerA = ownerQuery({ owner: "owner-a", scope: "balances", key: ["US"], queryFn: () => pendingOwnerA });
  const fetchOwnerA = client.fetchQuery(ownerA);
  const ownerB = ownerQuery({ owner: "owner-b", scope: "balances", key: ["US"], queryFn: async () => ({ total: 2 }) });
  expect(ownerB.queryKey).not.toEqual(ownerA.queryKey);
  expect(client.getQueryState(ownerA.queryKey)?.fetchStatus).toBe("fetching");
  expect(client.getQueryData(ownerB.queryKey)).toBeUndefined();
  resolveOwnerA({ total: 3 });
  await fetchOwnerA;
  expect(client.getQueryData<{ total: number }>(ownerA.queryKey)).toEqual({ total: 3 });
  expect(client.getQueryData(ownerB.queryKey)).toBeUndefined();
  client.clear();
});

test("memory-only owner scope does not inherit owner persistence", () => {
  const options = ownerQuery({ owner, scope: "invite-link", queryFn: async () => "link" });
  expect(options.meta).toEqual(ownerQueryMeta(owner, "memory"));
  expect(options.staleTime).toBe(30_000);
});

test("owner query combines callback and boolean enabled settings", () => {
  for (const [enabled, expected] of [[false, false], [true, true], [() => false, false], [() => true, true]] as const) {
    const options = ownerQuery({ owner, scope: "actions", enabled, queryFn: async () => ({ actions: [] }) });
    const client = createHomeQueryClient();
    const queryKey: QueryKey = ["owner", "actions"];
    const query = client.getQueryCache().build(client, { queryKey, queryFn: async () => ({ actions: [] }) });
    expect(typeof options.enabled === "function" && options.enabled(query)).toBe(expected);
    client.clear();
  }
});

test("public query has the public key and registered freshness without owner meta", async () => {
  const client = createHomeQueryClient();
  const options = publicQuery({ scope: "savings-vaults", initialData: { count: 1 }, queryFn: async () => ({ count: 2 }) });
  expect([...options.queryKey]).toEqual(["unauthenticated", "savings-vaults"]);
  expect(options.staleTime).toBe(60_000);
  expect(options.meta).toBeUndefined();
  expect(await client.fetchQuery(options)).toEqual({ count: 1 });
  await client.invalidateQueries({ queryKey: options.queryKey });
  expect(await client.fetchQuery(options)).toEqual({ count: 2 });
  client.clear();
});

test("caller options pass through with typed selection", () => {
  const options = ownerQuery({
    owner, scope: "actions", retry: false, refetchInterval: 12_000,
    placeholderData: { count: 1 },
    queryFn: async () => ({ count: 2 }),
    select: (data) => String(data.count),
  });
  const selected: string | undefined = options.select?.({ count: 2 });
  expect(selected).toBe("2");
  expect(options.retry).toBe(false);
  expect(options.refetchInterval).toBe(12_000);
  expect(options.placeholderData).toEqual({ count: 1 });
});

test("public infinite query passes keys and page parameters through", async () => {
  const client = createHomeQueryClient();
  const publicPages: number[] = [];
  const shared = publicInfiniteQuery<{ value: number }, number>({
    scope: "invest-search", key: ["btc"], initialPageParam: 2,
    queryFn: async ({ pageParam }) => { publicPages.push(pageParam); return { value: pageParam }; },
    getNextPageParam: (page) => page.value + 1,
  });
  expect([...shared.queryKey]).toEqual(["unauthenticated", "invest-search", "btc"]);
  expect(shared.staleTime).toBe(60_000);
  expect(shared.meta).toBeUndefined();
  expect((await client.fetchInfiniteQuery(shared)).pages).toEqual([{ value: 2 }]);
  expect(publicPages).toEqual([2]);
  client.clear();
});

test("signed-out infinite owner query stays disabled with its scoped key", () => {
  const options = ownerInfiniteQuery<{ value: number }, number>({
    owner: null, scope: "activity", key: ["window"], initialPageParam: 0,
    queryFn: async ({ pageParam }) => ({ value: pageParam }),
    getNextPageParam: () => undefined,
  });
  expect([...options.queryKey]).toEqual(["unauthenticated", "activity-disabled", "window"]);
  expect(options.queryFn).toBe(skipToken);
  expect(options.meta).toBeUndefined();
  const client = createHomeQueryClient();
  const queryKey: QueryKey = ["owner", "activity"];
  const query = client.getQueryCache().build<{ value: number }, Error, InfiniteData<{ value: number }, number>, QueryKey>(
    client, { queryKey, queryFn: async () => ({ value: 0 }) },
  );
  expect(typeof options.enabled === "function" && options.enabled(query)).toBe(false);
  client.clear();
});

const ownerScopes = Object.keys(queryScopes).filter((scope): scope is OwnerQueryScope =>
  queryScopes[scope as keyof typeof queryScopes].audience === "owner");

for (const scope of ownerScopes) {
  test(`${scope} fences a deferred response to its original owner key`, async () => {
    const client = createHomeQueryClient();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    const first = ownerQuery({ owner: "owner-a", scope, queryFn: () => pending });
    const second = ownerQuery({ owner: "owner-b", scope, queryFn: async () => "owner-b" });
    const request = client.fetchQuery(first);
    expect(second.queryKey).not.toEqual(first.queryKey);
    expect(client.getQueryData(second.queryKey)).toBeUndefined();
    resolve("owner-a");
    await expect(request).resolves.toBe("owner-a");
    expect(client.getQueryData<unknown>(first.queryKey)).toBe("owner-a");
    expect(client.getQueryData(second.queryKey)).toBeUndefined();
    client.clear();
  });

  test(`${scope} keeps cached data after a failed refetch`, async () => {
    const client = createHomeQueryClient();
    let fails = false;
    const options = ownerQuery({ owner: "owner-a", scope, retry: false,
      queryFn: async () => { if (fails) throw new Error("read failed"); return "cached"; },
    });
    expect(await client.fetchQuery(options)).toBe("cached");
    fails = true;
    await expect(client.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow("read failed");
    expect(client.getQueryData<unknown>(options.queryKey)).toBe("cached");
    expect(client.getQueryState(options.queryKey)?.status).toBe("error");
    client.clear();
  });
}

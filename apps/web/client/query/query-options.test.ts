import { expect, test } from "bun:test";
import { skipToken, type QueryKey } from "@tanstack/react-query";
import { createHomeQueryClient, ownerQueryMeta } from "./query-client";
import { ownerQuery, publicInfiniteQuery, publicQuery } from "./query-options";

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

test("signed-out owner query uses disabled key, skip token and enabled false", () => {
  const options = ownerQuery({ owner: null, scope: "invite-link", key: ["suffix"], queryFn: async () => "link" });
  expect([...options.queryKey]).toEqual(["unauthenticated", "invite-link-disabled", "suffix"]);
  expect(options.queryFn).toBe(skipToken);
  expect(options.meta).toBeUndefined();
  const client = createHomeQueryClient();
  const queryKey: QueryKey = ["owner", "invite-link"];
  const query = client.getQueryCache().build(client, { queryKey, queryFn: async () => "link" });
  expect(typeof options.enabled === "function" && options.enabled(query)).toBe(false);
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

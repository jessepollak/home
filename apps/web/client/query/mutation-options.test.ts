import { FUNDING_OPEN_ORDER_VERSION } from "@/shared/funding/contracts/open-order";
import { expect, spyOn, test } from "bun:test";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { clearOwnerQueryBoundary, createHomeQueryClient, dehydrateOwnerQueries, ownerQueryKey } from "./query-client";
import { invalidateMutationScopes, ownerMutation } from "./mutation-options";
import { readQuoteDraft } from "@/shared/funding/contracts/quotes";

const activityKey = ownerQueryKey("owner-a", "activity-orders");

function mutation<TData, TVariables>(
  client: ReturnType<typeof createHomeQueryClient>,
  options: ReturnType<typeof ownerMutation<TData, TVariables>>,
) {
  return client.getMutationCache().build(client, options);
}

test("a successful mutation invalidates each declared owner key once and refetches inactive queries when requested", async () => {
  const client = createHomeQueryClient();
  const openKey = ownerQueryKey("owner-a", "funding-open-order", "US");
  let reads = 0;
  await client.fetchQuery({ queryKey: openKey, queryFn: async () => { reads += 1; return { version: FUNDING_OPEN_ORDER_VERSION, order: null }; } });
  client.setQueryData(activityKey, { orders: [] });
  const invalidate = spyOn(client, "invalidateQueries");
  const operation = mutation(client, ownerMutation({
    owner: "owner-a",
    invalidates: [{ scope: "funding-open-order", key: ["US"], refetchType: "all" }, { scope: "activity-orders" }],
    mutationFn: async (id: string) => id,
  }));
  expect(await operation.execute("order-1")).toBe("order-1");
  expect(operation.state.status).toBe("success");
  expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
    { queryKey: openKey, refetchType: "all" }, { queryKey: activityKey },
  ]);
  expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true);
  expect(reads).toBe(2);
  invalidate.mockRestore();
  client.clear();
});

for (const [label, error] of [
  ["rejected request", new Error("request failed")],
  ["aborted request", new DOMException("aborted", "AbortError")],
] as const) {
  test(`${label} does not invalidate on failure`, async () => {
    const client = createHomeQueryClient();
    client.setQueryData(activityKey, { orders: [] });
    const invalidate = spyOn(client, "invalidateQueries");
    const operation = mutation(client, ownerMutation({
      owner: "owner-a", invalidates: [{ scope: "activity-orders" }],
      mutationFn: async () => { throw error; },
    }));
    await expect(operation.execute(undefined)).rejects.toEqual(error);
    expect(operation.state.status).toBe("error");
    expect(invalidate).not.toHaveBeenCalled();
    expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
    invalidate.mockRestore();
    client.clear();
  });
}

test("a parse failure inside a mutation does not invalidate", async () => {
  const client = createHomeQueryClient();
  client.setQueryData(activityKey, { orders: [] });
  const invalidate = spyOn(client, "invalidateQueries");
  const operation = mutation(client, ownerMutation({
    owner: "owner-a", invalidates: [{ scope: "activity-orders" }],
    mutationFn: async () => {
      const parsed = readQuoteDraft({ version: 0 });
      if (!parsed) throw new Error("quote");
      return parsed;
    },
  }));
  await expect(operation.execute(undefined)).rejects.toThrow("quote");
  expect(operation.state.status).toBe("error");
  expect(invalidate).not.toHaveBeenCalled();
  expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  invalidate.mockRestore();
  client.clear();
});

test("a null owner does not add mutation metadata or invalidate", async () => {
  const client = createHomeQueryClient();
  client.setQueryData(activityKey, { orders: [] });
  const invalidate = spyOn(client, "invalidateQueries");
  const operation = mutation(client, ownerMutation({ owner: null, invalidates: [{ scope: "activity-orders" }], mutationFn: async () => 1 }));
  expect(operation.meta).toBeUndefined();
  expect(await operation.execute(undefined)).toBe(1);
  expect(invalidate).not.toHaveBeenCalled();
  invalidate.mockRestore();
  client.clear();
});

test("per-call invalidations resolve the region from variables without touching another owner", async () => {
  const client = createHomeQueryClient();
  const usKey = ownerQueryKey("owner-a", "funding-open-order", "US");
  const arKey = ownerQueryKey("owner-a", "funding-open-order", "AR");
  const otherOwner = ownerQueryKey("owner-b", "funding-open-order", "US");
  for (const key of [usKey, arKey, otherOwner]) client.setQueryData(key, { version: FUNDING_OPEN_ORDER_VERSION, order: null });
  const operation = mutation(client, ownerMutation({
    owner: "owner-a",
    invalidates: (variables: { region: string }) => [{ scope: "funding-open-order", key: [variables.region] }],
    mutationFn: async (variables: { region: string }) => variables.region,
  }));
  expect(await operation.execute({ region: "US" })).toBe("US");
  expect(client.getQueryState(usKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(arKey)?.isInvalidated).toBe(false);
  expect(client.getQueryState(otherOwner)?.isInvalidated).toBe(false);
  expect(await operation.execute({ region: "AR" })).toBe("AR");
  expect(client.getQueryState(arKey)?.isInvalidated).toBe(true);
  client.clear();
});

test("malformed or missing mutation metadata is ignored", async () => {
  const client = createHomeQueryClient();
  const invalidate = spyOn(client, "invalidateQueries");
  for (const meta of [undefined, null, {}, { ownerKey: "", invalidates: [{ scope: "activity-orders" }] },
    { ownerKey: "owner-a", invalidates: "activity-orders" },
    { ownerKey: "owner-a", invalidates: [{ scope: 12 }] },
    { ownerKey: "owner-a", invalidates: [{ scope: "activity-orders", key: "bad" }] }]) {
    await invalidateMutationScopes(client, meta);
  }
  expect(invalidate).not.toHaveBeenCalled();
  invalidate.mockRestore();
  client.clear();
});

async function exerciseOfflineMutation(afterAssertions?: () => void) {
  const client = createHomeQueryClient();
  const wasOnline = onlineManager.isOnline();
  let pausedCompletion: Promise<string> | undefined;
  onlineManager.setOnline(false);
  try {
    const request = mutation(client, ownerMutation({
      owner: "owner-a", invalidates: [{ scope: "activity-orders" }],
      mutationFn: async (_token: string) => { throw new TypeError("offline"); },
    }));
    await expect(request.execute("private-token")).rejects.toThrow("offline");
    expect(request.state.isPaused).toBe(false);
    const paused = client.getMutationCache().build(client, { networkMode: "online", mutationFn: async (token: string) => token });
    pausedCompletion = paused.execute("private-token");
    await Promise.resolve();
    expect(paused.state.isPaused).toBe(true);
    expect(JSON.stringify(dehydrateOwnerQueries(client, "owner-a"))).not.toContain("private-token");
    afterAssertions?.();
  } finally {
    const focused = spyOn(focusManager, "isFocused").mockReturnValue(true);
    try {
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      if (pausedCompletion) await pausedCompletion;
    } finally {
      focused.mockRestore();
      onlineManager.setOnline(wasOnline);
      client.clear();
    }
  }
}

test("an offline POST runs and fails immediately instead of pausing, and owner persistence never stores mutations", () => exerciseOfflineMutation());

test("offline cleanup preserves document-driven focus after success or an assertion failure", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const testDocument = { visibilityState: "hidden" };
  const wasOnline = onlineManager.isOnline();
  Object.defineProperty(globalThis, "document", { configurable: true, value: testDocument });
  try {
    expect(focusManager.isFocused()).toBe(false);
    await exerciseOfflineMutation();
    expect(focusManager.isFocused()).toBe(false);
    expect(onlineManager.isOnline()).toBe(wasOnline);
    testDocument.visibilityState = "visible";
    expect(focusManager.isFocused()).toBe(true);
    testDocument.visibilityState = "hidden";
    await expect(exerciseOfflineMutation(() => { throw new Error("assertion failed"); })).rejects.toThrow("assertion failed");
    expect(focusManager.isFocused()).toBe(false);
    expect(onlineManager.isOnline()).toBe(wasOnline);
    testDocument.visibilityState = "visible";
    expect(focusManager.isFocused()).toBe(true);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("an owner boundary drops retained POST variables and results even when the next owner's queries are preserved", async () => {
  const client = createHomeQueryClient();
  const request = client.getMutationCache().build(client, { gcTime: 60_000, mutationFn: async (email: string) => ({ handoff: `https://provider.invalid/?t=${email}` }) });
  await request.execute("owner-a@example.com");
  client.setQueryData(ownerQueryKey("owner-b", "activity-orders"), { orders: [] });
  clearOwnerQueryBoundary(client, undefined, "owner-b");
  expect(client.getMutationCache().getAll()).toEqual([]);
  expect(client.getQueryData<{ orders: unknown[] }>(ownerQueryKey("owner-b", "activity-orders"))).toEqual({ orders: [] });
});

import { describe, expect, test } from "bun:test";
import { normalizeAccountResourcePath, qualifyBalancesForUnrecordedHandle } from "./cdp-authenticated-transport";
import {
  afterActionScopes,
  applyActionHandleEffects,
  createBalanceFreshnessState,
  indexedScopes,
  networkFeePolicyScope,
  settleBalanceFreshness,
  initialActivityWindowEnd,
} from "@/client/query/after-action";
import { createHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";

const actionId = "11111111-1111-4111-8111-111111111111";
const path = `/api/actions/${actionId}/handle`;
const ownerKey = "subject\u00000x1111111111111111111111111111111111111111\u00008453\u0000cdp-embedded";

function queryClientFixture() {
  const client = createHomeQueryClient();
  const invalidations: unknown[][] = [];
  client.invalidateQueries = async (filters) => {
    const { queryKey, predicate } = filters ?? {};
    if (queryKey) invalidations.push([...queryKey]);
    if (predicate) {
      for (const key of [
        [ownerKey, networkFeePolicyScope],
        ["other-owner", networkFeePolicyScope],
        ["other-owner", "balances"],
      ]) {
        const queryKey: readonly unknown[] = key;
        const query = client.getQueryCache().build(client, { queryKey });
        if (predicate(query)) invalidations.push(key);
      }
    }
  };
  return { client, invalidations };
}

describe("authenticated account resources", () => {
  test("allows country preference writes without opening unrelated account endpoints", () => {
    expect(normalizeAccountResourcePath("/api/account/country-preference"))
      .toBe("/api/account/country-preference");
    expect(() => normalizeAccountResourcePath("/api/account/private"))
      .toThrow();
    expect(normalizeAccountResourcePath("/api/invites/link"))
      .toBe("/api/invites/link");
    expect(() => normalizeAccountResourcePath("/api/invites/private"))
      .toThrow();
    expect(normalizeAccountResourcePath("/api/activity/orders")).toBe("/api/activity/orders");
  });
});

describe("authenticated action handle effects", () => {
  test("starts balance freshness when the provider handle is recorded", async () => {
    const fixture = queryClientFixture();
    const freshness: string[] = [];

    await applyActionHandleEffects({
      path,
      body: { providerHandle: `0x${"ab".repeat(32)}` },
      dataOwnerKey: ownerKey,
      queryClient: fixture.client,
      startBalanceFreshness: (id) => { freshness.push(id); },
    });

    expect(freshness).toEqual([actionId]);
    expect(fixture.invalidations).toEqual([[ownerKey, "actions"], [ownerKey, "activity-orders"]]);
  });

  test("one transaction hash post advances Activity and invalidates action scopes and every owner's fee policy", async () => {
    const fixture = queryClientFixture();
    const freshness: string[] = [];
    const initialWindow = initialActivityWindowEnd(Date.parse("2026-09-12T12:00:00.000Z"));
    fixture.client.setQueryData(ownerQueryKey(ownerKey, "activity-window"), initialWindow);

    await applyActionHandleEffects({
      path,
      body: { transactionHash: `0x${"cd".repeat(32)}` },
      dataOwnerKey: ownerKey,
      queryClient: fixture.client,
      startBalanceFreshness: (id) => { freshness.push(id); },
    });

    expect(fixture.invalidations).toEqual(
      [[ownerKey, networkFeePolicyScope], ["other-owner", networkFeePolicyScope], ...afterActionScopes.map((scope) => [ownerKey, scope])],
    );
    expect(new Set(fixture.invalidations.map((key) => key.join("\u0000"))).size).toBe(afterActionScopes.length + 2);
    expect(fixture.client.getQueryData(ownerQueryKey(ownerKey, "activity-window")))
      .not.toBe(initialWindow);
    expect(freshness).toEqual([actionId]);
  });
  test("a settled freshness run refreshes the indexer-backed scopes again", async () => {
    const fixture = queryClientFixture();
    const state = createBalanceFreshnessState();

    await settleBalanceFreshness({
      queryClient: fixture.client,
      dataOwnerKey: ownerKey,
      state,
      actionId,
      result: "moved",
    });

    expect(state.moved.has(actionId)).toBe(true);
    expect(fixture.invalidations).toEqual([
      ...indexedScopes.map((scope) => [ownerKey, scope]),
      [ownerKey, networkFeePolicyScope],
      ["other-owner", networkFeePolicyScope],
    ]);
    expect(fixture.invalidations.some(([, scope]) => scope === "balances")).toBe(false);
  });
});

describe("unrecorded handle qualification", () => {
  test("a handle record that may have landed qualifies the owner's balances", async () => {
    for (const [status, unreadable] of [[null, false], [409, false], [503, false], [200, true]] as const) {
      const client = createHomeQueryClient();
      const balancesKey = ownerQueryKey(ownerKey, "balances", "US");
      client.setQueryData(balancesKey, { version: 5, holdings: [] });
      const invalidated = new Promise<void>((resolve) => {
        const unsubscribe = client.getQueryCache().subscribe((event) => {
          if (event.query.queryKey[1] !== "balances" || !event.query.state.isInvalidated) return;
          unsubscribe();
          resolve();
        });
      });
      qualifyBalancesForUnrecordedHandle({ queryClient: client, dataOwnerKey: ownerKey, recordsHandle: true, status, unreadable });
      expect(client.getQueryData(ownerQueryKey(ownerKey, "balances-action"))).toBeDefined();
      await invalidated;
    }
  });

  test("a definite rejection or a non-handle request leaves balances unqualified", () => {
    for (const input of [
      { recordsHandle: true, status: 400, unreadable: false },
      { recordsHandle: true, status: 403, unreadable: false },
      { recordsHandle: true, status: 429, unreadable: false },
      { recordsHandle: false, status: null, unreadable: false },
      { recordsHandle: false, status: 503, unreadable: false },
    ] as const) {
      const client = createHomeQueryClient();
      qualifyBalancesForUnrecordedHandle({ queryClient: client, dataOwnerKey: ownerKey, ...input });
      expect(client.getQueryData(ownerQueryKey(ownerKey, "balances-action"))).toBeUndefined();
    }
  });
});

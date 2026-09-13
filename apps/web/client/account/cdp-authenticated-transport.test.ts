import { describe, expect, test } from "bun:test";
import {
  afterActionScopes,
  applyActionHandleEffects,
  createBalanceFreshnessState,
  indexedScopes,
  settleBalanceFreshness,
  initialActivityWindowEnd,
} from "@/client/query/after-action";

const actionId = "11111111-1111-4111-8111-111111111111";
const path = `/api/actions/${actionId}/handle`;
const ownerKey = "subject\u00000x1111111111111111111111111111111111111111\u00008453\u0000cdp-embedded";

function queryClientFixture() {
  const data = new Map<string, unknown>();
  const invalidations: unknown[][] = [];
  return {
    invalidations,
    client: {
      getQueryData: (queryKey: readonly unknown[]) => data.get(JSON.stringify(queryKey)),
      setQueryData: (queryKey: readonly unknown[], value: unknown) => {
        data.set(JSON.stringify(queryKey), value);
        return value;
      },
      invalidateQueries: async ({ queryKey }: { queryKey?: readonly unknown[] }) => {
        invalidations.push([...(queryKey ?? [])]);
      },
    },
  };
}

describe("authenticated action handle effects", () => {
  test("starts balance freshness when the provider handle is recorded", async () => {
    const fixture = queryClientFixture();
    const freshness: string[] = [];

    await applyActionHandleEffects({
      path,
      body: { providerHandle: `0x${"ab".repeat(32)}` },
      dataOwnerKey: ownerKey,
      queryClient: fixture.client as never,
      startBalanceFreshness: (id) => { freshness.push(id); },
    });

    expect(freshness).toEqual([actionId]);
    expect(fixture.invalidations).toEqual([[ownerKey, "actions"]]);
  });

  test("one transaction hash post advances Activity and invalidates all six scopes once", async () => {
    const fixture = queryClientFixture();
    const freshness: string[] = [];
    const initialWindow = initialActivityWindowEnd(Date.parse("2026-09-12T12:00:00.000Z"));
    fixture.client.setQueryData([ownerKey, "activity-window"], initialWindow);

    await applyActionHandleEffects({
      path,
      body: { transactionHash: `0x${"cd".repeat(32)}` },
      dataOwnerKey: ownerKey,
      queryClient: fixture.client as never,
      startBalanceFreshness: (id) => { freshness.push(id); },
    });

    expect(fixture.invalidations).toEqual(
      afterActionScopes.map((scope) => [ownerKey, scope]),
    );
    expect(new Set(fixture.invalidations.map((key) => key.join("\u0000"))).size).toBe(6);
    expect(fixture.client.getQueryData([ownerKey, "activity-window"]))
      .not.toBe(initialWindow);
    expect(freshness).toEqual([actionId]);
  });
  test("a settled freshness run refreshes the indexer-backed scopes again", async () => {
    const fixture = queryClientFixture();
    const state = createBalanceFreshnessState();

    await settleBalanceFreshness({
      queryClient: fixture.client as never,
      dataOwnerKey: ownerKey,
      state,
      actionId,
      result: "moved",
    });

    expect(state.moved.has(actionId)).toBe(true);
    expect(fixture.invalidations).toEqual(indexedScopes.map((scope) => [ownerKey, scope]));
    expect(fixture.invalidations.some(([, scope]) => scope === "valuation")).toBe(false);
  });
});

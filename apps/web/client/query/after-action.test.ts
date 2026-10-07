import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";
import { balancesSnapshotFixture } from "@/shared/balances/fixtures";
import {
  applyActionHandleEffects,
  freshRegionMarker,
  highestBlockNumber,
  invalidateAfterAction,
  requalifyBalancesAfterSettlement,
  snapshotProvesFreshness,
  type BalanceActionMarker,
} from "./after-action";
import { createHomeQueryClient, ownerQueryKey } from "./query-client";
import { trustRestoredBalanceActionMarker } from "./restored-cache";

const now = Date.parse("2026-09-13T12:00:10.000Z");
const ownerKey = `user-1\u0000${balancesSnapshotFixture.owner.address}\u00008453\u0000cdp-embedded`;
const clients: QueryClient[] = [];
const client = () => {
  const queryClient = createHomeQueryClient();
  clients.push(queryClient);
  return queryClient;
};
beforeEach(() => setSystemTime(new Date(now)));
afterEach(() => {
  for (const queryClient of clients) queryClient.clear();
  clients.length = 0;
  setSystemTime();
});

const snapshotAt = (number: string) => ({
  ...balancesSnapshotFixture,
  block: { ...balancesSnapshotFixture.block, number },
});

describe("post-action balance qualification", () => {
  test.each([
    [false, false], [false, true], [true, false], [true, true],
  ])("a matching handle's identical settlement replay preserves consumed proof %s and another boundary %s", async (consumed, outstanding) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    const balancesKey = ownerQueryKey(ownerKey, "balances", "US");
    queryClient.setQueryData(balancesKey, balancesSnapshotFixture);
    if (outstanding) await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    await applyActionHandleEffects({
      path: "/api/actions/action-a/handle", body: { transactionHash: "0x123" },
      response: {
        version: 1,
        action: {
          id: "action-a", provider: "p", kind: "send",
          summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2026-09-13T12:01:00.000Z" },
          status: "unknown", createdAt: "2026-09-13T12:00:00.000Z", confirmedAt: "2026-09-13T12:00:00.000Z",
          submittedAt: "2026-09-13T12:00:05.000Z", settledBlockNumber: "35123457",
          owner: { subject: "user-1", address: balancesSnapshotFixture.owner.address, chainId: 8453, accountProvider: "cdp-embedded" },
        },
      },
      dataOwnerKey: ownerKey, queryClient, startBalanceFreshness: () => {},
    });
    const settled = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    if (!settled) throw new Error("Expected the settlement marker");
    const provingSnapshot = { ...snapshotAt("35123457"), fetchedAt: new Date(settled.at + 1).toISOString() };
    queryClient.setQueryData(balancesKey, provingSnapshot);
    if (consumed) {
      const fresh = freshRegionMarker(settled, settled, "US", provingSnapshot);
      expect(fresh?.fresh.US).toBe(true);
      queryClient.setQueryData(markerKey, fresh);
    }
    const beforeReplay = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    if (!beforeReplay) throw new Error("Expected the marker before settlement replay");
    requalifyBalancesAfterSettlement({
      queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457",
      serverAt: "2026-09-13T12:00:20.000Z",
    });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(beforeReplay);
    expect(beforeReplay.fresh).toEqual(consumed ? { US: true } : {});
    expect(beforeReplay.dispatchedActionIds).toEqual(outstanding ? ["action-b"] : undefined);
    expect(snapshotProvesFreshness(snapshotAt("35123457"), beforeReplay)).toBe(!outstanding);
    expect(snapshotProvesFreshness({ ...provingSnapshot, block: { ...provingSnapshot.block, number: "35123456" } }, beforeReplay)).toBe(false);
  });

  test.each([
    ["higher block", "action-a", "106", undefined, "105", "106", undefined],
    ["different action", "action-b", "105", undefined, "105", "105", undefined],
    ["same-action boundary", "action-a", "105", ["action-a", "action-b"], "105", "105", ["action-b"]],
    ["lower block", "action-a", "104", undefined, "105", "105", undefined],
    ["absent block", "action-a", undefined, undefined, "105", "105", ["action-a"]],
    ["malformed block", "action-a", "0105", undefined, "105", "105", ["action-a"]],
    ["identical malformed proof", "action-a", "0105", undefined, "0105", undefined, ["action-a"]],
  ] as const)("a %s settlement still requalifies rather than taking the replay shortcut", (_label, actionId, settledBlock, boundaries, retainedBlock, expectedBlock, expectedBoundaries) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(markerKey, {
      at: now, fresh: { US: true }, settledActionId: "action-a", settledBlock: retainedBlock,
      ...(boundaries ? { dispatchedActionIds: [...boundaries] } : {}),
    });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId, settledBlock });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    if (!marker) throw new Error("Expected the settlement marker");
    expect(marker.fresh).toEqual({});
    expect(marker.settledActionId).toBe(actionId);
    expect(marker.settledBlock).toBe(expectedBlock);
    expect(marker.dispatchedActionIds).toEqual(expectedBoundaries ? [...expectedBoundaries] : undefined);
    expect(marker.at).toBe(now);
  });

  test("an identical settlement preserves another action's boundary and sticky overflow", () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    const marker: BalanceActionMarker = {
      at: now, fresh: { US: true }, settledActionId: "action-a", settledBlock: "105",
      dispatchedActionIds: ["action-b"], dispatchedOverflow: true,
    };
    queryClient.setQueryData(markerKey, marker);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(marker);
    expect(snapshotProvesFreshness(snapshotAt("105"), marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...snapshotAt("105"), fetchedAt: new Date(now + 1).toISOString() }, marker)).toBe(true);
  });

  test("a first settlement establishes proof for a new owner despite another owner's identical marker", () => {
    const queryClient = client();
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    const newOwnerKey = ownerKey.replace("user-1", "user-2");
    queryClient.setQueryData(ownerQueryKey(newOwnerKey, "balances", "US"), snapshotAt("104"));
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: newOwnerKey, actionId: "action-a", settledBlock: "105" });
    const marker = queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(newOwnerKey, "balances-action"));
    if (!marker) throw new Error("Expected the new owner's settlement marker");
    expect(marker).toEqual({ at: Date.parse(balancesSnapshotFixture.fetchedAt) + 1, fresh: {}, settledBlock: "105", settledActionId: "action-a" });
    expect(snapshotProvesFreshness(snapshotAt("104"), marker)).toBe(false);
  });

  test("a block-less replay still advances its timestamp boundary and clears consumed freshness", () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(markerKey, { at: now, fresh: { US: true }, settledBlock: "105", settledActionId: "action-a", dispatchedActionIds: ["action-a"] });
    const serverAt = "2026-09-13T12:00:20.000Z";
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    if (!marker) throw new Error("Expected the block-less settlement marker");
    expect(marker).toEqual({ at: Date.parse(serverAt), fresh: {}, settledBlock: "105", settledActionId: "action-a", dispatchedActionIds: ["action-a"] });
    expect(snapshotProvesFreshness({ ...snapshotAt("105"), fetchedAt: serverAt }, marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...snapshotAt("105"), fetchedAt: "2026-09-13T12:00:20.001Z" }, marker)).toBe(true);
  });

  test.each(["35123457", "35123458"])("a replayed dispatch cannot replace another action's boundary before its settlement at %s", async (settledBlock) => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedActionIds).toEqual(["action-b", "action-a"]);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(marker).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-b"],
      settledBlock: "35123457", settledActionId: "action-a",
    });
    expect(snapshotProvesFreshness(snapshotAt("35123457"), marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...snapshotAt("35123457"), fetchedAt: "2026-09-13T12:00:00.002Z" }, marker)).toBe(true);
    expect(snapshotProvesFreshness({ ...snapshotAt("35123456"), fetchedAt: "2026-09-13T12:00:00.002Z" }, marker)).toBe(false);

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual(marker);
    expect(snapshotProvesFreshness(snapshotAt("35123457"), queryClient.getQueryData<BalanceActionMarker>(markerKey)!)).toBe(false);

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock });
    const settledMarker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(settledMarker).not.toHaveProperty("dispatchedActionIds");
    expect(settledMarker.settledActionId).toBe("action-b");
    expect(settledMarker.settledBlock).toBe(settledBlock);
    expect(snapshotProvesFreshness(snapshotAt(settledBlock), settledMarker)).toBe(true);
  });

  test("a delayed lower-block settlement removes only its boundary and keeps the higher block proof", async () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock: "35123458" });
    const higherBlockSnapshot = snapshotAt("35123458");
    const pendingMarker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(pendingMarker.dispatchedActionIds).toEqual(["action-a"]);
    expect(snapshotProvesFreshness(higherBlockSnapshot, pendingMarker)).toBe(false);

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    const settledMarker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(settledMarker).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, settledBlock: "35123458", settledActionId: "action-a",
    });
    expect(snapshotProvesFreshness(higherBlockSnapshot, settledMarker)).toBe(true);
  });

  test("a hot registry-only refresh proves freshness after the dispatch boundary's own action settles", async () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    const marker = queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))!;
    expect(marker).not.toHaveProperty("dispatchedActionIds");
    expect(marker.settledActionId).toBe("action-a");
    expect(snapshotProvesFreshness(snapshotAt("35123457"), marker)).toBe(true);
  });

  test.each([
    ["older", "35123456", false],
    ["equal", "35123457", true],
    ["higher", "35123458", true],
    ["zero", "0", false],
    ["malformed", "035123457", false],
    ["fractional", "35123457.0", false],
  ] as const)("a %s snapshot block proves freshness only at or after settlement", (_label, block, fresh) => {
    expect(snapshotProvesFreshness(snapshotAt(block), { at: now, fresh: {}, settledBlock: "35123457" })).toBe(fresh);
  });

  test("block ordering remains exact above the safe integer range", () => {
    const marker = { at: now, fresh: {}, settledBlock: "9007199254740993" };
    expect(snapshotProvesFreshness(snapshotAt("9007199254740992"), marker)).toBe(false);
    expect(snapshotProvesFreshness(snapshotAt("9007199254740993"), marker)).toBe(true);
  });

  test("a stale snapshot never proves freshness even at the settled block", () => {
    expect(snapshotProvesFreshness({ ...snapshotAt("35123457"), stale: true }, {
      at: 0, fresh: {}, settledBlock: "35123457",
    })).toBe(false);
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, stale: true }, { at: 0, fresh: {} })).toBe(false);
  });

  test.each([undefined, null])("a missing snapshot %s cannot prove freshness", (snapshot) => {
    expect(snapshotProvesFreshness(snapshot, { at: 0, fresh: {} })).toBe(false);
  });

  test("without a settled block, freshness requires fetchedAt strictly after the marker", () => {
    const marker = { at: Date.parse("2026-09-13T12:00:00.000Z"), fresh: {} };
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T11:59:59.999Z" }, marker)).toBe(false);
    expect(snapshotProvesFreshness(balancesSnapshotFixture, marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:00.001Z" }, marker)).toBe(true);
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "invalid" }, marker)).toBe(false);
  });

  test.each(["", "035123456", "35123456.0", "-1", "+1", "1e3", " 35123456"])(
    "malformed settled block %s never proves freshness",
    (settledBlock) => {
      expect(snapshotProvesFreshness(balancesSnapshotFixture, { at: 0, fresh: {}, settledBlock })).toBe(false);
    },
  );

  test.each(["104", undefined, "0106"])("requalification with %s retains the higher settled block", (settledBlock) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(markerKey, { at: now, fresh: { US: true }, settledBlock: "105", settledActionId: "action-a" });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({
      at: now, fresh: {}, settledBlock: "105", settledActionId: "action-a",
      ...(settledBlock === "104" ? {} : { dispatchedActionIds: ["action-a"] }),
    });
    expect(snapshotProvesFreshness(snapshotAt("104"), queryClient.getQueryData<BalanceActionMarker>(markerKey)!)).toBe(false);
  });

  test("a dispatched action settling without a block keeps its timestamp requirement and the prior settlement proof", async () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), snapshotAt("105"));
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    const previous = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(snapshotProvesFreshness(snapshotAt("105"), previous)).toBe(false);
    queryClient.setQueryData(markerKey, { ...previous, fresh: { US: true } });

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b" });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(marker).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-b"],
      settledBlock: "105", settledActionId: "action-b",
    });
    expect(snapshotProvesFreshness({ ...snapshotAt("104"), fetchedAt: "2026-09-13T12:00:00.002Z" }, marker)).toBe(false);
    expect(snapshotProvesFreshness(snapshotAt("105"), marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...snapshotAt("105"), fetchedAt: "2026-09-13T12:00:00.002Z" }, marker)).toBe(true);
  });

  test("a replayed handle after a block-less settlement keeps the action's timestamp boundary", async () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    const preDispatchSnapshot = snapshotAt("105");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), preDispatchSnapshot);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    const settledMarker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(snapshotProvesFreshness(preDispatchSnapshot, settledMarker)).toBe(true);
    queryClient.setQueryData(markerKey, { ...settledMarker, fresh: { US: true } });

    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b" });
    const beforeReplay = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(beforeReplay.dispatchedActionIds).toEqual(["action-b"]);
    await applyActionHandleEffects({
      path: "/api/actions/action-b/handle", body: { transactionHash: "0x123" },
      dataOwnerKey: ownerKey, queryClient, startBalanceFreshness: () => {},
    });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(marker).toEqual(beforeReplay);
    expect(marker.dispatchedActionIds).toEqual(["action-b"]);
    expect(marker.settledBlock).toBe("105");
    expect(snapshotProvesFreshness(preDispatchSnapshot, marker)).toBe(false);
    expect(freshRegionMarker(marker, marker, "US", preDispatchSnapshot)).toBeUndefined();
    const newerSnapshot = { ...preDispatchSnapshot, fetchedAt: "2026-09-13T12:00:00.002Z" };
    expect(snapshotProvesFreshness(newerSnapshot, marker)).toBe(true);
    expect(freshRegionMarker(marker, marker, "US", newerSnapshot)).toEqual({ ...marker, fresh: { US: true } });
  });

  test("a replayed handle restores its settled block proof after another action overwrites the settlement identity", async () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    const snapshot = snapshotAt("35123457");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), snapshot);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock: "35123457" });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123456" });

    await applyActionHandleEffects({
      path: "/api/actions/action-b/handle", body: { transactionHash: "0x123" },
      response: {
        version: 1,
        action: {
          id: "action-b", provider: "p", kind: "send",
          summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2026-09-13T12:01:00.000Z" },
          status: "unknown", createdAt: "2026-09-13T12:00:00.000Z", confirmedAt: "2026-09-13T12:00:00.000Z",
          settledBlockNumber: "35123457",
          owner: { subject: "user-1", address: balancesSnapshotFixture.owner.address, chainId: 8453, accountProvider: "cdp-embedded" },
        },
      },
      dataOwnerKey: ownerKey, queryClient, startBalanceFreshness: () => {},
    });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    expect(marker?.dispatchedActionIds).toBeUndefined();
    expect(marker?.settledActionId).toBe("action-b");
    expect(marker?.settledBlock).toBe("35123457");
    expect(marker ? snapshotProvesFreshness(snapshot, marker) : false).toBe(true);
  });

  test.each([
    ["a different action id", "action-c", "user-1"],
    ["a different owner", "action-b", "user-2"],
  ] as const)("a handle response for %s cannot settle this action's boundary", async (_label, responseId, subject) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), snapshotAt("35123457"));
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock: "35123457" });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123456" });

    await applyActionHandleEffects({
      path: "/api/actions/action-b/handle", body: { transactionHash: "0x123" },
      response: {
        version: 1,
        action: {
          id: responseId, provider: "p", kind: "send",
          summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2026-09-13T12:01:00.000Z" },
          status: "unknown", createdAt: "2026-09-13T12:00:00.000Z", confirmedAt: "2026-09-13T12:00:00.000Z",
          settledBlockNumber: "35123457",
          owner: { subject, address: balancesSnapshotFixture.owner.address, chainId: 8453, accountProvider: "cdp-embedded" },
        },
      },
      dataOwnerKey: ownerKey, queryClient, startBalanceFreshness: () => {},
    });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    expect(marker?.dispatchedActionIds).toEqual(["action-b"]);
    expect(marker?.settledActionId).toBe("action-a");
  });

  test.each([undefined, "0106"])("an undispatched action settling with block %s establishes its timestamp boundary", (settledBlock) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    const preSettlementSnapshot = snapshotAt("105");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), preSettlementSnapshot);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    const settledMarker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(snapshotProvesFreshness(preSettlementSnapshot, settledMarker)).toBe(true);
    queryClient.setQueryData(markerKey, { ...settledMarker, fresh: { US: true } });

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(marker).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-b"],
      settledBlock: "105", settledActionId: "action-b",
    });
    expect(snapshotProvesFreshness(preSettlementSnapshot, marker)).toBe(false);
    expect(freshRegionMarker(marker, marker, "US", preSettlementSnapshot)).toBeUndefined();
    const newerSnapshot = { ...preSettlementSnapshot, fetchedAt: "2026-09-13T12:00:00.002Z" };
    expect(snapshotProvesFreshness(newerSnapshot, marker)).toBe(true);
    expect(freshRegionMarker(marker, marker, "US", newerSnapshot)).toEqual({ ...marker, fresh: { US: true } });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual(marker);
  });

  test("a different action with a block keeps the highest proof and records the new action identity", () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock: "104" });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: 1, fresh: {}, settledBlock: "105", settledActionId: "action-b" });
  });

  test.each([
    [undefined, undefined, undefined],
    ["invalid", "01", undefined],
    [undefined, "105", "105"],
    ["105", undefined, "105"],
    ["invalid", "105", "105"],
    ["105", "invalid", "105"],
    ["104", "105", "105"],
    ["105", "104", "105"],
    ["105", "105", "105"],
    ["0", undefined, "0"],
    ["9007199254740992", "9007199254740993", "9007199254740993"],
  ] as const)("highest block of %s and %s is %s", (left, right, expected) => {
    expect(highestBlockNumber(left, right)).toBe(expected);
  });

  test("a newer settlement boundary fences a rendered snapshot even when the timestamp is unchanged", () => {
    const observed = { at: now, fresh: {}, settledBlock: "100" };
    const current = { ...observed, settledBlock: "105" };
    expect(snapshotProvesFreshness(snapshotAt("100"), observed)).toBe(true);
    expect(freshRegionMarker(current, observed, "US", snapshotAt("100"))).toBeUndefined();
    expect(current.fresh).toEqual({});
  });

  test.each([
    ["missing current marker", undefined, snapshotAt("105")],
    ["changed timestamp", { at: now + 1, fresh: {}, settledBlock: "105" }, snapshotAt("105")],
    ["changed settled block", { at: now, fresh: {}, settledBlock: "106" }, snapshotAt("106")],
    ["already fresh region", { at: now, fresh: { US: true }, settledBlock: "105" }, snapshotAt("105")],
    ["earlier snapshot", { at: now, fresh: {}, settledBlock: "105" }, snapshotAt("104")],
    ["stale snapshot", { at: now, fresh: {}, settledBlock: "105" }, { ...snapshotAt("105"), stale: true }],
    ["missing snapshot", { at: now, fresh: {}, settledBlock: "105" }, undefined],
    ["null snapshot", { at: now, fresh: {}, settledBlock: "105" }, null],
  ] as const)("a %s cannot mark the region fresh", (_label, current, snapshot) => {
    expect(freshRegionMarker(current, { at: now, fresh: {}, settledBlock: "105" }, "US", snapshot)).toBeUndefined();
  });

  test.each([
    ["replaced boundary", { dispatchedActionIds: ["action-c", "action-b"] }],
    ["added boundary", { dispatchedActionIds: ["action-a", "action-b", "action-c"] }],
    ["removed boundary", { dispatchedActionIds: ["action-a"] }],
    ["cleared boundaries", { dispatchedActionIds: undefined }],
    ["settlement identity", { settledActionId: "action-b" }],
    ["overflow boundary", { dispatchedOverflow: true as const }],
  ])("a changed %s fences a rendered snapshot with an unchanged timestamp and block", (_label, change) => {
    const observed = { at: now, fresh: {}, dispatchedActionIds: ["action-a", "action-b"], settledActionId: "action-a", settledBlock: "105" };
    const current = { ...observed, ...change };
    const snapshot = { ...snapshotAt("105"), fetchedAt: "2026-09-13T12:00:10.002Z" };
    expect(snapshotProvesFreshness(snapshot, current)).toBe(true);
    expect(freshRegionMarker(current, observed, "US", snapshot)).toBeUndefined();
  });

  test("reordered outstanding boundaries do not fence a proving snapshot", () => {
    const observed = { at: now, fresh: {}, dispatchedActionIds: ["action-a", "action-b"], settledBlock: "105" };
    const current = { ...observed, dispatchedActionIds: ["action-b", "action-a"] };
    const snapshot = { ...snapshotAt("105"), fetchedAt: "2026-09-13T12:00:10.002Z" };
    expect(freshRegionMarker(current, observed, "US", snapshot)).toEqual({ ...current, fresh: { US: true } });
  });

  test("empty and absent outstanding boundaries allow the same block-only proof", () => {
    const observed = { at: now, fresh: {}, settledBlock: "105" };
    const current = { ...observed, dispatchedActionIds: [] };
    expect(snapshotProvesFreshness(snapshotAt("105"), current)).toBe(true);
    expect(freshRegionMarker(current, observed, "US", snapshotAt("105"))).toEqual({ ...current, fresh: { US: true } });
    expect(freshRegionMarker(observed, current, "US", snapshotAt("105"))).toEqual({ ...observed, fresh: { US: true } });
  });

  test.each(["105", "106"])("a snapshot at block %s marks only its region fresh", (block) => {
    const current: BalanceActionMarker = { at: now, fresh: { GLOBAL: true }, settledBlock: "105" };
    expect(freshRegionMarker(current, { ...current, fresh: {} }, "US", snapshotAt(block))).toEqual({
      at: now, fresh: { GLOBAL: true, US: true }, settledBlock: "105",
    });
    expect(current.fresh).toEqual({ GLOBAL: true });
  });

  test("a block-less settlement raises the boundary to its server-issued instant", () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    requalifyBalancesAfterSettlement({
      queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt: "2026-09-13T12:00:05.000Z",
    });
    const marker = queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"));
    if (!marker) throw new Error("Expected the settlement marker");
    expect(marker).toEqual({ at: Date.parse("2026-09-13T12:00:05.000Z"), fresh: {}, dispatchedActionIds: ["action-a"], settledActionId: "action-a" });
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:04.000Z" }, marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:05.000Z" }, marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:05.001Z" }, marker)).toBe(true);
  });

  test.each([undefined, "invalid", "2026-09-13T12:00:01.000Z"])("settlement instant %s cannot lower an existing boundary", (serverAt) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    queryClient.setQueryData(markerKey, { at: now, fresh: { US: true } });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    if (!marker) throw new Error("Expected the settlement marker");
    expect(marker).toEqual({ at: now, fresh: {}, dispatchedActionIds: ["action-a"], settledActionId: "action-a" });
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:09.999Z" }, marker)).toBe(false);
  });

  test("a server-issued dispatch instant rejects observations newer than the cache but older than the dispatch", async () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt: "2026-09-13T12:00:05.000Z", now });
    const marker = queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))!;
    expect(marker.at).toBe(Date.parse("2026-09-13T12:00:05.000Z"));
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:04.000Z" }, marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:05.000Z" }, marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:05.001Z" }, marker)).toBe(true);
  });

  test.each([undefined, "invalid", "2026-09-13T11:59:59.000Z"])("dispatch instant %s falls back to the newest cached source boundary", async (serverAt) => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt, now });
    expect(queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))?.at).toBe(Date.parse("2026-09-13T12:00:00.000Z") + 1);
  });

  test.each(["2026-09-13T12:00:01.000Z", undefined, "invalid"])("a late callback with dispatch instant %s cannot lower the boundary", async (serverAt) => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", serverAt: "2026-09-13T12:00:05.000Z", now });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt, now });
    const marker = queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))!;
    expect(marker).toEqual({ at: Date.parse("2026-09-13T12:00:05.000Z"), fresh: {}, dispatchedActionIds: ["action-b", "action-a"] });
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:04.000Z" }, marker)).toBe(false);
  });

  test.each([false, true])("a replayed dispatch retains settlement proof with another outstanding action: %s", async (outstanding) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    if (outstanding) await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    queryClient.setQueryData(markerKey, { ...queryClient.getQueryData<BalanceActionMarker>(markerKey)!, fresh: { US: true } });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt: "2026-09-13T12:00:05.000Z", now });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(marker).toEqual({
      at: Date.parse("2026-09-13T12:00:05.000Z"), fresh: {}, settledBlock: "35123457", settledActionId: "action-a",
      ...(outstanding ? { dispatchedActionIds: ["action-b"] } : {}),
    });
    expect(snapshotProvesFreshness({ ...snapshotAt("35123456"), fetchedAt: "2026-09-13T12:00:06.000Z" }, marker)).toBe(false);
    expect(snapshotProvesFreshness(snapshotAt("35123457"), marker)).toBe(!outstanding);
  });

  const handleAction = {
    id: "action-a", provider: "cdp-embedded", kind: "send",
    summary: { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2026-09-13T12:03:00.000Z" },
    status: "pending", createdAt: "2026-09-13T12:00:00.000Z", confirmedAt: "2026-09-13T12:00:01.000Z",
    submittedAt: "2026-09-13T12:00:05.000Z",
    owner: { subject: "user-1", address: balancesSnapshotFixture.owner.address, chainId: 8453, accountProvider: "cdp-embedded" },
  };
  const sourceBoundary = Date.parse(balancesSnapshotFixture.fetchedAt) + 1;
  const handleResponseCases = [
    ["matching action and owner", { version: 1, action: handleAction }, Date.parse(handleAction.submittedAt)],
    ["matching case-insensitive address", { version: 1, action: { ...handleAction, owner: { ...handleAction.owner, address: handleAction.owner.address.toUpperCase() } } }, Date.parse(handleAction.submittedAt)],
    ["mismatched action id", { version: 1, action: { ...handleAction, id: "action-b" } }, sourceBoundary],
    ["mismatched owner subject", { version: 1, action: { ...handleAction, owner: { ...handleAction.owner, subject: "user-2" } } }, sourceBoundary],
    ["mismatched owner address", { version: 1, action: { ...handleAction, owner: { ...handleAction.owner, address: "0x2222222222222222222222222222222222222222" } } }, sourceBoundary],
    ["mismatched owner chain", { version: 1, action: { ...handleAction, owner: { ...handleAction.owner, chainId: 1 } } }, sourceBoundary],
    ["zero owner chain", { version: 1, action: { ...handleAction, owner: { ...handleAction.owner, chainId: 0 } } }, sourceBoundary],
    ["mismatched owner provider", { version: 1, action: { ...handleAction, owner: { ...handleAction.owner, accountProvider: "base-account" } } }, sourceBoundary],
    ["missing version", { action: handleAction }, sourceBoundary],
    ["malformed body", { version: 1, action: [] }, sourceBoundary],
    ["malformed instant", { version: 1, action: { ...handleAction, submittedAt: "invalid" } }, sourceBoundary],
    ["non-string instant", { version: 1, action: { ...handleAction, submittedAt: 1 } }, sourceBoundary],
    ["absent instant", { version: 1, action: { ...handleAction, submittedAt: undefined } }, sourceBoundary],
    ["incomplete action", { version: 1, action: { id: handleAction.id, owner: handleAction.owner, submittedAt: handleAction.submittedAt } }, sourceBoundary],
    ["missing response", undefined, sourceBoundary],
  ] as const;

  test.each(handleResponseCases)("handle effects bind the response instant to the dispatch: %s", async (_label, response, at) => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    const starts: string[] = [];
    await applyActionHandleEffects({
      path: "/api/actions/action-a/handle", body: { transactionHash: "0x123", submittedAt: "2026-09-13T12:00:09.000Z" }, response,
      dataOwnerKey: ownerKey, queryClient, startBalanceFreshness: (actionId) => { starts.push(actionId); },
    });
    expect(starts).toEqual(["action-a"]);
    expect(queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))).toEqual({ at, fresh: {}, dispatchedActionIds: ["action-a"] });
  });

  test("invalidateAfterAction records a different dispatch action and retains the settled block and action identity", async () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    expect(queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1,
      fresh: {},
      dispatchedActionIds: ["action-b"],
      settledBlock: "35123457", settledActionId: "action-a",
    });
    const marker = queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))!;
    expect(snapshotProvesFreshness({ ...snapshotAt("35123456"), fetchedAt: "2026-09-13T12:00:05.000Z" }, marker)).toBe(false);
  });

  test("dispatch boundaries are deduplicated and capped at the 16 newest action ids", async () => {
    const queryClient = client();
    for (let index = 0; index < 16; index += 1) {
      await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, now });
    }
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-0", now });
    expect(queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))).not.toHaveProperty("dispatchedOverflow");
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-16", now });
    const marker = queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))!;
    expect(marker.dispatchedActionIds).toEqual([
      ...Array.from({ length: 14 }, (_, index) => `action-${index + 2}`), "action-0", "action-16",
    ]);
    expect(marker.dispatchedOverflow).toBe(true);
  });

  test("block-less settlements establish deduplicated boundaries capped at 16 action ids with sticky overflow", () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "settled-action", settledBlock: "105" });
    for (let index = 0; index < 16; index += 1) {
      requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}` });
    }
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-0" });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedActionIds).toEqual(Array.from({ length: 16 }, (_, index) => `action-${index}`));
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).not.toHaveProperty("dispatchedOverflow");
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-16" });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(marker.dispatchedActionIds).toEqual(Array.from({ length: 16 }, (_, index) => `action-${index + 1}`));
    expect(marker.dispatchedOverflow).toBe(true);
    expect(marker.settledBlock).toBe("105");
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-16", settledBlock: "106" });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-1" });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedOverflow).toBe(true);
  });

  test("an overflowed dispatch boundary survives every retained settlement and requires a newer observation", async () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    for (let index = 0; index < 17; index += 1) {
      await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, serverAt: "2026-09-13T12:00:05.000Z", now });
    }
    const retained = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(retained.dispatchedActionIds).toEqual(Array.from({ length: 16 }, (_, index) => `action-${index + 1}`));
    expect(retained.dispatchedOverflow).toBe(true);
    for (const actionId of retained.dispatchedActionIds!) {
      requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId, settledBlock: "35123457" });
      expect(snapshotProvesFreshness(snapshotAt("35123457"), queryClient.getQueryData<BalanceActionMarker>(markerKey)!)).toBe(false);
    }
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey)!;
    expect(marker).not.toHaveProperty("dispatchedActionIds");
    expect(marker.dispatchedOverflow).toBe(true);
    expect(snapshotProvesFreshness({ ...snapshotAt("35123457"), fetchedAt: "2026-09-13T12:00:05.000Z" }, marker)).toBe(false);
    const fresh = { ...snapshotAt("35123457"), fetchedAt: "2026-09-13T12:00:05.001Z" };
    expect(snapshotProvesFreshness(fresh, marker)).toBe(true);
    expect(freshRegionMarker(marker, marker, "US", fresh)).toEqual({ ...marker, fresh: { US: true } });
    expect(snapshotProvesFreshness({ ...fresh, block: { ...fresh.block, number: "35123456" } }, marker)).toBe(false);

    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-17", now });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedOverflow).toBe(true);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-0", settledBlock: "35123457" });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedOverflow).toBe(true);
  });
});

describe("restored balance action marker contract", () => {
  const entry = { ownerKey, queryKey: ownerQueryKey(ownerKey, "balances-action") };

  test("normalizes valid markers with optional settlement proof", () => {
    expect(trustRestoredBalanceActionMarker({ at: 0, fresh: { US: true, GLOBAL: true }, extra: "discard" }, entry)).toEqual({
      data: { at: 0, fresh: { US: true, GLOBAL: true } },
    });
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, settledBlock: "0" }, entry)).toEqual({
      data: { at: now, fresh: {}, settledBlock: "0" },
    });
  });

  test.each(["action-a", "a".repeat(64)])("restores a valid settlement action identity %s", (settledActionId) => {
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, settledBlock: "105", settledActionId }, entry)).toEqual({
      data: { at: now, fresh: {}, settledBlock: "105", settledActionId },
    });
  });

  test.each([
    ["action-a"],
    ["a".repeat(64)],
    Array.from({ length: 16 }, (_, index) => `action-${index}`),
  ])("restores valid outstanding dispatch action ids %j", (...dispatchedActionIds) => {
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, settledBlock: "105", dispatchedActionIds, settledActionId: "action-a" }, entry)).toEqual({
      data: { at: now, fresh: {}, settledBlock: "105", dispatchedActionIds, settledActionId: "action-a" },
    });
  });

  test("restores receipt proof and settled identity alongside another dispatch boundary", () => {
    const marker = { at: now, fresh: {}, settledBlock: "105", settledActionId: "action-a", dispatchedActionIds: ["action-b"] };
    const restored = trustRestoredBalanceActionMarker(marker, entry);
    expect(restored).toEqual({ data: marker });
    expect(snapshotProvesFreshness({ ...snapshotAt("104"), fetchedAt: "2026-09-13T12:00:11.000Z" }, restored!.data as BalanceActionMarker)).toBe(false);
    expect(snapshotProvesFreshness(snapshotAt("105"), restored!.data as BalanceActionMarker)).toBe(false);
    expect(snapshotProvesFreshness({ ...snapshotAt("105"), fetchedAt: "2026-09-13T12:00:11.000Z" }, restored!.data as BalanceActionMarker)).toBe(true);
  });

  test("deduplicates outstanding dispatch action ids on restore", () => {
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, dispatchedActionIds: ["action-a", "action-b", "action-a"] }, entry)).toEqual({
      data: { at: now, fresh: {}, dispatchedActionIds: ["action-a", "action-b"] },
    });
  });

  test("restores a literal true overflow boundary without tracked action ids", () => {
    const marker = { at: now, fresh: {}, dispatchedOverflow: true, settledBlock: "105" };
    const restored = trustRestoredBalanceActionMarker(marker, entry);
    expect(restored).toEqual({ data: marker });
    expect(snapshotProvesFreshness(snapshotAt("105"), restored!.data as BalanceActionMarker)).toBe(false);
  });

  test.each([false, 1, "true"])("rejects overflow boundary %j on restore", (dispatchedOverflow) => {
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, dispatchedOverflow }, entry)).toBeNull();
  });

  test("drops empty outstanding dispatch action ids on restore", () => {
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, dispatchedActionIds: [] }, entry)).toEqual({
      data: { at: now, fresh: {} },
    });
  });

  test.each([
    ["non-record", null],
    ["negative timestamp", { at: -1, fresh: {} }],
    ["non-finite timestamp", { at: Infinity, fresh: {} }],
    ["NaN timestamp", { at: Number.NaN, fresh: {} }],
    ["string timestamp", { at: "1", fresh: {} }],
    ["non-record freshness", { at: 0, fresh: [] }],
    ["unknown region", { at: 0, fresh: { UNKNOWN: true } }],
    ["false freshness", { at: 0, fresh: { US: false } }],
    ["malformed block", { at: 0, fresh: {}, settledBlock: "01" }],
    ["numeric block", { at: 0, fresh: {}, settledBlock: 1 }],
    ["empty action identity", { at: 0, fresh: {}, settledActionId: "" }],
    ["numeric action identity", { at: 0, fresh: {}, settledActionId: 1 }],
    ["null action identity", { at: 0, fresh: {}, settledActionId: null }],
    ["over-long action identity", { at: 0, fresh: {}, settledActionId: "a".repeat(65) }],
    ["non-array dispatch action identities", { at: 0, fresh: {}, dispatchedActionIds: "action-a" }],
    ["null dispatch action identities", { at: 0, fresh: {}, dispatchedActionIds: null }],
    ["empty dispatch action identity", { at: 0, fresh: {}, dispatchedActionIds: [""] }],
    ["non-string dispatch action identity", { at: 0, fresh: {}, dispatchedActionIds: ["action-a", 1] }],
    ["over-long dispatch action identity", { at: 0, fresh: {}, dispatchedActionIds: ["a".repeat(65)] }],
    ["too many dispatch action identities", { at: 0, fresh: {}, dispatchedActionIds: Array.from({ length: 17 }, (_, index) => `action-${index}`) }],
    ["too many duplicate dispatch action identities", { at: 0, fresh: {}, dispatchedActionIds: Array.from({ length: 17 }, () => "action-a") }],
  ])("rejects %s", (_label, data) => {
    expect(trustRestoredBalanceActionMarker(data, entry)).toBeNull();
  });

  test("rejects invalid owner identities and marker query shapes", () => {
    const data = { at: 0, fresh: {} };
    expect(trustRestoredBalanceActionMarker(data, { ...entry, ownerKey: "invalid" })).toBeNull();
    expect(trustRestoredBalanceActionMarker(data, { ownerKey, queryKey: [ownerKey, "balances-action", "US"] })).toBeNull();
    expect(trustRestoredBalanceActionMarker(data, { ownerKey, queryKey: [ownerKey, "balances"] })).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import * as afterAction from "./after-action";
import { recentActionsQuery } from "@/client/actions/recent-actions-query";
import type { RecentActionsPayload, RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
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

function isBalanceActionMarker(value: unknown): value is BalanceActionMarker {
  return typeof value === "object" && value !== null && "at" in value && typeof value.at === "number" && "fresh" in value;
}

function readMarker(client: { getQueryData: (key: readonly unknown[]) => unknown }, key: readonly unknown[]): BalanceActionMarker {
  const marker = client.getQueryData(key);
  if (!isBalanceActionMarker(marker)) throw new Error("The balance marker is missing.");
  return marker;
}

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
    ["same-action boundary", "action-a", "105", ["action-a", "action-b"], "105", "105", ["action-b"]],
    ["absent block", "action-a", undefined, undefined, "105", "105", ["action-a"]],
    ["malformed block", "action-a", "0105", undefined, "105", "105", ["action-a"]],
    ["identical malformed proof", "action-a", "0105", undefined, "0105", undefined, ["action-a"]],
  ] as const)("a %s settlement still requalifies rather than taking the replay shortcut", (_label, actionId, settledBlock, boundaries, retainedBlock, expectedBlock, expectedBoundaries) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(markerKey, {
      at: now, fresh: { US: true }, settledActionIds: ["action-a"], settledBlock: retainedBlock,
      ...(boundaries ? { dispatchedActionIds: [...boundaries] } : {}),
    });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId, settledBlock });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    if (!marker) throw new Error("Expected the settlement marker");
    expect(marker.fresh).toEqual({});
    expect(marker.settledActionIds).toEqual(["action-a"]);
    expect(marker.settledBlock).toBe(expectedBlock);
    expect(marker.dispatchedActionIds).toEqual(expectedBoundaries ? [...expectedBoundaries] : undefined);
    expect(marker.at).toBe(now);
  });

  test("an identical settlement preserves another action's boundary and sticky overflow", () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    const marker: BalanceActionMarker = {
      at: now, fresh: { US: true }, settledActionIds: ["action-a"], settledBlock: "105",
      dispatchedActionIds: ["action-b"], dispatchedOverflow: true, dispatchedOverflowAt: now,
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
    expect(marker).toEqual({ at: Date.parse(balancesSnapshotFixture.fetchedAt) + 1, fresh: {}, settledBlock: "105", settledActionIds: ["action-a"] });
    expect(snapshotProvesFreshness(snapshotAt("104"), marker)).toBe(false);
  });

  test("a block-less replay still advances its timestamp boundary and clears consumed freshness", () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(markerKey, { at: now, fresh: { US: true }, settledBlock: "105", settledActionIds: ["action-a"], dispatchedActionIds: ["action-a"] });
    const serverAt = "2026-09-13T12:00:20.000Z";
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt });
    const marker = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    if (!marker) throw new Error("Expected the block-less settlement marker");
    expect(marker).toEqual({ at: Date.parse(serverAt), fresh: {}, settledBlock: "105", settledActionIds: ["action-a"], dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": now } });
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
    const marker = readMarker(queryClient, markerKey);
    expect(marker).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-b"], dispatchedAt: { "action-b": now },
      settledBlock: "35123457", settledActionIds: ["action-a"],
    });
    expect(snapshotProvesFreshness(snapshotAt("35123457"), marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...snapshotAt("35123457"), fetchedAt: "2026-09-13T12:00:00.002Z" }, marker)).toBe(true);
    expect(snapshotProvesFreshness({ ...snapshotAt("35123456"), fetchedAt: "2026-09-13T12:00:00.002Z" }, marker)).toBe(false);

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual(marker);
    expect(snapshotProvesFreshness(snapshotAt("35123457"), readMarker(queryClient, markerKey))).toBe(false);

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock });
    const settledMarker = readMarker(queryClient, markerKey);
    expect(settledMarker).not.toHaveProperty("dispatchedActionIds");
    expect(settledMarker.settledActionIds).toEqual(["action-a", "action-b"]);
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
    const pendingMarker = readMarker(queryClient, markerKey);
    expect(pendingMarker.dispatchedActionIds).toEqual(["action-a"]);
    expect(snapshotProvesFreshness(higherBlockSnapshot, pendingMarker)).toBe(false);

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    const settledMarker = readMarker(queryClient, markerKey);
    expect(settledMarker).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, settledBlock: "35123458", settledActionIds: ["action-b", "action-a"],
    });
    expect(snapshotProvesFreshness(higherBlockSnapshot, settledMarker)).toBe(true);
  });

  test("a hot registry-only refresh proves freshness after the dispatch boundary's own action settles", async () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    const marker = readMarker(queryClient, ownerQueryKey(ownerKey, "balances-action"));
    expect(marker).not.toHaveProperty("dispatchedActionIds");
    expect(marker.settledActionIds).toEqual(["action-a"]);
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
    queryClient.setQueryData(markerKey, { at: now, fresh: { US: true }, settledBlock: "105", settledActionIds: ["action-a"] });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({
      at: now, fresh: settledBlock === "104" ? { US: true } : {}, settledBlock: "105", settledActionIds: ["action-a"],
      ...(settledBlock === "104" ? {} : { dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": now } }),
    });
    expect(snapshotProvesFreshness(snapshotAt("104"), readMarker(queryClient, markerKey))).toBe(false);
  });

  test("a dispatched action settling without a block keeps its timestamp requirement and the prior settlement proof", async () => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), snapshotAt("105"));
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    const previous = readMarker(queryClient, markerKey);
    expect(snapshotProvesFreshness(snapshotAt("105"), previous)).toBe(false);
    queryClient.setQueryData(markerKey, { ...previous, fresh: { US: true } });

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b" });
    const marker = readMarker(queryClient, markerKey);
    expect(marker).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-b"],
      settledBlock: "105", settledActionIds: ["action-a", "action-b"], dispatchedAt: { "action-b": now },
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
    const settledMarker = readMarker(queryClient, markerKey);
    expect(snapshotProvesFreshness(preDispatchSnapshot, settledMarker)).toBe(true);
    queryClient.setQueryData(markerKey, { ...settledMarker, fresh: { US: true } });

    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b" });
    const beforeReplay = readMarker(queryClient, markerKey);
    expect(beforeReplay.dispatchedActionIds).toEqual(["action-b"]);
    await applyActionHandleEffects({
      path: "/api/actions/action-b/handle", body: { transactionHash: "0x123" },
      dataOwnerKey: ownerKey, queryClient, startBalanceFreshness: () => {},
    });
    const marker = readMarker(queryClient, markerKey);
    expect(marker).toEqual(beforeReplay);
    expect(marker.dispatchedActionIds).toEqual(["action-b"]);
    expect(marker.settledBlock).toBe("105");
    expect(snapshotProvesFreshness(preDispatchSnapshot, marker)).toBe(false);
    expect(freshRegionMarker(marker, marker, "US", preDispatchSnapshot)).toBeUndefined();
    const newerSnapshot = { ...preDispatchSnapshot, fetchedAt: "2026-09-13T12:00:00.002Z" };
    expect(snapshotProvesFreshness(newerSnapshot, marker)).toBe(true);
    expect(freshRegionMarker(marker, marker, "US", newerSnapshot)).toEqual({ ...marker, fresh: { US: true } });
  });

  test("a replayed handle retains its settled block proof after another action settles", async () => {
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
    expect(marker?.settledActionIds).toEqual(["action-b", "action-a"]);
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
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", reopen: true, now });

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
    expect(marker?.settledActionIds).toEqual(["action-a"]);
  });

  test.each([undefined, "0106"])("an undispatched action settling with block %s establishes its timestamp boundary", (settledBlock) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    const preSettlementSnapshot = snapshotAt("105");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), preSettlementSnapshot);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    const settledMarker = readMarker(queryClient, markerKey);
    expect(snapshotProvesFreshness(preSettlementSnapshot, settledMarker)).toBe(true);
    queryClient.setQueryData(markerKey, { ...settledMarker, fresh: { US: true } });

    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock });
    const marker = readMarker(queryClient, markerKey);
    expect(marker).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1, fresh: {}, dispatchedActionIds: ["action-b"],
      settledBlock: "105", settledActionIds: ["action-a", "action-b"], dispatchedAt: { "action-b": now },
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
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: 1, fresh: {}, settledBlock: "105", settledActionIds: ["action-a", "action-b"] });
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
    ["settlement identity", { settledActionIds: ["action-b"] }],
    ["overflow boundary", { dispatchedOverflow: true as const }],
  ])("a changed %s fences a rendered snapshot with an unchanged timestamp and block", (_label, change) => {
    const observed = { at: now, fresh: {}, dispatchedActionIds: ["action-a", "action-b"], settledActionIds: ["action-a"], settledBlock: "105" };
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

  test.each([
    { dispatchedConfirmedAt: { "action-a": now + 1 } },
    { dispatchedOverflowConfirmedFloor: now - 1 },
    { dispatchedOverflowGeneration: 2 },
  ])("a changed confirmation or overflow identity cannot consume rendered proof %j", (change) => {
    const observed: BalanceActionMarker = { at: now, fresh: {}, dispatchedActionIds: ["action-a"], dispatchedConfirmedAt: { "action-a": now },
      dispatchedOverflow: true, dispatchedOverflowConfirmedFloor: now, dispatchedOverflowGeneration: 1 };
    const current = { ...observed, ...change };
    const snapshot = { ...snapshotAt("105"), fetchedAt: new Date(now + 10).toISOString() };
    expect(snapshotProvesFreshness(snapshot, current)).toBe(true);
    expect(freshRegionMarker(current, observed, "US", snapshot)).toBeUndefined();
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
    expect(marker).toEqual({ at: Date.parse("2026-09-13T12:00:05.000Z"), fresh: {}, dispatchedActionIds: ["action-a"], settledActionIds: ["action-a"], dispatchedAt: { "action-a": now } });
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
    expect(marker).toEqual({ at: now, fresh: {}, dispatchedActionIds: ["action-a"], settledActionIds: ["action-a"], dispatchedAt: { "action-a": now } });
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:09.999Z" }, marker)).toBe(false);
  });

  test("a server-issued dispatch instant rejects observations newer than the cache but older than the dispatch", async () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt: "2026-09-13T12:00:05.000Z", now });
    const marker = readMarker(queryClient, ownerQueryKey(ownerKey, "balances-action"));
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
    const marker = readMarker(queryClient, ownerQueryKey(ownerKey, "balances-action"));
    expect(marker).toEqual({ at: Date.parse("2026-09-13T12:00:05.000Z"), fresh: {}, dispatchedActionIds: ["action-b", "action-a"], dispatchedAt: { "action-b": now, "action-a": now } });
    expect(snapshotProvesFreshness({ ...balancesSnapshotFixture, fetchedAt: "2026-09-13T12:00:04.000Z" }, marker)).toBe(false);
  });

  test.each([false, true])("a replayed dispatch retains settlement proof with another outstanding action: %s", async (outstanding) => {
    const queryClient = client();
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now });
    if (outstanding) await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    queryClient.setQueryData(markerKey, { ...readMarker(queryClient, markerKey), fresh: { US: true } });
    const before = readMarker(queryClient, markerKey);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt: "2026-09-13T12:00:05.000Z", now });
    const marker = readMarker(queryClient, markerKey);
    expect(marker).toBe(before);
    expect(marker).toEqual({
      at: Date.parse(balancesSnapshotFixture.fetchedAt) + 1, fresh: { US: true }, settledBlock: "35123457", settledActionIds: ["action-a"],
      ...(outstanding ? { dispatchedActionIds: ["action-b"], dispatchedAt: { "action-b": now } } : {}),
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
    const knownConfirmation = ["matching action and owner", "matching case-insensitive address", "absent instant"].includes(_label);
    expect(queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))).toEqual({
      at, fresh: {}, dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": now },
      ...(knownConfirmation ? { dispatchedConfirmedAt: { "action-a": Date.parse(handleAction.confirmedAt) } } : {}),
    });
  });

  test("invalidateAfterAction records a different dispatch action and retains the settled block and action identity", async () => {
    const queryClient = client();
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), balancesSnapshotFixture);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "35123457" });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", now });
    expect(queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action"))).toEqual({
      at: Date.parse("2026-09-13T12:00:00.000Z") + 1,
      fresh: {},
      dispatchedActionIds: ["action-b"], dispatchedAt: { "action-b": now },
      settledBlock: "35123457", settledActionIds: ["action-a"],
    });
    const marker = readMarker(queryClient, ownerQueryKey(ownerKey, "balances-action"));
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
    const marker = readMarker(queryClient, ownerQueryKey(ownerKey, "balances-action"));
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
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedActionIds).toEqual([...Array.from({ length: 15 }, (_, index) => `action-${index + 1}`), "action-0"]);
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).not.toHaveProperty("dispatchedOverflow");
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-16" });
    const marker = readMarker(queryClient, markerKey);
    expect(marker.dispatchedActionIds).toEqual([...Array.from({ length: 14 }, (_, index) => `action-${index + 2}`), "action-0", "action-16"]);
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
    const retained = readMarker(queryClient, markerKey);
    expect(retained.dispatchedActionIds).toEqual(Array.from({ length: 16 }, (_, index) => `action-${index + 1}`));
    expect(retained.dispatchedOverflow).toBe(true);
    for (const actionId of retained.dispatchedActionIds!) {
      requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId, settledBlock: "35123457" });
      expect(snapshotProvesFreshness(snapshotAt("35123457"), readMarker(queryClient, markerKey))).toBe(false);
    }
    const marker = readMarker(queryClient, markerKey);
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

describe("balance boundary maintenance", () => {
  const markerKey = ownerQueryKey(ownerKey, "balances-action");
  const day = 24 * 60 * 60 * 1_000;
  const operation = (id: string, status: RecentMoneyActionOperation["status"] = "confirmed", block: string | undefined = "105"): RecentMoneyActionOperation => ({
    action: { id, kind: "send", title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z", createdAt: new Date(now).toISOString() },
    status, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    settledAt: new Date(now + 5).toISOString(), settledBlockNumber: block,
  });
  const payload = (operations: RecentMoneyActionOperation[] = [], change: Partial<RecentActionsPayload> = {}): RecentActionsPayload => ({
    operations, retainedSavingsDeposits: [], retainedSavingsDepositsUnavailable: false,
    unparsedSavingsDeposits: [], truncated: false, incomplete: false, exhaustive: null, ...change,
  });
  const exhaustive = { since: now - day + 5 * 60 * 1_000 };
  const reconcile = (queryClient: QueryClient, read: RecentActionsPayload, time = now, readStartGeneration?: number) =>
    afterAction.reconcileBalanceBoundaries({ queryClient, dataOwnerKey: ownerKey, payload: read, now: time, readStartGeneration });

  test("exhaustive confirmed coverage after 17 abandoned dispatches clears overflow and requalifies at the highest row block", async () => {
    const queryClient = client();
    for (let index = 0; index < 17; index += 1) await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, serverConfirmedAt: new Date(now).toISOString(), now });
    const generation = afterAction.balanceBoundaryGeneration(queryClient, ownerKey);
    expect(generation).toBe(1);
    expect(readMarker(queryClient, markerKey).dispatchedOverflowConfirmedFloor).toBe(now);
    queryClient.setQueryData(markerKey, { ...readMarker(queryClient, markerKey), fresh: { US: true } });
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), { ...snapshotAt("104"), fetchedAt: new Date(now + 10).toISOString() });
    const invalidate = spyOn(queryClient, "invalidateQueries");
    reconcile(queryClient, payload(Array.from({ length: 16 }, (_, index) => operation(`action-${index + 1}`, "confirmed", "106")), {
      exhaustive, retainedSavingsDeposits: [operation("action-0", "confirmed", "109")],
    }), now, generation);
    const marker = readMarker(queryClient, markerKey);
    expect(marker.dispatchedOverflow).toBeUndefined();
    expect(marker.dispatchedOverflowAt).toBeUndefined();
    expect(marker.dispatchedOverflowConfirmedFloor).toBeUndefined();
    expect(marker.dispatchedOverflowGeneration).toBe(1);
    expect(marker.dispatchedConfirmedAt).toBeUndefined();
    expect(marker.dispatchedActionIds).toBeUndefined();
    expect(marker.settledBlock).toBe("109");
    expect(marker.at).toBe(now + 11);
    expect(marker.fresh).toEqual({});
    expect(snapshotProvesFreshness(snapshotAt("108"), marker)).toBe(false);
    expect(snapshotProvesFreshness(snapshotAt("109"), marker)).toBe(true);
    expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[1] === "balances")).toHaveLength(1);
    invalidate.mockRestore();
  });

  test.each(["older", "unknown", "invalid"] as const)("exhaustive confirmed coverage keeps an evicted %s confirmation boundary", async (state) => {
    const queryClient = client();
    const confirmedAt = state === "older" ? new Date(exhaustive.since - 1).toISOString() : state === "invalid" ? "invalid" : undefined;
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-0", serverConfirmedAt: confirmedAt, now });
    for (let index = 1; index < 17; index += 1) {
      await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, serverConfirmedAt: new Date(now).toISOString(), now });
    }
    expect(readMarker(queryClient, markerKey).dispatchedConfirmedAt).not.toHaveProperty("action-0");
    const floor = state === "older" ? exhaustive.since - 1 : 0;
    expect(readMarker(queryClient, markerKey).dispatchedOverflowConfirmedFloor).toBe(floor);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-17", serverConfirmedAt: new Date(now).toISOString(), now });
    const generation = afterAction.balanceBoundaryGeneration(queryClient, ownerKey);
    reconcile(queryClient, payload(Array.from({ length: 16 }, (_, index) => operation(`action-${index + 2}`)), { exhaustive }), now, generation);
    const marker = readMarker(queryClient, markerKey);
    expect(marker.dispatchedActionIds).toBeUndefined();
    expect(marker.dispatchedConfirmedAt).toBeUndefined();
    expect(marker.dispatchedOverflow).toBe(true);
    expect(marker.dispatchedOverflowConfirmedFloor).toBe(floor);
    expect(marker.dispatchedOverflowGeneration).toBe(2);
  });

  test("legacy overflow without a confirmation floor cannot clear from exhaustive contents", () => {
    const queryClient = client();
    const marker: BalanceActionMarker = { at: now, fresh: {}, dispatchedOverflow: true, dispatchedOverflowAt: now, dispatchedOverflowGeneration: 1 };
    queryClient.setQueryData(markerKey, marker);
    reconcile(queryClient, payload([operation("untracked")], { exhaustive }), now, 1);
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(marker);
  });

  test("an eviction after overflow clears cannot reuse a previously captured generation", async () => {
    const queryClient = client();
    for (let index = 0; index < 17; index += 1) {
      await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, serverConfirmedAt: new Date(now).toISOString(), now });
    }
    const generation = afterAction.balanceBoundaryGeneration(queryClient, ownerKey);
    reconcile(queryClient, payload(Array.from({ length: 16 }, (_, index) => operation(`action-${index + 1}`)), { exhaustive }), now, generation);
    expect(readMarker(queryClient, markerKey).dispatchedOverflow).toBeUndefined();
    expect(afterAction.balanceBoundaryGeneration(queryClient, ownerKey)).toBe(generation);
    for (let index = 0; index < 17; index += 1) {
      await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `new-action-${index}`, serverConfirmedAt: new Date(now).toISOString(), now });
    }
    expect(afterAction.balanceBoundaryGeneration(queryClient, ownerKey)).toBe(generation + 1);
    reconcile(queryClient, payload(Array.from({ length: 16 }, (_, index) => operation(`new-action-${index + 1}`)), { exhaustive }), now, generation);
    expect(readMarker(queryClient, markerKey).dispatchedOverflow).toBe(true);
    expect(readMarker(queryClient, markerKey).dispatchedOverflowGeneration).toBe(generation + 1);
    reconcile(queryClient, payload([], { exhaustive }), now, generation + 1);
    expect(readMarker(queryClient, markerKey).dispatchedOverflow).toBeUndefined();
    expect(afterAction.balanceBoundaryGeneration(queryClient, ownerKey)).toBe(generation + 1);
  });

  test("confirmation times survive dispatch and settlement rebuilds only for tracked boundaries", async () => {
    const queryClient = client();
    const confirmedAt = new Date(now - 10).toISOString();
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverConfirmedAt: confirmedAt, now });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", serverConfirmedAt: new Date(now).toISOString(), now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a" });
    expect(readMarker(queryClient, markerKey).dispatchedConfirmedAt).toEqual({ "action-a": now - 10, "action-b": now });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock: "105" });
    expect(readMarker(queryClient, markerKey).dispatchedConfirmedAt).toEqual({ "action-a": now - 10 });
    reconcile(queryClient, payload([operation("action-a")]));
    expect(readMarker(queryClient, markerKey).dispatchedConfirmedAt).toBeUndefined();
  });

  test.each(["empty", "equal block", "lower block", "higher block", "absent block"] as const)("exhaustive %s coverage clears overflow and resets freshness only on a higher block", (state) => {
    const queryClient = client();
    const marker = { at: now, fresh: { US: true as const }, dispatchedOverflow: true as const, dispatchedOverflowAt: now,
      dispatchedOverflowGeneration: 3, dispatchedOverflowConfirmedFloor: exhaustive.since, ...(state === "absent block" ? {} : { settledBlock: "105" }) };
    queryClient.setQueryData(markerKey, marker);
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), { ...snapshotAt("104"), fetchedAt: new Date(now + 10).toISOString() });
    const invalidate = spyOn(queryClient, "invalidateQueries");
    const raised = state === "higher block" || state === "absent block";
    reconcile(queryClient, payload(state === "empty" ? [] : [operation("untracked", "confirmed", state === "lower block" ? "104" : raised ? "106" : "105")], { exhaustive }), now, 3);
    expect(readMarker(queryClient, markerKey)).toEqual({ at: raised ? now + 11 : now, fresh: raised ? {} : { US: true }, settledBlock: raised ? "106" : "105", dispatchedOverflowGeneration: 3 });
    expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[1] === "balances")).toHaveLength(raised ? 1 : 0);
    invalidate.mockRestore();
  });

  test.each(["truncated", "partial", "unavailable retained", "pending", "block-less", "invalid block", "pending retained", "block-less retained", "missing generation"] as const)("overflow remains on %s coverage", (state) => {
    const queryClient = client();
    const marker: BalanceActionMarker = { at: now, fresh: { US: true }, settledBlock: "104", dispatchedOverflow: true, dispatchedOverflowAt: now, dispatchedOverflowGeneration: 1, dispatchedOverflowConfirmedFloor: now };
    queryClient.setQueryData(markerKey, marker);
    const row = operation("untracked", state === "pending" || state === "pending retained" ? "pending" : "confirmed");
    if (state === "block-less" || state === "block-less retained") row.settledBlockNumber = undefined;
    if (state === "invalid block") row.settledBlockNumber = "0105";
    const retained = state === "pending retained" || state === "block-less retained";
    reconcile(queryClient, payload(retained ? [] : [row], {
      exhaustive: ["truncated", "partial", "unavailable retained"].includes(state) ? null : exhaustive,
      truncated: state === "truncated", retainedSavingsDepositsUnavailable: state === "unavailable retained",
      ...(retained ? { retainedSavingsDeposits: [row] } : {}),
    }), now, state === "missing generation" ? undefined : 1);
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(marker);
  });

  test("a read started before the next eviction cannot clear overflow", async () => {
    const queryClient = client();
    for (let index = 0; index < 17; index += 1) await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, serverConfirmedAt: new Date(now).toISOString(), now });
    const generation = afterAction.balanceBoundaryGeneration(queryClient, ownerKey);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-17", serverConfirmedAt: new Date(now).toISOString(), now: now + 1 });
    expect(afterAction.balanceBoundaryGeneration(queryClient, ownerKey)).toBe(2);
    reconcile(queryClient, payload([operation("untracked")], { exhaustive }), now, generation);
    const marker = readMarker(queryClient, markerKey);
    expect(marker.dispatchedOverflow).toBe(true);
    expect(marker.dispatchedOverflowGeneration).toBe(2);
    expect(marker.dispatchedOverflowAt).toBe(now + 1);
  });

  test("recent-actions captures the generation before a fetch that evicts another boundary", async () => {
    const queryClient = client();
    for (let index = 0; index < 17; index += 1) await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, serverConfirmedAt: new Date(now).toISOString(), now });
    const owner = { subject: "user-1", address: balancesSnapshotFixture.owner.address, chainId: 8453, accountProvider: "cdp-embedded" as const };
    const options = recentActionsQuery({ owner: ownerKey, session: { user: { subject: owner.subject }, smartAccount: { address: owner.address, chainId: 8453 }, accountProvider: owner.accountProvider },
      fetchOperations: async () => {
        await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-17", serverConfirmedAt: new Date(now).toISOString(), now: now + 1 });
        return { version: 1, truncated: false, actions: [], exhaustive: { owner, since: new Date(exhaustive.since).toISOString() } };
      } });
    if (typeof options.queryFn !== "function") throw new Error("Expected enabled query");
    const read = await options.queryFn({ client: queryClient, queryKey: options.queryKey, signal: new AbortController().signal, meta: options.meta });
    expect(read.exhaustive).toEqual(exhaustive);
    expect(readMarker(queryClient, markerKey).dispatchedOverflowGeneration).toBe(2);
    expect(readMarker(queryClient, markerKey).dispatchedOverflow).toBe(true);
  });

  test("a complete confirmed read prunes tracked dispatches but overflow refuses block-only proof until aged", async () => {
    const queryClient = client();
    for (let index = 0; index < 17; index += 1) await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, now });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedOverflow).toBe(true);
    const invalidate = spyOn(queryClient, "invalidateQueries");
    reconcile(queryClient, payload(Array.from({ length: 15 }, (_, index) => operation(`action-${index + 1}`, "confirmed", "105")), {
      retainedSavingsDeposits: [operation("action-16", "confirmed", "106"), operation("action-0", "confirmed", "107")],
      truncated: false, incomplete: false,
    }));
    const marker = readMarker(queryClient, markerKey);
    expect(marker.dispatchedActionIds).toBeUndefined();
    expect(marker.dispatchedAt).toBeUndefined();
    expect(marker.dispatchedOverflow).toBe(true);
    expect(marker.dispatchedOverflowAt).toBe(now);
    expect(marker.settledBlock).toBe("106");
    expect(marker.settledActionIds).toHaveLength(16);
    expect(marker.at).toBe(now + 5);
    expect(marker.fresh).toEqual({});
    expect(snapshotProvesFreshness(snapshotAt("106"), marker)).toBe(false);
    expect(snapshotProvesFreshness(snapshotAt("107"), marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...snapshotAt("106"), fetchedAt: new Date(marker.at + 1).toISOString() }, marker)).toBe(true);
    reconcile(queryClient, payload(), now + day);
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(marker);
    reconcile(queryClient, payload(), now + day + 1);
    const aged = readMarker(queryClient, markerKey);
    expect(aged.dispatchedOverflow).toBeUndefined();
    expect(aged.dispatchedOverflowAt).toBeUndefined();
    expect(aged.dispatchedOverflowConfirmedFloor).toBeUndefined();
    expect(aged.dispatchedOverflowGeneration).toBe(1);
    expect(aged.settledBlock).toBe("106");
    expect(aged.at).toBe(marker.at);
    expect(aged.fresh).toEqual(marker.fresh);
    expect(snapshotProvesFreshness(snapshotAt("105"), aged)).toBe(false);
    expect(snapshotProvesFreshness(snapshotAt("106"), aged)).toBe(true);
    expect(snapshotProvesFreshness(snapshotAt("107"), aged)).toBe(true);
    expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[1] === "balances")).toHaveLength(1);
    invalidate.mockRestore();
  });

  test.each([false, true])("absent aged boundaries and overflow expire without resetting freshness, legacy times: %s", (legacy) => {
    const queryClient = client();
    const marker: BalanceActionMarker = { at: now - day - 1, fresh: { US: true }, settledBlock: "105", dispatchedActionIds: ["action-a"], dispatchedOverflow: true,
      ...(legacy ? {} : { dispatchedAt: { "action-a": now - day - 1 }, dispatchedOverflowAt: now - day - 1 }) };
    queryClient.setQueryData(markerKey, marker);
    const invalidate = spyOn(queryClient, "invalidateQueries");
    reconcile(queryClient, payload([], { truncated: true }));
    const next = readMarker(queryClient, markerKey);
    expect(next).toEqual({ at: marker.at, fresh: marker.fresh, settledBlock: "105" });
    expect(snapshotProvesFreshness(snapshotAt("105"), next)).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
    invalidate.mockRestore();
  });

  test.each(["pending", "unknown", "failed", "block-less", "invalid-block", "absent"] as const)("a %s boundary remains and refuses block-only proof", (state) => {
    const queryClient = client();
    const marker: BalanceActionMarker = { at: now, fresh: { US: true }, settledBlock: "105", dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": now } };
    queryClient.setQueryData(markerKey, marker);
    const rows = state === "absent" ? [] : [operation("action-a", state === "block-less" || state === "invalid-block" ? "confirmed" : state, state === "block-less" ? undefined : state === "invalid-block" ? "0105" : "105")];
    if (state === "block-less") rows[0]!.settledBlockNumber = undefined;
    reconcile(queryClient, payload(rows), now + day);
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(marker);
    expect(snapshotProvesFreshness(snapshotAt("105"), marker)).toBe(false);
    expect(snapshotProvesFreshness({ ...snapshotAt("105"), fetchedAt: new Date(now + 1).toISOString() }, marker)).toBe(true);
    if (state !== "absent") {
      reconcile(queryClient, payload(rows), now + day + 1);
      expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(marker);
    }
  });

  test.each([false, true])("confirmed tracked row consumes only its boundary and raises the source/server fence, retained: %s", (retained) => {
    const queryClient = client();
    const marker: BalanceActionMarker = { at: now, fresh: { US: true }, settledBlock: "104", dispatchedActionIds: ["action-a", "action-b"], dispatchedAt: { "action-a": now, "action-b": now } };
    queryClient.setQueryData(markerKey, marker);
    queryClient.setQueryData(ownerQueryKey(ownerKey, "balances", "US"), { ...snapshotAt("104"), fetchedAt: new Date(now + 10).toISOString() });
    const row = { ...operation("action-a"), settledAt: undefined, submittedAt: new Date(now + 5).toISOString() };
    reconcile(queryClient, payload(retained ? [] : [row], retained ? { retainedSavingsDeposits: [row] } : {}));
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: now + 11, fresh: {}, settledBlock: "105", settledActionIds: ["action-a"], dispatchedActionIds: ["action-b"], dispatchedAt: { "action-b": now } });
  });

  test.each([
    ["truncated", { truncated: true }, "confirmed", "105"],
    ["incomplete", { incomplete: true }, "confirmed", "105"],
    ["pending", {}, "pending", "105"], ["unknown", {}, "unknown", "105"], ["failed", {}, "failed", "105"],
    ["block-less", {}, "confirmed", undefined], ["invalid-block", {}, "confirmed", "0105"],
  ] as const)("overflow remains on a %s read", (_label, change, status, block) => {
    const queryClient = client();
    const marker: BalanceActionMarker = { at: now, fresh: { US: true }, settledBlock: "104", dispatchedOverflow: true, dispatchedOverflowAt: now };
    queryClient.setQueryData(markerKey, marker);
    const row = operation("untracked", status, block);
    row.settledBlockNumber = block;
    reconcile(queryClient, payload([row], change));
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(marker);
    expect(snapshotProvesFreshness(snapshotAt("105"), marker)).toBe(false);
  });

  test("confirmed read prunes 16 abandoned dispatches so a 17th dispatch does not overflow", async () => {
    const queryClient = client();
    for (let index = 0; index < 16; index += 1) await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, now });
    reconcile(queryClient, payload(Array.from({ length: 16 }, (_, index) => operation(`action-${index}`))));
    const pruned = readMarker(queryClient, markerKey);
    expect(pruned.dispatchedActionIds).toBeUndefined();
    expect(pruned.dispatchedAt).toBeUndefined();
    expect(pruned.dispatchedOverflow).toBeUndefined();
    expect(pruned.settledBlock).toBe("105");
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-16", now: now + 10 });
    const marker = readMarker(queryClient, markerKey);
    expect(marker.dispatchedActionIds).toEqual(["action-16"]);
    expect(marker.dispatchedAt).toEqual({ "action-16": now + 10 });
    expect(marker.dispatchedOverflow).toBeUndefined();
    expect(marker.dispatchedOverflowAt).toBeUndefined();
    expect(snapshotProvesFreshness(snapshotAt("105"), marker)).toBe(false);
  });

  test("read with no changes or no marker writes nothing and a switched owner stays untouched", () => {
    const queryClient = client();
    const otherOwner = ownerKey.replace("user-1", "user-2");
    const otherKey = ownerQueryKey(otherOwner, "balances-action");
    const marker = { at: now, fresh: { US: true as const }, settledBlock: "106" };
    queryClient.setQueryData(otherKey, marker);
    const write = spyOn(queryClient, "setQueryData");
    reconcile(queryClient, payload([operation("action-a")]));
    expect(write).not.toHaveBeenCalled();
    queryClient.setQueryData(markerKey, { ...marker, dispatchedActionIds: ["action-a"] });
    write.mockClear();
    reconcile(queryClient, payload([operation("action-a")]));
    expect(queryClient.getQueryData<BalanceActionMarker>(otherKey)).toBe(marker);
    expect(write.mock.calls.every(([key]) => key[0] === ownerKey)).toBe(true);
    write.mockClear();
    reconcile(queryClient, payload([operation("action-a")]));
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  test("settled A then B keeps A's replay marker unchanged while invalidating scopes and advancing activity", async () => {
    const queryClient = client();
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", settledBlock: "105" });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock: "106" });
    queryClient.setQueryData(markerKey, { ...readMarker(queryClient, markerKey), fresh: { US: true } });
    for (const scope of afterAction.afterActionScopes) queryClient.setQueryData(ownerQueryKey(ownerKey, scope), {});
    const before = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", serverAt: new Date(now + 100).toISOString(), now });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(before);
    for (const scope of afterAction.afterActionScopes) expect(queryClient.getQueryState(ownerQueryKey(ownerKey, scope))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(ownerQueryKey(ownerKey, afterAction.activityWindowScope))).toBeDefined();
  });

  test("dispatch refreshes its time, reopens only its settled identity, and retains higher block and at", async () => {
    const queryClient = client();
    queryClient.setQueryData(markerKey, { at: now + 10, fresh: { US: true }, settledActionIds: ["action-a", "action-b"], settledBlock: "106" });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", reopen: true, now });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toEqual({ at: now + 10, fresh: {}, settledActionIds: ["action-b"], settledBlock: "106", dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": now } });
    await invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: "action-a", now: now + 1 });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedAt).toEqual({ "action-a": now + 1 });
  });

  test.each(["104", "105"])("different-action covered replay at %s appends identity without resetting proof", (block) => {
    const queryClient = client();
    const marker = { at: now, fresh: { US: true as const }, settledBlock: "105", settledActionIds: ["action-a"], dispatchedActionIds: ["action-c"], dispatchedAt: { "action-c": now } };
    queryClient.setQueryData(markerKey, marker);
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock: block, serverAt: new Date(now + 10).toISOString() });
    const next = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    expect(next).toEqual({ ...marker, settledActionIds: ["action-a", "action-b"] });
    requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: "action-b", settledBlock: block });
    expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(next);
  });

  test("settled identities are ordered, deduplicated, bounded to 16, and fence rendered proof", () => {
    const queryClient = client();
    for (let index = 0; index < 17; index += 1) requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: `action-${index}`, settledBlock: String(100 + index) });
    const marker = readMarker(queryClient, markerKey);
    expect(marker.settledActionIds).toEqual(Array.from({ length: 16 }, (_, index) => `action-${index + 1}`));
    const reversed = { ...marker, settledActionIds: [...marker.settledActionIds!].reverse() };
    expect(freshRegionMarker(reversed, marker, "US", snapshotAt("116"))).toBeUndefined();
  });

  test.each(["success", "throw", "invalid", "abort"] as const)("recent-actions %s read reconciles only a parsed non-aborted read for its own owner", async (mode) => {
    const queryClient = client();
    const otherOwner = ownerKey.replace("user-1", "user-2");
    const marker = { at: now, fresh: {}, dispatchedActionIds: ["action-a"] };
    queryClient.setQueryData(markerKey, marker);
    queryClient.setQueryData(ownerQueryKey(otherOwner, "balances-action"), marker);
    const controller = new AbortController();
    const options = recentActionsQuery({ owner: ownerKey, session: { user: { subject: "user-1" }, smartAccount: { address: balancesSnapshotFixture.owner.address, chainId: 8453 }, accountProvider: "cdp-embedded" }, fetchOperations: async () => {
      if (mode === "throw") throw new Error("read failed");
      if (mode === "invalid") return null;
      if (mode === "abort") controller.abort();
      return { version: 1, truncated: false, actions: [{ id: "action-a", kind: "send", status: "confirmed", owner: { subject: "user-1", address: balancesSnapshotFixture.owner.address, chainId: 8453, accountProvider: "cdp-embedded" }, createdAt: new Date(now).toISOString(), confirmedAt: new Date(now).toISOString(), settledBlockNumber: "105", summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" } }] };
    } });
    if (typeof options.queryFn !== "function") throw new Error("Expected enabled query");
    try { await options.queryFn({ client: queryClient, queryKey: options.queryKey, signal: controller.signal, meta: options.meta }); } catch (error) { if (mode === "success") throw error; }
    expect(queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(otherOwner, "balances-action"))).toBe(marker);
    if (mode === "success") expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)?.dispatchedActionIds).toBeUndefined();
    else expect(queryClient.getQueryData<BalanceActionMarker>(markerKey)).toBe(marker);
  });
});

describe("restored balance action marker contract", () => {
  const entry = { ownerKey, queryKey: ownerQueryKey(ownerKey, "balances-action") };

  test("restores new ordered settlement identities and dispatch/overflow times and generation, and converts a legacy identity", () => {
    const marker = { at: now, fresh: {}, settledActionIds: ["action-a", "action-b"], dispatchedActionIds: ["action-c"], dispatchedAt: { "action-c": now }, dispatchedConfirmedAt: { "action-c": now - 10 }, dispatchedOverflow: true, dispatchedOverflowAt: now, dispatchedOverflowConfirmedFloor: now - 20, dispatchedOverflowGeneration: 2 };
    expect(trustRestoredBalanceActionMarker(marker, entry)).toEqual({ data: marker });
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, settledActionId: "action-a" }, entry)).toEqual({ data: { at: now, fresh: {}, settledActionIds: ["action-a"] } });
  });

  test.each([
    { settledActionIds: "action-a" }, { settledActionIds: [""] }, { settledActionIds: [1] }, { settledActionIds: ["a".repeat(65)] },
    { settledActionIds: Array.from({ length: 17 }, (_, index) => `action-${index}`) },
    { dispatchedAt: [] }, { dispatchedAt: { missing: now } }, { dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": -1 } },
    { dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": Infinity } }, { dispatchedActionIds: ["action-a"], dispatchedAt: { "action-a": "1" } },
    { dispatchedOverflowAt: now }, { dispatchedOverflow: true, dispatchedOverflowAt: -1 }, { dispatchedOverflow: true, dispatchedOverflowAt: Number.NaN },
    { dispatchedOverflow: true, dispatchedOverflowAt: "1" },
    { dispatchedConfirmedAt: [] }, { dispatchedConfirmedAt: { missing: now } },
    { dispatchedActionIds: ["action-a"], dispatchedConfirmedAt: { "action-a": -1 } },
    { dispatchedActionIds: ["action-a"], dispatchedConfirmedAt: { "action-a": Infinity } },
    { dispatchedActionIds: ["action-a"], dispatchedConfirmedAt: { "action-a": Number.NaN } },
    { dispatchedActionIds: ["action-a"], dispatchedConfirmedAt: { "action-a": "1" } },
    { dispatchedOverflowConfirmedFloor: 0 }, { dispatchedOverflow: true, dispatchedOverflowConfirmedFloor: -1 },
    { dispatchedOverflow: true, dispatchedOverflowConfirmedFloor: Infinity }, { dispatchedOverflow: true, dispatchedOverflowConfirmedFloor: Number.NaN },
    { dispatchedOverflow: true, dispatchedOverflowConfirmedFloor: "1" },
    { dispatchedOverflow: true, dispatchedOverflowGeneration: -1 },
    { dispatchedOverflow: true, dispatchedOverflowGeneration: 1.5 }, { dispatchedOverflow: true, dispatchedOverflowGeneration: Number.NaN },
    { dispatchedOverflow: true, dispatchedOverflowGeneration: Infinity }, { dispatchedOverflow: true, dispatchedOverflowGeneration: Number.MAX_SAFE_INTEGER + 1 },
    { dispatchedOverflow: true, dispatchedOverflowGeneration: "1" },
  ])("rejects malformed new marker fields %j", (fields) => {
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, ...fields }, entry)).toBeNull();
  });

  test.each([0, 2, Number.MAX_SAFE_INTEGER])("restores generation %s after overflow clears", (generation) => {
    const marker = { at: now, fresh: {}, dispatchedOverflowGeneration: generation };
    expect(trustRestoredBalanceActionMarker(marker, entry)).toEqual({ data: marker });
  });

  test("restores zero-valued confirmation fields conservatively", () => {
    const marker = { at: now, fresh: {}, dispatchedActionIds: ["action-a"], dispatchedConfirmedAt: { "action-a": 0 }, dispatchedOverflow: true, dispatchedOverflowConfirmedFloor: 0 };
    expect(trustRestoredBalanceActionMarker(marker, entry)).toEqual({ data: marker });
  });

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
      data: { at: now, fresh: {}, settledBlock: "105", settledActionIds: [settledActionId] },
    });
  });

  test.each([
    ["action-a"],
    ["a".repeat(64)],
    Array.from({ length: 16 }, (_, index) => `action-${index}`),
  ])("restores valid outstanding dispatch action ids %j", (...dispatchedActionIds) => {
    expect(trustRestoredBalanceActionMarker({ at: now, fresh: {}, settledBlock: "105", dispatchedActionIds, settledActionIds: ["action-a"] }, entry)).toEqual({
      data: { at: now, fresh: {}, settledBlock: "105", dispatchedActionIds, settledActionIds: ["action-a"] },
    });
  });

  test("restores receipt proof and settled identity alongside another dispatch boundary", () => {
    const marker = { at: now, fresh: {}, settledBlock: "105", settledActionIds: ["action-a"], dispatchedActionIds: ["action-b"] };
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

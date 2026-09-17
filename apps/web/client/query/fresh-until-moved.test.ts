import { describe, expect, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";
import { dataOwnerKey } from "@/client/account/owner-keys";
import type { VerifiedAccountSession } from "@/client/account/session-client";
import {
  createBalanceFreshnessState,
  startBalanceFreshness,
} from "./after-action";
import {
  freshUntilMoved,
  type FreshUntilMovedClock,
} from "./fresh-until-moved";
import { createHomeQueryClient, ownerQueryKey } from "./query-client";

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: FreshUntilMovedClock = {
    now: () => now,
    setTimer: (callback, delayMs) => {
      const timerId = ++id;
      timers.set(timerId, { at: now + delayMs, callback });
      return timerId;
    },
    clearTimer: (timer) => { timers.delete(timer as number); },
  };
  return {
    clock,
    async advance(ms: number) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    },
    pending: () => timers.size,
  };
}

const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
  },
  accountProvider: "cdp-embedded",
};

function balancesSnapshot(balance: string | null) {
  return {
    version: 3,
    holdings: balance === null
      ? []
      : [{
          id: "usdc",
          key: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          balance: { status: "ready", baseUnits: balance },
        }],
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("balance freshness across cached regions", () => {
  const cases = [
    {
      name: "merges the affected balance from the second region without a false move",
      regions: [
        { id: "US", initial: null, fresh: null },
        { id: "DE", initial: "10", fresh: "10" },
      ],
      expectedMoved: false,
    },
    {
      name: "fires moved once when the first region balance changes",
      regions: [
        { id: "US", initial: "10", fresh: "11" },
        { id: "DE", initial: null, fresh: null },
      ],
      expectedMoved: true,
    },
    {
      name: "fires moved once when the second region balance changes",
      regions: [
        { id: "US", initial: null, fresh: null },
        { id: "DE", initial: "10", fresh: "11" },
      ],
      expectedMoved: true,
    },
    {
      name: "preserves unchanged single-region behavior",
      regions: [{ id: "US", initial: "10", fresh: "10" }],
      expectedMoved: false,
    },
    {
      name: "matches savings action CAIP asset ids to balance holding keys",
      regions: [{ id: "US", initial: "10", fresh: "11" }],
      assetIdentity: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      expectedMoved: true,
    },
    {
      name: "a stale inactive region cached first does not report a false move",
      regions: [
        { id: "US", initial: "5", fresh: "10", updatedAt: 1_000 },
        { id: "DE", initial: "10", fresh: "10", updatedAt: 2_000 },
      ],
      expectedMoved: false,
    },
    {
      name: "a stale inactive region cached last does not report a false move",
      regions: [
        { id: "DE", initial: "10", fresh: "10", updatedAt: 2_000 },
        { id: "US", initial: "5", fresh: "10", updatedAt: 1_000 },
      ],
      expectedMoved: false,
    },
  ] as const;

  for (const scenario of cases) {
    test(scenario.name, async () => {
      const fake = fakeClock();
      const queryClient = createHomeQueryClient();
      const ownerKey = dataOwnerKey(session);
      const state = createBalanceFreshnessState();
      const fetchMetas: unknown[] = [];
      let freshReads = 0;
      let invalidations = 0;

      for (const region of scenario.regions) {
        queryClient.setQueryData(
          ownerQueryKey(ownerKey, "balances", region.id),
          balancesSnapshot(region.initial),
          "updatedAt" in region ? { updatedAt: region.updatedAt } : undefined,
        );
      }
      queryClient.fetchQuery = (async (options: {
        queryKey: readonly unknown[];
        meta?: unknown;
      }) => {
        freshReads += 1;
        fetchMetas.push(options.meta);
        const region = scenario.regions.find((item) => item.id === options.queryKey[2]);
        return balancesSnapshot(region?.fresh ?? null);
      }) as QueryClient["fetchQuery"];
      queryClient.invalidateQueries = (async () => {
        invalidations += 1;
      }) as QueryClient["invalidateQueries"];

      await startBalanceFreshness({
        actionId: "action-1",
        session,
        queryClient,
        state,
        clock: fake.clock,
        fetchVerifiedResource: async (endpoint) => {
          if (endpoint !== "/api/actions") throw new Error("unexpected balances fetch");
          return {
            actions: [{
              id: "action-1",
              summary: { amounts: [{ assetId: "assetIdentity" in scenario ? scenario.assetIdentity : "usdc" }] },
            }],
          };
        },
      });

      await fake.advance(3_000);
      await flushMicrotasks();

      expect(state.moved.has("action-1")).toBe(scenario.expectedMoved);
      expect(freshReads).toBe(scenario.regions.length);
      expect(fetchMetas).toEqual(
        scenario.regions.map(() => ({ persistence: "owner", ownerKey })),
      );
      expect(invalidations).toBe(scenario.expectedMoved ? 3 : 0);

      if (scenario.expectedMoved) {
        await fake.advance(6_000);
        await flushMicrotasks();
        expect(freshReads).toBe(scenario.regions.length);
        expect(invalidations).toBe(3);
      }
    });
  }
});

describe("fresh-until-moved scheduler", () => {
  test("stops after an affected balance moves", async () => {
    const fake = fakeClock();
    let reads = 0;
    const run = freshUntilMoved({
      initial: { usdc: "10" },
      readFresh: async () => ({ usdc: ++reads === 2 ? "11" : "10" }),
      clock: fake.clock,
    });

    await fake.advance(6_000);

    expect(await run.result).toBe("moved");
    expect(reads).toBe(2);
    expect(fake.pending()).toBe(0);
  });

  test("stops at sixty seconds when balances do not move", async () => {
    const fake = fakeClock();
    let reads = 0;
    const run = freshUntilMoved({
      initial: { usdc: "10" },
      readFresh: async () => { reads += 1; return { usdc: "10" }; },
      clock: fake.clock,
    });

    await fake.advance(60_000);

    expect(await run.result).toBe("timed-out");
    expect(reads).toBe(19);
    expect(fake.pending()).toBe(0);
  });
});

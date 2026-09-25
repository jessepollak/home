import { describe, expect, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";
import { executeActionOnce } from "@/client/account/action-dispatch";
import { dataOwnerKey } from "@/client/account/owner-keys";
import type { VerifiedAccountSession } from "@/client/account/session-client";
import {
  afterActionScopes,
  applyActionHandleEffects,
  createBalanceFreshnessState,
  indexedScopes,
  startBalanceFreshness,
} from "./after-action";
import type { FreshUntilMovedClock } from "./fresh-until-moved";
import { createHomeQueryClient, ownerQueryKey } from "./query-client";

const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const USDC_KEY = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const VAULT_KEY = "eip155:8453/erc20:0x2222222222222222222222222222222222222222";
const TRANSACTION_HASH = `0x${"cd".repeat(32)}`;
const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
  },
  accountProvider: "cdp-embedded",
};

type SavingsKind = "savings-deposit" | "savings-withdraw";

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: FreshUntilMovedClock = {
    now: () => now,
    setTimer: (callback, delayMs) => {
      const id = ++nextId;
      timers.set(id, { at: now + delayMs, callback });
      return id;
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
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
      }
      now = target;
    },
  };
}

function balances(usdc: string, shares: string) {
  return {
    version: 4,
    holdings: [
      { id: "usdc", key: USDC_KEY, balance: { status: "ready", baseUnits: usdc } },
      { id: "morpho-vault", key: VAULT_KEY, balance: { status: "ready", baseUnits: shares } },
    ],
  };
}

function balanceValues(snapshot: ReturnType<typeof balances> | undefined) {
  return {
    usdc: snapshot?.holdings.find((holding) => holding.key === USDC_KEY)?.balance.baseUnits,
    shares: snapshot?.holdings.find((holding) => holding.key === VAULT_KEY)?.balance.baseUnits,
  };
}

async function proveSavingsConvergence({
  kind,
  initial,
  final,
}: {
  kind: SavingsKind;
  initial: ReturnType<typeof balances>;
  final: ReturnType<typeof balances>;
}) {
  const fake = fakeClock();
  const queryClient = createHomeQueryClient();
  const ownerKey = dataOwnerKey(session);
  const balanceKey = ownerQueryKey(ownerKey, "balances", "US");
  const freshnessState = createBalanceFreshnessState();
  const invalidations: string[] = [];
  let freshReads = 0;
  let dispatches = 0;
  let confirms = 0;
  let handlePosts = 0;
  let freshnessStart: Promise<void> | undefined;

  queryClient.setQueryData(balanceKey, initial);
  expect(balanceValues(queryClient.getQueryData(balanceKey))).toEqual(balanceValues(initial));
  queryClient.fetchQuery = (async () => {
    freshReads += 1;
    if (freshReads === 1) throw new Error("temporary balance refresh failure");
    const next = freshReads === 2 ? initial : final;
    queryClient.setQueryData(balanceKey, next);
    return next;
  }) as QueryClient["fetchQuery"];
  queryClient.invalidateQueries = (async ({ queryKey }: { queryKey?: readonly unknown[] }) => {
    invalidations.push(String(queryKey?.[1]));
  }) as QueryClient["invalidateQueries"];

  const confirmedPlans = new Map();
  const providerDispatches = new Map<string, Promise<string>>();
  const dispatchAttempts = new Map<string, number>();
  const pendingDeclines = new Map<string, Promise<void>>();
  const execute = () => executeActionOnce({
    id: ACTION_ID,
    generation: 7,
    fence: { assertCurrent: (generation) => { expect(generation).toBe(7); } },
    confirmedPlans,
    providerDispatches,
    dispatchAttempts,
    pendingDeclines,
    confirm: async () => {
      confirms += 1;
      return { calls: [{ to: session.smartAccount!.address, data: "0x1234", value: "0" }] };
    },
    dispatch: async () => {
      dispatches += 1;
      return `0x${"ab".repeat(32)}`;
    },
    recordHandle: async () => {
      handlePosts += 1;
      if (handlePosts === 1) throw new Error("response failed after the handle was recorded");
      await applyActionHandleEffects({
        path: `/api/actions/${ACTION_ID}/handle`,
        body: { transactionHash: TRANSACTION_HASH },
        dataOwnerKey: ownerKey,
        queryClient,
        startBalanceFreshness: () => {
          freshnessStart = startBalanceFreshness({
            actionId: ACTION_ID,
            session,
            queryClient,
            state: freshnessState,
            clock: fake.clock,
            fetchVerifiedResource: async (endpoint) => {
              if (endpoint !== "/api/actions") throw new Error("unexpected endpoint");
              return {
                actions: [{
                  id: ACTION_ID,
                  kind,
                  status: "confirmed",
                  summary: { amounts: [{ assetId: USDC_KEY }, { assetId: VAULT_KEY }] },
                }],
              };
            },
          });
          return freshnessStart;
        },
      });
    },
  });

  await expect(execute()).rejects.toThrow("response failed after the handle was recorded");
  await expect(execute()).resolves.toBe(`0x${"ab".repeat(32)}`);
  await freshnessStart;

  expect({ confirms, dispatches, handlePosts }).toEqual({
    confirms: 1,
    dispatches: 1,
    handlePosts: 2,
  });
  expect(invalidations).toEqual([...afterActionScopes]);
  expect(balanceValues(queryClient.getQueryData(balanceKey))).toEqual(balanceValues(initial));

  await fake.advance(9_000);

  expect(freshReads).toBe(3);
  expect(freshnessState.moved.has(ACTION_ID)).toBe(true);
  expect(balanceValues(queryClient.getQueryData(balanceKey))).toEqual(balanceValues(final));
  expect(invalidations).toEqual([...afterActionScopes, ...indexedScopes]);
  expect(invalidations.filter((scope) => scope === "balances")).toHaveLength(1);
  expect(invalidations.filter((scope) => scope === "activity")).toHaveLength(2);
  expect(invalidations.filter((scope) => scope === "actions")).toHaveLength(2);
}

describe("savings action convergence", () => {
  test("deposit converges lower Base USDC and higher vault shares after refresh failure and indexer lag", async () => {
    await proveSavingsConvergence({
      kind: "savings-deposit",
      initial: balances("5000000", "0"),
      final: balances("4000000", "1000000000000000000"),
    });
  });

  test("withdraw converges lower vault shares and higher Base USDC without redispatch", async () => {
    await proveSavingsConvergence({
      kind: "savings-withdraw",
      initial: balances("4000000", "2000000000000000000"),
      final: balances("5000000", "1000000000000000000"),
    });
  });
});

import { describe, expect, test } from "bun:test";
import { MfaError } from "@coinbase/cdp-core";
import { executeActionOnce } from "./action-dispatch";
import {
  normalizeResolutionState,
  pollTransactionResolution,
  type ResolutionClock,
} from "./action-resolution";
import { BaseAccountConnectorError } from "./base-account-connector";
import { TransferExecutionError } from "@/shared/transfers/types";

const id = "11111111-1111-4111-8111-111111111111";
const plan = { calls: [{ to: "0x1111111111111111111111111111111111111111" as const, data: "0x1234" as const, value: "0" }] };
const transactionHash = `0x${"cd".repeat(32)}`;

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: ResolutionClock = {
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
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    },
    pending: () => timers.size,
  };
}

describe("thin action dispatch", () => {
  test("does not confirm or call a provider when the prepared generation is stale", async () => {
    let serverPosts = 0;
    let providerCalls = 0;
    await expect(executeActionOnce({
      id,
      generation: 7,
      fence: { assertCurrent: () => { throw new TransferExecutionError("stale-session"); } },
      confirmedPlans: new Map(),
      providerDispatches: new Map(),
      confirm: async () => { serverPosts += 1; return plan; },
      dispatch: async () => { providerCalls += 1; return `0x${"ab".repeat(32)}`; },
      recordHandle: async () => { serverPosts += 1; },
    })).rejects.toMatchObject({ reason: "stale-session" });
    expect({ serverPosts, providerCalls }).toEqual({ serverPosts: 0, providerCalls: 0 });
  });

  test("retries explicit wallet rejection but keeps ambiguous dispatch failures single-shot", async () => {
    for (const rejection of [
      new BaseAccountConnectorError("cancelled"),
      new MfaError("CANCELLED", "fixture MFA cancellation"),
    ]) {
      let dispatches = 0;
      const providerDispatches = new Map<string, Promise<string>>();
      const execute = () => executeActionOnce({
        id,
        generation: 3,
        fence: { assertCurrent: () => {} },
        confirmedPlans: new Map([[id, plan]]),
        providerDispatches,
        confirm: async () => plan,
        dispatch: async () => {
          dispatches += 1;
          if (dispatches === 1) throw rejection;
          return `0x${"ab".repeat(32)}`;
        },
        recordHandle: async () => {},
      });

      await expect(execute()).rejects.toMatchObject({ reason: "rejected", cause: rejection });
      await expect(execute()).resolves.toBe(`0x${"ab".repeat(32)}`);
      expect(dispatches).toBe(2);
    }

    const ambiguous = new Error("transport aborted after dispatch began");
    let ambiguousDispatches = 0;
    const providerDispatches = new Map<string, Promise<string>>();
    const executeAmbiguous = () => executeActionOnce({
      id,
      generation: 3,
      fence: { assertCurrent: () => {} },
      confirmedPlans: new Map([[id, plan]]),
      providerDispatches,
      confirm: async () => plan,
      dispatch: async () => {
        ambiguousDispatches += 1;
        throw ambiguous;
      },
      recordHandle: async () => {},
    });

    await expect(executeAmbiguous()).rejects.toBe(ambiguous);
    await expect(executeAmbiguous()).rejects.toBe(ambiguous);
    expect(ambiguousDispatches).toBe(1);
  });

  test("polls pending CDP operations to completion and records the transaction hash once", async () => {
    const fake = fakeClock();
    const states = [
      { status: "pending" as const },
      { status: "pending" as const },
      { status: "complete" as const, transactionHash },
    ];
    const posts: string[] = [];
    const run = pollTransactionResolution({
      generation: 4,
      fence: { assertCurrent: (generation) => { expect(generation).toBe(4); } },
      check: async () => states.shift() ?? { status: "pending" },
      recordTransactionHash: async (hash) => { posts.push(hash); },
      onFailedWithoutHash: () => { throw new Error("unexpected failure"); },
      clock: fake.clock,
    });

    await fake.advance(6_500);
    await run.result;

    expect(posts).toEqual([transactionHash]);
    expect(fake.pending()).toBe(0);
  });

  test("stops a failed operation without a hash and does not post a transaction handle", async () => {
    const fake = fakeClock();
    const posts: string[] = [];
    const failures: string[] = [];
    const run = pollTransactionResolution({
      generation: 2,
      fence: { assertCurrent: () => {} },
      check: async () => ({ status: "failed", reason: "Bundler rejected the operation." }),
      recordTransactionHash: async (hash) => { posts.push(hash); },
      onFailedWithoutHash: (reason) => { failures.push(reason); },
      clock: fake.clock,
    });

    await fake.advance(1_500);
    await run.result;

    expect(posts).toEqual([]);
    expect(failures).toEqual(["Bundler rejected the operation."]);
    expect(fake.pending()).toBe(0);
  });

  test("stops silently when the operation status cannot be read", async () => {
    const fake = fakeClock();
    const posts: string[] = [];
    const failures: string[] = [];
    const run = pollTransactionResolution({
      generation: 2,
      fence: { assertCurrent: () => {} },
      check: async () => ({ status: "unavailable" }),
      recordTransactionHash: async (hash) => { posts.push(hash); },
      onFailedWithoutHash: (reason) => { failures.push(reason); },
      clock: fake.clock,
    });

    await fake.advance(1_500);
    await run.result;

    expect(posts).toEqual([]);
    expect(failures).toEqual([]);
    expect(fake.pending()).toBe(0);
  });

  test.each([
    ["pending", "pending"],
    ["signed", "pending"],
    ["broadcast", "pending"],
    ["complete", "complete"],
    ["failed", "failed"],
    ["dropped", "failed"],
  ] as const)("folds CDP status %s to %s", (cdpStatus, expected) => {
    expect(normalizeResolutionState({ status: cdpStatus }).status).toBe(expected);
  });

  test("rejects unknown provider statuses so the poller retries instead of guessing", () => {
    expect(() => normalizeResolutionState({ status: "mystery" })).toThrow();
    expect(normalizeResolutionState({ status: "dropped" }).reason).toMatch(/dropped/);
  });

  test("stops resolution after an owner switch without posting", async () => {
    const fake = fakeClock();
    let currentGeneration = 7;
    const posts: string[] = [];
    const run = pollTransactionResolution({
      generation: 7,
      fence: { assertCurrent: (generation) => {
        if (generation !== currentGeneration) throw new TransferExecutionError("stale-session");
      } },
      check: async () => ({ status: "pending" }),
      recordTransactionHash: async (hash) => { posts.push(hash); },
      onFailedWithoutHash: () => {},
      clock: fake.clock,
    });

    await fake.advance(1_500);
    currentGeneration = 8;
    await fake.advance(2_500);
    await run.result;

    expect(posts).toEqual([]);
    expect(fake.pending()).toBe(0);
  });

  test("canceling on unmount stops resolution", async () => {
    const fake = fakeClock();
    let checks = 0;
    const run = pollTransactionResolution({
      generation: 1,
      fence: { assertCurrent: () => {} },
      check: async () => { checks += 1; return { status: "pending" }; },
      recordTransactionHash: async () => {},
      onFailedWithoutHash: () => {},
      clock: fake.clock,
    });

    run.cancel();
    await fake.advance(10_000);
    await run.result;

    expect(checks).toBe(0);
    expect(fake.pending()).toBe(0);
  });

  test("reuses one idempotent CDP dispatch when handle recording resolves remotely then throws locally", async () => {
    let confirmPosts = 0;
    let dispatches = 0;
    let handlePosts = 0;
    let recordedHandle: string | null = null;
    const confirmedPlans = new Map();
    const providerDispatches = new Map<string, Promise<string>>();
    const execute = () => executeActionOnce({
      id,
      generation: 3,
      fence: { assertCurrent: (generation) => { if (generation !== 3) throw new Error("stale"); } },
      confirmedPlans,
      providerDispatches,
      confirm: async () => { confirmPosts += 1; return plan; },
      dispatch: async () => {
        dispatches += 1;
        const request = { path: `/smart-accounts/${plan.calls[0].to}/send`, headers: { "X-Idempotency-Key": id } };
        expect(request.path.endsWith("/send")).toBe(true);
        expect(request.headers["X-Idempotency-Key"]).toBe(id);
        return `0x${"ab".repeat(32)}`;
      },
      recordHandle: async (handle) => {
        handlePosts += 1;
        recordedHandle = handle;
        if (handlePosts === 1) throw new Error("response stream failed after commit");
      },
    });

    await expect(execute()).rejects.toThrow("response stream failed after commit");
    await expect(execute()).resolves.toBe(`0x${"ab".repeat(32)}`);
    expect({ confirmPosts, dispatches, handlePosts }).toEqual({
      confirmPosts: 1,
      dispatches: 1,
      handlePosts: 2,
    });
    expect(recordedHandle as string | null).toBe(`0x${"ab".repeat(32)}`);
  });
});

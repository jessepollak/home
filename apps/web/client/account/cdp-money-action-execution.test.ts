import "./dom-test-harness";

import { describe, expect, mock, test } from "bun:test";
import { MfaError } from "@coinbase/cdp-core";
import type { MutableRefObject } from "react";
import { executeActionOnce, type ConfirmedPlan } from "./action-dispatch";
import {
  normalizeResolutionState,
  pollTransactionResolution,
  type ResolutionClock,
} from "./action-resolution";
import {
  BaseAccountConnectorError,
  type ConnectedBaseAccount,
} from "./base-account-connector";
import type { AuthenticatedTransport } from "./cdp-authenticated-transport";
import type { OwnerGenerationFence } from "./owner-generation-fence";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { TransferExecutionError } from "@/shared/transfers/types";

const { render } = await import("@testing-library/react");
const { createElement, useEffect } = await import("react");
const { useMoneyActionExecution } = await import("./cdp-money-action-execution");
const { useAuthenticatedTransport } = await import("./cdp-authenticated-transport");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

const id = "11111111-1111-4111-8111-111111111111";
const plan = { calls: [{ to: "0x1111111111111111111111111111111111111111" as const, data: "0x1234" as const, value: "0" }] };
const transactionHash = `0x${"cd".repeat(32)}` as `0x${string}`;

function requireExecution(holder: { current: ReturnType<typeof useMoneyActionExecution> | null }) {
  if (!holder.current) throw new Error("Execution probe did not render");
  return holder.current;
}

function renderConfirmExecution(confirm: () => Promise<unknown>, dispatchError = new Error("Must not dispatch")) {
  const session: VerifiedAccountSession = {
    user: { subject: "subject" },
    smartAccount: { address: plan.calls[0].to, chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
  const ownerFence: OwnerGenerationFence = {
    advance: () => 4,
    capture: () => 4,
    isCurrent: (generation) => generation === 4,
    assertCurrent: (generation) => { expect(generation).toBe(4); },
    updateAuthorizationBoundary: () => {},
    updateOwnerKey: () => false,
  };
  const posts: string[] = [];
  const unexpectedTransportCall = async () => { throw new Error("Unexpected transport call"); };
  const transport: AuthenticatedTransport = {
    fetchAccountResource: async (path, options) => {
      if (path === `/api/actions/${id}`) return {
        id, kind: "send", summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
        calls: plan.calls, expiresAt: "2099-01-01T00:00:00.000Z",
      };
      if (path === `/api/actions/${id}/confirm`) {
        expect(options?.method).toBe("POST");
        posts.push(path);
        return confirm();
      }
      throw new Error(`Unexpected account resource ${path}`);
    },
    fetchBalances: unexpectedTransportCall,
    fetchActivity: unexpectedTransportCall,
    fetchAccountResponse: unexpectedTransportCall,
    fetchCountryPreference: unexpectedTransportCall,
    fetchMoneyActionApi: unexpectedTransportCall,
    reset: () => {},
  };
  let dispatches = 0;
  const executionRef: { current: ReturnType<typeof useMoneyActionExecution> | null } = { current: null };
  const baseConnection: MutableRefObject<ConnectedBaseAccount | null> = { current: null };
  function Probe() {
    const execution = useMoneyActionExecution({
      session, status: "verified", verification: "server", ownerKey: "owner", ownerFence,
      sdkSendUserOperation: async () => { dispatches += 1; throw dispatchError; },
      sdkGetUserOperation: undefined,
      baseConnection,
      transport, signTypedData: async () => "0x12",
    });
    useEffect(() => { executionRef.current = execution; }, [execution]);
    return null;
  }
  const view = render(createElement(Probe));
  return { execution: requireExecution(executionRef), posts, dispatchCount: () => dispatches, unmount: () => view.unmount() };
}

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

describe("resolution recovery", () => {
  test("a rejected status check stays pending and retries on the next interval", async () => {
    const fake = fakeClock();
    let checks = 0;
    let settled = false;
    const hashes: string[] = [];
    const poller = pollTransactionResolution({
      generation: 1, fence: { assertCurrent: () => {} }, clock: fake.clock,
      check: async () => {
        if (++checks === 1) throw new Error("status unavailable");
        return { status: "complete", transactionHash };
      },
      recordTransactionHash: async (hash) => { hashes.push(hash); },
      onFailedWithoutHash: () => { throw new Error("unexpected failure"); },
    });
    void poller.result.then(() => { settled = true; });
    await fake.advance(1_500);
    expect(checks).toBe(1);
    expect(settled).toBe(false);
    expect(hashes).toEqual([]);
    expect(fake.pending()).toBe(1);
    await fake.advance(2_499);
    expect(checks).toBe(1);
    expect(settled).toBe(false);
    await fake.advance(1);
    await poller.result;
    expect(checks).toBe(2);
    expect(hashes).toEqual([transactionHash]);
    expect(fake.pending()).toBe(0);
  });

  test("an owner change during a complete status check finishes without recording its hash", async () => {
    const fake = fakeClock();
    let generation = 1;
    const hashes: string[] = [];
    let assertions = 0;
    const poller = pollTransactionResolution({
      generation: 1, clock: fake.clock,
      fence: { assertCurrent: (expected) => {
        assertions += 1;
        if (expected !== generation) throw new TransferExecutionError("stale-session");
      } },
      check: async () => { generation = 2; return { status: "complete", transactionHash }; },
      recordTransactionHash: async (hash) => { hashes.push(hash); },
      onFailedWithoutHash: () => { throw new Error("unexpected failure"); },
    });
    await fake.advance(1_500);
    await poller.result;
    expect(assertions).toBe(2);
    expect(hashes).toEqual([]);
    expect(fake.pending()).toBe(0);
  });

  test("a rejected hash record stays pending and retries instead of settling", async () => {
    const fake = fakeClock();
    let checks = 0;
    let settled = false;
    const records: string[] = [];
    const poller = pollTransactionResolution({
      generation: 1, fence: { assertCurrent: () => {} }, clock: fake.clock,
      check: async () => { checks += 1; return { status: "complete", transactionHash }; },
      recordTransactionHash: async (hash) => {
        records.push(hash);
        if (records.length === 1) throw new Error("record unavailable");
      },
      onFailedWithoutHash: () => { throw new Error("unexpected failure"); },
    });
    void poller.result.then(() => { settled = true; });
    await fake.advance(1_500);
    await fake.advance(0);
    expect(settled).toBe(false);
    expect(records).toEqual([transactionHash]);
    expect(fake.pending()).toBe(1);
    await fake.advance(2_499);
    expect(checks).toBe(1);
    expect(settled).toBe(false);
    await fake.advance(1);
    await poller.result;
    expect(checks).toBe(2);
    expect(records).toEqual([transactionHash, transactionHash]);
    expect(fake.pending()).toBe(0);
  });
});

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
      dispatchAttempts: new Map(),
      pendingDeclines: new Map(),
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
      let declines = 0;
      const events: string[] = [];
      const providerDispatches = new Map<string, Promise<string>>();
      const dispatchAttempts = new Map<string, number>();
      const pendingDeclines = new Map<string, Promise<void>>();
      const execute = () => executeActionOnce({
        id,
        generation: 3,
        fence: { assertCurrent: () => {} },
        confirmedPlans: new Map([[id, plan]]),
        providerDispatches,
        dispatchAttempts,
        pendingDeclines,
        beginRetry: async (attempt) => { events.push(`retry:${attempt}`); },
        confirm: async () => plan,
        dispatch: async () => {
          dispatches += 1;
          events.push(`dispatch:${dispatches}`);
          if (dispatches === 1) throw rejection;
          return `0x${"ab".repeat(32)}`;
        },
        recordHandle: async () => {},
        recordDecline: async (attempt) => { declines += 1; events.push(`decline:${attempt}`); throw new Error("decline POST unavailable"); },
      });

      await expect(execute()).rejects.toMatchObject({ reason: "rejected", cause: rejection });
      await expect(execute()).resolves.toBe(`0x${"ab".repeat(32)}`);
      expect(dispatches).toBe(2);
      expect(declines).toBe(1);
      expect(events).toEqual(["dispatch:1", "decline:0", "retry:1", "dispatch:2"]);
    }

    const ambiguous = new Error("transport aborted after dispatch began");
    let ambiguousDispatches = 0;
    let ambiguousDeclines = 0;
    const providerDispatches = new Map<string, Promise<string>>();
    const dispatchAttempts = new Map<string, number>();
    const pendingDeclines = new Map<string, Promise<void>>();
    const executeAmbiguous = () => executeActionOnce({
      id,
      generation: 3,
      fence: { assertCurrent: () => {} },
      confirmedPlans: new Map([[id, plan]]),
      providerDispatches,
      dispatchAttempts,
      pendingDeclines,
      confirm: async () => plan,
      dispatch: async () => {
        ambiguousDispatches += 1;
        throw ambiguous;
      },
      recordHandle: async () => {},
      recordDecline: async () => { ambiguousDeclines += 1; },
    });

    await expect(executeAmbiguous()).rejects.toMatchObject({ reason: "dispatch-unknown", cause: ambiguous });
    await expect(executeAmbiguous()).rejects.toMatchObject({ reason: "dispatch-unknown", cause: ambiguous });
    expect(ambiguousDispatches).toBe(1);
    expect(ambiguousDeclines).toBe(0);
  });

  test("a failure proven before the provider request is not submitted: it reports a decline and a retry dispatches again", async () => {
    let dispatches = 0;
    let declines = 0;
    const execute = () => executeActionOnce({
      id, generation: 3, fence: { assertCurrent: () => {} }, confirmedPlans: new Map([[id, plan]]),
      providerDispatches: new Map(), dispatchAttempts: new Map(), pendingDeclines: new Map(),
      confirm: async () => plan,
      dispatch: async () => {
        if (++dispatches === 1) throw new TransferExecutionError("not-submitted", new Error("account changed before wallet_sendCalls"));
        return "handle";
      },
      recordHandle: async () => {},
      recordDecline: async () => { declines += 1; },
    });
    await expect(execute()).rejects.toMatchObject({ reason: "not-submitted" });
    expect(declines).toBe(1);
    await expect(execute()).resolves.toBe("handle");
    expect(dispatches).toBe(2);
  });

  test("a lost confirm response retries confirmation without opening a second provider dispatch", async () => {
    let confirms = 0;
    let dispatches = 0;
    const confirmedPlans = new Map<string, ConfirmedPlan>();
    const providerDispatches = new Map<string, Promise<string>>();
    const execute = () => executeActionOnce({
      id, generation: 3, fence: { assertCurrent: () => {} }, confirmedPlans, providerDispatches,
      dispatchAttempts: new Map(), pendingDeclines: new Map(),
      confirm: async () => { if (++confirms === 1) throw new Error("confirm response lost"); return plan; },
      dispatch: async () => { dispatches++; return "handle"; },
      recordHandle: async () => {},
    });
    await expect(execute()).rejects.toThrow("confirm response lost");
    expect(dispatches).toBe(0);
    await expect(execute()).resolves.toBe("handle");
    await expect(execute()).resolves.toBe("handle");
    expect({ confirms, dispatches }).toEqual({ confirms: 2, dispatches: 1 });
  });

  test("retry waits for a pending decline report before opening the next attempt", async () => {
    let finishReport!: () => void;
    const report = new Promise<void>((resolve) => { finishReport = resolve; });
    const events: string[] = [];
    const dispatchAttempts = new Map<string, number>();
    const pendingDeclines = new Map<string, Promise<void>>();
    const providerDispatches = new Map<string, Promise<string>>();
    let dispatches = 0;
    const execute = () => executeActionOnce({ id, generation: 3, fence: { assertCurrent: () => {} },
      confirmedPlans: new Map([[id, plan]]), dispatchAttempts, pendingDeclines, providerDispatches,
      confirm: async () => plan,
      dispatch: async () => {
        dispatches += 1;
        events.push(`dispatch:${dispatches}`);
        if (dispatches === 1) throw new BaseAccountConnectorError("cancelled");
        return "handle";
      },
      recordHandle: async () => {},
      recordDecline: async (attempt) => { events.push(`decline:${attempt}`); await report; },
      beginRetry: async (attempt) => { events.push(`retry:${attempt}`); },
    });
    await expect(execute()).rejects.toMatchObject({ reason: "rejected" });
    const second = execute();
    await Promise.resolve();
    expect(events).toEqual(["dispatch:1", "decline:0"]);
    finishReport();
    await expect(second).resolves.toBe("handle");
    expect(events).toEqual(["dispatch:1", "decline:0", "retry:1", "dispatch:2"]);
  });

  test("a failed beginRetry prevents that provider dispatch and a later retry can proceed", async () => {
    let dispatches = 0;
    let retries = 0;
    const dispatchAttempts = new Map<string, number>();
    const pendingDeclines = new Map<string, Promise<void>>();
    const providerDispatches = new Map<string, Promise<string>>();
    const execute = () => executeActionOnce({ id, generation: 3, fence: { assertCurrent: () => {} },
      confirmedPlans: new Map([[id, plan]]), dispatchAttempts, pendingDeclines, providerDispatches,
      confirm: async () => plan,
      dispatch: async () => {
        dispatches += 1;
        if (dispatches === 1) throw new BaseAccountConnectorError("cancelled");
        return "handle";
      },
      recordHandle: async () => {}, recordDecline: async () => {},
      beginRetry: async (attempt) => {
        retries += 1;
        expect(attempt).toBe(1);
        if (retries === 1) throw new Error("retry unavailable");
      },
    });
    await expect(execute()).rejects.toMatchObject({ reason: "rejected" });
    await expect(execute()).rejects.toMatchObject({ reason: "unavailable" });
    expect(dispatches).toBe(1);
    await expect(execute()).resolves.toBe("handle");
    expect(retries).toBe(2);
    expect(dispatches).toBe(2);
  });

  test("a never-settling decline report does not delay rejection and bounds retry waiting", async () => {
    const fake = fakeClock();
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((callback: () => void, delay?: number) => fake.clock.setTimer(() => {
      if (typeof callback === "function") callback();
    }, delay ?? 0)) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: unknown) => fake.clock.clearTimer(timer)) as typeof clearTimeout;
    try {
      let reportStarted = false;
      const pendingReport = new Promise<void>(() => {});
      const providerDispatches = new Map<string, Promise<string>>();
      const dispatchAttempts = new Map<string, number>();
      const pendingDeclines = new Map<string, Promise<void>>();
      let dispatches = 0;
      const execute = () => executeActionOnce({
        id, generation: 3, fence: { assertCurrent: () => {} },
        confirmedPlans: new Map([[id, plan]]), providerDispatches, dispatchAttempts, pendingDeclines,
        confirm: async () => plan,
        dispatch: async () => {
          dispatches += 1;
          if (dispatches === 1) throw new BaseAccountConnectorError("cancelled");
          return "handle";
        },
        recordHandle: async () => {},
        recordDecline: () => { reportStarted = true; return pendingReport; },
        beginRetry: async () => {},
      });
      await expect(execute()).rejects.toMatchObject({ reason: "rejected" });
      expect(reportStarted).toBe(true);
      const retry = execute();
      await Promise.resolve();
      expect(dispatches).toBe(1);
      await fake.advance(5_000);
      await expect(retry).resolves.toBe("handle");
      expect(dispatches).toBe(2);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  test("records and resolves a Base Account wallet-generated handle", async () => {
    const fake = fakeClock();
    const walletHandle = `0x${"ef".repeat(64)}`;
    const address = "0x1111111111111111111111111111111111111111" as const;
    const session: VerifiedAccountSession = {
      user: { subject: "subject" },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "base-account",
    };
    const ownerFence: OwnerGenerationFence = {
      advance: () => 4,
      capture: () => 4,
      isCurrent: (generation) => generation === 4,
      assertCurrent: (generation) => { expect(generation).toBe(4); },
      updateAuthorizationBoundary: () => {},
      updateOwnerKey: () => false,
    };
    const fee = { payment: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "20000", decimals: 6 };
    const handlePosts: Array<{ path: string; body: unknown }> = [];
    const transport = {
      fetchAccountResource: async (path: string, options?: { body?: unknown }) => {
        if (path === `/api/actions/${id}`) {
          return {
            id,
            kind: "send",
            summary: {
              title: "Send",
              networkFee: fee,
              amounts: [],
              warnings: [],
              expiresAt: "2099-01-01T00:00:00.000Z",
            },
            calls: plan.calls,
            expiresAt: "2099-01-01T00:00:00.000Z",
          };
        }
        if (path === `/api/actions/${id}/confirm`) return { calls: plan.calls, batchGasLimit: "150000" };
        if (path === `/api/actions/${id}/handle`) {
          handlePosts.push({ path, body: options?.body });
          return {};
        }
        throw new Error(`Unexpected account resource ${path}`);
      },
    } as unknown as AuthenticatedTransport;
    const statusHandles: string[] = [];
    const connection: ConnectedBaseAccount = {
      kind: "unsupported",
      address,
      assertUnchanged: async () => {},
      signMessage: async () => "0x12",
      signTypedData: async () => "0x12",
      sendCalls: async (_calls, requestId, beforeDispatch, batchGasLimit, paymaster) => {
        expect(requestId).toBe(id);
        expect(batchGasLimit).toBe("150000");
        expect(paymaster).toEqual({ url: new URL(`/api/actions/${id}/paymaster`, window.location.origin).toString(), context: { erc20: fee.token.toLowerCase() } });
        await beforeDispatch?.();
        return walletHandle;
      },
      getCallsStatus: async (providerHandle) => {
        statusHandles.push(providerHandle);
        return { status: "complete", transactionHash };
      },
      disconnect: async () => {},
    };
    const baseConnection = { current: connection } as MutableRefObject<ConnectedBaseAccount | null>;
    let execution!: ReturnType<typeof useMoneyActionExecution>;

    function Probe() {
      execution = useMoneyActionExecution({
        session,
        status: "verified",
        verification: "server",
        ownerKey: "owner",
        ownerFence,
        sdkSendUserOperation: undefined,
        sdkGetUserOperation: undefined,
        baseConnection,
        transport,
        signTypedData: async () => "0x12",
      });
      return null;
    }

    render(createElement(Probe));
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((callback: () => void, delay?: number) =>
      fake.clock.setTimer(() => {
        if (typeof callback === "function") callback();
      }, delay ?? 0)) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: unknown) =>
      fake.clock.clearTimer(timer)) as typeof clearTimeout;

    try {
      const action = await execution.resumeMoneyAction(id);
      await expect(execution.executeMoneyAction(action)).resolves.toMatchObject({
        id,
        status: "submitted",
      });
      expect(handlePosts).toEqual([{
        path: `/api/actions/${id}/handle`,
        body: { providerHandle: walletHandle },
      }]);

      await fake.advance(1_500);

      expect(statusHandles).toEqual([walletHandle]);
      expect(handlePosts).toEqual([
        { path: `/api/actions/${id}/handle`, body: { providerHandle: walletHandle } },
        { path: `/api/actions/${id}/handle`, body: { transactionHash } },
      ]);
      expect(fake.pending()).toBe(0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      execution.reset();
    }
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

  test.each([
    {
      name: "without a hash reports the bundler failure and never posts a handle",
      resolution: { status: "failed" as const, reason: "Bundler rejected the operation." },
      reason: "Bundler rejected the operation.",
      checkCount: false,
    },
    {
      name: "with a provider hash reports its reason and never posts a handle",
      resolution: normalizeResolutionState({
        status: "failed", transactionHash, failureReason: "User operation reverted inside the bundle.",
      }),
      reason: "User operation reverted inside the bundle.",
      checkCount: true,
    },
    {
      name: "with a provider hash and no reason reports the default and never posts a handle",
      resolution: normalizeResolutionState({ status: "failed", transactionHash }),
      reason: "The wallet operation failed.",
      checkCount: false,
    },
  ])("failed operation $name", async ({ resolution, reason, checkCount }) => {
    const fake = fakeClock();
    const posts: string[] = [];
    const failures: string[] = [];
    let checks = 0;
    const run = pollTransactionResolution({
      generation: 2,
      fence: { assertCurrent: () => {} },
      check: async () => { checks += 1; return resolution; },
      recordTransactionHash: async (hash) => { posts.push(hash); },
      onFailedWithoutHash: (failure) => { failures.push(failure); },
      clock: fake.clock,
    });

    await fake.advance(1_500);
    await run.result;

    expect(posts).toEqual([]);
    expect(failures).toEqual([reason]);
    if (checkCount) expect(checks).toBe(1);
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

  test("a malformed 2xx confirm response fails unavailable before wallet dispatch", async () => {
    const session: VerifiedAccountSession = {
      user: { subject: "subject" },
      smartAccount: { address: plan.calls[0].to, chainId: 8453 },
      accountProvider: "cdp-embedded",
    };
    const ownerFence: OwnerGenerationFence = {
      advance: () => 4,
      capture: () => 4,
      isCurrent: (generation) => generation === 4,
      assertCurrent: (generation) => { expect(generation).toBe(4); },
      updateAuthorizationBoundary: () => {},
      updateOwnerKey: () => false,
    };
    const posts: string[] = [];
    const transport = {
      fetchAccountResource: async (path: string, options?: { method?: string }) => {
        if (path === `/api/actions/${id}`) return {
          id, kind: "send", summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
          calls: plan.calls, expiresAt: "2099-01-01T00:00:00.000Z",
        };
        if (path === `/api/actions/${id}/confirm`) {
          expect(options?.method).toBe("POST");
          posts.push(path);
          return { calls: [{ ...plan.calls[0], to: "0xnothex" }] };
        }
        throw new Error(`Unexpected account resource ${path}`);
      },
    } as unknown as AuthenticatedTransport;
    let dispatches = 0;
    let execution!: ReturnType<typeof useMoneyActionExecution>;
    function Probe() {
      execution = useMoneyActionExecution({
        session, status: "verified", verification: "server", ownerKey: "owner", ownerFence,
        sdkSendUserOperation: async () => { dispatches += 1; throw new Error("Must not dispatch"); },
        sdkGetUserOperation: undefined,
        baseConnection: { current: null } as MutableRefObject<ConnectedBaseAccount | null>,
        transport, signTypedData: async () => "0x12",
      });
      return null;
    }
    const view = render(createElement(Probe));
    try {
      const action = await execution.resumeMoneyAction(id);
      await expect(execution.executeMoneyAction(action)).rejects.toMatchObject({ reason: "unavailable" });
      expect(posts).toEqual([`/api/actions/${id}/confirm`]);
      expect(dispatches).toBe(0);
    } finally {
      view.unmount();
    }
  });

  test("a 410 ACTION_EXPIRED confirm reaches the flow as expired through the real transport without dispatch", async () => {
    const session: VerifiedAccountSession = {
      user: { subject: "subject" },
      smartAccount: { address: plan.calls[0].to, chainId: 8453 },
      accountProvider: "cdp-embedded",
    };
    const ownerFence: OwnerGenerationFence = {
      advance: () => 4,
      capture: () => 4,
      isCurrent: (generation) => generation === 4,
      assertCurrent: (generation) => { expect(generation).toBe(4); },
      updateAuthorizationBoundary: () => {},
      updateOwnerKey: () => false,
    };
    const posts: string[] = [];
    const sessionFetch: SessionFetch = async (path, options) => {
      if (path === `/api/actions/${id}`) {
        expect(options?.method).toBe("GET");
        return Response.json({
          id, kind: "send", summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
          calls: plan.calls, expiresAt: "2099-01-01T00:00:00.000Z",
        });
      }
      if (path === `/api/actions/${id}/confirm`) {
        expect(options?.method).toBe("POST");
        posts.push(path);
        return new Response(JSON.stringify({ error: { code: "ACTION_EXPIRED", message: "This action expired." } }), {
          status: 410, headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected account resource ${String(path)}`);
    };
    const sdkSendUserOperation = mock(async () => { throw new Error("Must not dispatch"); });
    const queryClient = new QueryClient();
    const executionRef: { current: ReturnType<typeof useMoneyActionExecution> | null } = { current: null };
    const baseConnection: MutableRefObject<ConnectedBaseAccount | null> = { current: null };
    function Probe() {
      const transport = useAuthenticatedTransport({
        session, status: "verified", verification: "server", ownerKey: "owner", ownerFence,
        getAccessToken: async () => "fixture-access-token", sessionFetch,
      });
      const execution = useMoneyActionExecution({
        session, status: "verified", verification: "server", ownerKey: "owner", ownerFence,
        sdkSendUserOperation, sdkGetUserOperation: undefined,
        baseConnection,
        transport, signTypedData: async () => "0x12",
      });
      useEffect(() => { executionRef.current = execution; }, [execution]);
      return null;
    }
    const view = render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)));
    try {
      const execution = requireExecution(executionRef);
      const action = await execution.resumeMoneyAction(id);
      const result = execution.executeMoneyAction(action);
      await expect(result).rejects.toBeInstanceOf(TransferExecutionError);
      await expect(result).rejects.toMatchObject({
        reason: "unavailable", kind: "http", code: "ACTION_EXPIRED", status: 410,
        serverMessage: "This action expired.",
      });
      await expect(result).rejects.not.toMatchObject({ reason: "submission-unknown" });
      expect(posts).toEqual([`/api/actions/${id}/confirm`]);
      expect(sdkSendUserOperation).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      queryClient.clear();
    }
  });

  test("an ambiguous CDP dispatch failure stays single-shot through the real executor", async () => {
    const failure = new Error("transport aborted after dispatch began");
    const harness = renderConfirmExecution(async () => plan, failure);
    try {
      const action = await harness.execution.resumeMoneyAction(id);
      await expect(harness.execution.executeMoneyAction(action)).rejects.toMatchObject({
        reason: "dispatch-unknown", cause: failure,
      });
      await expect(harness.execution.executeMoneyAction(action)).rejects.toMatchObject({
        reason: "dispatch-unknown", cause: failure,
      });
      expect(harness.posts).toEqual([`/api/actions/${id}/confirm`]);
      expect(harness.dispatchCount()).toBe(1);
    } finally {
      harness.unmount();
    }
  });

  test("addresses the CDP smart account by its checksummed form when sending and polling", async () => {
    const fake = fakeClock();
    const lowercase = "0x7b058c8ea4f394d30047998202f45b3c2a94d196" as const;
    const checksummed = "0x7B058c8EA4F394D30047998202F45b3C2a94d196";
    const userOperationHash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const session: VerifiedAccountSession = {
      user: { subject: "subject" },
      smartAccount: { address: lowercase, chainId: 8453 },
      accountProvider: "cdp-embedded",
    };
    const ownerFence: OwnerGenerationFence = {
      advance: () => 4,
      capture: () => 4,
      isCurrent: (generation) => generation === 4,
      assertCurrent: (generation) => { expect(generation).toBe(4); },
      updateAuthorizationBoundary: () => {},
      updateOwnerKey: () => false,
    };
    const transport = {
      fetchAccountResource: async (path: string) => {
        if (path === `/api/actions/${id}`) {
          return {
            id,
            kind: "send",
            summary: { title: "Send", networkFee: { payment: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "20000", decimals: 6 }, amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
            calls: plan.calls,
            expiresAt: "2099-01-01T00:00:00.000Z",
          };
        }
        if (path === `/api/actions/${id}/confirm`) return { calls: plan.calls };
        if (path === `/api/actions/${id}/handle`) return {};
        throw new Error(`Unexpected account resource ${path}`);
      },
    } as unknown as AuthenticatedTransport;
    const sentTo: string[] = [];
    const paymasterOptions: unknown[] = [];
    const polledFor: string[] = [];
    let execution!: ReturnType<typeof useMoneyActionExecution>;

    function Probe() {
      execution = useMoneyActionExecution({
        session,
        status: "verified",
        verification: "server",
        ownerKey: "owner",
        ownerFence,
        sdkSendUserOperation: async (options) => {
          sentTo.push(options.evmSmartAccount);
          paymasterOptions.push({ paymasterUrl: options.paymasterUrl, paymasterContext: options.paymasterContext, useCdpPaymaster: options.useCdpPaymaster });
          return { userOperationHash };
        },
        sdkGetUserOperation: async (options) => {
          polledFor.push(options.evmSmartAccount);
          return { status: "complete", transactionHash, network: "base", userOpHash: userOperationHash, calls: [] };
        },
        baseConnection: { current: null } as MutableRefObject<ConnectedBaseAccount | null>,
        transport,
        signTypedData: async () => "0x12",
      });
      return null;
    }

    render(createElement(Probe));
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((callback: () => void, delay?: number) =>
      fake.clock.setTimer(() => {
        if (typeof callback === "function") callback();
      }, delay ?? 0)) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: unknown) =>
      fake.clock.clearTimer(timer)) as typeof clearTimeout;

    try {
      const action = await execution.resumeMoneyAction(id);
      expect(action.owner.address).toBe(lowercase);
      await expect(execution.executeMoneyAction({ ...action, networkFee: { payment: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "bad", decimals: 6 } })).rejects.toMatchObject({ reason: "unavailable" });
      expect(sentTo).toEqual([]);
      await expect(execution.executeMoneyAction(action)).resolves.toMatchObject({ id, status: "submitted", userOperationHash });
      await fake.advance(1_500);
      expect(sentTo).toEqual([checksummed]);
      expect(paymasterOptions).toEqual([{ paymasterUrl: new URL(`/api/actions/${id}/paymaster`, window.location.origin).toString(), paymasterContext: { erc20: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }, useCdpPaymaster: undefined }]);
      expect(polledFor).toEqual([checksummed]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      execution.reset();
    }
  });

  test("reuses one idempotent CDP dispatch when handle recording resolves remotely then throws locally", async () => {
    let confirmPosts = 0;
    let dispatches = 0;
    let handlePosts = 0;
    let recordedHandle: string | null = null;
    const confirmedPlans = new Map<string, ConfirmedPlan>();
    const providerDispatches = new Map<string, Promise<string>>();
    const dispatchAttempts = new Map<string, number>();
    const pendingDeclines = new Map<string, Promise<void>>();
    const execute = () => executeActionOnce({
      id,
      generation: 3,
      fence: { assertCurrent: (generation) => { if (generation !== 3) throw new Error("stale"); } },
      confirmedPlans,
      providerDispatches,
      dispatchAttempts,
      pendingDeclines,
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

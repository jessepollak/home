import "./dom-test-harness";

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { EmailRequestResult } from "./base-account-connector";
import type { SignInEmailFollowUp } from "./email-request-flow";

const { act, renderHook, waitFor } = await import("@testing-library/react");
const { useEmailRequestFlow } = await import("./email-request-flow");

const OWNER = "base-account:0xowner";
const OTHER_OWNER = "base-account:0xother";
const EMAIL = "person@example.com";
const ADDRESS = "0x1111111111111111111111111111111111111111";

type Props = { ownerKey: string; ready: boolean };
type Call = { path: string; method: string; body?: Record<string, unknown>; owner: string };

function setup({
  followUp,
  claimed = true,
  failSaves = 0,
  failAnswers = 0,
  malformedSaves = 0,
  deferredWallet = false,
  deferredClaim = false,
  walletResult = { status: "email", email: EMAIL, bundleId: null } as EmailRequestResult,
}: {
  followUp: SignInEmailFollowUp;
  claimed?: boolean;
  failSaves?: number;
  failAnswers?: number;
  malformedSaves?: number;
  deferredWallet?: boolean;
  deferredClaim?: boolean;
  walletResult?: EmailRequestResult;
}) {
  const calls: Call[] = [];
  const waits: number[] = [];
  const waiters: (() => void)[] = [];
  let walletRequests = 0;
  let saveFailures = failSaves;
  let answerFailures = failAnswers;
  let malformed = malformedSaves;
  let pendingFollowUp: SignInEmailFollowUp | null = followUp;
  let resolveWallet: ((result: EmailRequestResult) => void) | null = null;
  let resolveClaim: (() => void) | null = null;
  // Mirrors the real transport: a fetcher is bound to the owner generation that created it and
  // rejects once the live owner has moved on.
  const live = { owner: OWNER, ready: true, generation: 0 };
  const hookOwner = { current: OWNER };
  const resourceFor = (owner: string) => async (path: string, options: { method?: string; body?: unknown } = {}) => {
    const call = { path, method: options.method ?? "GET", body: options.body as Record<string, unknown> | undefined, owner };
    calls.push(call);
    if (live.owner !== owner || !live.ready) throw new Error("stale-session");
    if (call.body?.kind === "claim") {
      if (deferredClaim) return new Promise((resolve) => { resolveClaim = () => resolve({ version: 1, claimed }); });
      return { version: 1, claimed };
    }
    if (call.body?.kind === "email" && saveFailures > 0) {
      saveFailures -= 1;
      throw new Error("save failed");
    }
    if (call.body?.kind === "answer" && answerFailures > 0) {
      answerFailures -= 1;
      throw new Error("save failed");
    }
    if (call.body?.kind === "email" && malformed > 0) {
      malformed -= 1;
      return { version: 2, asked: true };
    }
    return { version: 1, asked: true };
  };
  const hook = renderHook((props: Props) => useEmailRequestFlow({
    ready: props.ready,
    ownerKey: props.ownerKey,
    accountAddress: ADDRESS,
    captureGeneration: () => live.generation,
    isGenerationCurrent: (generation) => live.generation === generation,
    followUp: 1,
    takeFollowUp: () => {
      const next = pendingFollowUp;
      pendingFollowUp = null;
      return next;
    },
    requestEmail: () => {
      walletRequests += 1;
      if (!deferredWallet) return Promise.resolve(walletResult);
      return new Promise<EmailRequestResult>((resolve) => { resolveWallet = resolve; });
    },
    fetchResource: resourceFor(hookOwner.current),
    wait: (ms) => {
      waits.push(ms);
      return new Promise<void>((resolve) => { waiters.push(resolve); });
    },
  }), { initialProps: { ownerKey: OWNER, ready: true } as Props });
  const releaseWaits = () => { for (const resolve of waiters.splice(0)) resolve(); };
  const waitForWaits = async (count = 1) => { await waitFor(() => expect(waiters.length).toBeGreaterThanOrEqual(count)); };
  const switchOwner = (ownerKey: string, ready = true) => {
    live.generation += 1;
    live.owner = ownerKey;
    live.ready = ready;
    hookOwner.current = ownerKey;
    hook.rerender({ ownerKey, ready });
  };
  const setReady = (ready: boolean) => {
    live.ready = ready;
    hook.rerender({ ownerKey: hookOwner.current, ready });
  };
  return {
    hook, calls, waits, switchOwner, setReady, releaseWaits, waitForWaits,
    walletRequests: () => walletRequests,
    resolveWallet: (result: EmailRequestResult) => resolveWallet?.(result),
    resolveClaim: () => resolveClaim?.(),
  };
}

const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST").map((call) => call.body);
const bodies = (calls: Call[], kind: string) => posts(calls).filter((body) => body?.kind === kind);
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("email request flow", () => {
  test("stores an email returned by the combined sign-in request without showing the step", async () => {
    const { hook, calls } = setup({ followUp: { status: "email", email: EMAIL } });
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toEqual({ version: 1, kind: "email", channel: "sign_in", email: EMAIL, address: ADDRESS });
    expect(hook.result.current.pending).toBe(false);
    await waitFor(() => expect(window.localStorage.getItem("home:email-request-answered")).toBe("1"));
  });

  test("a sign-in decline records the answer, stores nothing and shows no step", async () => {
    const { hook, calls } = setup({ followUp: { status: "declined" } });
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toEqual({ version: 1, kind: "answer", channel: "sign_in", answer: "declined", address: ADDRESS });
    expect(hook.result.current.pending).toBe(false);
    await waitFor(() => expect(window.localStorage.getItem("home:email-request-answered")).toBe("1"));
  });

  test("a declined answer writes the device hint only after the marker save succeeds", async () => {
    const failed = setup({ followUp: { status: "declined" }, failAnswers: 10 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await failed.waitForWaits();
      await act(async () => { failed.releaseWaits(); });
    }
    await waitFor(() => expect(bodies(failed.calls, "answer")).toHaveLength(4));
    expect(window.localStorage.getItem("home:email-request-answered")).toBeNull();
    failed.hook.unmount();

    const saved = setup({ followUp: { status: "declined" } });
    await waitFor(() => expect(bodies(saved.calls, "answer")).toHaveLength(1));
    await waitFor(() => expect(window.localStorage.getItem("home:email-request-answered")).toBe("1"));
  });

  test("a refused combined request records the wallet response and offers the step once", async () => {
    const { hook, calls } = setup({ followUp: { status: "refused", code: 5700, message: "unsupported" } });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    expect(posts(calls)[0]).toEqual({ version: 1, kind: "sign_in_capability", result: "refused", walletCode: 5700, walletMessage: "unsupported", address: ADDRESS });
    expect(bodies(calls, "claim")).toEqual([{ version: 1, kind: "claim", channel: "share_step", address: ADDRESS }]);
    expect(calls.every((call) => call.method === "POST")).toBe(true);
  });

  test("an account that was already asked never sees the step", async () => {
    const { hook, calls } = setup({ followUp: { status: "skipped" }, claimed: false });
    await waitFor(() => expect(bodies(calls, "claim")).toHaveLength(1));
    await settle();
    expect(hook.result.current.pending).toBe(false);
    expect(posts(calls)).toEqual([{ version: 1, kind: "claim", channel: "share_step", address: ADDRESS }]);
  });

  test("an unsuccessful claim never shows the sheet or opens the wallet", async () => {
    const { hook, calls, walletRequests } = setup({ followUp: { status: "ignored" }, claimed: false });
    await waitFor(() => expect(bodies(calls, "claim")).toHaveLength(1));
    await settle();
    expect(hook.result.current.pending).toBe(false);
    act(() => hook.result.current.share());
    expect(walletRequests()).toBe(0);
    expect(bodies(calls, "asked")).toHaveLength(0);
  });

  test("Share marks the account asked before the wallet opens, then stores the email", async () => {
    const { hook, calls, walletRequests } = setup({ followUp: { status: "ignored" }, walletResult: { status: "email", email: EMAIL, bundleId: "0xb" } });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    const before = posts(calls).length;
    act(() => hook.result.current.share());
    expect(posts(calls)[before]).toEqual({ version: 1, kind: "asked", channel: "share_step", address: ADDRESS });
    expect(walletRequests()).toBe(1);
    expect(hook.result.current.pending).toBe(false);
    await waitFor(() => expect(posts(calls).at(-1)).toEqual({ version: 1, kind: "email", channel: "share_step", email: EMAIL, bundleId: "0xb", address: ADDRESS }));
    act(() => hook.result.current.share());
    expect(walletRequests()).toBe(1);
  });

  test("Not now and a wallet decline store no email", async () => {
    const notNow = setup({ followUp: { status: "ignored" } });
    await waitFor(() => expect(notNow.hook.result.current.pending).toBe(true));
    act(() => notNow.hook.result.current.dismiss());
    expect(posts(notNow.calls).at(-1)).toEqual({ version: 1, kind: "answer", channel: "share_step", answer: "not_now", address: ADDRESS });
    expect(notNow.walletRequests()).toBe(0);
    notNow.hook.unmount();

    const declined = setup({ followUp: { status: "ignored" }, walletResult: { status: "declined" } });
    await waitFor(() => expect(declined.hook.result.current.pending).toBe(true));
    act(() => declined.hook.result.current.share());
    await waitFor(() => expect(posts(declined.calls).at(-1)).toEqual({ version: 1, kind: "answer", channel: "share_step", answer: "declined", address: ADDRESS }));
    expect([...posts(notNow.calls), ...posts(declined.calls)].some((body) => body?.kind === "email")).toBe(false);
  });

  test("a failed save retries a bounded number of times without re-prompting the wallet", async () => {
    const { hook, calls, waits, walletRequests, releaseWaits, waitForWaits } = setup({ followUp: { status: "ignored" }, failSaves: 10 });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    act(() => hook.result.current.share());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await waitForWaits();
      await act(async () => { releaseWaits(); });
    }
    await waitFor(() => expect(bodies(calls, "email")).toHaveLength(4));
    expect(waits).toEqual([500, 1500, 4000]);
    expect(walletRequests()).toBe(1);
  });

  test("a save that fails once is retried and succeeds", async () => {
    const { hook, calls, releaseWaits, waitForWaits } = setup({ followUp: { status: "ignored" }, failSaves: 1 });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    act(() => hook.result.current.share());
    await waitForWaits();
    await act(async () => { releaseWaits(); });
    await waitFor(() => expect(bodies(calls, "email")).toHaveLength(2));
  });

  test("a 200 that does not satisfy the write contract is retried, not treated as saved", async () => {
    const { hook, calls, releaseWaits, waitForWaits } = setup({ followUp: { status: "ignored" }, malformedSaves: 10 });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    act(() => hook.result.current.share());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await waitForWaits();
      await act(async () => { releaseWaits(); });
    }
    await waitFor(() => expect(bodies(calls, "email")).toHaveLength(4));
    expect(posts(calls).filter((body) => body?.kind !== "email")).toEqual([
      { version: 1, kind: "sign_in_capability", result: "ignored", address: ADDRESS },
      { version: 1, kind: "claim", channel: "share_step", address: ADDRESS },
      { version: 1, kind: "asked", channel: "share_step", address: ADDRESS },
    ]);
  });

  test("a late wallet result after the owner changed is discarded", async () => {
    const { hook, calls, switchOwner, resolveWallet, walletRequests } = setup({ followUp: { status: "ignored" }, deferredWallet: true });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    act(() => hook.result.current.share());
    expect(walletRequests()).toBe(1);
    const askedBefore = bodies(calls, "asked").length;
    switchOwner(OTHER_OWNER);
    await act(async () => { resolveWallet({ status: "email", email: EMAIL, bundleId: null }); });
    expect(bodies(calls, "email")).toHaveLength(0);
    expect(bodies(calls, "asked")).toHaveLength(askedBefore);
    expect(calls.every((call) => call.owner === OWNER)).toBe(true);
    expect(hook.result.current.pending).toBe(false);
  });

  test("a late wallet result after A to B to A is discarded by generation", async () => {
    const { hook, calls, switchOwner, resolveWallet, walletRequests } = setup({ followUp: { status: "ignored" }, deferredWallet: true });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    act(() => hook.result.current.share());
    expect(walletRequests()).toBe(1);
    const before = posts(calls).length;
    switchOwner(OTHER_OWNER);
    switchOwner(OWNER);
    await act(async () => { resolveWallet({ status: "email", email: EMAIL, bundleId: null }); });
    expect(posts(calls)).toHaveLength(before);
    expect(bodies(calls, "email")).toHaveLength(0);
    expect(hook.result.current.pending).toBe(false);
    expect(walletRequests()).toBe(1);
  });

  test("the share sheet reopens when readiness returns for the same owner", async () => {
    const { hook, switchOwner, walletRequests } = setup({ followUp: { status: "skipped" } });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    switchOwner(OWNER, false);
    expect(hook.result.current.pending).toBe(false);
    switchOwner(OWNER);
    expect(hook.result.current.pending).toBe(true);
    expect(walletRequests()).toBe(0);
  });

  test("a save retry stops when the owner changes instead of writing for the new owner", async () => {
    const { hook, calls, switchOwner, releaseWaits, waitForWaits } = setup({ followUp: { status: "ignored" }, failSaves: 10 });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    act(() => hook.result.current.share());
    await waitForWaits();
    switchOwner(OTHER_OWNER);
    await act(async () => { releaseWaits(); });
    await settle();
    expect(bodies(calls, "email")).toHaveLength(1);
    expect(calls.every((call) => call.owner === OWNER)).toBe(true);
  });

  test("a share step claim that resolves after the owner changes is not offered", async () => {
    const { hook, calls, switchOwner, resolveClaim } = setup({ followUp: { status: "skipped" }, deferredClaim: true });
    await waitFor(() => expect(bodies(calls, "claim")).toHaveLength(1));
    switchOwner(OTHER_OWNER);
    await act(async () => { resolveClaim(); });
    await settle();
    switchOwner(OWNER);
    await settle();
    expect(hook.result.current.pending).toBe(false);
  });

  test("a deferred claim after A to B to A is discarded by generation", async () => {
    const { hook, calls, switchOwner, resolveClaim } = setup({ followUp: { status: "skipped" }, deferredClaim: true });
    await waitFor(() => expect(bodies(calls, "claim")).toHaveLength(1));
    switchOwner(OTHER_OWNER);
    switchOwner(OWNER);
    await act(async () => { resolveClaim(); });
    expect(bodies(calls, "claim")).toHaveLength(1);
    expect(hook.result.current.pending).toBe(false);
  });

  test("a claim that resolves during a same-owner readiness flap still offers the sheet", async () => {
    const { hook, calls, resolveClaim } = setup({ followUp: { status: "skipped" }, deferredClaim: true });
    await waitFor(() => expect(bodies(calls, "claim")).toHaveLength(1));
    act(() => { hook.rerender({ ownerKey: OWNER, ready: false }); });
    await act(async () => { resolveClaim(); });
    expect(hook.result.current.pending).toBe(false);
    act(() => { hook.rerender({ ownerKey: OWNER, ready: true }); });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
  });

  test("a wallet result during a same-owner readiness flap is retried and saved when readiness returns", async () => {
    const { hook, calls, setReady, resolveWallet, releaseWaits, waitForWaits } = setup({ followUp: { status: "ignored" }, deferredWallet: true });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    act(() => hook.result.current.share());
    act(() => { setReady(false); });
    await act(async () => { resolveWallet({ status: "email", email: EMAIL, bundleId: null }); });
    const duringFlap = bodies(calls, "email").length;
    expect(duringFlap).toBe(1);
    act(() => { setReady(true); });
    await waitForWaits();
    await act(async () => { releaseWaits(); });
    await waitFor(() => expect(bodies(calls, "email").length).toBeGreaterThan(duringFlap));
  });

  test("never writes the email to the console", async () => {
    const spies = [spyOn(console, "log"), spyOn(console, "info"), spyOn(console, "warn"), spyOn(console, "error"), spyOn(console, "debug")];
    const { hook, calls, releaseWaits, waitForWaits } = setup({ followUp: { status: "ignored" }, failSaves: 2 });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    act(() => hook.result.current.share());
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await waitForWaits();
      await act(async () => { releaseWaits(); });
    }
    await waitFor(() => expect(bodies(calls, "email")).toHaveLength(3));
    expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toContain(EMAIL);
    for (const spy of spies) spy.mockRestore();
  });
});

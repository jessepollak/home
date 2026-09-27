import "./dom-test-harness";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { AccountWalletClient, AccountWalletSdkBoundary } from "./cdp-client";
import type { VerifiedAccountSession } from "./session-client";
import type { HomeAuthRestoreReport } from "@/shared/observability/client-performance.contract";
import * as authPerformance from "@/client/observability/auth-performance";
import { AccountRestoreStageTimeoutError, runAccountRestoreStage } from "./restore-stage";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { useEffect } = await import("react");
const { useAccountWallet } = await import("./cdp-client");
const { AccountWalletSessionOwner } = await import("./cdp-session-lifecycle");

const TEST_TIMEOUT_MS = 123_456;
const verifiedSession: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

let client: AccountWalletClient | null = null;
function Probe() {
  const account = useAccountWallet();
  useEffect(() => { client = account; }, [account]);
  return <output>{account.status}</output>;
}

function account(): AccountWalletClient {
  if (!client) throw new Error("Account client was not rendered.");
  return client;
}

function sdk(overrides: Partial<AccountWalletSdkBoundary> = {}): AccountWalletSdkBoundary {
  return {
    isInitialized: true,
    isSignedIn: true,
    ownerKey: "owner-a",
    signInWithEmail: async () => ({ flowId: "email-flow" }),
    verifyEmailOTP: async () => {},
    requestBaseAccountChallenge: async () => { throw new Error("Unexpected challenge"); },
    verifyBaseAccountProof: async () => {},
    getAccessToken: async () => "fixture-token",
    signOut: async () => {},
    ...overrides,
  };
}

function manualStageTimeout() {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const pending = new Map<object, () => void>();
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === TEST_TIMEOUT_MS && typeof callback === "function") {
      const handle = {};
      pending.set(handle, () => callback(...args));
      return handle;
    }
    return originalSet(callback, delay, ...args);
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    if (pending.delete(handle as object)) return;
    originalClear(handle);
  }) as typeof clearTimeout;
  return {
    hasPending: () => pending.size > 0,
    fire: () => {
      const entry = pending.entries().next().value;
      if (!entry) throw new Error("No restore stage timeout is pending.");
      const [handle, callback] = entry;
      pending.delete(handle);
      callback();
    },
    restore: () => {
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
    },
  };
}

function renderOwner(overrides: Partial<AccountWalletSdkBoundary>, sessionFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return render(
    <AccountWalletSessionOwner sdk={sdk(overrides)} sessionFetch={sessionFetch} restoreStageTimeoutMs={TEST_TIMEOUT_MS}>
      <Probe />
    </AccountWalletSessionOwner>,
  );
}

afterEach(() => {
  cleanup();
  client = null;
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("bounded account restore stages", () => {
  test("settling reports the stage and cancels its timeout", async () => {
    const timeout = manualStageTimeout();
    const begin = spyOn(authPerformance, "beginHomeAuthRestoreStage").mockImplementation(() => {});
    const end = spyOn(authPerformance, "endHomeAuthRestoreStage").mockImplementation(() => {});
    try {
      const result = await runAccountRestoreStage("token", new AbortController().signal, async () => "token", TEST_TIMEOUT_MS);
      expect(result).toBe("token");
      expect(begin).toHaveBeenCalledWith("token");
      expect(end).toHaveBeenCalledWith("token", "settled");
      await expect(runAccountRestoreStage("validation", new AbortController().signal, () => {
        throw new Error("fixture failure");
      }, TEST_TIMEOUT_MS)).rejects.toThrow("fixture failure");
      expect(begin).toHaveBeenCalledWith("validation");
      expect(end).toHaveBeenCalledWith("validation", "settled");
      expect(timeout.hasPending()).toBe(false);
    } finally {
      begin.mockRestore();
      end.mockRestore();
      timeout.restore();
    }
  });

  test("caller abort cancels without reporting a timeout or late settlement", async () => {
    const timeout = manualStageTimeout();
    const end = spyOn(authPerformance, "endHomeAuthRestoreStage").mockImplementation(() => {});
    try {
      const caller = new AbortController();
      let inner: AbortSignal | undefined;
      let finish!: (value: string) => void;
      const pending = runAccountRestoreStage("validation", caller.signal, (signal) => {
        inner = signal;
        return new Promise<string>((resolve) => { finish = resolve; });
      }, TEST_TIMEOUT_MS);
      await Promise.resolve();
      caller.abort();
      await expect(pending).rejects.toHaveProperty("name", "AbortError");
      expect(inner?.aborted).toBe(true);
      finish("late");
      await Promise.resolve();
      expect(end).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledWith("validation", "cancelled");
      expect(timeout.hasPending()).toBe(false);
    } finally {
      end.mockRestore();
      timeout.restore();
    }
  });

  test("an already-aborted caller cancels before starting work", async () => {
    const timeout = manualStageTimeout();
    const end = spyOn(authPerformance, "endHomeAuthRestoreStage").mockImplementation(() => {});
    try {
      const caller = new AbortController();
      caller.abort();
      let started = false;
      await expect(runAccountRestoreStage("token", caller.signal, () => {
        started = true;
        return "token";
      }, TEST_TIMEOUT_MS)).rejects.toHaveProperty("name", "AbortError");
      expect(started).toBe(false);
      expect(end).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledWith("token", "cancelled");
      expect(timeout.hasPending()).toBe(false);
    } finally {
      end.mockRestore();
      timeout.restore();
    }
  });

  test("timeout aborts work, reports the stage once, and ignores late settlement", async () => {
    const timeout = manualStageTimeout();
    const end = spyOn(authPerformance, "endHomeAuthRestoreStage").mockImplementation(() => {});
    try {
      let finish!: (value: string) => void;
      let inner: AbortSignal | undefined;
      const pending = runAccountRestoreStage("validation", new AbortController().signal, (signal) => {
        inner = signal;
        return new Promise<string>((resolve) => { finish = resolve; });
      }, TEST_TIMEOUT_MS);
      await Promise.resolve();
      timeout.fire();
      await expect(pending).rejects.toBeInstanceOf(AccountRestoreStageTimeoutError);
      await expect(pending).rejects.toMatchObject({ stage: "validation" });
      expect(inner?.aborted).toBe(true);
      finish("late");
      await Promise.resolve();
      expect(end).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledWith("validation", "timeout");
    } finally {
      end.mockRestore();
      timeout.restore();
    }
  });

  test("never-settling token acquisition makes the session unavailable without fetching or signing out", async () => {
    const timeout = manualStageTimeout();
    try {
      let fetches = 0;
      let signOuts = 0;
      renderOwner({
        getAccessToken: () => new Promise<string>(() => {}),
        signOut: async () => { signOuts += 1; },
      }, async () => { fetches += 1; return Response.json(verifiedSession); });
      await waitFor(() => expect(timeout.hasPending()).toBe(true));
      await act(async () => { timeout.fire(); });
      expect(account().status).toBe("unavailable");
      expect(account().message).toBe("Checking your account took too long.");
      expect(account().session).toBeNull();
      expect(fetches).toBe(0);
      expect(signOuts).toBe(0);
    } finally {
      timeout.restore();
    }
  });

  test("stalled session validation aborts its fetch and becomes unavailable", async () => {
    const timeout = manualStageTimeout();
    try {
      let fetchSignal: AbortSignal | undefined;
      renderOwner({}, async (_input, init) => new Promise<Response>((resolve) => {
        fetchSignal = init?.signal ?? undefined;
        fetchSignal?.addEventListener("abort", () => resolve(Response.json(verifiedSession)), { once: true });
      }));
      await waitFor(() => expect(fetchSignal).toBeDefined());
      await act(async () => { timeout.fire(); });
      expect(fetchSignal?.aborted).toBe(true);
      expect(account().status).toBe("unavailable");
      expect(account().message).toBe("Checking your account took too long.");
    } finally {
      timeout.restore();
    }
  });

  test("superseding an attempt clears its timeout and ignores a late token", async () => {
    const timeout = manualStageTimeout();
    try {
      let finishOldToken!: (value: string) => void;
      let tokenCalls = 0;
      const fetchSession = async () => Response.json(verifiedSession);
      const oldSdk = sdk({ getAccessToken: () => {
        tokenCalls += 1;
        return new Promise<string>((resolve) => { finishOldToken = resolve; });
      } });
      const newSdk = sdk({ ownerKey: "owner-b", getAccessToken: async () => {
        tokenCalls += 1;
        return "new-token";
      } });
      const view = render(
        <AccountWalletSessionOwner sdk={oldSdk} sessionFetch={fetchSession} restoreStageTimeoutMs={TEST_TIMEOUT_MS}>
          <Probe />
        </AccountWalletSessionOwner>,
      );
      await waitFor(() => expect(tokenCalls).toBe(1));
      expect(timeout.hasPending()).toBe(true);
      await act(async () => {
        view.rerender(
          <AccountWalletSessionOwner sdk={newSdk} sessionFetch={fetchSession} restoreStageTimeoutMs={TEST_TIMEOUT_MS}>
            <Probe />
          </AccountWalletSessionOwner>,
        );
      });
      await waitFor(() => expect(account().status).toBe("verified"));
      expect(timeout.hasPending()).toBe(false);
      await act(async () => { finishOldToken("old-token"); });
      expect(account().status).toBe("verified");
      expect(account().message).toBeNull();
      expect(tokenCalls).toBe(2);
    } finally {
      timeout.restore();
    }
  });

  test("superseded token acquisition reports only the stalled replacement", async () => {
    const timeout = manualStageTimeout();
    let now = 0;
    const reports: HomeAuthRestoreReport[] = [];
    const recorder = authPerformance.createHomeAuthRestoreRecorder({
      now: () => now,
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
      send: (report) => { reports.push(report); },
    });
    recorder.start("/home", "cdp");
    const begin = spyOn(authPerformance, "beginHomeAuthRestoreStage").mockImplementation((stage) => recorder.beginStage(stage));
    const end = spyOn(authPerformance, "endHomeAuthRestoreStage").mockImplementation((stage, outcome) => recorder.endStage(stage, outcome));
    const finish = spyOn(authPerformance, "finishHomeAuthRestore").mockImplementation((outcome) => { recorder.terminate(outcome); });
    try {
      let finishOldToken!: (value: string) => void;
      let tokenCalls = 0;
      const oldSdk = sdk({ getAccessToken: () => {
        tokenCalls += 1;
        return new Promise<string>((resolve) => { finishOldToken = resolve; });
      } });
      const newSdk = sdk({ ownerKey: "owner-b", getAccessToken: () => {
        tokenCalls += 1;
        return new Promise<string>(() => {});
      } });
      now = 100;
      const view = render(
        <AccountWalletSessionOwner sdk={oldSdk} sessionFetch={async () => Response.json(verifiedSession)} restoreStageTimeoutMs={TEST_TIMEOUT_MS}>
          <Probe />
        </AccountWalletSessionOwner>,
      );
      await waitFor(() => expect(tokenCalls).toBe(1));
      now = 500;
      await act(async () => {
        view.rerender(
          <AccountWalletSessionOwner sdk={newSdk} sessionFetch={async () => Response.json(verifiedSession)} restoreStageTimeoutMs={TEST_TIMEOUT_MS}>
            <Probe />
          </AccountWalletSessionOwner>,
        );
      });
      await waitFor(() => expect(tokenCalls).toBe(2));
      expect(end).toHaveBeenCalledWith("token", "cancelled");
      await act(async () => { finishOldToken("old-token"); });
      expect(account().status).toBe("validating");
      now = 8_500;
      await act(async () => { timeout.fire(); });
      await waitFor(() => expect(account().status).toBe("unavailable"));
      expect(end).toHaveBeenCalledWith("token", "timeout");
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ tokenMs: 8_000, stalledStage: "token", outcome: "unavailable" });
    } finally {
      begin.mockRestore();
      end.mockRestore();
      finish.mockRestore();
      timeout.restore();
    }
  });

  test("normal restore verifies without a timeout message", async () => {
    const timeout = manualStageTimeout();
    try {
      renderOwner({}, async () => Response.json(verifiedSession));
      await waitFor(() => expect(account().status).toBe("verified"));
      expect(account().session).toEqual(verifiedSession);
      expect(account().message).toBeNull();
      expect(timeout.hasPending()).toBe(false);
    } finally {
      timeout.restore();
    }
  });

  test("retry after a stage timeout revalidates even when SDK initialization retry is a no-op", async () => {
    const timeout = manualStageTimeout();
    try {
      let working = false;
      let fetches = 0;
      let initializationRetries = 0;
      renderOwner({ retryInitialization: async () => { initializationRetries += 1; } }, async (_input, init) => {
        fetches += 1;
        if (working) return Response.json(verifiedSession);
        return new Promise<Response>((resolve) => {
          init?.signal?.addEventListener("abort", () => resolve(Response.json(verifiedSession)), { once: true });
        });
      });
      await waitFor(() => expect(fetches).toBe(1));
      await act(async () => { timeout.fire(); });
      expect(account().status).toBe("unavailable");
      working = true;
      await act(async () => { await account().retrySessionValidation(); });
      expect(initializationRetries).toBe(1);
      expect(fetches).toBe(2);
      expect(account().status).toBe("verified");
      expect(account().message).toBeNull();
    } finally {
      timeout.restore();
    }
  });
});

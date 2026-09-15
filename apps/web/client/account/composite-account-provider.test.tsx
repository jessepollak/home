import "./dom-test-harness";

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { AccountWalletClient } from "./cdp-client";
import {
  hasCdpRestoreHint,
  hasCdpRestoreMarker,
  writeAccountProviderHint,
  writeCdpRestoreMarker,
} from "./cdp-wallet-provider-capabilities";
import type { VerifiedAccountSession } from "./session-client";

const NATIVE_SESSION: VerifiedAccountSession = {
  user: { subject: "base-subject" },
  smartAccount: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
  },
  accountProvider: "base-account",
};
const CDP_SESSION: VerifiedAccountSession = {
  user: { subject: "cdp-subject" },
  smartAccount: {
    address: "0x2222222222222222222222222222222222222222",
    chainId: 8453,
  },
  accountProvider: "cdp-embedded",
};

type CdpState = {
  isInitialized: boolean;
  isSignedIn: boolean;
  userId: string | null;
};

let cdpState: CdpState = {
  isInitialized: true,
  isSignedIn: false,
  userId: null,
};
const cdpListeners = new Set<() => void>();
const events: string[] = [];
let cdpSignOuts = 0;
let cdpSignOutError: Error | null = null;
let cdpSignOutPending: Promise<void> | null = null;
let cdpProviderMounts = 0;
let cdpProviderShouldThrow = false;
const nativeListeners = new Set<() => void>();
let nativeIdentity: VerifiedAccountSession | null = null;
let nativeInitializationError: "provider-unavailable" | undefined;
let nativeRestores = 0;
let restoreNative: () => Promise<void> = async () => {
  nativeInitializationError = undefined;
  for (const listener of nativeListeners) listener();
};
let clearNative: () => Promise<void> = async () => {};

function setCdpState(next: Partial<CdpState>) {
  cdpState = { ...cdpState, ...next };
  for (const listener of cdpListeners) listener();
}

function useCdpState(): CdpState {
  return useSyncExternalStore(
    (listener) => {
      cdpListeners.add(listener);
      return () => cdpListeners.delete(listener);
    },
    () => cdpState,
    () => cdpState,
  );
}

function setNativeIdentity(identity: VerifiedAccountSession | null) {
  nativeIdentity = identity;
  for (const listener of nativeListeners) listener();
}

function useNativeIdentity(): VerifiedAccountSession | null {
  return useSyncExternalStore(
    (listener) => {
      nativeListeners.add(listener);
      return () => nativeListeners.delete(listener);
    },
    () => nativeIdentity,
    () => nativeIdentity,
  );
}

function MockCdpHooksProvider({ children }: { children: ReactNode }) {
  if (cdpProviderShouldThrow) throw new Error("CDP provider failed.");
  useEffect(() => {
    cdpProviderMounts += 1;
    return () => { cdpProviderMounts -= 1; };
  }, []);
  return children;
}

mock.module("@coinbase/cdp-hooks", () => ({
  CDPHooksProvider: MockCdpHooksProvider,
  useIsInitialized: () => ({ isInitialized: useCdpState().isInitialized }),
  useIsSignedIn: () => ({ isSignedIn: useCdpState().isSignedIn }),
  useCurrentUser: () => {
    const state = useCdpState();
    return {
      currentUser: state.userId
        ? {
            userId: state.userId,
            evmSmartAccountObjects: [{ address: CDP_SESSION.smartAccount!.address }],
          }
        : null,
    };
  },
  useSignInWithEmail: () => ({
    signInWithEmail: async () => {
      events.push("cdp-email");
      return { flowId: "email-flow" };
    },
  }),
  useVerifyEmailOTP: () => ({
    verifyEmailOTP: async () => {
      events.push("cdp-verify");
      setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    },
  }),
  useGetAccessToken: () => ({ getAccessToken: async () => "token.value" }),
  useSignOut: () => ({
    signOut: async () => {
      if (!cdpState.isSignedIn) throw new Error("User is not authenticated.");
      cdpSignOuts += 1;
      events.push("cdp-signout");
      if (cdpSignOutPending) await cdpSignOutPending;
      if (cdpSignOutError) throw cdpSignOutError;
      setCdpState({ isSignedIn: false, userId: null });
    },
  }),
}));

mock.module("./native-base-bridge", () => ({
  default: ({ children }: { children: ReactNode }) => children,
  useNativeBaseIdentity: (enabled = true) => {
    const identity = useNativeIdentity();
    const availableIdentity = enabled ? identity : null;
    const boundary = {
      authentication: "native-base" as const,
      isInitialized: true,
      isSignedIn: availableIdentity !== null,
      ownerKey: availableIdentity
        ? `${availableIdentity.user.subject}\u0000${availableIdentity.smartAccount!.address}\u00008453`
        : null,
      provisionalSession: availableIdentity,
      signInWithEmail: async () => { throw new Error("Email uses CDP."); },
      verifyEmailOTP: async () => { throw new Error("Email uses CDP."); },
      requestBaseAccountChallenge: async () => {
        events.push("native-challenge");
        return {
          nonce: "a".repeat(48), chainId: 8453, domain: "localhost", uri: "http://localhost",
          version: "1" as const, statement: "Sign in to Home." as const,
          issuedAt: "2026-09-13T12:00:00.000Z", expirationTime: "2026-09-13T12:05:00.000Z",
        };
      },
      verifyBaseAccountProof: async () => {
        events.push("native-verify");
        setNativeIdentity(NATIVE_SESSION);
      },
      getAccessToken: async () => null,
      signOut: async () => {
        await clearNative();
        setNativeIdentity(null);
      },
    };
    return {
      identity: availableIdentity,
      isSettled: true,
      hasSettled: true,
      initializationError: enabled ? nativeInitializationError : undefined,
      restore: async () => {
        if (!enabled) return;
        nativeRestores += 1;
        await restoreNative();
      },
      boundary,
    };
  },
}));

mock.module("@base-org/account", () => ({
  createBaseAccountSDK: () => ({
    getProvider: () => ({
      on: () => {},
      removeListener: () => {},
      disconnect: async () => {},
      request: async ({ method }: { method: string }) => {
        events.push(`base-${method}`);
        switch (method) {
          case "wallet_switchEthereumChain": return null;
          case "wallet_connect": return {
            accounts: [{
              address: NATIVE_SESSION.smartAccount!.address,
              capabilities: { signInWithEthereum: { message: "signed SIWE", signature: "0x1234" } },
            }],
          };
          case "eth_requestAccounts":
          case "eth_accounts": return [NATIVE_SESSION.smartAccount!.address];
          case "eth_chainId": return "0x2105";
          case "personal_sign": return "0x1234";
          default: throw new Error(`Unexpected Base provider method: ${method}`);
        }
      },
    }),
  }),
}));

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { getHomeQueryClient } = await import("@/client/query/query-client");
const { useAccountWallet } = await import("./cdp-client");
const CompositeAccountProvider = (await import("./composite-account-provider")).default;
const { AccountSignInSheet } = await import("./account-screen");

let observedClient: AccountWalletClient | null = null;
let observedStatuses: AccountWalletClient["status"][] = [];

function ClientProbe() {
  const client = useAccountWallet();
  useEffect(() => {
    observedClient = client;
    observedStatuses.push(client.status);
  }, [client]);
  return null;
}

function currentClient(): AccountWalletClient {
  if (!observedClient) throw new Error("Account client was not rendered.");
  return observedClient;
}

function renderProvider(showSignIn = false, waitForCdpRestore = false, baseAccountEnabled = true) {
  if (waitForCdpRestore) writeCdpRestoreMarker();
  return render(
    <CompositeAccountProvider projectId="project-id" baseAccountEnabled={baseAccountEnabled}>
      <ClientProbe />
      {showSignIn ? <AccountSignInSheet open onClose={() => {}} /> : null}
    </CompositeAccountProvider>,
  );
}

function installSessionFetch() {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get(
      ["Author", "ization"].join(""),
    );
    return Response.json(authorization ? CDP_SESSION : NATIVE_SESSION);
  }) as typeof fetch;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  observedClient = null;
  observedStatuses = [];
  cdpListeners.clear();
  nativeListeners.clear();
  cdpState = { isInitialized: true, isSignedIn: false, userId: null };
  events.length = 0;
  cdpSignOuts = 0;
  cdpSignOutError = null;
  cdpSignOutPending = null;
  cdpProviderMounts = 0;
  cdpProviderShouldThrow = false;
  nativeIdentity = null;
  nativeInitializationError = undefined;
  nativeRestores = 0;
  restoreNative = async () => {
    nativeInitializationError = undefined;
    for (const listener of nativeListeners) listener();
  };
  clearNative = async () => {};
  getHomeQueryClient().clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("composite account provider switches", () => {
  test("keeps the server and first client render storage-independent", () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const withoutHint = renderToString(
      <CompositeAccountProvider projectId="project-id" baseAccountEnabled={false}>
        <div>child</div>
      </CompositeAccountProvider>,
    );
    writeCdpRestoreMarker();
    window.sessionStorage.setItem("home:account-provider", "cdp-embedded");
    const withHint = renderToString(
      <CompositeAccountProvider projectId="project-id" baseAccountEnabled={false}>
        <div>child</div>
      </CompositeAccountProvider>,
    );

    expect(withHint).toBe(withoutHint);
    expect(withHint).toContain("child");
    expect(cdpProviderMounts).toBe(0);
  });

  test("settles natively with no hint and deduplicates on-demand CDP activation", async () => {
    installSessionFetch();
    renderProvider();
    await waitFor(() => expect(currentClient().status).toBe("signed-out"));
    expect(cdpProviderMounts).toBe(0);
    expect(events).toEqual([]);

    let settled!: Promise<PromiseSettledResult<{ flowId: string }>[]>;
    act(() => {
      const first = currentClient().requestEmailCode("first@example.com");
      const second = currentClient().requestEmailCode("second@example.com");
      settled = Promise.allSettled([first, second]);
    });
    await waitFor(() => expect(cdpProviderMounts).toBe(1));
    const results = await act(async () => settled);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(events).toEqual(["cdp-email", "cdp-email"]);
  });

  test("keeps canceled and reissued email actions gated through an uninitialized publication", async () => {
    cdpState = { isInitialized: false, isSignedIn: false, userId: null };
    installSessionFetch();
    renderProvider();
    await waitFor(() => expect(currentClient().status).toBe("signed-out"));

    let results!: Promise<PromiseSettledResult<{ flowId: string }>[]>;
    let settled = false;
    act(() => {
      const canceled = currentClient().requestEmailCode("first@example.com");
      currentClient().cancelSignInAttempt();
      const reissued = currentClient().requestEmailCode("second@example.com");
      results = Promise.allSettled([canceled, reissued]);
      void results.then(() => { settled = true; });
    });

    await waitFor(() => expect(cdpProviderMounts).toBe(1));
    await act(async () => { await Promise.resolve(); });
    expect(events).toEqual([]);
    expect(settled).toBe(false);

    act(() => setCdpState({ isInitialized: true }));
    const outcomes = await act(async () => results);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "fulfilled"]);
    expect(events).toEqual(["cdp-email", "cdp-email"]);
  });

  test("keeps a captured Base restore failure unavailable until retry recovers", async () => {
    nativeInitializationError = "provider-unavailable";
    writeAccountProviderHint("base-account");
    installSessionFetch();
    renderProvider();

    await waitFor(() => expect(currentClient().status).toBe("unavailable"));
    expect(currentClient().isSignedIn).toBe(false);
    expect(currentClient().message).toBe("Account verification is unavailable.");

    restoreNative = async () => {
      nativeInitializationError = undefined;
      setNativeIdentity(NATIVE_SESSION);
    };
    await act(async () => { await currentClient().retrySessionValidation(); });
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    expect(currentClient().session?.accountProvider).toBe("base-account");
    expect(nativeRestores).toBe(1);
  });

  test("fails open after an anonymous native restore error without a hint", async () => {
    nativeInitializationError = "provider-unavailable";
    installSessionFetch();
    renderProvider();

    await waitFor(() => expect(currentClient().status).toBe("signed-out"));
    expect(currentClient().message).toBeNull();
    expect(currentClient().signInAvailability).toBe("ready");
  });

  test("skips unavailable native restoration in a CDP-only deployment", async () => {
    nativeInitializationError = "provider-unavailable";
    installSessionFetch();
    renderProvider(false, false, false);

    await waitFor(() => expect(currentClient().status).toBe("signed-out"));
    expect(currentClient().message).toBeNull();
    expect(nativeRestores).toBe(0);
    let request!: Promise<{ flowId: string }>;
    act(() => { request = currentClient().requestEmailCode("person@example.com"); });
    await waitFor(() => expect(cdpProviderMounts).toBe(1));
    let result!: { flowId: string };
    await act(async () => { result = await request; });
    expect(result).toEqual({ flowId: "email-flow" });
    expect(events).toEqual(["cdp-email"]);
  });

  test("does not mount or sign out CDP for a Base-only logout", async () => {
    nativeIdentity = NATIVE_SESSION;
    installSessionFetch();
    renderProvider();
    await waitFor(() => expect(currentClient().status).toBe("verified"));

    await act(async () => { await currentClient().signOut(); });
    expect(cdpProviderMounts).toBe(0);
    expect(cdpSignOuts).toBe(0);
  });

  test("skips real CDP sign-out after known cleanup initializes signed out", async () => {
    installSessionFetch();
    renderProvider(false, true);
    await waitFor(() => expect(currentClient().status).toBe("signed-out"));

    await act(async () => { await currentClient().signOut(); });
    expect(cdpProviderMounts).toBe(1);
    expect(cdpSignOuts).toBe(0);
  });

  test("re-arms cleanup from each live signed-in SDK boundary", async () => {
    installSessionFetch();
    renderProvider();
    await waitFor(() => expect(currentClient().status).toBe("signed-out"));

    for (const email of ["first@example.com", "second@example.com"]) {
      let request!: Promise<{ flowId: string }>;
      act(() => { request = currentClient().requestEmailCode(email); });
      await waitFor(() => expect(cdpProviderMounts).toBe(1));
      const { flowId } = await act(async () => request);
      await act(async () => { await currentClient().verifyEmailCode(flowId, "123456"); });
      await waitFor(() => expect(currentClient().status).toBe("verified"));

      await act(async () => { await currentClient().signOut(); });
      expect(currentClient().status).toBe("signed-out");
      expect(currentClient().isSignedIn).toBe(false);
      expect(currentClient().ownerKey).toBeNull();
      expect(currentClient().session).toBeNull();
    }

    expect(cdpSignOuts).toBe(2);
  });

  test("restores durable cleanup evidence when CDP sign-out fails", async () => {
    setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    cdpSignOutError = new Error("CDP cleanup failed.");
    installSessionFetch();
    renderProvider(false, true);
    await waitFor(() => expect(currentClient().status).toBe("verified"));

    let cleanup!: Promise<void>;
    act(() => { cleanup = currentClient().signOut(); });
    expect(hasCdpRestoreMarker()).toBe(false);
    await act(async () => { await cleanup.catch(() => {}); });

    expect(currentClient().status).toBe("signout-error");
    expect(hasCdpRestoreMarker()).toBe(true);
    expect(cdpSignOuts).toBe(1);
  });

  test("keeps a timeout marker until the late CDP sign-out succeeds", async () => {
    const lateCleanup = deferred();
    setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    cdpSignOutPending = lateCleanup.promise;
    installSessionFetch();
    renderProvider(false, true);
    await waitFor(() => expect(currentClient().status).toBe("verified"));

    let cleanup!: Promise<void>;
    act(() => { cleanup = currentClient().signOut(); });
    expect(hasCdpRestoreMarker()).toBe(false);
    await act(async () => { await cleanup.catch(() => {}); });

    expect(currentClient().status).toBe("signout-error");
    expect(hasCdpRestoreMarker()).toBe(true);
    lateCleanup.resolve();
    await waitFor(() => expect(hasCdpRestoreMarker()).toBe(false));
    expect(cdpSignOuts).toBe(1);
  }, 6_000);

  test("does not repeat successful CDP cleanup when native cleanup is retried", async () => {
    setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    let nativeAttempts = 0;
    clearNative = async () => {
      nativeAttempts += 1;
      if (nativeAttempts === 1) throw new Error("Native cleanup failed.");
    };
    installSessionFetch();
    renderProvider(false, true);
    await waitFor(() => expect(currentClient().status).toBe("verified"));

    let signOutError: unknown;
    await act(async () => {
      try {
        await currentClient().signOut();
      } catch (error) {
        signOutError = error;
      }
    });
    expect(signOutError).toBeInstanceOf(Error);
    expect((signOutError as Error).message).toContain("did not finish");
    expect(cdpSignOuts).toBe(1);
    expect(nativeAttempts).toBe(1);
    await waitFor(() => expect(currentClient().status).toBe("signout-error"));

    await act(async () => { await currentClient().signOut(); });
    expect(cdpSignOuts).toBe(1);
    expect(nativeAttempts).toBe(2);
    expect(currentClient().status).toBe("signed-out");
  });

  test("retries native restoration and a failed CDP island through initialized recovery", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    cdpState = { isInitialized: false, isSignedIn: false, userId: null };
    cdpProviderShouldThrow = true;
    nativeInitializationError = "provider-unavailable";
    installSessionFetch();
    renderProvider(false, true);
    await waitFor(() => expect(currentClient().status).toBe("unavailable"));

    cdpProviderShouldThrow = false;
    let retry!: Promise<void>;
    act(() => { retry = currentClient().retrySessionValidation(); });
    await waitFor(() => expect(cdpProviderMounts).toBe(1));
    expect(nativeRestores).toBe(1);

    act(() => setCdpState({ isInitialized: true }));
    await act(async () => { await retry; });
    await waitFor(() => expect(currentClient().status).toBe("signed-out"));
    expect(nativeInitializationError).toBeUndefined();
    consoleError.mockRestore();
  });

  test("shows both sign-in choices while CDP is pending and keeps email server-verified", async () => {
    cdpState = { isInitialized: false, isSignedIn: false, userId: null };
    installSessionFetch();
    const view = renderProvider(true);

    await waitFor(() => expect(currentClient().status).toBe("signed-out"));
    expect(await view.findByRole("textbox", { name: "Email address" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Sign in with Base Account" })).toBeTruthy();

    fireEvent.input(view.getByRole("textbox", { name: "Email address" }), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(view.getByRole("button", { name: "Continue with email" }));
    await waitFor(() => expect(cdpProviderMounts).toBe(1));
    expect(events).toEqual([]);
    expect(view.queryByRole("textbox", { name: "Verification code" })).toBeNull();
    expect(currentClient().verification).toBeNull();
    expect(currentClient().session).toBeNull();
    expect(hasCdpRestoreMarker()).toBe(false);

    act(() => setCdpState({ isInitialized: true }));
    await view.findByRole("textbox", { name: "Verification code" });
    fireEvent.input(view.getByRole("textbox", { name: "Verification code" }), {
      target: { value: "123456" },
    });
    fireEvent.click(view.getByRole("button", { name: "Verify and continue" }));

    await waitFor(() => expect(events).toEqual(["cdp-email", "cdp-verify"]));
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    expect(currentClient().verification).toBe("server");
    expect(currentClient().session?.accountProvider).toBe("cdp-embedded");
    expect(hasCdpRestoreMarker()).toBe(true);
  });

  test("activates a hinted CDP restore immediately after mount", async () => {
    cdpState = { isInitialized: false, isSignedIn: false, userId: null };
    installSessionFetch();
    const view = renderProvider(true, true);

    await waitFor(() => expect(cdpProviderMounts).toBe(1));
    expect(currentClient().status).toBe("restoring");
    expect(observedStatuses).not.toContain("signed-out");
    // The restoring status keeps the sign-in form hidden while the lazy CDP
    // island is suspended, so a fallback cannot expose a misleading first click.
    expect(view.queryByRole("textbox", { name: "Email address" })).toBeNull();
  });

  test("a returning CDP marker waits through initialization without settling signed out", async () => {
    cdpState = { isInitialized: false, isSignedIn: false, userId: null };
    writeCdpRestoreMarker();
    window.sessionStorage.clear();
    installSessionFetch();
    renderProvider(false, hasCdpRestoreHint());

    await waitFor(() => expect(currentClient().status).toBe("restoring"));
    expect(observedStatuses).not.toContain("signed-out");
    await waitFor(() => expect(cdpProviderMounts).toBe(1));

    await act(async () => setCdpState({
      isInitialized: true,
      isSignedIn: true,
      userId: CDP_SESSION.user.subject,
    }));
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    expect(currentClient().session?.accountProvider).toBe("cdp-embedded");
    expect(observedStatuses).not.toContain("signed-out");
  });

  test("fails a timed-out hinted CDP restore closed and retries without dropping its marker", async () => {
    cdpState = { isInitialized: false, isSignedIn: false, userId: null };
    installSessionFetch();
    renderProvider(false, true);

    await waitFor(() => expect(currentClient().status).toBe("unavailable"), { timeout: 12_000 });
    expect(hasCdpRestoreMarker()).toBe(true);
    expect(hasCdpRestoreHint()).toBe(true);
    expect(nativeRestores).toBe(0);

    let retry!: Promise<void>;
    act(() => { retry = currentClient().retrySessionValidation(); });
    await waitFor(() => expect(cdpProviderMounts).toBe(1));
    expect(hasCdpRestoreMarker()).toBe(true);

    act(() => setCdpState({ isInitialized: true }));
    await act(async () => { await retry; });
    await waitFor(() => expect(currentClient().status).toBe("signed-out"));
    expect(hasCdpRestoreMarker()).toBe(false);
  }, 15_000);

  test("native to email preserves the newly verified CDP identity", async () => {
    const nativeClear = deferred();
    nativeIdentity = NATIVE_SESSION;
    clearNative = async () => {
      events.push("clear-native-start");
      await nativeClear.promise;
      events.push("clear-native-done");
    };
    installSessionFetch();
    renderProvider();

    await waitFor(() => expect(currentClient().status).toBe("verified"));
    expect(currentClient().session?.accountProvider).toBe("base-account");
    events.length = 0;

    let emailRequest!: Promise<{ flowId: string }>;
    act(() => { emailRequest = currentClient().requestEmailCode("person@example.com"); });
    await waitFor(() => expect(cdpProviderMounts).toBe(1));
    const { flowId } = await act(async () => emailRequest);
    let verification!: Promise<void>;
    act(() => { verification = currentClient().verifyEmailCode(flowId, "123456"); });

    await waitFor(() => expect(events).toEqual(["cdp-email", "cdp-verify", "clear-native-start"]));
    expect(cdpSignOuts).toBe(0);

    nativeClear.resolve();
    await act(async () => { await verification; });
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    expect(currentClient().session?.accountProvider).toBe("cdp-embedded");
    expect(events).toEqual(["cdp-email", "cdp-verify", "clear-native-start", "clear-native-done"]);
    expect(cdpSignOuts).toBe(0);
  });

  test("retains automatic CDP cleanup failures for a later retry", async () => {
    setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    cdpSignOutError = new Error("CDP cleanup failed.");
    installSessionFetch();
    renderProvider(false, true);

    await waitFor(() => expect(currentClient().status).toBe("verified"));
    await act(async () => { await currentClient().signInWithBaseAccount(() => {}); });
    await waitFor(() => expect(currentClient().session?.accountProvider).toBe("base-account"));
    await waitFor(() => expect(hasCdpRestoreMarker()).toBe(true));
    expect(cdpSignOuts).toBe(1);

    cdpSignOutError = null;
    await act(async () => { await currentClient().signOut(); });
    expect(cdpSignOuts).toBe(2);
    expect(hasCdpRestoreMarker()).toBe(false);
  });

  test("bounds hanging automatic CDP cleanup and permits retry before late success", async () => {
    const lateCleanup = deferred();
    setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    cdpSignOutPending = lateCleanup.promise;
    installSessionFetch();
    renderProvider(false, true);

    await waitFor(() => expect(currentClient().status).toBe("verified"));
    await act(async () => { await currentClient().signInWithBaseAccount(() => {}); });
    await waitFor(() => expect(currentClient().session?.accountProvider).toBe("base-account"));
    await waitFor(() => expect(cdpSignOuts).toBe(1));
    await waitFor(() => expect(hasCdpRestoreMarker()).toBe(true), { timeout: 4_000 });

    await act(async () => {
      setCdpState({ isSignedIn: false, userId: null });
    });
    await act(async () => {
      setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    });
    await waitFor(() => expect(cdpSignOuts).toBe(2));

    lateCleanup.resolve();
    await waitFor(() => expect(hasCdpRestoreMarker()).toBe(false));
    expect(currentClient().session?.accountProvider).toBe("base-account");
  }, 6_000);

  test("email to Base signs CDP out once without a stale session", async () => {
    setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    installSessionFetch();
    renderProvider(false, true);

    await waitFor(() => expect(currentClient().status).toBe("verified"));
    expect(currentClient().session?.accountProvider).toBe("cdp-embedded");

    await act(async () => { await currentClient().signInWithBaseAccount(() => {}); });
    await waitFor(() => expect(currentClient().session?.accountProvider).toBe("base-account"));
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    await waitFor(() => expect(cdpSignOuts).toBe(1));

    expect(events).toEqual([
      "native-challenge",
      "base-wallet_switchEthereumChain",
      "base-wallet_connect",
      "base-eth_chainId",
      "native-verify",
      "cdp-signout",
    ]);
    expect(events).not.toContain("base-personal_sign");
    expect(currentClient().status).toBe("verified");
  });
});

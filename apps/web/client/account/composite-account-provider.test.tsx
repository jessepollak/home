import "./dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { AccountWalletClient } from "./cdp-client";
import {
  hasCdpRestoreHint,
  hasCdpRestoreMarker,
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
let nativeIdentity: VerifiedAccountSession | null = null;
let clearNative: () => Promise<void> = async () => {};
const nativeListeners = new Set<() => void>();

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
  );
}

mock.module("@coinbase/cdp-hooks", () => ({
  CDPHooksProvider: ({ children }: { children: ReactNode }) => children,
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
      cdpSignOuts += 1;
      events.push("cdp-signout");
      setCdpState({ isSignedIn: false, userId: null });
    },
  }),
}));

mock.module("./native-base-bridge", () => ({
  default: ({ children }: { children: ReactNode }) => children,
  useNativeBaseIdentity: () => {
    const identity = useNativeIdentity();
    const boundary = {
      authentication: "native-base" as const,
      isInitialized: true,
      isSignedIn: identity !== null,
      ownerKey: identity
        ? `${identity.user.subject}\u0000${identity.smartAccount!.address}\u00008453`
        : null,
      provisionalSession: identity,
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
      identity,
      isSettled: true,
      hasSettled: true,
      restore: async () => {},
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

function renderProvider(showSignIn = false, waitForCdpRestore = false) {
  return render(
    <CompositeAccountProvider projectId="project-id" waitForCdpRestore={waitForCdpRestore}>
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
  nativeIdentity = null;
  clearNative = async () => {};
  getHomeQueryClient().clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("composite account provider switches", () => {
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
    await view.findByRole("textbox", { name: "Verification code" });
    fireEvent.input(view.getByRole("textbox", { name: "Verification code" }), {
      target: { value: "123456" },
    });
    fireEvent.click(view.getByRole("button", { name: "Verify and continue" }));

    await waitFor(() => expect(events).toEqual(["cdp-email", "cdp-verify"]));
    expect(currentClient().verification).toBeNull();
    expect(currentClient().session).toBeNull();
    expect(hasCdpRestoreMarker()).toBe(false);

    act(() => setCdpState({ isInitialized: true }));
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    expect(currentClient().verification).toBe("server");
    expect(currentClient().session?.accountProvider).toBe("cdp-embedded");
    expect(hasCdpRestoreMarker()).toBe(true);
  });

  test("a returning CDP marker waits through initialization without settling signed out", async () => {
    cdpState = { isInitialized: false, isSignedIn: false, userId: null };
    writeCdpRestoreMarker();
    window.sessionStorage.clear();
    installSessionFetch();
    renderProvider(false, hasCdpRestoreHint());

    await act(async () => { await Promise.resolve(); });
    expect(currentClient().status).toBe("restoring");
    expect(observedStatuses).not.toContain("signed-out");

    act(() => setCdpState({
      isInitialized: true,
      isSignedIn: true,
      userId: CDP_SESSION.user.subject,
    }));
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    expect(currentClient().session?.accountProvider).toBe("cdp-embedded");
    expect(observedStatuses).not.toContain("signed-out");
  });

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

    const { flowId } = await act(async () => currentClient().requestEmailCode("person@example.com"));
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

  test("email to Base signs CDP out once without a stale session", async () => {
    setCdpState({ isSignedIn: true, userId: CDP_SESSION.user.subject });
    installSessionFetch();
    renderProvider();

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

import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { createSiweMessage } from "viem/siwe";
import type { AccountWalletClient, AccountWalletSdkBoundary } from "./cdp-client";
import type { VerifiedAccountSession } from "./session-client";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { useEffect } = await import("react");
const { useAccountWallet } = await import("./cdp-client");
const { AccountWalletSessionOwner } = await import("./cdp-session-lifecycle");
const { connectWithBaseProvider, restoreWithBaseProvider } = await import("./base-account-connector");

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";
const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";

type ProviderEvent = "accountsChanged" | "chainChanged" | "disconnect";

class ProviderFixture {
  readonly listeners = new Map<ProviderEvent, Set<(value: never) => void>>();
  walletDispatches = 0;

  on(event: ProviderEvent, listener: (value: never) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event: ProviderEvent, listener: (value: never) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: ProviderEvent, value?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }

  async request({ method }: { method: string }): Promise<unknown> {
    switch (method) {
      case "wallet_switchEthereumChain": return null;
      case "wallet_connect": return {
        accounts: [{
          address: ADDRESS_A,
          capabilities: { signInWithEthereum: { message: "signed SIWE", signature: "0x1234" } },
        }],
      };
      case "eth_requestAccounts":
      case "eth_accounts": return [ADDRESS_A];
      case "eth_chainId": return "0x2105";
      case "personal_sign": return "0x1234";
      case "wallet_sendCalls":
        this.walletDispatches += 1;
        return { id: ACTION_ID };
      default: throw new Error(`Unexpected provider request: ${method}`);
    }
  }

  async disconnect() {}
}

function session(
  accountProvider: VerifiedAccountSession["accountProvider"],
  subject = "subject-a",
  address: typeof ADDRESS_A | typeof ADDRESS_B = ADDRESS_A,
): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount: { address, chainId: 8453 },
    accountProvider,
  };
}

function prepared(active: VerifiedAccountSession): PreparedMoneyAction {
  if (!active.smartAccount) throw new Error("Fixture session requires an account.");
  return {
    id: ACTION_ID,
    owner: {
      subject: active.user.subject,
      address: active.smartAccount.address,
      chainId: 8453,
      accountProvider: active.accountProvider,
    },
    kind: "send",
    title: "Send USDC",
    calls: [{ to: ADDRESS_B, data: "0x1234", value: "0" }],
    amounts: [{
      assetId: "usdc",
      symbol: "USDC",
      decimals: 6,
      amountBaseUnits: "1000000",
      direction: "spend",
    }],
    warnings: [],
    createdAt: "2026-09-12T00:00:00.000Z",
    expiresAt: "2026-09-12T00:30:00.000Z",
  };
}

function sdk(overrides: Partial<AccountWalletSdkBoundary> = {}): AccountWalletSdkBoundary {
  return {
    isInitialized: true,
    isSignedIn: true,
    ownerKey: OWNER_A,
    signInWithEmail: async () => ({ flowId: "email-flow" }),
    verifyEmailOTP: async () => {},
    requestBaseAccountChallenge: async () => ({
      nonce: "a".repeat(48), chainId: 8453, domain: "home.example", uri: "https://home.example",
      version: "1", statement: "Sign in to Home.", issuedAt: "2026-09-13T12:00:00.000Z",
      expirationTime: "2026-09-13T12:05:00.000Z",
    }),
    verifyBaseAccountProof: async () => {},
    getAccessToken: async () => "fixture-token",
    signOut: async () => {},
    ...overrides,
  };
}

let observedClient: AccountWalletClient | null = null;
function ClientProbe() {
  const client = useAccountWallet();
  useEffect(() => { observedClient = client; }, [client]);
  return <output data-testid="status">{client.status}</output>;
}

function currentClient(): AccountWalletClient {
  if (!observedClient) throw new Error("Account client was not rendered.");
  return observedClient;
}

type TriggerContext = {
  provider: ProviderFixture;
  rerender: (nextSdk: AccountWalletSdkBoundary) => void;
  setServerSession: (next: VerifiedAccountSession) => void;
  loseServerVerification: () => void;
};

const triggerRows: Array<{
  name: string;
  initialProvider: VerifiedAccountSession["accountProvider"];
  trigger: (context: TriggerContext) => Promise<void> | void;
}> = [
  {
    name: "sign-out",
    initialProvider: "cdp-embedded",
    trigger: async () => { await currentClient().signOut(); },
  },
  {
    name: "sign-in as a different owner",
    initialProvider: "cdp-embedded",
    trigger: ({ rerender, setServerSession }) => {
      setServerSession(session("cdp-embedded", "subject-b", ADDRESS_B));
      rerender(sdk({ ownerKey: OWNER_B }));
    },
  },
  {
    name: "provider switch",
    initialProvider: "cdp-embedded",
    trigger: async () => { await currentClient().signInWithBaseAccount(() => {}); },
  },
  {
    name: "Base accountsChanged",
    initialProvider: "base-account",
    trigger: ({ provider }) => { provider.emit("accountsChanged", [ADDRESS_B]); },
  },
  {
    name: "Base chainChanged",
    initialProvider: "base-account",
    trigger: ({ provider }) => { provider.emit("chainChanged", "0x1"); },
  },
  {
    name: "Base disconnect",
    initialProvider: "base-account",
    trigger: ({ provider }) => { provider.emit("disconnect"); },
  },
  {
    name: "restored Base address mismatch",
    initialProvider: "base-account",
    trigger: async ({ setServerSession }) => {
      setServerSession(session("base-account", "subject-a", ADDRESS_B));
      await currentClient().retrySessionValidation();
    },
  },
  {
    name: "server verification loss (401)",
    initialProvider: "cdp-embedded",
    trigger: async ({ loseServerVerification }) => {
      loseServerVerification();
      await currentClient().retrySessionValidation();
    },
  },
];

afterEach(() => {
  cleanup();
  observedClient = null;
  getHomeQueryClient().clear();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("owner generation fence", () => {
  test("signs and submits the canonical SIWE message only for an unsupported connection", async () => {
    const loginChallenge = {
      nonce: "a".repeat(48),
      chainId: 8453 as const,
      domain: "home.example",
      uri: "https://home.example",
      version: "1" as const,
      statement: "Sign in to Home." as const,
      issuedAt: "2026-09-13T12:00:00.000Z",
      expirationTime: "2026-09-13T12:05:00.000Z",
    };
    const signedMessages: string[] = [];
    const submittedProofs: Array<{
      address: `0x${string}`;
      message: string;
      signature: `0x${string}`;
    }> = [];
    const phases: string[] = [];

    render(
      <AccountWalletSessionOwner
        sdk={sdk({
          isSignedIn: false,
          ownerKey: null,
          requestBaseAccountChallenge: async () => loginChallenge,
          verifyBaseAccountProof: async (proof) => { submittedProofs.push(proof); },
        })}
        baseAccountEnabled
        baseAccountConnector={async () => ({
          kind: "unsupported",
          address: ADDRESS_A,
          assertUnchanged: async () => {},
          signMessage: async (message) => {
            signedMessages.push(message);
            return "0x1234";
          },
          signTypedData: async () => "0x1234",
          disconnect: async () => {},
        })}
      >
        <ClientProbe />
      </AccountWalletSessionOwner>,
    );
    await waitFor(() => expect(currentClient().status).toBe("signed-out"));

    await act(async () => {
      await currentClient().signInWithBaseAccount((phase) => phases.push(phase));
    });

    const message = createSiweMessage({
      ...loginChallenge,
      address: ADDRESS_A,
      issuedAt: new Date(loginChallenge.issuedAt),
      expirationTime: new Date(loginChallenge.expirationTime),
    });
    expect(signedMessages).toEqual([message]);
    expect(submittedProofs).toEqual([{
      address: ADDRESS_A,
      message,
      signature: "0x1234",
    }]);
    expect(phases).toEqual(["connecting", "signing", "verifying"]);
  });

  test("blocks prepared actions after every owner-generation trigger", async () => {
    for (const { initialProvider, trigger } of triggerRows) {
      const provider = new ProviderFixture();
    let activeSession = session(initialProvider);
    let verificationLost = false;
    let serverPostsAfterPrepare = 0;
    let cdpDispatches = 0;
    const activeSdk = sdk({
      sendUserOperation: async () => {
        cdpDispatches += 1;
        return { userOperationHash: `0x${"ab".repeat(32)}` };
      },
    });
    const sessionFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/session") {
        return verificationLost ? new Response(null, { status: 401 }) : Response.json(activeSession);
      }
      if (path === "/api/actions/prepare") return Response.json(prepared(activeSession));
      if (init?.method === "POST") serverPostsAfterPrepare += 1;
      if (path.endsWith("/confirm")) return Response.json({ calls: prepared(activeSession).calls });
      return Response.json({});
    };
    const asProvider = provider as unknown as Parameters<typeof connectWithBaseProvider>[0];
    const owner = (ownerSdk: AccountWalletSdkBoundary) => (
      <AccountWalletSessionOwner
        sdk={ownerSdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={(challenge, onInvalidated) => connectWithBaseProvider(asProvider, challenge, onInvalidated)}
        baseAccountRestorer={(onInvalidated) => restoreWithBaseProvider(asProvider, onInvalidated)}
      >
        <ClientProbe />
      </AccountWalletSessionOwner>
    );
    const view = render(owner(activeSdk));

    await waitFor(() => expect(currentClient().status).toBe("verified"));
    const action = await currentClient().prepareMoneyAction("send", { amountBaseUnits: "1000000" });
    serverPostsAfterPrepare = 0;

    await act(async () => {
      await trigger({
        provider,
        rerender: (nextSdk) => view.rerender(owner(nextSdk)),
        setServerSession: (next) => { activeSession = next; },
        loseServerVerification: () => { verificationLost = true; },
      });
    });

      await expect(currentClient().executeMoneyAction(action)).rejects.toMatchObject({
        reason: "stale-session",
      });
      expect(cdpDispatches + provider.walletDispatches).toBe(0);
      expect(serverPostsAfterPrepare).toBe(0);
      cleanup();
      observedClient = null;
      window.sessionStorage.clear();
      window.localStorage.clear();
    }
  });

  test("signs the SDK out when CDP session validation returns 401", async () => {
    let verificationLost = false;
    let signOutCalls = 0;
    render(
      <AccountWalletSessionOwner
        sdk={sdk({
          provisionalSession: session("cdp-embedded"),
          signOut: async () => { signOutCalls += 1; },
        })}
        sessionFetch={async () => verificationLost
          ? new Response(null, { status: 401 })
          : Response.json(session("cdp-embedded"))}
      >
        <ClientProbe />
      </AccountWalletSessionOwner>,
    );
    await waitFor(() => expect(currentClient().status).toBe("verified"));

    verificationLost = true;
    await act(async () => { await currentClient().retrySessionValidation(); });

    await waitFor(() => expect(currentClient().status).toBe("signed-out"));
    expect(currentClient().message).toBe("You are signed out.");
    expect(signOutCalls).toBe(1);
  });

  test("clears the CDP render hint synchronously with private session state", async () => {
    let finishSignOut!: () => void;
    const signOutPending = new Promise<void>((resolve) => { finishSignOut = resolve; });
    const activeSdk = sdk({
      provisionalSession: session("cdp-embedded"),
      signOut: () => signOutPending,
    });
    render(
      <AccountWalletSessionOwner sdk={activeSdk} sessionFetch={async () => Response.json(session("cdp-embedded"))}>
        <ClientProbe />
      </AccountWalletSessionOwner>,
    );
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    document.cookie = "home-cdp-live=fixture; Path=/; SameSite=Lax";
    expect(document.cookie).toContain("home-cdp-live=fixture");

    let signOutPromise!: Promise<void>;
    act(() => { signOutPromise = currentClient().signOut(); });
    expect(document.cookie).not.toContain("home-cdp-live");

    finishSignOut();
    await act(async () => { await signOutPromise; });
  });

  test("cancels post-action freshness before an owner switch can recreate old-owner queries", async () => {
    const queryClient = getHomeQueryClient();
    let activeSession = session("cdp-embedded");
    let freshFetches = 0;
    const dataOwnerKey = `${activeSession.user.subject}\u0000${ADDRESS_A.toLowerCase()}\u00008453\u0000cdp-embedded`;

    const scheduled = new Map<object, () => void>();
    const nativeSetTimeout = globalThis.setTimeout;
    const nativeClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 3_000 && typeof callback === "function") {
        const id = {};
        scheduled.set(id, () => callback(...args));
        return id;
      }
      return nativeSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
      if (scheduled.delete(id as object)) return;
      nativeClearTimeout(id);
    }) as typeof clearTimeout;

    try {
      const activeSdk = sdk({
        sendUserOperation: async () => ({ userOperationHash: `0x${"ab".repeat(32)}` }),
        getUserOperation: async () => ({
          network: "base",
          userOpHash: `0x${"ab".repeat(32)}`,
          calls: prepared(activeSession).calls,
          status: "complete",
          transactionHash: `0x${"cd".repeat(32)}`,
        }),
      });
      const sessionFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/session") return Response.json(activeSession);
        if (path === "/api/actions/prepare") return Response.json(prepared(activeSession));
        if (path.endsWith("/confirm")) return Response.json({ calls: prepared(activeSession).calls });
        if (path === "/api/actions") {
          return Response.json({ actions: [{ id: ACTION_ID, summary: { amounts: prepared(activeSession).amounts } }] });
        }
        if (path.startsWith("/api/balances?")) {
          freshFetches += 1;
          return new Response(null, { status: 500 });
        }
        if (init?.method === "POST" && path.endsWith("/handle")) return Response.json({});
        return Response.json({});
      };
      const owner = (ownerSdk: AccountWalletSdkBoundary) => (
        <AccountWalletSessionOwner sdk={ownerSdk} sessionFetch={sessionFetch}>
          <ClientProbe />
        </AccountWalletSessionOwner>
      );
      const view = render(owner(activeSdk));
      await waitFor(() => expect(currentClient().status).toBe("verified"));
      queryClient.setQueryData(ownerQueryKey(dataOwnerKey, "balances", "US"), {
        version: 3,
        holdings: [{ id: "usdc", balance: { status: "ready", baseUnits: "1000000" } }],
      });
      const action = await currentClient().prepareMoneyAction("send", { amountBaseUnits: "1000000" });
      await currentClient().executeMoneyAction(action);
      await waitFor(() => expect(scheduled.size).toBe(1));
      const oldPoll = [...scheduled.values()][0]!;

      activeSession = session("cdp-embedded", "subject-b", ADDRESS_B);
      await act(async () => { view.rerender(owner(sdk({ ownerKey: OWNER_B }))); });
      await waitFor(() => expect(currentClient().status).toBe("verified"));
      oldPoll();
      await Promise.resolve();
      await Promise.resolve();

      expect(freshFetches).toBe(0);
      expect(scheduled.size).toBe(0);
      expect(queryClient.getQueryCache().findAll({ queryKey: [dataOwnerKey] })).toHaveLength(0);
    } finally {
      globalThis.setTimeout = nativeSetTimeout;
      globalThis.clearTimeout = nativeClearTimeout;
    }
  });

  test("allows verification to finish when it switches from another signed-in provider", async () => {
    let activeSession = session("base-account");
    const viewRef: { current?: ReturnType<typeof render> } = {};
    const provider = new ProviderFixture();
    const asProvider = provider as unknown as Parameters<typeof restoreWithBaseProvider>[0];
    const sessionFetch = async () => Response.json(activeSession);
    const owner = (ownerSdk: AccountWalletSdkBoundary) => (
      <AccountWalletSessionOwner
        sdk={ownerSdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountRestorer={(onInvalidated) => restoreWithBaseProvider(asProvider, onInvalidated)}
      >
        <ClientProbe />
      </AccountWalletSessionOwner>
    );
    const nextSdk = sdk({
      authentication: "cdp",
      ownerKey: OWNER_B,
      provisionalSession: session("cdp-embedded", "subject-b", ADDRESS_B),
    });
    const initialSdk = sdk({
      authentication: "native-base",
      ownerKey: OWNER_A,
      provisionalSession: activeSession,
      getAccessToken: async () => null,
      verifyEmailOTP: async () => {
        activeSession = session("cdp-embedded", "subject-b", ADDRESS_B);
        viewRef.current?.rerender(owner(nextSdk));
      },
    });
    viewRef.current = render(owner(initialSdk));
    await waitFor(() => expect(currentClient().status).toBe("verified"));

    let flowId = "";
    await act(async () => {
      ({ flowId } = await currentClient().requestEmailCode("person@example.com"));
    });
    await act(async () => {
      await expect(currentClient().verifyEmailCode(flowId, "123456")).resolves.toBeUndefined();
    });
    await waitFor(() => expect(currentClient().ownerKey).toBe(OWNER_B));
    await waitFor(() => expect(currentClient().status).toBe("verified"));
  });

  test("clears confirmed plans at the owner-generation boundary", async () => {
    let activeSession = session("cdp-embedded");
    let confirmPosts = 0;
    let dispatches = 0;
    const sessionFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/session") return Response.json(activeSession);
      if (path === "/api/actions/prepare") return Response.json(prepared(activeSession));
      if (path.endsWith("/confirm")) {
        confirmPosts += 1;
        return Response.json({ calls: prepared(activeSession).calls });
      }
      if (init?.method === "POST" && path.endsWith("/handle")) return Response.json({});
      return Response.json({});
    };
    const activeSdk = (ownerKey: string) => sdk({
      ownerKey,
      sendUserOperation: async () => {
        dispatches += 1;
        return { userOperationHash: `0x${"ab".repeat(32)}` };
      },
    });
    const owner = (ownerSdk: AccountWalletSdkBoundary) => (
      <AccountWalletSessionOwner sdk={ownerSdk} sessionFetch={sessionFetch}>
        <ClientProbe />
      </AccountWalletSessionOwner>
    );
    const view = render(owner(activeSdk(OWNER_A)));
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    const first = await currentClient().prepareMoneyAction("send", { amountBaseUnits: "1000000" });
    await currentClient().executeMoneyAction(first);

    activeSession = session("cdp-embedded", "subject-b", ADDRESS_B);
    view.rerender(owner(activeSdk(OWNER_B)));
    await waitFor(() => expect(currentClient().status).toBe("verified"));
    activeSession = session("cdp-embedded");
    view.rerender(owner(activeSdk(OWNER_A)));
    await waitFor(() => expect(currentClient().status).toBe("verified"));

    const second = await currentClient().prepareMoneyAction("send", { amountBaseUnits: "1000000" });
    await currentClient().executeMoneyAction(second);
    expect({ confirmPosts, dispatches }).toEqual({ confirmPosts: 2, dispatches: 2 });
  });
});

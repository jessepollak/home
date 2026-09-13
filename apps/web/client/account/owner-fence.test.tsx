import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
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
    signInWithSiwe: async () => ({ flowId: "siwe-flow", message: "fixture SIWE message" }),
    verifySiweSignature: async () => {},
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
        baseAccountConnector={(onInvalidated) => connectWithBaseProvider(asProvider, onInvalidated)}
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
        if (path.startsWith("/api/portfolio/valuation?")) {
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
      queryClient.setQueryData(ownerQueryKey(dataOwnerKey, "valuation", "US"), {
        version: 2,
        inventory: {
          holdings: [{ kind: "direct", id: "usdc", balanceBaseUnits: "1000000" }],
        },
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

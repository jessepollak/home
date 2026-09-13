import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { dehydrate } from "@tanstack/react-query";
import type { AccountWalletClient, AccountWalletSdkBoundary } from "./cdp-client";
import type { VerifiedAccountSession } from "./session-client";
import {
  createHomeQueryClient,
  createOwnerQueryPersister,
  getHomeQueryClient,
  ownerQueryKey,
  ownerQueryMeta,
  ownerQueryStorageKey,
  shouldPersistOwnerQuery,
  useHomeQuery,
} from "@/client/query/query-client";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { useEffect } = await import("react");
const { useAccountWallet } = await import("./cdp-client");
const { AccountWalletSessionOwner } = await import("./cdp-session-lifecycle");

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;

function verifiedSession(subject: string, address: typeof ADDRESS_A | typeof ADDRESS_B): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount: { address, chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
}

function dataOwnerKey(session: VerifiedAccountSession): string {
  return `${session.user.subject}\u0000${session.smartAccount!.address.toLowerCase()}\u00008453\u0000${session.accountProvider}`;
}

function sdk(
  ownerKey: string | null,
  provisionalSession: VerifiedAccountSession | null = null,
): AccountWalletSdkBoundary {
  return {
    isInitialized: true,
    isSignedIn: ownerKey !== null,
    ownerKey,
    provisionalSession,
    signInWithEmail: async () => ({ flowId: "flow" }),
    verifyEmailOTP: async () => {},
    signInWithSiwe: async () => ({ flowId: "flow", message: "message" }),
    verifySiweSignature: async () => {},
    getAccessToken: async () => "token",
    signOut: async () => {},
  };
}

function persistValuation(ownerKey: string, amount: string): void {
  const client = createHomeQueryClient();
  client.setQueryDefaults(ownerQueryKey(ownerKey, "valuation", "US"), {
    meta: ownerQueryMeta(ownerKey, "owner"),
  });
  client.setQueryData(ownerQueryKey(ownerKey, "valuation", "US"), { amount });
  const persister = createOwnerQueryPersister(window.localStorage, ownerKey);
  persister?.persistClient({
    timestamp: Date.now(),
    buster: "home-query-v1",
    clientState: dehydrate(client, {
      shouldDehydrateQuery: (query) => shouldPersistOwnerQuery(query, ownerKey),
    }),
  });
  persister?.flush();
}

let observedClient: AccountWalletClient | null = null;
function HydrationProbe({ fetchValuation }: { fetchValuation: () => Promise<unknown> }) {
  const account = useAccountWallet();
  useEffect(() => { observedClient = account; }, [account]);
  const ownerKey = account.verification && account.session?.smartAccount
    ? dataOwnerKey(account.session)
    : null;
  const valuation = useHomeQuery({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "valuation", "US")
      : ["unauthenticated", "valuation-disabled"],
    enabled: ownerKey !== null && account.verification === "server",
    staleTime: 0,
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: fetchValuation,
  });
  const amount = valuation.data && typeof valuation.data === "object" &&
    "amount" in valuation.data && typeof valuation.data.amount === "string"
    ? valuation.data.amount
    : "none";
  return <output data-testid="valuation">{amount}</output>;
}

afterEach(() => {
  cleanup();
  observedClient = null;
  getHomeQueryClient().clear();
  window.localStorage.clear();
});

describe("owner query hydration lifecycle", () => {
  test("provisional identity preserves only its own cache and cannot use authenticated transport", async () => {
    const rows = [
      { name: "matching", cached: verifiedSession("subject-a", ADDRESS_A), incoming: verifiedSession("subject-a", ADDRESS_A), expected: "12340000" },
      { name: "different", cached: verifiedSession("subject-a", ADDRESS_A), incoming: verifiedSession("subject-b", ADDRESS_B), expected: "none" },
    ] as const;

    for (const row of rows) {
      const cachedOwnerKey = dataOwnerKey(row.cached);
      persistValuation(cachedOwnerKey, "12340000");
      let valuationFetches = 0;
      const sessionPending = new Promise<Response>(() => {});
      const owner = (ownerSdk: AccountWalletSdkBoundary) => (
        <AccountWalletSessionOwner
          sdk={ownerSdk}
          sessionFetch={async (input) => String(input) === "/api/session" ? sessionPending : Response.json({})}
        >
          <HydrationProbe fetchValuation={async () => { valuationFetches += 1; return {}; }} />
        </AccountWalletSessionOwner>
      );
      const view = render(owner({ ...sdk(null), isInitialized: false }));
      await act(async () => { view.rerender(owner(sdk(`sdk-${row.name}`, row.incoming))); });

      await waitFor(() => expect(observedClient?.verification).toBe("provisional"));
      await waitFor(() => expect(view.getByTestId("valuation").textContent).toBe(row.expected));
      expect(valuationFetches).toBe(0);
      await expect(observedClient!.fetchAccountResource("/api/actions")).rejects.toMatchObject({ reason: "stale-session" });
      await expect(observedClient!.prepareMoneyAction("send", { amountBaseUnits: "1" })).rejects.toMatchObject({ reason: "stale-session" });
      expect(getHomeQueryClient().getQueryData(ownerQueryKey(cachedOwnerKey, "valuation", "US")))
        [row.name === "matching" ? "toBeDefined" : "toBeUndefined"]();

      cleanup();
      observedClient = null;
      getHomeQueryClient().clear();
      window.localStorage.clear();
    }
  });

  test("server verification preserves matching provisional data and clears mismatches", async () => {
    const rows = [
      { name: "matching", server: verifiedSession("subject-a", ADDRESS_A), survives: true },
      { name: "different", server: verifiedSession("subject-b", ADDRESS_B), survives: false },
    ] as const;

    for (const row of rows) {
      const provisional = verifiedSession("subject-a", ADDRESS_A);
      const provisionalOwnerKey = dataOwnerKey(provisional);
      persistValuation(provisionalOwnerKey, "12340000");
      let resolveSession!: (response: Response) => void;
      const sessionResponse = new Promise<Response>((resolve) => { resolveSession = resolve; });
      const view = render(
        <AccountWalletSessionOwner
          sdk={sdk("sdk-owner-a", provisional)}
          sessionFetch={async () => sessionResponse}
        >
          <HydrationProbe fetchValuation={async () => new Promise<unknown>(() => {})} />
        </AccountWalletSessionOwner>,
      );

      await waitFor(() => expect(observedClient?.verification).toBe("provisional"));
      expect(view.getByTestId("valuation").textContent).toBe("12340000");
      resolveSession(Response.json(row.server));
      await waitFor(() => expect(observedClient?.verification).toBe("server"));
      expect(getHomeQueryClient().getQueryData(ownerQueryKey(provisionalOwnerKey, "valuation", "US")))
        [row.survives ? "toBeDefined" : "toBeUndefined"]();

      cleanup();
      observedClient = null;
      getHomeQueryClient().clear();
      window.localStorage.clear();
    }
  });

  test("same owner paints persisted data before its first fetch resolves", async () => {
    const activeSession = verifiedSession("subject-a", ADDRESS_A);
    const ownerKey = dataOwnerKey(activeSession);
    persistValuation(ownerKey, "12340000");
    let fetches = 0;
    const never = new Promise<unknown>(() => {});

    const view = render(
      <AccountWalletSessionOwner
        sdk={sdk("sdk-owner-a")}
        sessionFetch={async () => Response.json(activeSession)}
      >
        <HydrationProbe fetchValuation={() => { fetches += 1; return never; }} />
      </AccountWalletSessionOwner>,
    );

    await waitFor(() => expect(view.getByTestId("valuation").textContent).toBe("12340000"));
    expect(fetches).toBe(1);
    expect(window.localStorage.getItem(ownerQueryStorageKey(ownerKey)!)).not.toBeNull();
  });

  test("owner switch and sign-out clear every persisted owner store", async () => {
    let activeSession = verifiedSession("subject-a", ADDRESS_A);
    const ownerAKey = dataOwnerKey(activeSession);
    const ownerBKey = dataOwnerKey(verifiedSession("subject-b", ADDRESS_B));
    persistValuation(ownerAKey, "1");
    persistValuation(ownerBKey, "2");
    const sessionFetch = async () => Response.json(activeSession);
    const never = new Promise<unknown>(() => {});
    const owner = (ownerSdk: AccountWalletSdkBoundary) => (
      <AccountWalletSessionOwner sdk={ownerSdk} sessionFetch={sessionFetch}>
        <HydrationProbe fetchValuation={() => never} />
      </AccountWalletSessionOwner>
    );
    const view = render(owner(sdk("sdk-owner-a")));
    await waitFor(() => expect(view.getByTestId("valuation").textContent).toBe("1"));

    activeSession = verifiedSession("subject-b", ADDRESS_B);
    view.rerender(owner(sdk("sdk-owner-b")));
    await waitFor(() => expect(observedClient?.session?.user.subject).toBe("subject-b"));
    expect(window.localStorage.getItem(ownerQueryStorageKey(ownerAKey)!)).toBeNull();
    expect(window.localStorage.getItem(ownerQueryStorageKey(ownerBKey)!)).toBeNull();

    persistValuation(ownerBKey, "3");
    await act(async () => { await observedClient?.signOut(); });
    expect(window.localStorage.getItem(ownerQueryStorageKey(ownerBKey)!)).toBeNull();
  });
});

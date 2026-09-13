import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import type { AccountWalletSdkBoundary } from "@/client/account/cdp-client";
import type { SessionFetch, VerifiedAccountSession } from "@/client/account/session-client";

const replaceCalls: string[] = [];
const pushCalls: string[] = [];
let historyEntries = ["/"];
let historyCursor = 0;
const nativeReplaceState = window.history.replaceState.bind(window.history);

function syncLocation(href: string) {
  nativeReplaceState({}, "", href);
}

function pushHistory(href: string) {
  pushCalls.push(href);
  historyEntries = historyEntries.slice(0, historyCursor + 1);
  historyEntries.push(href);
  historyCursor = historyEntries.length - 1;
  syncLocation(href);
}

function replaceHistory(href: string) {
  replaceCalls.push(href);
  historyEntries[historyCursor] = href;
  syncLocation(href);
}

function popHistory() {
  if (historyCursor > 0) {
    historyCursor -= 1;
    syncLocation(historyEntries[historyCursor]);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

Object.defineProperties(window.history, {
  pushState: {
    configurable: true,
    value: (_state: unknown, _unused: string, href?: string | URL | null) => {
      if (href !== undefined && href !== null) pushHistory(String(href));
    },
  },
  replaceState: {
    configurable: true,
    value: (_state: unknown, _unused: string, href?: string | URL | null) => {
      if (href !== undefined && href !== null) replaceHistory(String(href));
    },
  },
  back: { configurable: true, value: popHistory },
});

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => replaceHistory(href),
    push: (href: string) => pushHistory(href),
    back: popHistory,
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { CdpAccountProvider } = await import("@/client/account/cdp-client");
const { AccountWalletSessionOwner } = await import("@/client/account/cdp-session-lifecycle");
const { BASE_CHAIN_ID } = await import("@/client/account/session-client");
const { HomeExperience } = await import("./home-experience");

const OWNER = "home-user";
const OWNER_B = "home-user-b";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";

function page() {
  return within(document.body);
}

function sdk(overrides: Partial<AccountWalletSdkBoundary> = {}): AccountWalletSdkBoundary {
  return {
    isInitialized: true,
    isSignedIn: false,
    ownerKey: null,
    signInWithEmail: async () => ({ flowId: "flow-1" }),
    verifyEmailOTP: async () => {},
    signInWithSiwe: async () => ({ flowId: "siwe-1", message: "message" }),
    verifySiweSignature: async () => {},
    getAccessToken: async () => "fixture-token",
    signOut: async () => {},
    ...overrides,
  };
}

function session(
  address: `0x${string}` = ADDRESS,
  subject = "subject-home",
): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount: { address, chainId: BASE_CHAIN_ID },
    accountProvider: "cdp-embedded",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const defaultSessionFetch: SessionFetch = async () => Response.json(session());

function HomeHarness({
  accountSdk,
  sessionFetch = defaultSessionFetch,
  routeMode = "dashboard",
  assetBalances,
  ...props
}: {
  accountSdk: AccountWalletSdkBoundary;
  sessionFetch?: SessionFetch;
  routeMode?: "landing" | "dashboard";
  assetBalances?: ComponentProps<typeof HomeExperience>["assetBalances"];
} & Omit<ComponentProps<typeof HomeExperience>, "routeMode" | "assetBalances">) {
  return (
    <AccountWalletSessionOwner sdk={accountSdk} sessionFetch={sessionFetch}>
      <HomeExperience
        {...props}
        routeMode={routeMode}
        savingsContent={<section aria-label="Savings module">Savings fixture</section>}
        investContent={<section aria-label="Invest module">Invest fixture</section>}
        assetBalances={assetBalances ?? {
          status: "ready",
          displayTotal: "$12.34",
          totalStatus: "complete",
          items: [{
            id: "usdc",
            group: "cash",
            name: "US dollar",
            displayBalance: "$12.34",
            currencyCode: "USD",
          }],
        }}
      />
    </AccountWalletSessionOwner>
  );
}

async function waitForVerifiedShell() {
  return waitFor(() => {
    const button = page().getByRole("button", { name: "Account" });
    expect(button.hasAttribute("disabled")).toBe(false);
    return button;
  });
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: () => ({
    matches: true,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }),
});
HTMLElement.prototype.scrollIntoView = () => {};

function resetHistory() {
  replaceCalls.length = 0;
  pushCalls.length = 0;
  historyEntries = ["/"];
  historyCursor = 0;
  syncLocation("/");
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.body.style.overflow = "";
  resetHistory();
});

describe("Home shell auth and privacy", () => {
  test("gates dashboard content while signed out and opens the shared sign-in flow", async () => {
    render(<HomeHarness accountSdk={sdk()} routeMode="landing" />);

    expect(await page().findByRole("heading", { name: "One home for your money." })).toBeTruthy();
    expect(page().queryByText("$12.34")).toBeNull();
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();

    fireEvent.click(within(page().getByRole("main")).getByRole("button", { name: "Sign in" }));
    expect(await page().findByRole("dialog", { name: "Sign in to Home" })).toBeTruthy();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/?account=signin");
  });

  test("keeps unavailable auth behind setup recovery", async () => {
    render(
      <CdpAccountProvider projectId={null}>
        <HomeExperience routeMode="landing" />
      </CdpAccountProvider>,
    );

    await page().findByRole("heading", { name: "One home for your money." });
    expect(page().queryByRole("button", { name: "Create account" })).toBeNull();
    fireEvent.click(within(page().getByRole("main")).getByRole("button", { name: "Sign in" }));
    expect(await page().findByText("Sign-in is not configured")).toBeTruthy();
    expect(page().queryByRole("textbox", { name: "Email address" })).toBeNull();
  });

  test("redirects a signed-out dashboard without exposing private balances", async () => {
    render(<HomeHarness accountSdk={sdk()} />);

    expect(page().queryByText("$12.34")).toBeNull();
    expect(document.body.textContent).not.toContain(ADDRESS);
    await waitFor(() => expect(replaceCalls).toEqual(["/?account=signin"]));
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();
  });

  test("hides the previous owner's balances immediately during an owner switch", async () => {
    const pendingSession = deferred<Response>();
    const view = render(
      <HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />,
    );
    await waitForVerifiedShell();
    expect(page().getAllByText("$12.34").length).toBeGreaterThan(0);

    view.rerender(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER_B })}
        sessionFetch={() => pendingSession.promise}
      />,
    );

    expect(page().queryByText("$12.34")).toBeNull();
    expect(document.body.textContent).not.toContain(ADDRESS);
    await act(async () => {
      pendingSession.resolve(Response.json(session(ADDRESS_B, "subject-home-b")));
      await pendingSession.promise;
    });
    await waitForVerifiedShell();
  });

  test("keeps private content hidden after failed sign-out and permits recovery", async () => {
    let signOutCalls = 0;
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
          signOut: async () => {
            signOutCalls += 1;
            if (signOutCalls === 1) throw new Error("fixture logout failed");
          },
        })}
      />,
    );

    fireEvent.click(await waitForVerifiedShell());
    fireEvent.click(page().getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(replaceCalls).toEqual(["/"]));
    expect(page().queryByText("$12.34")).toBeNull();
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();

    fireEvent.click(await page().findByRole("button", { name: "Retry sign out" }));
    await waitFor(() => expect(signOutCalls).toBe(2));
  });

  test("recovers a failed session check without revealing balances early", async () => {
    let checks = 0;
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={async () => {
          checks += 1;
          return checks === 1
            ? Response.json({ error: { code: "SESSION_UNAVAILABLE" } }, { status: 503 })
            : Response.json(session());
        }}
      />,
    );

    expect(await page().findByRole("button", { name: "Retry account check" })).toBeTruthy();
    expect(page().queryByText("$12.34")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Retry account check" }));
    await waitForVerifiedShell();
    expect(page().getAllByText("$12.34").length).toBeGreaterThan(0);
  });
});

describe("Home shell routing and intents", () => {
  test("keeps panel selection and browser history synchronized", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/dashboard?panel=balances");
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/dashboard?panel=invest");
    expect(page().getByRole("region", { name: "Invest module" })).toBeTruthy();

    act(() => popHistory());
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
  });

  test("honors server-selected panel state without adding history", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="activity"
      />,
    );

    await waitForVerifiedShell();
    expect(page().getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(pushCalls).toEqual([]);
  });

  test("replaces deep-linked account settings when there is no in-app return", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialAccountSettingsOpen
      />,
    );

    expect(await page().findByRole("combobox", { name: "Country" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(replaceCalls).toEqual(["/dashboard"]);
    expect(await page().findByRole("heading", { name: "Balances" })).toBeTruthy();
  });

  test("applies a verified inbound send intent once", async () => {
    syncLocation("/dashboard?flow=send");
    historyEntries = ["/dashboard?flow=send"];
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        applyInboundUrlIntent
      />,
    );

    await waitForVerifiedShell();
    expect(await page().findByRole("dialog", { name: "Send" })).toBeTruthy();
    expect(page().getAllByRole("dialog", { name: "Send" })).toHaveLength(1);
  });
});

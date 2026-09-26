import "@/client/account/dom-test-harness";

import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { useState, type ComponentProps } from "react";
import type { HomeRegionState } from "./use-home-region";
import type { AccountWalletSdkBoundary } from "@/client/account/cdp-client";
import type { SessionFetch, VerifiedAccountSession } from "@/client/account/session-client";
import { DEFAULT_BORROW_MARKET } from "@/shared/borrowing/config";

const BORROW_MARKET_ID = DEFAULT_BORROW_MARKET.marketId;
import {
  buildBalancesSnapshotFixture,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
} from "@/shared/balances/fixtures";
import {
  presentBalances,
  type BalanceRowModel,
  type BalancesPresentation,
} from "@/shared/balances/present";

const replaceCalls: string[] = [];
const pushCalls: string[] = [];
let historyEntries = ["/"];
let historyStates: unknown[] = [{}];
let historyCursor = 0;
const nativeReplaceState = window.history.replaceState.bind(window.history);

function syncLocation(href: string, state: unknown = historyStates[historyCursor]) {
  nativeReplaceState(state, "", href);
}

function pushHistory(href: string, state: unknown = {}) {
  pushCalls.push(href);
  historyEntries = historyEntries.slice(0, historyCursor + 1);
  historyStates = historyStates.slice(0, historyCursor + 1);
  historyEntries.push(href);
  historyStates.push(state);
  historyCursor = historyEntries.length - 1;
  syncLocation(href, state);
}

function replaceHistory(href: string, state: unknown = historyStates[historyCursor]) {
  replaceCalls.push(href);
  historyEntries[historyCursor] = href;
  historyStates[historyCursor] = state;
  syncLocation(href, state);
}

function popHistory() {
  if (historyCursor > 0) {
    historyCursor -= 1;
    syncLocation(historyEntries[historyCursor]!, historyStates[historyCursor]);
  }
  window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates[historyCursor] }));
}

Object.defineProperties(window.history, {
  pushState: {
    configurable: true,
    value: (state: unknown, _unused: string, href?: string | URL | null) => {
      if (href !== undefined && href !== null) pushHistory(String(href), state);
    },
  },
  replaceState: {
    configurable: true,
    value: (state: unknown, _unused: string, href?: string | URL | null) => {
      if (href !== undefined && href !== null) {
        replaceHistory(String(href), state);
        return;
      }
      historyStates[historyCursor] = state;
      nativeReplaceState(state, "");
    },
  },
  back: { configurable: true, value: popHistory },
});

const actualNavigation = await import("next/navigation");
const router = {
  replace: (href: string) => replaceHistory(href),
  push: (href: string) => pushHistory(href),
  back: popHistory,
};
mock.module("next/navigation", () => ({
  ...actualNavigation,
  useRouter: () => router,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { CdpAccountProvider } = await import("@/client/account/cdp-client");
const { AccountWalletSessionOwner } = await import("@/client/account/cdp-session-lifecycle");
const { BASE_CHAIN_ID } = await import("@/client/account/session-client");
const { useNestedAppChrome } = await import("@/components/app-chrome");
const { InvestExperience } = await import("@/client/invest/invest-experience");
const { DashboardShell } = await import("./shell");
const { PortfolioHomeExperience } = await import("./portfolio-home-experience");
const { LandingShell } = await import("./landing-shell");
const { useHomeRegion } = await import("./use-home-region");

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
  ...props
}: {
  accountSdk: AccountWalletSdkBoundary;
  sessionFetch?: SessionFetch;
  routeMode?: "landing" | "dashboard";
} & DashboardHarnessProps) {
  return (
    <AccountWalletSessionOwner sdk={accountSdk} sessionFetch={sessionFetch}>
      {routeMode === "landing" ? <LandingShell /> : <DashboardHarness {...props} />}
    </AccountWalletSessionOwner>
  );
}

type DashboardHarnessProps = Omit<ComponentProps<typeof DashboardShell>, "region"> & {
  detectedCountry?: string | null;
  accountPreference?: "DE" | null;
  regionOverride?: Partial<HomeRegionState>;
  onRegionObserved?: (regionId: HomeRegionState["regionId"]) => void;
};

function DashboardHarness({
  detectedCountry = null,
  accountPreference = null,
  regionOverride,
  onRegionObserved,
  assetBalances,
  investContent = <section aria-label="Invest module">Invest fixture</section>,
  ...props
}: DashboardHarnessProps) {
  const region = useHomeRegion({ detectedCountry, accountPreference, signedIn: accountPreference !== null });
  const resolvedRegion = { ...region, ...regionOverride };
  onRegionObserved?.(resolvedRegion.regionId);
  return (
    <DashboardShell
      {...props}
      region={resolvedRegion}
        savingsContent={<section aria-label="Savings module">Savings fixture</section>}
        investContent={investContent}
        assetBalances={assetBalances ?? {
          status: "ready",
          displayTotal: "$12.34",
          totalStatus: "complete",
          groups: [{
            id: "cash",
            label: "Cash",
            displaySubtotal: "$12.34",
            rows: [{
              key: "usdc",
              group: "cash",
              name: "US dollar",
              mark: { kind: "flag", currency: "USD" },
              primary: "$12.34",
              secondary: null,
              tone: "default",
            }],
          }],
          breakdown: [{ id: "cash", label: "Cash", value: "$12.34", weight: 1_000 }],
          summary: {
            cash: { status: "complete", value: "$12.34" },
            investments: { status: "complete", value: "$0.00", assetCount: 0 },
            borrow: { kind: "none" },
          },
          rows: [{
            key: "usdc",
            group: "cash",
            name: "US dollar",
            mark: { kind: "flag", currency: "USD" },
            primary: "$12.34",
            secondary: null,
            tone: "default",
          }],
          hiddenRows: [],
          hiddenCount: 0,
        }}
    />
  );
}

async function waitForVerifiedShell() {
  return waitFor(() => {
    const button = page().getByRole("button", { name: "Account" });
    expect(button.hasAttribute("disabled")).toBe(false);
    return button;
  });
}

function NestedInvestFixture({ balancesReturn = false }: { balancesReturn?: boolean }) {
  const [assetOpen, setAssetOpen] = useState(false);
  useNestedAppChrome(
    assetOpen
      ? {
          title: "US dollar",
          // "Back" is the production invariant that arms Balances asset-return provenance.
          backLabel: balancesReturn ? "Back" : "Back to Invest",
          onBack: () => setAssetOpen(false),
        }
      : null,
  );

  return (
    <section aria-label="Invest module">
      <button type="button" onClick={() => setAssetOpen(true)}>Open asset details</button>
    </section>
  );
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
HTMLElement.prototype.scrollTo = function scrollTo(
  optionsOrX?: ScrollToOptions | number,
  y?: number,
  ) {
  this.scrollTop = typeof optionsOrX === "number"
    ? y ?? 0
    : optionsOrX?.top ?? 0;
};

let restoreAnimationFrames: (() => void) | null = null;
function controlAnimationFrames() {
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  let id = 0;
  const queued = new Map<number, FrameRequestCallback>();
  window.requestAnimationFrame = (callback) => (queued.set(++id, callback), id);
  window.cancelAnimationFrame = (frame) => { queued.delete(frame); };
  restoreAnimationFrames = () => {
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
    queued.clear();
    restoreAnimationFrames = null;
  };
  return { pending: () => queued.size, flush: () => {
    const callbacks = [...queued.values()];
    queued.clear();
    callbacks.forEach((callback) => callback(performance.now()));
  } };
}

function resetHistory() {
  replaceCalls.length = 0;
  pushCalls.length = 0;
  historyEntries = ["/"];
  historyStates = [{}];
  historyCursor = 0;
  syncLocation("/");
}

afterEach(() => {
  jest.useRealTimers();
  restoreAnimationFrames?.();
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
    expect(page().queryByRole("link", { name: "Explore local money coverage" })).toBeNull();

    fireEvent.click(within(page().getByRole("main")).getByRole("button", { name: "Sign in" }));
    expect(await page().findByRole("dialog", { name: "Sign in to Home" })).toBeTruthy();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/?account=signin");
  });

  test("keeps unavailable auth behind setup recovery", async () => {
    render(
      <CdpAccountProvider projectId={null}>
        <LandingShell />
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

  test("redirects a signed-out Save route without exposing savings content", async () => {
    syncLocation("/save");
    historyEntries = ["/save"];
    render(
      <HomeHarness
        accountSdk={sdk()}
        initialPanel="save"
        initialLocation={{
          panel: "save",
          account: null,
          shelf: null,
          asset: null,
          group: null,
          market: null,
        }}
      />,
    );

    expect(page().queryByRole("region", { name: "Savings module" })).toBeNull();
    await waitFor(() => expect(replaceCalls).toEqual(["/?account=signin"]));
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();
  });

  test("redirects a verified landing session to Home, keeping only overlay intent", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
          provisionalSession: session(),
        })}
        routeMode="landing"
      />,
    );
    await waitFor(() => expect(replaceCalls).toEqual(["/home"]));

    cleanup();
    getHomeQueryClient().clear();
    replaceCalls.length = 0;
    syncLocation("/?flow=send&panel=balances&group=investments");
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
          provisionalSession: session(),
        })}
        routeMode="landing"
      />,
    );
    // Obsolete page-routing params never survive the redirect.
    await waitFor(() => expect(replaceCalls).toEqual(["/home?flow=send"]));
  });

  test("keeps a verified landing session on an explicit sign-in intent", async () => {
    let sessionChecks = 0;
    syncLocation("/?account=signin");
    historyEntries = ["/?account=signin"];
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
          provisionalSession: session(),
        })}
        sessionFetch={async () => {
          sessionChecks += 1;
          return Response.json(session());
        }}
        routeMode="landing"
      />,
    );

    await waitFor(() => expect(sessionChecks).toBe(1));
    await act(async () => { await Promise.resolve(); });
    expect(replaceCalls).toEqual([]);
  });

  for (const initialPanel of ["home", "activity"] as const) {
    test(`keeps ${initialPanel === "home" ? "the Home feed" : "/activity"} loading with cached balances until server verification`, async () => {
      const pendingSession = deferred<Response>();
      let activityReads = 0;
      const sessionFetch: SessionFetch = async (input) => {
        const url = String(input);
        if (url.startsWith("/api/session")) return pendingSession.promise;
        if (url.startsWith("/api/activity?")) {
          activityReads += 1;
          const query = new URLSearchParams(url.split("?")[1]);
          const to = query.get("to")!;
          return Response.json({
            version: 1,
            walletAddress: ADDRESS,
            chainId: 8453,
            window: {
              from: new Date(new Date(to).getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
              to,
            },
            currency: query.get("currency"),
            transfers: [],
            nextCursor: null,
            source: {
              provider: "cdp-sql", cached: false, stale: false,
              executionTimestamp: to, executionTimeMs: 1, fetchedAt: to,
            },
          });
        }
        if (url === "/api/actions") return Response.json({ version: "1", actions: [] });
        throw new Error(`Unexpected read: ${url}`);
      };
      render(
        <HomeHarness
          accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER, provisionalSession: session() })}
          sessionFetch={sessionFetch}
          initialPanel={initialPanel}
        />,
      );

      expect(page().getAllByText("$12.34").length).toBeGreaterThan(0);
      const activity = page().getAllByRole("region", { name: "Activity", busy: true }).at(-1)!;
      expect(activity.getAttribute("aria-busy")).toBe("true");
      if (initialPanel === "home") {
        expect(activity.querySelectorAll("[data-slot='card']")).toHaveLength(1);
      }
      expect(page().queryByText("No activity yet")).toBeNull();
      expect(activityReads).toBe(0);

      await act(async () => {
        pendingSession.resolve(Response.json(session()));
        await pendingSession.promise;
      });
      await waitFor(() => expect(activityReads).toBe(1));
      await waitFor(() => expect(page().getAllByText("No activity yet").length).toBeGreaterThan(0));
      expect(page().queryAllByRole("region", { name: "Activity", busy: true })).toHaveLength(0);
      if (initialPanel === "home") {
        expect(page().getAllByRole("region", { name: "Activity" }).at(-1)!
          .querySelectorAll("[data-slot='card']")).toHaveLength(1);
      }
    });
  }

  test("hides the previous owner's balances immediately during an owner switch", async () => {
    const pendingSession = deferred<Response>();
    const view = render(
      <HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />,
    );
    await waitForVerifiedShell();
    expect(page().getAllByText("$12.34").length).toBeGreaterThan(0);
    const main = page().getByRole("main");
    main.scrollTop = 300;

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
    await waitFor(() => expect(main.scrollTop).toBe(0));
  });

  test("waits for native logout before dashboard navigation", async () => {
    const pending = deferred<void>();
    render(
      <HomeHarness
        accountSdk={sdk({
          authentication: "native-base",
          isSignedIn: true,
          ownerKey: OWNER,
          signOut: async (onPhase) => {
            await pending.promise;
            onPhase?.({ phase: "native-logout", outcome: "success", durationMs: 1 });
          },
        })}
      />,
    );

    fireEvent.click(await waitForVerifiedShell());
    fireEvent.click(page().getByRole("button", { name: "Sign out" }));
    expect(replaceCalls).toEqual([]);

    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
    await waitFor(() => expect(replaceCalls).toEqual(["/"]));
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
    await page().findByRole("button", { name: "Retry sign out" });
    expect(replaceCalls).toEqual(["/"]);
    expect(page().queryByText("$12.34")).toBeNull();
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Retry sign out" }));
    await waitFor(() => expect(signOutCalls).toBe(2));
    await waitFor(() => expect(replaceCalls).toEqual(["/", "/"]));
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
  test("keeps one stable title slot while L2 destinations replace the Home mark with Back", async () => {
    const cases: Array<{
      title: string;
      leading: "home" | "back";
      props: Partial<ComponentProps<typeof HomeHarness>>;
    }> = [
      { title: "Home", leading: "home", props: {} },
      { title: "Invest", leading: "home", props: { initialPanel: "invest" } },
      { title: "Your money", leading: "back", props: { initialPanel: "balances" } },
      { title: "Activity", leading: "back", props: { initialPanel: "activity" } },
      { title: "Save", leading: "back", props: { initialPanel: "save" } },
      { title: "Account", leading: "home", props: { initialAccountSettingsOpen: true } },
    ];
    for (const shellCase of cases) {
      render(
        <HomeHarness
          accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
          {...shellCase.props}
        />,
      );

      const title = await waitFor(() => {
        const element = document.querySelector<HTMLElement>("[data-shell-header-title]");
        expect(element?.textContent).toBe(shellCase.title);
        return element!;
      });
      const headerMain = title.closest<HTMLElement>("[data-shell-header-main]");
      expect(headerMain).not.toBeNull();
      if (shellCase.leading === "back") {
        expect(headerMain!.querySelectorAll("[data-home-mark]")).toHaveLength(0);
        expect(title.previousElementSibling?.hasAttribute("data-shell-back")).toBe(true);
        expect(within(headerMain!).getByRole("button", { name: "Back" })).toBeTruthy();
      } else {
        expect(headerMain!.querySelectorAll("[data-home-mark]")).toHaveLength(1);
        expect(title.previousElementSibling?.hasAttribute("data-home-mark")).toBe(true);
        expect(within(headerMain!).getByRole("button", { name: "Home" })).toBeTruthy();
      }
      cleanup();
      getHomeQueryClient().clear();
      resetHistory();
    }
  });

  test("active Invest tab pushes its root only when the current path is nested", async () => {
    syncLocation("/invest/crypto");
    historyEntries = ["/invest/crypto"];
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} initialPanel="invest" />);
    await waitForVerifiedShell();

    const investTab = within(page().getByRole("navigation", { name: "Main navigation" }))
      .getByRole("button", { name: "Invest" });
    fireEvent.click(investTab);
    expect(window.location.pathname).toBe("/invest");
    expect(pushCalls).toEqual(["/invest"]);

    fireEvent.click(investTab);
    expect(pushCalls).toEqual(["/invest"]);
    act(() => popHistory());
    expect(window.location.pathname).toBe("/invest/crypto");
  });

  test("restores a crypto detail's category Back after the active Invest tab and browser Back", async () => {
    syncLocation("/invest");
    historyEntries = ["/invest"];
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="invest"
        investContent={<InvestExperience />}
      />,
    );
    await waitForVerifiedShell();

    fireEvent.click(within(page().getByRole("region", { name: "Crypto" }))
      .getByRole("button", { name: "See all ›" }));
    expect(window.location.pathname).toBe("/invest/crypto");
    fireEvent.click(page().getByRole("button", { name: /Bitcoin/ }));
    expect(window.location.pathname).toBe("/invest/cbbtc");
    expect(window.history.state.investDetailFrom).toBe("crypto");

    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" }))
      .getByRole("button", { name: "Invest" }));
    expect(window.location.pathname).toBe("/invest");
    await act(async () => { popHistory(); await Promise.resolve(); });
    expect(window.location.pathname).toBe("/invest/cbbtc");
    expect(page().getByRole("button", { name: /^Back$/ })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: /^Back$/ }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/invest/crypto");
      expect(document.querySelector("[data-shell-header-title]")?.textContent).toBe("Crypto");
      expect(page().getAllByRole("region", { name: "Crypto" }).length).toBeGreaterThan(0);
      expect(page().getByRole("button", { name: "Back to Invest" })).toBeTruthy();
    });
  });

  test("returns to the Invest overview after Account settings unmounts a nested Invest view", async () => {
    syncLocation("/invest/crypto");
    historyEntries = ["/invest/crypto"];
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="invest"
        investContent={<InvestExperience initialView={{ screen: "category", shelfId: "crypto" }} />}
      />,
    );
    const accountTrigger = await waitForVerifiedShell();
    expect(page().getByRole("button", { name: "Back to Invest" })).toBeTruthy();
    expect(window.location.pathname).toBe("/invest/crypto");
    fireEvent.click(accountTrigger);
    expect(window.location.search).toBe("?account=settings");
    expect(await page().findByRole("region", { name: "Account settings" })).toBeTruthy();

    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" }))
      .getByRole("button", { name: "Invest" }));
    expect(window.location.pathname).toBe("/invest");
    expect(pushCalls).toEqual(["/invest/crypto?account=settings", "/invest"]);
    expect(page().queryAllByRole("button", { name: "Back to Invest" })).toHaveLength(0);
    expect(page().getByRole("region", { name: "Crypto" })).toBeTruthy();
  });

  test("browser Back from Account settings restores the nested Invest view", async () => {
    syncLocation("/invest/crypto");
    historyEntries = ["/invest/crypto"];
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="invest"
        investContent={<InvestExperience initialView={{ screen: "category", shelfId: "crypto" }} />}
      />,
    );
    const accountTrigger = await waitForVerifiedShell();
    fireEvent.click(accountTrigger);
    expect(await page().findByRole("region", { name: "Account settings" })).toBeTruthy();

    act(() => popHistory());
    expect(window.location.pathname).toBe("/invest/crypto");
    expect(await page().findByRole("button", { name: "Back to Invest" })).toBeTruthy();
  });

  test("uses a Back button for nested Invest chrome and preserves its action", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="invest"
        investContent={<NestedInvestFixture />}
      />,
    );
    await waitForVerifiedShell();
    expect(document.querySelector("[data-shell-header-title]")?.textContent).toBe("Invest");

    fireEvent.click(page().getByRole("button", { name: "Open asset details" }));
    await waitFor(() => {
      expect(document.querySelector("[data-shell-header-title]")?.textContent).toBe("US dollar");
    });
    const nestedBack = page().getByRole("button", { name: "Back to Invest" });
    expect(nestedBack.closest("[data-shell-back]")).not.toBeNull();
    expect(document.querySelector("[data-home-mark]")).toBeNull();

    fireEvent.click(nestedBack);
    await waitFor(() => {
      expect(document.querySelector("[data-shell-header-title]")?.textContent).toBe("Invest");
    });
  });

  test("renders the net total with Borrow left of the zero axis, then Cash and Investments", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$60.54",
          totalStatus: "complete",
          groups: [],
          breakdown: [
            { id: "borrow", label: "Borrow", value: "−$30.01", weight: 249 },
            { id: "cash", label: "Cash", value: "$12.34", weight: 102 },
            { id: "investments", label: "Investments", value: "$78.21", weight: 649 },
          ],
          summary: {
            cash: { status: "complete", value: "$12.34" },
            investments: { status: "complete", value: "$78.21", assetCount: 1 },
            borrow: { kind: "position", status: "complete", value: "$30.01", rate: "5.10% APR", debts: [{ marketId: BORROW_MARKET_ID, baseUnits: "30010000" }] },
          },
          rows: [],
          hiddenRows: [],
          hiddenCount: 0,
        }}
      />,
    );
    await waitForVerifiedShell();

    const breakdown = document.querySelector<HTMLElement>("[data-balance-breakdown]");
    expect(breakdown).not.toBeNull();
    expect(page().getByLabelText("Total balance").textContent).toContain("$60.54");
    const legend = [...breakdown!.querySelectorAll("[data-breakdown-item]")];
    expect(legend.map((item) => item.getAttribute("data-breakdown-item"))).toEqual(["borrow", "cash", "investments"]);
    expect(legend[0]!.textContent).toContain("Borrow−$30.01");
    expect(legend[1]!.textContent).toContain("Cash$12.34");
    expect(legend[2]!.textContent).toContain("Investments$78.21");
    expect(within(breakdown!).getByRole("list", { name: "Balance allocation" })).toBeTruthy();
    const bar = breakdown!.querySelector<HTMLElement>("[data-signed-balance-bar]")!;
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect([...bar.children].map((child) =>
      child.getAttribute("data-balance-segment") ?? (child.hasAttribute("data-balance-axis") ? "axis" : null)
    )).toEqual(["borrow", "axis", "cash", "investments"]);
    const summary = within(page().getByRole("region", { name: "Your money" }));
    const borrowRow = summary.getByRole("button", { description: "Open Borrow" });
    expect(borrowRow.textContent).toContain("Borrow Cash");
    expect(borrowRow.textContent).toContain("$30.01");
    expect(borrowRow.textContent).not.toContain("−");
    expect(borrowRow.textContent).toContain("5.10% APR");
    expect(summary.getByRole("button", { description: "Open Invest" }).textContent).toContain("Across 1 asset");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="borrow"]')?.style.flexGrow,
    ).toBe("249");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="investments"]')?.style.flexGrow,
    ).toBe("649");
  });

  test("does not re-present unchanged balances during navigation or account interactions", async () => {
    let presentationCalls = 0;
    const presentation: NonNullable<ComponentProps<typeof DashboardShell>["assetBalances"]> = {
      status: "ready",
      displayTotal: "$12.34",
      totalStatus: "complete",
      groups: [],
      breakdown: [{ id: "cash", label: "Cash", value: "$12.34", weight: 1_000 }],
      summary: null,
      rows: [],
      hiddenRows: [],
      hiddenCount: 0,
    };
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        presentAssetBalances={() => {
          presentationCalls += 1;
          return presentation;
        }}
      />,
    );
    await waitForVerifiedShell();
    await waitFor(() => expect(presentationCalls).toBeGreaterThan(0));
    presentationCalls = 0;

    const navigation = within(page().getByRole("navigation", { name: "Main navigation" }));
    fireEvent.click(navigation.getByRole("button", { name: "Invest" }));
    expect(page().getByRole("region", { name: "Invest module" })).toBeTruthy();
    fireEvent.click(navigation.getByRole("button", { name: "Home" }));
    expect(page().getByLabelText("Total balance")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Account" }));
    expect(await page().findByRole("combobox", { name: "Country" })).toBeTruthy();

    expect(presentationCalls).toBe(0);
  });

  test("keeps the total-balance hero quiet for a stale cached balance during background revalidation", async () => {
    const snapshot = {
      ...buildBalancesSnapshotFixture({
        fetchedAt: "2026-09-13T12:00:00.000Z",
        registry: {
          usdc: {
            balance: ready("12340000"),
            value: priced("USD", "1234"),
            cashValue: pricedCash("USD", "1234"),
          },
        },
      }),
      stale: true as const,
    };
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={presentBalances(
          { status: "ready", snapshot, error: null, revalidating: true },
          { showSmallBalances: false },
        )}
      />,
    );
    await waitForVerifiedShell();

    const hero = page().getByLabelText("Total balance");
    expect(hero.querySelector("[data-balance-breakdown]")).toBeTruthy();
    expect(hero.querySelector("[data-total-status]")).toBeNull();
    expect(document.querySelector("[data-home-status]")).toBeNull();
    expect(hero.textContent).not.toContain("Updated");
    expect(hero.textContent).not.toContain("ago");
    expect(hero.textContent).not.toContain("Updating…");
    expect(hero.getAttribute("aria-busy")).toBe("true");
  });

  test("preserves Balances offset across background value and topology refreshes", async () => {
    window.localStorage.setItem("home.country.v2", "US");
    const accountSdk = sdk({ isSignedIn: true, ownerKey: OWNER });
    const cashRow: BalanceRowModel = {
      key: "usdc",
      group: "cash",
      name: "US dollar",
      mark: { kind: "flag", currency: "USD" },
      primary: "$12.34",
      secondary: null,
      tone: "default",
    };
    const presentation: BalancesPresentation = {
      status: "ready",
      displayTotal: "$12.34",
      totalStatus: "complete",
      groups: [{
        id: "cash",
        label: "Cash",
        displaySubtotal: "$12.34",
        rows: [cashRow],
      }],
      breakdown: [{ id: "cash", label: "Cash", value: "$12.34", weight: 1_000 }],
      summary: null,
      rows: [cashRow],
      hiddenRows: [],
      hiddenCount: 0,
    };
    const view = render(
      <HomeHarness accountSdk={accountSdk} initialPanel="balances" assetBalances={presentation} />,
    );
    await waitForVerifiedShell();
    const main = page().getByRole("main");
    main.scrollTop = 275;

    view.rerender(
      <HomeHarness
        accountSdk={accountSdk}
        initialPanel="balances"
        assetBalances={{
          ...presentation,
          displayTotal: "$99.00",
          groups: [{
            ...presentation.groups[0]!,
            displaySubtotal: "$99.00",
            rows: [{ ...cashRow, name: "US Dollar", primary: "$99.00" }],
          }],
          rows: [{ ...cashRow, name: "US Dollar", primary: "$99.00" }],
        }}
      />,
    );
    await waitFor(() => expect(page().getAllByText("$99.00").length).toBeGreaterThan(0));
    expect(main.scrollTop).toBe(275);

    const investmentRow: BalanceRowModel = {
      ...cashRow,
      key: "eth",
      group: "asset",
      name: "Ethereum",
      primary: "$50.00",
    };
    view.rerender(
      <HomeHarness
        accountSdk={accountSdk}
        initialPanel="balances"
        assetBalances={{
          ...presentation,
          groups: [
            ...presentation.groups,
            {
              id: "investments",
              label: "Investments",
              displaySubtotal: "$50.00",
              rows: [investmentRow],
            },
          ],
          rows: [cashRow, investmentRow],
        }}
      />,
    );
    await page().findAllByText("Ethereum");
    expect(main.scrollTop).toBe(275);

    const dust = { ...cashRow, key: "dust", name: "Dust dollar", primary: "$0.01" };
    view.rerender(<HomeHarness accountSdk={accountSdk} initialPanel="balances"
      presentAssetBalances={(show) => ({
        ...presentation,
        groups: [{ ...presentation.groups[0]!, rows: show ? [cashRow, dust] : [cashRow] }],
        rows: show ? [cashRow, dust] : [cashRow],
        hiddenRows: show ? [] : [dust],
        hiddenCount: 1,
      })}
    />);
    fireEvent.click(page().getByRole("button", { name: "Show" }));
    await page().findAllByText("Dust dollar");
    expect(main.scrollTop).toBe(275);
    fireEvent.click(page().getByRole("button", { name: "Hide small balances" }));
    await waitFor(() => expect(page().queryByText("Dust dollar")).toBeNull());
    expect(main.scrollTop).toBe(275);
  });

  test("Your money shows three summary rows without See all or grouped currency rows", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    const summary = within(page().getByRole("region", { name: "Your money" }));
    expect(summary.getByRole("heading", { level: 2, name: "Your money" })).toBeTruthy();
    expect(summary.getAllByRole("listitem")).toHaveLength(3);
    expect(summary.queryByRole("button", { name: /See all|More Cash/ })).toBeNull();
    expect(summary.queryByText("US dollar")).toBeNull();
    expect(summary.getByRole("button", { description: "Open Invest" }).textContent).toContain("Start investing");
    expect(page().queryByRole("button", { name: "Open Save" })).toBeNull();

    fireEvent.click(summary.getByRole("button", { description: "Open Invest" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/invest");
    expect(page().getByRole("region", { name: "Invest module" })).toBeTruthy();
  });

  test("returns a kept-mounted Invest category to the hub on primary tab entry", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        investContent={<InvestExperience />}
      />,
    );
    await waitForVerifiedShell();
    const navigation = within(page().getByRole("navigation", { name: "Main navigation" }));
    fireEvent.click(navigation.getByRole("button", { name: "Invest" }));
    const cryptoShelf = page().getByRole("heading", { name: "Crypto", level: 3 }).closest("section")!;
    fireEvent.click(within(cryptoShelf).getByRole("button", { name: "See all ›" }));
    expect(window.location.pathname).toBe("/invest/crypto");
    expect(page().getByRole("heading", { level: 1, name: "Crypto" })).toBeTruthy();

    fireEvent.click(navigation.getByRole("button", { name: "Home" }));
    expect(window.location.pathname).toBe("/home");
    fireEvent.click(navigation.getByRole("button", { name: "Invest" }));
    expect(window.location.pathname).toBe("/invest");
    expect(await page().findByRole("heading", { level: 1, name: "Invest" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Back to Invest" })).toBeNull();
    expect(page().getByRole("heading", { name: "Crypto", level: 3 })).toBeTruthy();
  });

  test("returns a deep-linked Invest asset detail to the hub when the Invest tab is entered from Balances", async () => {
    syncLocation("/invest/nvdac");
    historyEntries = ["/balances", "/invest/nvdac"];
    historyStates = [{}, {}];
    historyCursor = 1;
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="invest"
        initialLocation={{ panel: "invest", account: null, shelf: null, asset: "nvdac", group: null, market: null }}
        investContent={<InvestExperience initialView={{ screen: "detail", assetId: "nvdac", from: "hub" }} />}
      />,
    );
    await waitForVerifiedShell();
    expect(page().getByRole("heading", { level: 1, name: "NVIDIA" })).toBeTruthy();
    act(() => popHistory());
    expect(window.location.pathname).toBe("/balances");
    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" }));
    expect(window.location.pathname).toBe("/invest");
    expect(await page().findByRole("heading", { level: 1, name: "Invest" })).toBeTruthy();
    expect(page().queryByRole("heading", { level: 1, name: "NVIDIA" })).toBeNull();
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
  });

  test("synchronizes Invest view with browser Back from a category", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        investContent={<InvestExperience />}
      />,
    );
    await waitForVerifiedShell();
    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" }));
    const cryptoShelf = page().getByRole("heading", { name: "Crypto", level: 3 }).closest("section")!;
    fireEvent.click(within(cryptoShelf).getByRole("button", { name: "See all ›" }));
    expect(window.location.pathname).toBe("/invest/crypto");
    act(() => popHistory());
    expect(window.location.pathname).toBe("/invest");
    expect(await page().findByRole("heading", { level: 1, name: "Invest" })).toBeTruthy();
  });

  test("keeps panel selection and browser history synchronized", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    fireEvent.click(page().getByRole("button", { description: "Open Cash" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/save");
    expect(page().getByRole("region", { name: "Savings module" })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/invest");
    expect(page().getByRole("region", { name: "Invest module" })).toBeTruthy();

    act(() => popHistory());
    expect(page().getByLabelText("Total balance")).toBeTruthy();
  });

  test("keeps Balances Back as forward app navigation", async () => {
    syncLocation("/balances");
    historyEntries = ["/balances"];
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} initialPanel="balances" />);
    await waitForVerifiedShell();

    const pushesBeforeBack = pushCalls.length;
    fireEvent.click(page().getByRole("button", { name: "Back" }));

    expect(`${window.location.pathname}${window.location.search}`).toBe("/home");
    expect(pushCalls).toHaveLength(pushesBeforeBack + 1);
    expect(pushCalls.at(-1)).toBe("/home");
    expect(page().getByLabelText("Total balance")).toBeTruthy();
  });

  test("restores the prior panel scroll position when returning from an L2", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    const main = page().getByRole("main");
    main.scrollTop = 320;
    fireEvent.scroll(main);
    fireEvent.click(page().getByRole("button", { description: "Open Cash" }));
    await waitFor(() => expect(main.scrollTop).toBe(0));

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(page().getByLabelText("Total balance")).toBeTruthy();
      expect(main.scrollTop).toBe(320);
    });
  });

  test("keeps Cash, Investments, and Borrow Cash reachable when balances cannot load", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" })}
      />,
    );
    await waitForVerifiedShell();

    expect(page().getByLabelText("Balance unavailable").textContent).toContain("—");
    const summary = within(page().getByRole("region", { name: "Your money" }));
    expect(summary.getAllByRole("listitem")).toHaveLength(3);
    const borrowRow = summary.getByRole("button", { description: "Open Borrow" });
    expect(borrowRow.textContent).toContain("—");
    expect(summary.getByRole("button", { name: "Retry Borrow balance" })).toBeTruthy();
    expect(document.querySelector("[role='alert']")).toBeNull();
    const header = page().getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: "Balances are unavailable" }));
    const detail = await waitFor(() => {
      const node = document.querySelector<HTMLElement>("[data-home-status-detail]");
      expect(node).toBeTruthy();
      return node!;
    });
    expect(detail.textContent).toContain("Balances are unavailable");
    expect(within(detail).getByRole("button", { name: "Retry" })).toBeTruthy();
    fireEvent.click(summary.getByRole("button", { description: "Open Borrow" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/borrow");
    await waitFor(() => expect(document.querySelector("[data-home-status]")).toBeNull());
  });

  test("offers balance row retries only when the header offers recovery", async () => {
    const unavailable = presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" });
    const onRetryInterruption = mock(() => {});
    const { rerender } = render(
      <HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} assetBalances={unavailable}
        interruption={{ kind: "offline" }} onRetryInterruption={onRetryInterruption} />,
    );
    await waitForVerifiedShell();
    const summary = () => within(page().getByRole("region", { name: "Your money" }));
    expect(summary().getByRole("button", { description: "Open Cash" }).textContent).toContain("—");
    expect(summary().queryByRole("button", { name: /^Retry .* balance$/ })).toBeNull();

    rerender(
      <HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} assetBalances={unavailable}
        interruption={{ kind: "interrupted" }} onRetryInterruption={onRetryInterruption} />,
    );
    fireEvent.click(await waitFor(() => summary().getByRole("button", { name: "Retry Cash balance" })));
    expect(onRetryInterruption).toHaveBeenCalledTimes(1);
  });

  test("keeps interruption status across Invest and nested chrome, hiding and restoring Home-only coverage", async () => {
    const accountSdk = sdk({ isSignedIn: true, ownerKey: OWNER });
    const country = presentBalances({
      status: "ready", snapshot: buildBalancesSnapshotFixture({ region: "GLOBAL" }), error: null,
    });
    const partial = presentBalances({
      status: "ready", snapshot: buildBalancesSnapshotFixture({
        registry: { eth: { balance: unavailableBalance, value: { status: "unavailable" } } },
      }), error: null,
    });
    const view = render(<HomeHarness accountSdk={accountSdk} assetBalances={country}
      investContent={<NestedInvestFixture />} interruption={{ kind: "offline" }} />);
    await waitForVerifiedShell();
    const offline = "You’re offline. Home will update when you reconnect.";
    expect(page().getByRole("button", { name: offline })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: offline }));
    const detail = await page().findByRole("dialog", { name: "Status" });
    expect(detail.textContent).toContain(offline);
    expect(within(detail).queryByRole("button")).toBeNull();
    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" }))
      .getByRole("button", { name: "Invest" }));
    expect(page().getByRole("button", { name: offline })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Open asset details" }));
    expect(page().getByRole("button", { name: offline })).toBeTruthy();
    const interrupted = "Home can’t refresh right now. Some information may be out of date.";
    view.rerender(<HomeHarness accountSdk={accountSdk} assetBalances={country}
      investContent={<NestedInvestFixture />} interruption={{ kind: "interrupted" }} />);
    expect(page().getByRole("button", { name: interrupted })).toBeTruthy();
    view.rerender(<HomeHarness accountSdk={accountSdk} assetBalances={country}
      investContent={<NestedInvestFixture />} interruption={null} />);
    expect(document.querySelector("[data-home-status]")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Back to Invest" }));
    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" }))
      .getByRole("button", { name: "Home" }));
    expect(page().getByRole("button", { name: "Choose a country in Account to set how money is shown" })).toBeTruthy();
    view.rerender(<HomeHarness accountSdk={accountSdk} assetBalances={partial}
      investContent={<NestedInvestFixture />} interruption={null} />);
    expect(document.querySelector("[data-home-status]")).toBeNull();
    view.rerender(<HomeHarness accountSdk={accountSdk} assetBalances={partial}
      investContent={<NestedInvestFixture />} interruption={{ kind: "interrupted" }} />);
    expect(page().getByRole("button", { name: interrupted })).toBeTruthy();
    view.rerender(<HomeHarness accountSdk={accountSdk} assetBalances={partial}
      investContent={<NestedInvestFixture />} interruption={null} />);
    expect(document.querySelector("[data-home-status]")).toBeNull();
  });

  test("opens Borrow from the Borrow Cash row without adding a bottom navigation item", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    const borrowRow = page().getByRole("button", { description: "Open Borrow" });
    expect(borrowRow.textContent).toContain("Borrow Cash");
    fireEvent.click(borrowRow);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/borrow");
    expect(await page().findByText("Borrowed")).toBeTruthy();
    expect(within(page().getByRole("navigation", { name: "Main navigation" })).queryByRole("button", { name: "Borrow" })).toBeNull();
  });

  test("renders a validated Borrow market deep link inside the existing main landmark", async () => {
    syncLocation(`/borrow/${BORROW_MARKET_ID}`);
    historyEntries = [`/borrow/${BORROW_MARKET_ID}`];
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialLocation={{
          panel: "borrow",
          account: null,
          shelf: null,
          asset: null,
          group: null,
          market: BORROW_MARKET_ID,
        }}
        applyInboundUrlIntent
      />,
    );

    await waitForVerifiedShell();
    expect(page().getAllByRole("main")).toHaveLength(1);
    expect(await page().findByText("Borrow USDC against your crypto on Base.")).toBeTruthy();
    expect(page().queryByText("Market and position")).toBeNull();
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/borrow/${BORROW_MARKET_ID}`);
  });

  test("prefers the server-selected location over the browser location", async () => {
    syncLocation("/borrow");
    historyEntries = ["/borrow"];
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="home"
        initialLocation={{
          panel: "activity",
          account: null,
          shelf: null,
          asset: null,
          group: null,
          market: null,
        }}
      />,
    );

    await waitForVerifiedShell();
    expect(page().getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(page().queryByText("Borrowed")).toBeNull();
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
    expect(replaceCalls).toEqual(["/home"]);
    expect(await page().findByRole("heading", { name: "Your money" })).toBeTruthy();
  });

  test("applies a verified inbound send intent once", async () => {
    syncLocation("/home?flow=send");
    historyEntries = ["/home?flow=send"];
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

  test("keeps an in-progress Add money open when the session verifies", async () => {
    const pendingSession = deferred<Response>();
    syncLocation("/home");
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={() => pendingSession.promise}
        applyInboundUrlIntent
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Add money" }));
    await page().findByRole("dialog", { name: "Add money" });

    await act(async () => {
      pendingSession.resolve(Response.json(session()));
      await pendingSession.promise;
    });
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Add money" })).toBeTruthy());

    expect(page().getAllByRole("dialog", { name: "Add money" })).toHaveLength(1);
    expectSheetOpen(page().getByRole("dialog", { name: "Add money" }));
    expect(window.location.search).toBe("?flow=add-money");
  });
});

// A closing Base UI drawer stays in the test DOM until its exit transition
// completes, which happy-dom never does, so presence alone cannot tell an open
// sheet from one on its way out. Base UI's documented open-state attribute can
// (see its animation handbook); the real-browser closure is covered by the
// Playwright smoke.
function expectSheetOpen(dialog: HTMLElement) {
  expect(dialog.hasAttribute("data-open")).toBe(true);
}

describe("walletless country preference read", () => {
  const location = { panel: "home" as const, account: null, shelf: null, asset: null, group: null, market: null };

  test("holds balances and funding methods until the account country read resolves", async () => {
    window.localStorage.setItem("home.country.v2", "MX");
    const read = deferred<Response>();
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      if (path === "/api/session") return Response.json(session());
      requests.push(path);
      if (path === "/api/account/country-preference") return read.promise;
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null} initialLocation={location} />
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toContain("/api/account/country-preference"));
    fireEvent.click(await waitForVerifiedShell());
    const country = await page().findByRole("combobox", { name: "Country" });
    expect(country.getAttribute("value")).not.toContain("Mexico");
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    fireEvent.click(page().getByRole("button", { name: "Add money" }));
    const dialog = await page().findByRole("dialog", { name: "Add money" });
    expect(within(dialog).getByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Deposit/ })).toBeNull();
    expect(within(dialog).queryByText(/No local deposit method/)).toBeNull();
    expect(requests.filter((path) => path.startsWith("/api/balances?") || path.startsWith("/api/funding/"))).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close add money" }));
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    const send = await page().findByRole("dialog", { name: "Send" });
    expect(within(send).getByRole("textbox", { name: "Amount" })).toBeTruthy();
    expect(requests.filter((path) => path.startsWith("/api/funding/providers") || path.startsWith("/api/funding/offramp/orders"))).toEqual([]);
    await act(async () => { read.resolve(Response.json({ version: 1, regionId: "DE" })); await read.promise; });
    await waitFor(() => expect(requests.some((path) => path === "/api/balances?region=DE")).toBe(true));
    await waitFor(() => expect(requests.some((path) => path.startsWith("/api/funding/providers?region=DE"))).toBe(true));
    expect(requests.some((path) => path.startsWith("/api/balances?region=MX") || path.startsWith("/api/balances?region=BR") || path.startsWith("/api/funding/providers?region=MX") || path.startsWith("/api/funding/providers?region=BR"))).toBe(false);
  });

  test("does not paint cached detected-country balances before the saved-country read resolves", async () => {
    const read = deferred<Response>();
    const cached = buildBalancesSnapshotFixture({
      region: "BR",
      registry: { usdc: { balance: ready("1000000"), value: priced("BRL", "123456"), cashValue: pricedCash("USD", "100") } },
    });
    const saved = buildBalancesSnapshotFixture({
      region: "DE",
      registry: { usdc: { balance: ready("1000000"), value: priced("EUR", "7890"), cashValue: pricedCash("USD", "100") } },
    });
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(session()), "balances", "BR"), cached);
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      if (path === "/api/session") return Response.json(session());
      requests.push(path);
      if (path === "/api/account/country-preference") return read.promise;
      if (path === "/api/balances?region=DE") return Response.json(saved);
      throw new Error(`Unexpected read: ${path}`);
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null} initialLocation={location} />
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toContain("/api/account/country-preference"));
    await waitForVerifiedShell();
    expect(document.body.textContent).not.toContain("1.234,56");
    expect(document.body.textContent).not.toContain("78,90");
    expect(requests).not.toContain("/api/balances?region=BR");
    await act(async () => { read.resolve(Response.json({ version: 1, regionId: "DE" })); await read.promise; });
    await waitFor(() => expect(requests).toContain("/api/balances?region=DE"));
    await waitFor(() => expect(document.body.textContent).toContain("78,90"));
    expect(document.body.textContent).not.toContain("1.234,56");
  });

  for (const panel of ["home", "activity"] as const) {
    test(`holds ${panel === "home" ? "the Home feed" : "/activity"} until the account country read resolves`, async () => {
      const read = deferred<Response>();
      const activityCurrencies: (string | null)[] = [];
      const sessionFetch: SessionFetch = async (input) => {
        const path = String(input);
        if (path === "/api/session") return Response.json(session());
        if (path === "/api/account/country-preference") return read.promise;
        if (path.startsWith("/api/activity?")) {
          const query = new URLSearchParams(path.split("?")[1]);
          activityCurrencies.push(query.get("currency"));
          const to = query.get("to")!;
          return Response.json({
            version: 1,
            walletAddress: ADDRESS,
            chainId: 8453,
            window: { from: new Date(new Date(to).getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(), to },
            currency: query.get("currency"),
            transfers: [],
            nextCursor: null,
            source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
          });
        }
        if (path === "/api/actions") return Response.json({ version: "1", actions: [] });
        return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
      };
      render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
        <PortfolioHomeExperience detectedCountry="BR" accountPreference={null} initialLocation={{ ...location, panel }} />
      </AccountWalletSessionOwner>);
      await waitForVerifiedShell();
      expect(page().getAllByRole("region", { name: "Activity", busy: true }).length).toBeGreaterThan(0);
      expect(page().queryByText("No activity yet")).toBeNull();
      expect(activityCurrencies).toEqual([]);
      await act(async () => { read.resolve(Response.json({ version: 1, regionId: "DE" })); await read.promise; });
      await waitFor(() => expect(page().getAllByText("No activity yet").length).toBeGreaterThan(0));
      expect(activityCurrencies).toEqual(["EUR"]);
    });
  }

  test("retries an unreadable country response and applies the account value", async () => {
    const first = deferred<Response>();
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      if (path === "/api/session") return Response.json({ ...session(), smartAccount: null });
      if (path === "/api/account/country-preference") {
        requests.push(path);
        return requests.length === 1 ? first.promise : Response.json({ version: 1, regionId: "DE" });
      }
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null} initialLocation={location} />
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toHaveLength(1));
    jest.useFakeTimers();
    await act(async () => { first.resolve(Response.json({ version: 2, regionId: "BR" })); await first.promise; });
    expect(requests).toHaveLength(1);
    await act(async () => { jest.advanceTimersByTime(500); });
    await waitFor(() => expect(requests).toHaveLength(2));
    fireEvent.click(await waitForVerifiedShell());
    expect((await page().findByRole("combobox", { name: "Country" })).getAttribute("value")).toContain("Germany");
  });

  test("settles to the browser only after all three read attempts fail", async () => {
    window.localStorage.setItem("home.country.v2", "MX");
    const first = deferred<Response>();
    const requests: Array<{ path: string; method: string }> = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/session") return Response.json({ ...session(), smartAccount: null });
      if (path === "/api/account/country-preference") {
        requests.push({ path, method });
        if (method === "PUT") return Response.json({ version: 1, regionId: "MX" });
        return requests.length === 1 ? first.promise : Response.json({ version: 2, regionId: "MX" });
      }
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null} initialLocation={location} />
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toHaveLength(1));
    jest.useFakeTimers();
    fireEvent.click(await waitForVerifiedShell());
    const country = await page().findByRole("combobox", { name: "Country" });
    await act(async () => { first.resolve(Response.json({ version: 2, regionId: "MX" })); await first.promise; });
    expect(country.getAttribute("value")).not.toContain("Mexico");
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(2);
    expect(country.getAttribute("value")).not.toContain("Mexico");
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(3);
    await waitFor(() => expect(country.getAttribute("value")).toContain("Mexico"));
    await waitFor(() => expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1));
  });

  test("a null server seed settles the read without a client GET", async () => {
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      if (path === "/api/session") return Response.json({ ...session(), smartAccount: null });
      requests.push(path);
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={{ accountProvider: "cdp-embedded", subject: "subject-home", regionId: null }} initialLocation={location} />
    </AccountWalletSessionOwner>);
    fireEvent.click(await waitForVerifiedShell());
    expect((await page().findByRole("combobox", { name: "Country" })).getAttribute("value")).toContain("Brazil");
    expect(requests).not.toContain("/api/account/country-preference");
  });
  test("waits for the account read before adopting v2 and resolves the saved country", async () => {
    window.localStorage.setItem("home.country.v2", "MX");
    const read = deferred<Response>();
    const requests: Array<{ path: string; method: string }> = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/session") return Response.json({ ...session(), smartAccount: null });
      if (path === "/api/account/country-preference") {
        requests.push({ path, method });
        if (method === "GET") return read.promise;
      }
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}
        initialLocation={{ panel: "home", account: null, shelf: null, asset: null, group: null, market: null }} />
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toEqual([{ path: "/api/account/country-preference", method: "GET" }]));
    fireEvent.click(await waitForVerifiedShell());
    const country = await page().findByRole("combobox", { name: "Country" });
    expect(country.getAttribute("value")).not.toContain("Mexico");
    await act(async () => { read.resolve(Response.json({ version: 1, regionId: "DE" })); await read.promise; });
    await waitFor(() => expect(country.getAttribute("value")).toContain("Germany"));
    expect(requests).toEqual([{ path: "/api/account/country-preference", method: "GET" }]);
  });

  test("a server-rendered preference applies only to the account it was read for", async () => {
    const requests: string[] = [];
    const fetchFor = (subject: string, address: `0x${string}`): SessionFetch => async (input, init) => {
      const path = String(input);
      if (path === "/api/session") return Response.json(session(address, subject));
      if (path === "/api/account/country-preference" && (init?.method ?? "GET") === "GET") {
        requests.push(subject);
        return Response.json({ version: 1, regionId: "GB" });
      }
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    const location = { panel: "home" as const, account: null, shelf: null, asset: null, group: null, market: null };
    const seed = { accountProvider: "cdp-embedded" as const, subject: "subject-home", regionId: "DE" as const };
    const view = render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={fetchFor("subject-home", ADDRESS)}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={seed} initialLocation={location} />
    </AccountWalletSessionOwner>);
    fireEvent.click(await waitForVerifiedShell());
    const country = await page().findByRole("combobox", { name: "Country" });
    expect(country.getAttribute("value")).toContain("Germany");
    expect(requests).toEqual([]);
    view.rerender(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER_B })} sessionFetch={fetchFor("subject-home-b", ADDRESS_B)}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={seed} initialLocation={location} />
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toEqual(["subject-home-b"]));
    await waitFor(async () => expect((await page().findByRole("combobox", { name: "Country" })).getAttribute("value")).toContain("United Kingdom"));
  });

  test("a server-rendered preference is not reused after its account signs out", async () => {
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      const path = String(input);
      if (path === "/api/session") return Response.json(session());
      if (path === "/api/account/country-preference" && (init?.method ?? "GET") === "GET") {
        requests.push(path);
        return Response.json({ version: 1, regionId: "GB" });
      }
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    const location = { panel: "home" as const, account: null, shelf: null, asset: null, group: null, market: null };
    const seed = { accountProvider: "cdp-embedded" as const, subject: "subject-home", regionId: "DE" as const };
    const shell = (signedIn: boolean) => (
      <AccountWalletSessionOwner sdk={sdk(signedIn ? { isSignedIn: true, ownerKey: OWNER } : {})} sessionFetch={sessionFetch}>
        <PortfolioHomeExperience detectedCountry="BR" accountPreference={seed} initialLocation={location} />
      </AccountWalletSessionOwner>
    );
    const view = render(shell(true));
    await waitForVerifiedShell();
    expect(requests).toEqual([]);
    view.rerender(shell(false));
    await waitFor(() => expect(page().queryByRole("button", { name: "Account" })).toBeNull());
    view.rerender(shell(true));
    await waitFor(() => expect(requests).toEqual(["/api/account/country-preference"]));
  });

  test("holds a walletless explicit choice until the account read settles", async () => {
    const read = deferred<Response>();
    const writes: unknown[] = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      if (String(input) === "/api/session") return Response.json({ ...session(), smartAccount: null });
      if (String(input) === "/api/account/country-preference") {
        if (init?.method === "GET") return read.promise;
        writes.push(JSON.parse(String(init?.body)));
        return Response.json({ version: 1, regionId: "GB" });
      }
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}
        initialLocation={{ panel: "home", account: null, shelf: null, asset: null, group: null, market: null }} />
    </AccountWalletSessionOwner>);
    fireEvent.click(await waitForVerifiedShell());
    const country = await page().findByRole("combobox", { name: "Country" });
    fireEvent.click(country.parentElement!.querySelector("button")!);
    fireEvent.click(await page().findByRole("option", { name: "United Kingdom" }));
    expect(writes).toEqual([]);
    await act(async () => { read.resolve(Response.json({ version: 1, regionId: "DE" })); await read.promise; });
    await waitFor(() => expect(writes).toEqual([{ version: 1, regionId: "GB", adopt: false }]));
    expect(country.getAttribute("value")).toContain("United Kingdom");
  });
});

describe("Balances scope scroll interleavings (#485)", () => {
  test("signed-in account preference never flips after first paint", async () => {
    window.localStorage.setItem("home.country.v2", "MX");
    const frames = controlAnimationFrames();
    const observedRegions: HomeRegionState["regionId"][] = [];
    const onRegionObserved = (regionId: HomeRegionState["regionId"]) => {
      if (observedRegions.at(-1) !== regionId) observedRegions.push(regionId);
    };
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      detectedCountry="BR" accountPreference="DE" initialPanel="balances" onRegionObserved={onRegionObserved} />);
    expect(observedRegions).toEqual(["DE"]);
    act(() => frames.flush());
    await waitForVerifiedShell();
    expect(observedRegions).toEqual(["DE"]);
  });

  const balancesLocation = { panel: "balances" as const, account: null, shelf: null, asset: null, group: null, market: null };
  test("persisted region hydrates once without resetting the balances scroll scope", async () => {
    window.localStorage.setItem("home.country.v2", "GB");
    const frames = controlAnimationFrames();
    const accountSdk = sdk({ isSignedIn: true, ownerKey: OWNER });
    const observedRegions: HomeRegionState["regionId"][] = [];
    const onRegionObserved = (regionId: HomeRegionState["regionId"]) => {
      if (observedRegions.at(-1) !== regionId) observedRegions.push(regionId);
    };
    const view = render(<HomeHarness accountSdk={accountSdk} initialPanel="balances" onRegionObserved={onRegionObserved} />);
    const main = page().getByRole("main");
    main.scrollTop = 260;
    expect(observedRegions).toEqual(["US"]);
    act(() => frames.flush());
    await waitForVerifiedShell();
    expect(observedRegions).toEqual(["US", "GB"]);
    expect(main.scrollTop).toBe(260);

    view.rerender(<HomeHarness accountSdk={accountSdk} initialPanel="balances" onRegionObserved={onRegionObserved} />);
    act(() => frames.flush());
    expect(observedRegions).toEqual(["US", "GB"]);
    expect(main.scrollTop).toBe(260);
  });
  for (const mode of ["Account", "asset", "history"] as const) {
    test(`scope change cancels the queued ${mode} restore`, async () => {
      window.localStorage.setItem("home.country.v2", "US");
      const startsInBalances = mode !== "history";
      syncLocation(startsInBalances ? "/balances" : "/home");
      historyEntries = [window.location.pathname];
      const pending = deferred<Response>();
      const view = render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel={startsInBalances ? "balances" : "home"}
        initialLocation={startsInBalances ? balancesLocation : undefined}
        investContent={<NestedInvestFixture balancesReturn />}
      />);
      await waitForVerifiedShell();
      const frames = controlAnimationFrames();
      const main = page().getByRole("main");
      main.scrollTop = 280;
      if (mode === "Account") {
        fireEvent.click(page().getByRole("button", { name: "Account" }));
        await page().findByRole("combobox", { name: "Country" });
        fireEvent.click(page().getByRole("button", { name: "Done" }));
      } else {
        if (mode === "history") {
          fireEvent.scroll(main);
          act(() => frames.flush());
        }
        fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" }));
        if (mode === "asset") {
          fireEvent.click(page().getByRole("button", { name: "Open asset details" }));
          fireEvent.click(page().getByRole("button", { name: "Back" }));
        }
        act(() => popHistory());
      }
      await waitFor(() => expect(main.scrollTop).toBe(280));
      expect(frames.pending()).toBeGreaterThan(0);
      view.rerender(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER_B })}
        sessionFetch={() => pending.promise}
        initialPanel={startsInBalances ? "balances" : "home"}
        initialLocation={startsInBalances ? balancesLocation : undefined}
        investContent={<NestedInvestFixture balancesReturn />}
      />);
      await act(async () => {
        pending.resolve(Response.json(session(ADDRESS_B, "subject-home-b"))); await pending.promise;
      });
      await waitForVerifiedShell();
      await waitFor(() => expect(main.scrollTop).toBe(0));
      act(() => frames.flush());
      expect(main.scrollTop).toBe(0);
    });
  }
  test("readiness, explicit scope, sign-out, and new baseline stay ordered", async () => {
    window.localStorage.setItem("home.country.v2", "GB");
    const frames = controlAnimationFrames();
    const accountSdk = sdk({ isSignedIn: true, ownerKey: OWNER });
    const view = render(<HomeHarness accountSdk={accountSdk} initialPanel="balances" />);
    const main = page().getByRole("main");
    main.scrollTop = 260;
    act(() => frames.flush());
    await waitForVerifiedShell();
    expect(main.scrollTop).toBe(260);
    view.rerender(<HomeHarness accountSdk={accountSdk} initialPanel="balances" regionOverride={{ regionId: "US" }} />);
    await waitFor(() => expect(main.scrollTop).toBe(0));
    view.rerender(<HomeHarness accountSdk={sdk()} initialPanel="balances" />);
    await page().findByLabelText("Signed out");
    main.scrollTop = 190;
    view.rerender(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER_B })} sessionFetch={async () => Response.json(session(ADDRESS_B, "subject-home-b"))} initialPanel="balances" />);
    await waitForVerifiedShell();
    expect(main.scrollTop).toBe(190);
  });
  test("cold canonical A to B cancels the old group RAF, re-anchors once, and consumes", async () => {
    window.localStorage.setItem("home.country.v2", "US");
    syncLocation("/balances/cash"); historyEntries = ["/balances/cash"];
    const pending = deferred<Response>(); const coldLocation = { ...balancesLocation, group: "cash" as const };
    const view = render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} initialPanel="balances" initialLocation={coldLocation} />);
    await waitForVerifiedShell();
    const frames = controlAnimationFrames();
    const main = page().getByRole("main");
    let anchors = 0;
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => { anchors += 1; main.scrollTop = 440; };
    try {
      fireEvent.click(page().getByRole("button", { name: "Back" })); act(() => popHistory());
      expect(frames.pending()).toBeGreaterThan(0);
      view.rerender(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER_B })} sessionFetch={() => pending.promise} />);
      await act(async () => {
        pending.resolve(Response.json(session(ADDRESS_B, "subject-home-b"))); await pending.promise;
      });
      await waitForVerifiedShell();
      await waitFor(() => expect(anchors).toBe(1));
      act(() => frames.flush());
      expect(anchors).toBe(1);
      expect(main.scrollTop).toBe(440);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

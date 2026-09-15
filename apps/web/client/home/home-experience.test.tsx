import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { useState, type ComponentProps } from "react";
import type { AccountWalletSdkBoundary } from "@/client/account/cdp-client";
import type { SessionFetch, VerifiedAccountSession } from "@/client/account/session-client";
import { BORROW_MARKET_ID } from "@/shared/borrowing/config";
import type { BalanceRowModel, BalancesPresentation } from "@/shared/balances/present";

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
const { useNestedAppChrome } = await import("@/components/app-chrome");
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
  assetBalances,
  investContent = <section aria-label="Invest module">Invest fixture</section>,
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

    const landingHeader = document.querySelector<HTMLElement>('[data-shell-header-frame="landing"]');
    expect(landingHeader?.className).not.toContain("max-w-2xl");
    expect(landingHeader?.className).toContain("lg:px-8");

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
  test("keeps the dashboard header constrained while only the landing header is full width", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    const dashboardHeader = document.querySelector<HTMLElement>('[data-shell-header-frame="dashboard"]');
    expect(dashboardHeader?.className).toContain("max-w-2xl");
    expect(dashboardHeader?.className).not.toContain("lg:px-8");
  });

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
    let titleClassName: string | null = null;

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
      titleClassName ??= title.className;
      expect(title.className).toBe(titleClassName);

      cleanup();
      getHomeQueryClient().clear();
      resetHistory();
    }
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

  test("renders the total as a proportional cash, savings, and investments bar", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$33,231.30",
          totalStatus: "complete",
          groups: [],
          breakdown: [
            { id: "cash", label: "Cash", value: "$4,468.73", weight: 155 },
            { id: "saved", label: "Savings", value: "$25.95", weight: 1 },
            { id: "investments", label: "Investments", value: "$28,736.62", weight: 1_000 },
          ],
          rows: [],
          hiddenRows: [],
          hiddenCount: 0,
        }}
      />,
    );
    await waitForVerifiedShell();

    const breakdown = document.querySelector<HTMLElement>("[data-balance-breakdown]");
    expect(breakdown).not.toBeNull();
    const labels = ["Cash", "Savings", "Investments"].map((label) =>
      within(breakdown!).getByText(label),
    );
    expect(labels[0]!.compareDocumentPosition(labels[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(labels[1]!.compareDocumentPosition(labels[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="cash"]')?.style.flexGrow,
    ).toBe("155");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="saved"]')?.style.flexGrow,
    ).toBe("1");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="investments"]')?.style.flexGrow,
    ).toBe("1000");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="cash"]')?.style.backgroundColor,
    ).toBe("#0aa852");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="saved"]')?.style.backgroundColor,
    ).toBe("#0c84fa");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="investments"]')?.style.backgroundColor,
    ).toBe("#a064db");
  });

  test("does not re-present unchanged balances during navigation or account interactions", async () => {
    let presentationCalls = 0;
    const presentation: NonNullable<ComponentProps<typeof HomeExperience>["assetBalances"]> = {
      status: "ready",
      displayTotal: "$12.34",
      totalStatus: "complete",
      groups: [],
      breakdown: [{ id: "cash", label: "Cash", value: "$12.34", weight: 1_000 }],
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

  test("preserves Balances offset across background value and topology refreshes", async () => {
    window.localStorage.setItem("home.country.v1", "US");
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

  test("a group's More row opens the panel anchored to that group; absent groups show no row", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    // The harness wallet holds only cash: no Investments header or More row leading nowhere.
    expect(page().queryByRole("button", { name: "More Investments" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "More Cash" }));

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/balances/cash",
    );
    expect(page().getByRole("heading", { name: "Your money" })).toBeTruthy();
  });

  test("keeps panel selection and browser history synchronized", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    fireEvent.click(page().getByRole("button", { name: "Your money" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/balances");
    expect(page().getByRole("heading", { name: "Your money" })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/invest");
    expect(page().getByRole("region", { name: "Invest module" })).toBeTruthy();

    act(() => popHistory());
    expect(page().getByRole("heading", { name: "Your money" })).toBeTruthy();
  });

  test("keeps Balances Back as forward app navigation", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    fireEvent.click(page().getByRole("button", { name: "Your money" }));
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
    fireEvent.click(page().getByRole("button", { name: "Open Save" }));
    await waitFor(() => expect(main.scrollTop).toBe(0));

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(page().getByLabelText("Total balance")).toBeTruthy();
      expect(main.scrollTop).toBe(320);
    });
  });

  test("opens Borrow from the Home card without adding a bottom navigation item", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    const saveTeaser = page().getByRole("button", { name: "Open Save" });
    expect(saveTeaser.textContent).toContain("Earn");
    expect(saveTeaser.closest("section")?.parentElement?.className).toContain("grid-cols-2");

    const borrowTeaser = page().getByRole("button", { name: "Open Borrow" });
    expect(borrowTeaser.className).toContain("whitespace-normal");
    expect(borrowTeaser.querySelector(".lucide-bitcoin")).toBeTruthy();
    fireEvent.click(borrowTeaser);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/borrow");
    expect(await page().findByText("Borrow USDC using your Bitcoin on Base.")).toBeTruthy();
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
    expect(await page().findByText("Borrow USDC using your Bitcoin on Base.")).toBeTruthy();
    expect(page().queryByText("Market and position")).toBeNull();
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/borrow/${BORROW_MARKET_ID}`);
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
});

describe("Balances scope scroll interleavings (#485)", () => {
  const balancesLocation = { panel: "balances" as const, account: null, shelf: null, asset: null, group: null, market: null };
  for (const mode of ["Account", "asset", "history"] as const) {
    test(`scope change cancels the queued ${mode} restore`, async () => {
      window.localStorage.setItem("home.country.v1", "US");
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
    window.localStorage.setItem("home.country.v1", "GB");
    const frames = controlAnimationFrames();
    const accountSdk = sdk({ isSignedIn: true, ownerKey: OWNER });
    const view = render(<HomeHarness accountSdk={accountSdk} initialPanel="balances" />);
    const main = page().getByRole("main");
    main.scrollTop = 260;
    act(() => frames.flush());
    await waitForVerifiedShell();
    expect(main.scrollTop).toBe(260);
    view.rerender(<HomeHarness accountSdk={accountSdk} initialPanel="balances" selectedRegionId="US" />);
    await waitFor(() => expect(main.scrollTop).toBe(0));
    view.rerender(<HomeHarness accountSdk={sdk()} initialPanel="balances" />);
    await page().findByLabelText("Signed out");
    main.scrollTop = 190;
    view.rerender(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER_B })} sessionFetch={async () => Response.json(session(ADDRESS_B, "subject-home-b"))} initialPanel="balances" />);
    await waitForVerifiedShell();
    expect(main.scrollTop).toBe(190);
  });
  test("cold canonical A to B cancels the old group RAF, re-anchors once, and consumes", async () => {
    window.localStorage.setItem("home.country.v1", "US");
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
      fireEvent.click(page().getByRole("button", { name: "Back" })); fireEvent.click(page().getByRole("button", { name: "More Cash" }));
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
import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AccountWalletSdkBoundary } from "@/client/account/cdp-client";
import type { SessionFetch, VerifiedAccountSession } from "@/client/account/session-client";
import { BASE_CHAIN_ID } from "@/client/account/session-client";

const replaceCalls: string[] = [];
const pushCalls: string[] = [];
let historyEntries = ["/"];
let historyStates: unknown[] = [{}];
let historyCursor = 0;
const nativeReplaceState = window.history.replaceState.bind(window.history);

function syncLocation(href: string, state: unknown = historyStates[historyCursor]) {
  nativeReplaceState(state, "", href);
}

Object.defineProperties(window.history, {
  pushState: {
    configurable: true,
    value: (state: unknown, _unused: string, href?: string | URL | null) => {
      if (href === undefined || href === null) return;
      pushCalls.push(String(href));
      historyEntries = historyEntries.slice(0, historyCursor + 1);
      historyStates = historyStates.slice(0, historyCursor + 1);
      historyEntries.push(String(href));
      historyStates.push(state);
      historyCursor = historyEntries.length - 1;
      syncLocation(String(href), state);
    },
  },
  replaceState: {
    configurable: true,
    value: (state: unknown, _unused: string, href?: string | URL | null) => {
      if (href === undefined || href === null) {
        historyStates[historyCursor] = state;
        nativeReplaceState(state, "");
        return;
      }
      replaceCalls.push(String(href));
      historyEntries[historyCursor] = String(href);
      historyStates[historyCursor] = state;
      syncLocation(String(href), state);
    },
  },
});

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => {
      replaceCalls.push(href);
      historyEntries[historyCursor] = href;
      syncLocation(href);
    },
    push: (href: string) => pushCalls.push(href),
    back: () => {},
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { cleanup, render } = await import("@testing-library/react");
const { AccountWalletSessionOwner } = await import("@/client/account/cdp-session-lifecycle");
const { DashboardExperience } = await import("./dashboard-experience");

const OWNER = "dashboard-user";
const ADDRESS = "0x1111111111111111111111111111111111111111";

function sdk(): AccountWalletSdkBoundary {
  return {
    isInitialized: true,
    isSignedIn: true,
    ownerKey: OWNER,
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
  };
}

const defaultSessionFetch: SessionFetch = async () => Response.json({
  user: { subject: "subject-dashboard" },
  smartAccount: { address: ADDRESS, chainId: BASE_CHAIN_ID },
  accountProvider: "cdp-embedded",
} satisfies VerifiedAccountSession);

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

function resetHistory(href = "/dashboard") {
  replaceCalls.length = 0;
  pushCalls.length = 0;
  historyEntries = [href];
  historyStates = [{}];
  historyCursor = 0;
  syncLocation(href);
}

/** The one panel shell section that is painted (not hidden, not inert). */
function visiblePanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>("[data-shell-panel]:not([hidden])");
  expect(panel).not.toBeNull();
  return panel!;
}

function visiblePanelSection(label: string): HTMLElement {
  const section = visiblePanel().querySelector<HTMLElement>(`section[aria-label="${label}"]`);
  expect(section).not.toBeNull();
  return section!;
}

function renderDashboard(initialSearch?: string) {
  return render(
    <AccountWalletSessionOwner sdk={sdk()} sessionFetch={defaultSessionFetch}>
      <DashboardExperience initialSearch={initialSearch} />
    </AccountWalletSessionOwner>,
  );
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetHistory();
});

describe("DashboardExperience direct routes (#460)", () => {
  test("every valid L1 panel paints on the first render from initialSearch alone", () => {
    const cases = [
      { search: undefined, verify: () => expect(visiblePanel().textContent).toContain("Total balance") },
      { search: "panel=invest", verify: () => visiblePanelSection("Invest") },
      { search: "panel=balances", verify: () => visiblePanelSection("Your money") },
      { search: "panel=activity", verify: () => visiblePanelSection("Activity") },
      { search: "panel=save", verify: () => {
        // The savings screen swaps its hero while loading; the shell header title
        // is the stable synchronous marker for the nested Save panel.
        expect(document.querySelector("[data-shell-header-title]")?.textContent).toBe("Save");
      } },
      { search: "panel=borrow", verify: () => {
        expect(visiblePanel().querySelector("#borrow-overview-title, #borrow-direct-title")).not.toBeNull();
      } },
    ];

    for (const shellCase of cases) {
      resetHistory("/dashboard");
      renderDashboard(shellCase.search);
      // Synchronous first render, before any session or URL effects run.
      try {
        shellCase.verify();
      } catch (error) {
        throw new Error(`case ${shellCase.search}: ${String(error)}`);
      }
      if (shellCase.search) {
        const homePanel = document.querySelector<HTMLElement>("[data-shell-panel]");
        expect(homePanel?.hasAttribute("hidden")).toBe(true);
      }
      cleanup();
      getHomeQueryClient().clear();
    }
  });

  test("valid Invest category and detail URLs paint their L2 on the first render", () => {
    const cases = [
      { search: "panel=invest&shelf=stocks", section: "Stocks" },
      { search: "panel=invest&shelf=crypto", section: "Crypto" },
      { search: "panel=invest&shelf=stocks&asset=nvdac", section: "NVIDIA" },
      { search: "panel=invest&asset=nvdac", section: "NVIDIA" },
    ];

    for (const shellCase of cases) {
      resetHistory("/dashboard");
      renderDashboard(shellCase.search);
      visiblePanelSection(shellCase.section);
      cleanup();
      getHomeQueryClient().clear();
    }
  });

  test("invalid panel, shelf, and asset values keep the existing fallbacks", () => {
    const cases = [
      { search: "panel=not-a-panel", section: null, fallback: "Total balance" },
      { search: "panel=invest&shelf=forex", section: "Invest", fallback: null },
      { search: "panel=invest&asset=not-an-asset", section: "Invest", fallback: null },
      { search: "panel=invest&shelf=forex&asset=not-an-asset", section: "Invest", fallback: null },
    ];

    for (const shellCase of cases) {
      resetHistory("/dashboard");
      renderDashboard(shellCase.search);
      const panel = visiblePanel();
      if (shellCase.section) visiblePanelSection(shellCase.section);
      if (shellCase.fallback) expect(panel.textContent).toContain(shellCase.fallback);
      cleanup();
      getHomeQueryClient().clear();
    }
  });

  test("initialSearch wins over window.location so hydration matches the server", () => {
    // A stale client URL must not override the server-supplied query: the server
    // rendered from initialSearch, so the first client render must too (#460).
    resetHistory("/dashboard?panel=invest&shelf=stocks");
    renderDashboard("panel=balances");
    visiblePanelSection("Your money");
    expect(visiblePanel().querySelector('section[aria-label="Stocks"]')).toBeNull();
  });

  test("reapplying the verified initial intent does not refocus the panel stage or scroll", async () => {
    const { waitFor } = await import("@testing-library/react");
    resetHistory("/dashboard?panel=balances");
    render(<AccountWalletSessionOwner sdk={sdk()} sessionFetch={defaultSessionFetch}>
      <DashboardExperience initialSearch="panel=balances" />
    </AccountWalletSessionOwner>);

    visiblePanelSection("Your money");
    expect(document.activeElement?.id).not.toBe("navigation-panel");

    // The verified-session inbound-intent effect still runs for account overlays;
    // with the server-selected panel already painted it must not act like a
    // navigation (no stage focus, no scroll reset, no history writes).
    await waitFor(() => {
      const accountButton = page().getByRole("button", { name: "Account" });
      expect(accountButton.hasAttribute("disabled")).toBe(false);
    });
    expect(document.activeElement?.id).not.toBe("navigation-panel");
    expect(document.querySelector<HTMLElement>(".app-main-authenticated")?.scrollTop ?? 0).toBe(0);
    expect(pushCalls).toEqual([]);
  });
});

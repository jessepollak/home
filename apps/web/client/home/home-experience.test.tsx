import "@/client/account/dom-test-harness";

import { getHomeQueryClient, ownerQueryKey, useHomeQuery } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { afterEach, beforeEach, describe, expect, jest, mock, setSystemTime, spyOn, test } from "bun:test";
import * as homePerformance from "@/client/observability/perf-marks";
import { useState, useSyncExternalStore, type ComponentProps } from "react";
import type { HomeRegionState } from "./use-home-region";
import type { AccountWalletSdkBoundary } from "@/client/account/cdp-client";
import type { SessionFetch, VerifiedAccountSession } from "@/client/account/session-client";
import { DEFAULT_BORROW_MARKET } from "@/shared/borrowing/config";
import { erc20AssetKey, nativeAssetKey, type AssetKey } from "@/shared/balances/types";
import { selectOwnedInvestment } from "@/shared/balances/owned-investments";
import { BASE_CBBTC, BASE_USDC } from "@/shared/assets/base";
import { parseActivityPage } from "@/shared/activity/contract";
import type { InvestmentsContentProps } from "./home-types";
import { BASE_USDC_ADDRESS } from "@/shared/savings/config";
import { ProductOfferingProvider } from "./product-offering";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import { savingsVaultsBody } from "@/tests/browser/fixtures/bodies";
import { readClientHistoryFlag } from "@/config/shell-location";

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
} from "@/shared/balances/present";

const replaceCalls: string[] = [];
const pushCalls: string[] = [];
let historyEntries = ["/"];
let historyStates: unknown[] = [{}];
let historyCursor = 0;
const nativeReplaceState = window.history.replaceState.bind(window.history);
const nativeFetch = globalThis.fetch;

function syncLocation(href: string, state: unknown = historyStates[historyCursor]) {
  nativeReplaceState(state, "", href);
  window.dispatchEvent(new Event("test-route"));
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

function forwardHistory() {
  if (historyCursor < historyEntries.length - 1) {
    historyCursor += 1;
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
  forward: { configurable: true, value: forwardHistory },
});

const actualNavigation = await import("next/navigation");
const router = {
  replace: (href: string) => replaceHistory(href),
  push: (href: string) => pushHistory(href),
  prefetch: () => Promise.resolve(),
  back: popHistory,
};
const subscribeTestRoute = (listener: () => void) => { window.addEventListener("test-route", listener); return () => window.removeEventListener("test-route", listener); };
const useTestPathname = () => useSyncExternalStore(subscribeTestRoute, () => window.location.pathname, () => "/home");
const useTestSearch = () => useSyncExternalStore(subscribeTestRoute, () => window.location.search, () => "");
await mock.module("next/navigation", () => ({
  ...actualNavigation,
  useRouter: () => router,
  usePathname: useTestPathname,
  useSearchParams: () => new URLSearchParams(useTestSearch()),
}));

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { CdpAccountProvider, AccountWalletContext, createBlockedAccountWalletClient } = await import("@/client/account/cdp-client");
const { AccountWalletSessionOwner } = await import("@/client/account/cdp-session-lifecycle");
const { BASE_CHAIN_ID } = await import("@/client/account/session-client");
const { useNestedAppChrome } = await import("@/components/app-chrome");
const { InvestExperience } = await import("@/client/invest/invest-experience");
const { parseShellLocation } = await import("@/config/shell-location");
const { DashboardShell } = await import("./shell");
const { CashExperience } = await import("@/client/cash/cash-experience");
const { HomePageContent, CashPageContent, ActivityPageContent, BorrowPageContent, InvestmentsPageContent, InvestPageContent } = await import("./shell-pages");
const { useOptionalHomeShellRouting } = await import("./panel-routing");
const { PortfolioHomeExperience } = await import("./portfolio-home-experience");
const { LandingShell } = await import("./landing-shell");
const { useHomeRegion } = await import("./use-home-region");

const OWNER = "home-user";
const OWNER_B = "home-user-b";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";

function navigationPanel() {
  const panel = document.getElementById("navigation-panel");
  if (!panel) throw new Error("Missing navigation panel");
  return panel;
}

function page() {
  return within(document.body);
}

function tabsNavigation(): HTMLElement {
  return document.getElementById("home-nav")!.closest("nav")!;
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

function emptyOrders() {
  const { user, accountProvider } = session();
  return { version: 1, owner: { subject: user.subject, accountProvider }, orders: [] };
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
  cashContent = ({ view, onOpenSavings }) => <section aria-label="Cash module">{view === "cash" ? <button onClick={onOpenSavings}>Savings fixture</button> : "Savings fixture detail"}</section>,
  ...props
}: DashboardHarnessProps) {
  const region = useHomeRegion({ detectedCountry, accountPreference, signedIn: accountPreference !== null });
  const resolvedRegion = { ...region, ...regionOverride };
  onRegionObserved?.(resolvedRegion.regionId);
  return (
    <DashboardShell
      {...props}
      region={resolvedRegion}
        cashContent={cashContent}
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
            investments: { status: "complete", value: "$0.00", assetCount: 0, ownedCount: 0 },
            borrow: { kind: "none", hasCollateral: false },
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
    ><TestPage /></DashboardShell>
  );
}

function TestPage() {
  const pathname = useTestPathname();
  const panel = parseShellLocation(pathname).panel;
  return <TestRoutePage key={panel === "invest" ? panel : pathname} panel={panel} />;
}

function TestRoutePage({ panel }: { panel: ReturnType<typeof parseShellLocation>["panel"] }) {
  if (panel === "home") return <HomePageContent />;
  if (panel === "cash") return <CashPageContent />;
  if (panel === "activity") return <ActivityPageContent />;
  if (panel === "borrow") return <BorrowPageContent />;
  if (panel === "investments") return <InvestmentsPageContent />;
  return <InvestPageContent />;
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

const INVESTMENT_HOLDING = erc20AssetKey("0xABABABABABABABABABABABABABABABABABABABAB");
const INVESTMENT_PATH = "/investments/0xabababababababababababababababababababab";

function InvestmentsFixture({ holding, onOpenHolding, onCloseHolding }: InvestmentsContentProps) {
  useNestedAppChrome(holding ? { title: "Ethereum holding", backLabel: "Back", onBack: onCloseHolding } : null);
  return holding
    ? <section aria-label="Holding detail">Selected {holding}</section>
    : <section aria-label="Holding list">
        <button type="button" onClick={() => onOpenHolding(INVESTMENT_HOLDING)}>
          <span data-holding-key={INVESTMENT_HOLDING}>Ethereum row</span>
        </button>
      </section>;
}

let pendingSelectionReady = true;

function PendingInvestmentsFixture({ holding, onOpenHolding, onCloseHolding }: InvestmentsContentProps) {
  const [ready, setReadyState] = useState(pendingSelectionReady);
  const setReady = (next: boolean) => {
    pendingSelectionReady = next;
    setReadyState(next);
  };
  useNestedAppChrome(holding ? { title: "Ethereum holding", backLabel: "Back", onBack: onCloseHolding } : null);
  if (holding) return <section aria-label="Holding detail">Selected {holding}</section>;
  return <section aria-labelledby="investments-held-heading" aria-busy={!ready || undefined}>
    <h2 id="investments-held-heading">Your investments</h2>
    {ready ? <button onClick={() => { setReady(false); onOpenHolding(INVESTMENT_HOLDING); }}>
      <span data-holding-key={INVESTMENT_HOLDING}>Ethereum row</span>
    </button> : <button onClick={() => setReady(true)}>Finish selection</button>}
  </section>;
}

function ActivityHoldingFixture({ holding, onCloseHolding }: InvestmentsContentProps) {
  useNestedAppChrome(holding ? { title: "Bitcoin", backLabel: "Back", onBack: onCloseHolding } : null);
  return holding ? <section aria-label="Holding detail">Selected {holding}</section> : null;
}

function fundedInvestments() {
  return presentBalances({ status: "ready", snapshot: buildBalancesSnapshotFixture({
    registry: { eth: { balance: ready("1000000000000000000"), value: priced("USD", "10000") } },
  }), error: null });
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

function resetHistory() {
  replaceCalls.length = 0;
  pushCalls.length = 0;
  historyEntries = ["/"];
  historyStates = [{}];
  historyCursor = 0;
  syncLocation("/");
}

const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
beforeEach(() => setSystemTime(new Date(NOW)));
function mockActivityLayout() {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() { return this.tagName === "LI" ? 64 : this.tagName === "MAIN" ? 800 : 0; },
  });
}

afterEach(() => {
  setSystemTime();
  jest.useRealTimers();
  globalThis.fetch = nativeFetch;
  cleanup();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
  getHomeQueryClient().clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.body.style.overflow = "";
  resetHistory();
});

function CashFundingTrigger() {
  const routing = useOptionalHomeShellRouting();
  return <button onClick={() => routing?.setFlow("add-money", { mode: "push" })}>Add money in Cash</button>;
}

function EmptySavingsFunding({ view, onOpenSavings }: { view: "cash" | "savings"; onOpenSavings: () => void }) {
  const routing = useOptionalHomeShellRouting();
  return <CashExperience view={view} onOpenSavings={onOpenSavings} session={session()}
    snapshot={buildBalancesSnapshotFixture()} balanceStatus="ready"
    fetchVaults={async () => savingsVaultsBody(new Date(NOW).toISOString(), new Date(NOW).toISOString())}
    onAddMoney={(options) => { routing?.setFlow("add-money", { mode: options?.replaceFlow ? "replace" : "push" }); }}
    prepareMoneyAction={async () => { throw new Error("Not part of this test"); }}
    executeMoneyAction={async () => { throw new Error("Not part of this test"); }} />;
}

describe("pushed funding history", () => {
  test("Home to Cash to Add money closes without a duplicate Cash history entry", async () => {
    syncLocation("/home");
    historyEntries = ["/home"];
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      cashContent={() => <CashFundingTrigger />} />);
    await waitForVerifiedShell();
    fireEvent.click(within(page().getByRole("region", { name: "Your money" })).getByRole("button", { name: /^Cash/ }));
    expect(window.location.pathname).toBe("/cash");
    fireEvent.click(page().getByRole("button", { name: "Add money in Cash" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/cash?flow=add-money");
    expect(readClientHistoryFlag("fundingFlowPushed")).toBe(true);
    fireEvent.click(await page().findByRole("button", { name: /Receive crypto/ }));
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/cash?flow=receive"));
    expect(readClientHistoryFlag("fundingFlowPushed")).toBe(true);
    fireEvent.click(within(await page().findByRole("dialog", { name: "Receive" })).getByRole("button", { name: "Close add money" }));
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/cash"));
    expect(historyEntries).toEqual(["/home", "/cash", "/cash?flow=receive"]);
    act(() => popHistory());
    await waitFor(() => expect(window.location.pathname).toBe("/home"));
  });

  test("Home activity empty Add money closes by popping the overlay entry and keeps its opener focused", async () => {
    syncLocation("/home");
    historyEntries = ["/home"];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      if (path === "/api/session") return Response.json(session());
      if (path === "/api/activity/orders") return Response.json(emptyOrders());
      if (path === "/api/actions") return Response.json({ version: "1", actions: [] });
      if (path.startsWith("/api/activity?")) {
        const to = new URL(path, "https://home.invalid").searchParams.get("to") ?? new Date(NOW).toISOString();
        return Response.json({ version: 1, walletAddress: ADDRESS.toLowerCase(), chainId: 8453,
          window: { from: new Date(Date.parse(to) - 86_400_000).toISOString(), to }, currency: "USD", transfers: [], nextCursor: null,
          source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to } });
      }
      throw new Error(`Unexpected read: ${path}`);
    };
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch} />);
    const prompt = await page().findByRole("link", { name: "Add money" });
    await page().findByText("No activity yet");
    const activity = page().getByRole("region", { name: "Activity" });
    const emptyPrompt = within(activity).getByRole("button", { name: "Add money" });
    expect(emptyPrompt).not.toBe(prompt);
    emptyPrompt.focus();
    fireEvent.click(emptyPrompt);
    expect(readClientHistoryFlag("fundingFlowPushed")).toBe(true);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/home?flow=add-money");
    fireEvent.click(within(await page().findByRole("dialog", { name: "Add money" })).getByRole("button", { name: "Close add money" }));
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/home"));
    expect(historyEntries).toEqual(["/home", "/home?flow=add-money"]);
    await waitFor(() => expect(document.activeElement).toBe(emptyPrompt));
  });

  test("replacing a pushed savings picker with Add money closes back to savings without reopening", async () => {
    syncLocation("/cash/savings");
    historyEntries = ["/cash/savings"];
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/savings/vaults"
        ? Response.json(savingsVaultsBody(new Date().toISOString(), new Date().toISOString()))
        : nativeFetch(input, init), { preconnect: nativeFetch.preconnect });
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      initialPanel="cash" initialLocation={parseShellLocation("/cash/savings")}
      cashContent={({ view, onOpenSavings }) => <EmptySavingsFunding view={view} onOpenSavings={onOpenSavings} />} />);
    await waitForVerifiedShell();
    fireEvent.click(await page().findByRole("button", { name: "Start saving" }));
    const picker = await page().findByRole("dialog", { name: "Choose where to save" });
    expect(`${window.location.pathname}${window.location.search}`).toBe("/cash/savings?flow=save-deposit");
    expect(readClientHistoryFlag("cashSavingsFlowPushed")).toBe(true);
    fireEvent.click(within(picker).getByRole("button", { name: "Add money" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/cash/savings?flow=add-money");
    expect(historyEntries).toEqual(["/cash/savings", "/cash/savings?flow=add-money"]);
    expect(readClientHistoryFlag("fundingFlowPushed")).not.toBe(true);
    expect(readClientHistoryFlag("cashSavingsFlowPushed")).toBe(true);
    const funding = await page().findByRole("dialog", { name: "Add money" });
    expectSheetOpen(funding);
    expect(document.activeElement).not.toBe(page().getByRole("button", { name: "Start saving", hidden: true }));
    fireEvent.click(within(funding).getByRole("button", { name: "Close add money" }));
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/cash/savings"));
    expect(historyEntries).toEqual(["/cash/savings", "/cash/savings"]);
    expect(page().queryByRole("dialog", { name: "Choose where to save" })?.hasAttribute("data-open")).not.toBe(true);
    expect(pushCalls).toEqual(["/cash/savings?flow=save-deposit"]);
  });

  test("closing a direct funding deep link replaces its entry", async () => {
    syncLocation("/cash?flow=add-money");
    historyEntries = ["/cash?flow=add-money"];
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} initialPanel="cash"
      initialLocation={{ panel: "cash", account: null, shelf: null, asset: null, market: null }}
      initialSearch="flow=add-money" initialAddMoney applyInboundUrlIntent />);
    fireEvent.click(within(await page().findByRole("dialog", { name: "Add money" })).getByRole("button", { name: "Close add money" }));
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/cash"));
    expect(historyEntries).toEqual(["/cash"]);
  });
});

function controlAnimationFrames() {
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  let id = 0;
  const queued = new Map<number, FrameRequestCallback>();
  window.requestAnimationFrame = (callback) => { queued.set(++id, callback); return id; };
  window.cancelAnimationFrame = (frame) => { queued.delete(frame); };
  return {
    flush: () => {
      const callbacks = [...queued.values()];
      queued.clear();
      callbacks.forEach((callback) => callback(0));
    },
    restore: () => {
      window.requestAnimationFrame = request;
      window.cancelAnimationFrame = cancel;
      queued.clear();
    },
  };
}

async function finishDeferredFocusTest(
  view: ReturnType<typeof render>,
  frames: ReturnType<typeof controlAnimationFrames>,
) {
  try {
    await act(async () => {
      try {
        view.unmount();
      } finally {
        jest.runOnlyPendingTimers();
      }
    });
  } finally {
    jest.useRealTimers();
    frames.restore();
  }
}

describe("Home navigation after paint", () => {
  for (const panel of ["Cash", "Invest"] as const) {
    test(`defers ${panel} panel focus until after paint`, async () => {
      const view = render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
      await waitForVerifiedShell();
      const frames = controlAnimationFrames();
      jest.useFakeTimers();
      try {
        fireEvent.click(page().getByRole("button", { description: `Open ${panel}` }));
        const stage = navigationPanel();
        expect(document.activeElement).not.toBe(stage);
        act(() => frames.flush());
        expect(document.activeElement).not.toBe(stage);
        act(() => { jest.advanceTimersByTime(0); });
        expect(document.activeElement).toBe(stage);
      } finally {
        await finishDeferredFocusTest(view, frames);
      }
    });

    test(`does not steal focus moved after ${panel} navigation`, async () => {
      const view = render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
      const account = await waitForVerifiedShell();
      const frames = controlAnimationFrames();
      jest.useFakeTimers();
      try {
        fireEvent.click(page().getByRole("button", { description: `Open ${panel}` }));
        account.focus();
        act(() => frames.flush());
        act(() => { jest.advanceTimersByTime(0); });
        expect(document.activeElement).toBe(account);
      } finally {
        await finishDeferredFocusTest(view, frames);
      }
    });
  }

  test("does not steal focus moved away and back before the deferred focus", async () => {
    const view = render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    const account = await waitForVerifiedShell();
    const frames = controlAnimationFrames();
    jest.useFakeTimers();
    try {
      account.focus();
      fireEvent.click(page().getByRole("button", { description: "Open Cash" }));
      const homeTab = within(tabsNavigation()).getByRole("button", { name: "Home" });
      homeTab.focus();
      account.focus();
      act(() => frames.flush());
      act(() => { jest.advanceTimersByTime(0); });
      expect(document.activeElement).toBe(account);
    } finally {
      await finishDeferredFocusTest(view, frames);
    }
  });

  test("drops the deferred focus when Account settings replaces the panel", async () => {
    const view = render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    const account = await waitForVerifiedShell();
    const frames = controlAnimationFrames();
    jest.useFakeTimers();
    try {
      fireEvent.click(page().getByRole("button", { description: "Open Cash" }));
      fireEvent.click(account);
      const settings = page().getByRole("region", { name: "Account settings" });
      expect(document.activeElement).toBe(settings);
      await act(async () => { frames.flush(); jest.advanceTimersByTime(0); });
      expect(document.activeElement).toBe(settings);
    } finally {
      await finishDeferredFocusTest(view, frames);
    }
  });

  test("focuses the panel stage after Back returns to Home", async () => {
    const view = render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();
    const frames = controlAnimationFrames();
    jest.useFakeTimers();
    try {
      fireEvent.click(page().getByRole("button", { description: "Open Cash" }));
      act(() => frames.flush());
      act(() => { jest.advanceTimersByTime(0); });
      expect(document.activeElement).toBe(navigationPanel());
      page().getByRole("button", { name: "Account" }).focus();
      fireEvent.click(page().getByRole("button", { name: "Back" }));
      act(() => frames.flush());
      act(() => { jest.advanceTimersByTime(0); });
      expect(document.activeElement).toBe(navigationPanel());
    } finally {
      await finishDeferredFocusTest(view, frames);
    }
  });
});

function renderLandingAccount(account: ReturnType<typeof createBlockedAccountWalletClient>) {
  return render(<AccountWalletContext.Provider value={account}><LandingShell /></AccountWalletContext.Provider>);
}

describe("Home shell auth and privacy", () => {
  for (const status of ["signed-out", "unavailable"] as const) test(`landing startup settles as ${status} instead of waiting for a timeout`, async () => {
    const outcome = spyOn(homePerformance, "markHomeStartupOutcome").mockImplementation(() => {});
    try {
      const account = { ...createBlockedAccountWalletClient("unconfigured"), status };
      renderLandingAccount(account);
      await page().findByRole("heading", { name: "One home for your money." });
      expect(outcome).toHaveBeenCalledWith(status);
    } finally { outcome.mockRestore(); }
  });

  test("landing records a server-verified session before handing off to the dashboard", async () => {
    const mark = spyOn(homePerformance, "markHomePerformance").mockImplementation(() => {});
    try {
      const account = { ...createBlockedAccountWalletClient("unconfigured"),
        status: "verified" as const, verification: "server" as const, session: session() };
      renderLandingAccount(account);
      await page().findByRole("heading", { name: "One home for your money." });
      expect(mark).toHaveBeenCalledWith("session:verified");
    } finally { mark.mockRestore(); }
  });
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

  test("offers sign-in, not Account settings, when initialization fails before sign-in", async () => {
    render(<HomeHarness accountSdk={sdk({ initializationError: "provider-unavailable" })} />);

    expect(await page().findByText("Account verification is unavailable.")).toBeTruthy();
    expect(page().getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(page().queryByRole("button", { name: /^Account settings/ })).toBeNull();
  });

  test("redirects a signed-out Cash route without exposing cash content", async () => {
    syncLocation("/cash");
    historyEntries = ["/cash"];
    render(
      <HomeHarness
        accountSdk={sdk()}
        initialPanel="cash"
        initialLocation={{
          panel: "cash",
          account: null,
          shelf: null,
          asset: null,
                    market: null,
          cashView: null,
        }}
      />,
    );

    expect(page().queryByRole("region", { name: "Cash module" })).toBeNull();
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
        if (url === "/api/activity/orders") return Response.json(emptyOrders());
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
    window.scrollTo(0, 300);
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
    await waitFor(() => expect(window.scrollY).toBe(0));
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
    await waitFor(() => expect(page().getByRole("button", { name: /^Account settings/ }).hasAttribute("disabled")).toBe(true));

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

    expect(await page().findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(page().queryByText("$12.34")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
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
      { title: "Activity", leading: "back", props: { initialPanel: "activity" } },
      { title: "Cash", leading: "back", props: { initialPanel: "cash" } },
      { title: "Account", leading: "home", props: { initialAccountSettingsOpen: true } },
    ];
    for (const shellCase of cases) {
      syncLocation(shellCase.props.initialPanel ? `/${shellCase.props.initialPanel}` : "/home");
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
        expect(title.previousElementSibling?.querySelector("[data-home-mark]")).not.toBeNull();
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

    const investTab = within(tabsNavigation())
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

    fireEvent.click(within(tabsNavigation())
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

    fireEvent.click(within(tabsNavigation())
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
    syncLocation("/invest");
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
    expect(document.querySelector("[data-shell-header-main] [data-home-mark]")).toBeNull();

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
            investments: { status: "complete", value: "$78.21", assetCount: 1, ownedCount: 1 },
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
    expect(summary.getByRole("button", { description: /^Open Invest(ments)?$/ }).textContent).toContain("Across 1 asset");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="borrow"]')?.style.flexGrow,
    ).toBe("249");
    expect(
      breakdown!.querySelector<HTMLElement>('[data-balance-segment="investments"]')?.style.flexGrow,
    ).toBe("649");
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

  for (const back of ["header", "browser"] as const) {
    test(`opens the owned cbBTC contract from Activity and restores details on ${back} Back`, async () => {
      syncLocation("/activity");
      mockActivityLayout();
      historyEntries = ["/activity"];
      const snapshot = buildBalancesSnapshotFixture({ registry: {
        cbbtc: { balance: ready("10000000"), value: priced("USD", "10000") },
        usdc: { balance: ready("1000000"), value: priced("USD", "100") },
      } });
      const btc = BASE_CBBTC.address.toLowerCase();
      const usdc = BASE_USDC.address.toLowerCase();
      const makeTransfer = (address: string, symbol: string, index: number, to: string) => ({
        id: `8453:${address}:activity-${index}`, logId: `activity-${index}`, chainId: 8453,
        assetId: address === btc ? "cbbtc" : address === usdc ? "usdc" : null,
        tokenAddress: address, tokenSymbol: symbol,
        tokenDecimals: symbol === "cbBTC" ? 8 : 6, tokenImageUrl: null,
        walletAddress: ADDRESS, fromAddress: ADDRESS_B, toAddress: ADDRESS,
        direction: "incoming", amountBaseUnits: symbol === "cbBTC" ? "10000000" : "1000000",
        blockNumber: String(4 - index), blockHash: `0x${"c".repeat(64)}`,
        transactionHash: `0x${String(index).padStart(64, "0")}`, logIndex: "1",
        blockTimestamp: new Date(Date.parse(to) - index * 60_000).toISOString(),
        valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
      });
      const sessionFetch: SessionFetch = async (input) => {
        const path = String(input);
        if (path === "/api/session") return Response.json(session());
        if (path === "/api/activity/orders") return Response.json(emptyOrders());
        if (path === "/api/actions") return Response.json({ version: "1", actions: [] });
        if (path.startsWith("/api/activity?")) {
          const to = new URL(path, "https://home.invalid").searchParams.get("to") ?? new Date(NOW).toISOString();
          const response = { version: 1, walletAddress: ADDRESS.toLowerCase(), chainId: 8453,
            window: { from: new Date(Date.parse(to) - 86_400_000).toISOString(), to }, currency: "USD",
            transfers: [makeTransfer(btc, "cbBTC", 1, to), makeTransfer(usdc, "USDC", 2, to),
              makeTransfer("0x4444444444444444444444444444444444444444", "FAKE", 3, to)],
            nextCursor: null,
            source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
          };
          parseActivityPage(response, session(), to);
          return Response.json(response);
        }
        throw new Error(`Unexpected read: ${path}`);
      };
      render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch} initialPanel="activity" initialLocation={parseShellLocation("/activity")}
        canOpenAssetDetail={(key) => selectOwnedInvestment(snapshot, key as AssetKey) !== null}
        investmentsContent={ActivityHoldingFixture} />);
      await waitForVerifiedShell();
      const opener = (await page().findAllByRole("button", { description: "View received cbBTC transaction details" }))[0]!;
      const main = page().getByRole("main");
      main.scrollTop = 170;
      fireEvent.scroll(main);
      opener.focus();
      fireEvent.click(opener);
      await page().findByRole("dialog", { name: "Received" });
      fireEvent.click(await page().findByRole("button", { name: "Bitcoin Asset" }));
      expect(window.location.pathname).toBe(`/investments/${btc}`);
      expect(page().getByRole("region", { name: "Holding detail" }).textContent).toContain(erc20AssetKey(BASE_CBBTC.address));
      await waitFor(() => expect(page().queryAllByRole("dialog")).toHaveLength(0));
      if (back === "header") fireEvent.click(page().getByRole("button", { name: "Back" }));
      else act(() => popHistory());
      expect(window.location.pathname).toBe("/activity");
      const restored = await page().findByRole("dialog", { name: "Received" });
      expect(restored.textContent).toContain("+0.1000 cbBTC");
      act(() => forwardHistory());
      expect(window.location.pathname).toBe(`/investments/${btc}`);
      await waitFor(() => expect(page().queryAllByRole("dialog")).toHaveLength(0));
      act(() => popHistory());
      expect(window.location.pathname).toBe("/activity");
      const restoredAgain = await page().findByRole("dialog", { name: "Received" });
      expect(restoredAgain.textContent).toContain("+0.1000 cbBTC");
      fireEvent.click(within(restoredAgain).getByRole("button", { name: "Close Received details" }));
      await waitFor(() => expect(page().queryAllByRole("dialog")).toHaveLength(0));
      await waitFor(() => expect(page().getAllByRole("button", { description: "View received cbBTC transaction details" }).some((button) => button === document.activeElement)).toBe(true));
      act(() => forwardHistory());
      expect(window.location.pathname).toBe(`/investments/${btc}`);
      await waitFor(() => expect(page().queryAllByRole("dialog")).toHaveLength(0));
      act(() => popHistory());
      expect(window.location.pathname).toBe("/activity");
      expect(page().queryAllByRole("dialog")).toHaveLength(0);
      fireEvent.click(page().getByRole("button", { description: "View received USDC transaction details" }));
      expect(within(await page().findByRole("dialog", { name: "Received" })).queryByRole("button", { name: "US dollar Asset" })).toBeNull();
      act(() => forwardHistory());
      await waitFor(() => expect(page().queryAllByRole("dialog")).toHaveLength(0));
      act(() => popHistory());
      expect(window.location.pathname).toBe("/activity");
      expect(await page().findByRole("dialog", { name: "Received" })).toBeTruthy();
      fireEvent.click(page().getByRole("button", { name: "Close Received details" }));
      await waitFor(() => expect(page().queryAllByRole("dialog")).toHaveLength(0));
      fireEvent.click(page().getByRole("button", { description: "View received FAKE transaction details" }));
      expect(within(await page().findByRole("dialog", { name: "Received" })).queryByRole("button", { name: "FAKE Asset" })).toBeNull();
    });
  }

  test("opens funded Investments holdings separately from Invest discovery", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      assetBalances={fundedInvestments()} investmentsContent={InvestmentsFixture} />);
    await waitForVerifiedShell();
    fireEvent.click(page().getByRole("button", { description: /^Open Invest(ments)?$/ }));
    expect(window.location.pathname).toBe("/investments");
    expect(page().getByRole("heading", { level: 1, name: "Investments" })).toBeTruthy();
    expect(within(tabsNavigation()).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(page().getByRole("region", { name: "Holding list" })).toBeTruthy();
    fireEvent.click(within(tabsNavigation()).getByRole("button", { name: "Invest" }));
    expect(window.location.pathname).toBe("/invest");
    expect(page().getByRole("region", { name: "Invest module" })).toBeTruthy();
  });

  test("opens Investments holdings when the only owned holding is below one cent", async () => {
    const dust = presentBalances({ status: "ready", snapshot: buildBalancesSnapshotFixture({
      registry: { eth: { balance: ready("1000000000000"), value: priced("USD", "5", 3) } },
    }), error: null });
    expect(dust.summary?.investments).toMatchObject({ status: "complete", assetCount: 0, ownedCount: 1 });
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      assetBalances={dust} investmentsContent={InvestmentsFixture} />);
    await waitForVerifiedShell();
    const summary = within(page().getByRole("region", { name: "Your money" }));
    expect(summary.queryByText("Start investing")).toBeNull();
    fireEvent.click(summary.getByRole("button", { description: "Open Investments" }));
    expect(window.location.pathname).toBe("/investments");
    expect(page().getByRole("region", { name: "Holding list" })).toBeTruthy();
  });

  for (const back of ["header", "browser"] as const) {
    test(`returns from a holding using ${back} history and focuses its list row`, async () => {
      render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={fundedInvestments()} investmentsContent={InvestmentsFixture} />);
      await waitForVerifiedShell();
      fireEvent.click(page().getByRole("button", { description: /^Open Invest(ments)?$/ }));
      const main = page().getByRole("main");
      main.scrollTop = 180;
      fireEvent.scroll(main);
      fireEvent.click(page().getByRole("button", { name: "Ethereum row" }));
      expect(window.location.pathname).toBe(INVESTMENT_PATH);
      expect(page().getByRole("region", { name: "Holding detail" })).toBeTruthy();
      if (back === "header") fireEvent.click(page().getByRole("button", { name: "Back" }));
      else act(() => popHistory());
      expect(window.location.pathname).toBe("/investments");
      await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Ethereum row" })));
      expect(historyEntries).toContain(INVESTMENT_PATH);
    });
  }

  for (const back of ["header", "browser"] as const) {
    test(`restores holding focus after asynchronous ${back} Back rows arrive`, async () => {
      pendingSelectionReady = true;
      const originalObserver = globalThis.MutationObserver;
      const callbacks = new Set<() => void>();
      globalThis.MutationObserver = class extends originalObserver {
        callback: () => void;
        constructor(callback: MutationCallback) { super(callback); this.callback = () => callback([], this); }
        observe() { callbacks.add(this.callback); }
        disconnect() { callbacks.delete(this.callback); }
      };
      try {
      render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={fundedInvestments()} investmentsContent={PendingInvestmentsFixture} />);
      await waitForVerifiedShell();
      fireEvent.click(page().getByRole("button", { description: /^Open Invest(ments)?$/ }));
      const main = page().getByRole("main");
      fireEvent.click(page().getByRole("button", { name: "Ethereum row" }));
      await page().findByRole("region", { name: "Holding detail" });
      if (back === "header") fireEvent.click(page().getByRole("button", { name: "Back" }));
      else act(() => popHistory());
      expect(page().getByRole("region", { name: "Your investments" }).getAttribute("aria-busy")).toBe("true");
      fireEvent.click(page().getByRole("button", { name: "Finish selection" }));
      act(() => { for (const callback of [...callbacks]) callback(); });
      expect(document.activeElement).toBe(page().getByRole("button", { name: "Ethereum row" }));
      const homeButton = within(tabsNavigation()).getByRole("button", { name: "Home" });
      homeButton.focus();
      act(() => main.setAttribute("aria-busy", "false"));
      act(() => { for (const callback of [...callbacks]) callback(); });
      expect(document.activeElement).toBe(homeButton);
      } finally { globalThis.MutationObserver = originalObserver; }
    });
  }

  test("cold holding detail replaces to the list, focuses and scrolls its row", async () => {
    syncLocation(INVESTMENT_PATH);
    historyEntries = [INVESTMENT_PATH];
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      initialPanel="investments" initialLocation={parseShellLocation(INVESTMENT_PATH)}
      investmentsContent={InvestmentsFixture} investContent={<NestedInvestFixture />} />);
    await waitForVerifiedShell();
    expect(page().getByRole("region", { name: "Holding detail" })).toBeTruthy();
      fireEvent.click(page().getByRole("button", { name: "Back" }));
      expect(window.location.pathname).toBe("/investments");
      expect(replaceCalls.at(-1)).toBe("/investments");
      await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Ethereum row" })));
  });

  test("Invest nested chrome cannot replace the Investments detail header", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      assetBalances={fundedInvestments()} investContent={<NestedInvestFixture />}
      investmentsContent={InvestmentsFixture} />);
    await waitForVerifiedShell();
    fireEvent.click(within(tabsNavigation())
      .getByRole("button", { name: "Invest" }));
    fireEvent.click(page().getByRole("button", { name: "Open asset details" }));
    expect(page().getByRole("heading", { level: 1, name: "US dollar" })).toBeTruthy();
    fireEvent.click(within(tabsNavigation())
      .getByRole("button", { name: "Home" }));
    fireEvent.click(page().getByRole("button", { description: /^Open Invest(ments)?$/ }));
    expect(page().getByRole("heading", { level: 1, name: "Investments" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Ethereum row" }));
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().getByRole("heading", { level: 1, name: "Investments" })).toBeTruthy();
  });

  test("refresh keeps an in-app holding return in history", async () => {
    syncLocation("/investments");
    historyEntries = ["/investments"];
    historyStates = [{}];
    pushHistory(INVESTMENT_PATH, { __homeShellOrigin: "/investments" });
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      initialPanel="investments" initialLocation={parseShellLocation(INVESTMENT_PATH)}
      investmentsContent={InvestmentsFixture} />);
    await waitForVerifiedShell();
    expect(page().getByRole("region", { name: "Holding detail" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(window.location.pathname).toBe("/investments");
    expect(replaceCalls).toEqual([]);
    expect(historyEntries).toEqual(["/investments", INVESTMENT_PATH]);
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Ethereum row" })));
  });

  test("cold Investments list returns Home and refresh state preserves a native holding detail", async () => {
    syncLocation("/investments");
    historyEntries = ["/investments"];
    const view = render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      initialPanel="investments" initialLocation={parseShellLocation("/investments")}
      investmentsContent={InvestmentsFixture} />);
    await waitForVerifiedShell();
    expect(page().getByRole("heading", { level: 1, name: "Investments" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(window.location.pathname).toBe("/home");
    view.unmount();
    syncLocation("/investments/native");
    historyEntries = ["/investments/native"];
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      initialPanel="investments" initialLocation={parseShellLocation("/investments/native")}
      investmentsContent={InvestmentsFixture} />);
    await waitForVerifiedShell();
    expect(page().getByRole("region", { name: "Holding detail" }).textContent).toContain(nativeAssetKey());
  });

  test("returns a kept-mounted Invest category to the hub on primary tab entry", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        investContent={<InvestExperience />}
      />,
    );
    await waitForVerifiedShell();
    const navigation = within(tabsNavigation());
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

  test("synchronizes Invest view with browser Back from a category", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        investContent={<InvestExperience />}
      />,
    );
    await waitForVerifiedShell();
    fireEvent.click(within(tabsNavigation()).getByRole("button", { name: "Invest" }));
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
    expect(`${window.location.pathname}${window.location.search}`).toBe("/cash");
    expect(page().getByRole("region", { name: "Cash module" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Savings fixture" }));
    expect(window.location.pathname).toBe("/cash/savings");
    expect(page().getByRole("region", { name: "Savings" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(window.location.pathname).toBe("/cash");

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(within(tabsNavigation()).getByRole("button", { name: "Invest" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/invest");
    expect(page().getByRole("region", { name: "Invest module" })).toBeTruthy();

    act(() => popHistory());
    expect(page().getByLabelText("Total balance")).toBeTruthy();
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
    fireEvent.click(within(tabsNavigation())
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
    fireEvent.click(within(tabsNavigation())
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

  test("offered Send becomes Cash out without removing transfer actions when Send pauses", async () => {
    const accountSdk = sdk({ isSignedIn: true, ownerKey: OWNER });
    const view = render(<ProductOfferingProvider value={resolveProductOffering({ kind: "deployment" })}>
      <HomeHarness accountSdk={accountSdk} />
    </ProductOfferingProvider>);
    await waitForVerifiedShell();
    expect(page().getByRole("button", { name: "Send" })).toBeTruthy();
    view.rerender(<ProductOfferingProvider value={resolveProductOffering({ kind: "unavailable" })}>
      <HomeHarness accountSdk={accountSdk} />
    </ProductOfferingProvider>);
    expect(page().queryByRole("button", { name: "Send" })).toBeNull();
    const cashOut = page().getByRole("button", { name: "Cash out" });
    expect(cashOut.hasAttribute("data-action-trigger")).toBe(true);
    expect(page().getByRole("link", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("button", { description: "Open Borrow" })).toBeNull();
    expect(within(tabsNavigation()).queryByRole("button", { name: "Invest" })).toBeNull();
  });

  test("opens Borrow from the Borrow Cash row without adding a bottom navigation item", async () => {
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();

    const borrowRow = page().getByRole("button", { description: "Open Borrow" });
    expect(borrowRow.textContent).toContain("Borrow Cash");
    fireEvent.click(borrowRow);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/borrow");
    expect(await page().findByText("Borrowed")).toBeTruthy();
    expect(within(tabsNavigation()).queryByRole("button", { name: "Borrow" })).toBeNull();
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

    fireEvent.click(await page().findByRole("link", { name: "Add money" }));
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

function RefreshBalancesProbe({ read }: { read: () => Promise<string> }) {
  useHomeQuery({
    queryKey: ownerQueryKey(dataOwnerKey(session()), "balances", "GLOBAL"),
    queryFn: read,
  });
  return null;
}

function touchPull(target: HTMLElement) {
  const fire = (name: string, y: number, end = false) => {
    const event = new Event(name, { bubbles: true, cancelable: true });
    const touch = { identifier: 1, clientX: 0, clientY: y, target };
    Object.defineProperties(event, {
      touches: { value: end ? [] : [touch] },
      changedTouches: { value: [touch] },
    });
    target.dispatchEvent(event);
  };
  fire("touchstart", 0);
  fire("touchmove", 350);
  fire("touchend", 350, true);
}

function refreshFixture() {
  const calls = { balances: 0, activity: 0, actions: 0 };
  let fail = false;
  let pending: ReturnType<typeof deferred<string>> | null = null;
  const snapshot = buildBalancesSnapshotFixture({ region: "US" });
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/savings/vaults") {
      return fail ? Response.json({}, { status: 503 }) : Response.json({
        version: "v1", chainId: 8453, asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
        candidates: [], source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: new Date(NOW).toISOString() }, stale: false,
      });
    }
    return nativeFetch(input, init);
  }, { preconnect: nativeFetch.preconnect });
  const readBalances = async () => {
    calls.balances += 1;
    if (fail) throw new Error("Balance read unavailable");
    return pending?.promise ?? "balances-ready";
  };
  const sessionFetch: SessionFetch = async (input) => {
    const url = String(input);
    if (url.startsWith("/api/session")) return Response.json(session());
    if (url.startsWith("/api/activity?")) {
      calls.activity += 1;
      if (fail) return Response.json({ invalid: true });
      const query = new URLSearchParams(url.split("?")[1]);
      const to = query.get("to")!;
      return Response.json({
        version: 1, walletAddress: ADDRESS, chainId: 8453,
        window: { from: new Date(Date.parse(to) - 31 * 24 * 60 * 60 * 1000).toISOString(), to },
        currency: query.get("currency"), transfers: [], nextCursor: null,
        source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
      });
    }
    if (url === "/api/actions") {
      calls.actions += 1;
      if (fail) return Response.json({ invalid: true });
      return Response.json({ version: "1", actions: [] });
    }
    if (url.startsWith("/api/balances?")) return fail ? Response.json({}, { status: 503 }) : Response.json(snapshot);
    if (url === "/api/borrow") return fail ? Response.json({}, { status: 503 }) : Response.json({
      version: "2", chainId: 8453, owner: { address: ADDRESS, accountProvider: "cdp-embedded" },
      discovery: { status: "complete", sourceBlock: null, candidateCount: 0, verifiedCount: 0, reason: null, fetchedAt: new Date(NOW).toISOString() },
      opportunities: [], positions: [],
    });
    throw new Error(`Unexpected read: ${url}`);
  };
  const renderShell = (props: DashboardHarnessProps = {}) => render(
    <AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
      <RefreshBalancesProbe read={readBalances} />
      <DashboardHarness {...props} />
    </AccountWalletSessionOwner>,
  );
  return { calls, renderShell, failNext: () => { fail = true; }, recover: () => { fail = false; },
    holdBalances: () => { pending = deferred<string>(); return pending; },
    releaseBalances: () => { pending = null; },
  };
}

describe("Home refresh wiring", () => {
  test("Refresh Home re-requests balances, activity and actions and announces cycle boundaries", async () => {
    const fixture = refreshFixture();
    fixture.renderShell();
    await waitForVerifiedShell();
    await waitFor(() => expect(fixture.calls.activity).toBe(1));
    await waitFor(() => expect(fixture.calls.actions).toBe(1));
    await waitFor(() => expect(fixture.calls.balances).toBe(1));
    const pending = fixture.holdBalances();
    const action = page().getByRole("button", { name: "Refresh Home" });
    fireEvent.click(action);
    await waitFor(() => expect(within(page().getByRole("main")).getByRole("status").textContent).toBe("Refreshing Home"));
    await waitFor(() => expect(page().getByRole("button", { name: "Refresh Home" }).getAttribute("aria-busy")).toBe("true"));
    expect(action.getAttribute("aria-disabled")).toBe("true");
    expect(fixture.calls.balances).toBe(2);
    expect(fixture.calls.actions).toBe(2);
    expect(fixture.calls.activity).toBe(2);
    fixture.releaseBalances();
    await act(async () => { pending.resolve("balances-ready"); await pending.promise; });
    await waitFor(() => expect(within(page().getByRole("main")).getByRole("status").textContent).toBe("Home updated"));
    expect(action.getAttribute("aria-busy")).not.toBe("true");
  });

  test("a failed refresh preserves Home content, offers Retry, and clears on success or navigation", async () => {
    const fixture = refreshFixture();
    fixture.renderShell();
    await waitForVerifiedShell();
    await waitFor(() => expect(fixture.calls.activity).toBe(1));
    await waitFor(() => expect(fixture.calls.actions).toBe(1));
    await waitFor(() => expect(fixture.calls.balances).toBe(1));
    fixture.failNext();
    fireEvent.click(page().getByRole("button", { name: "Refresh Home" }));
    const alert = await page().findByRole("alert");
    await waitFor(() => expect(alert.textContent).toContain("Couldn't refresh Home."));
    expect(page().getByRole("heading", { name: "Your money" })).toBeTruthy();
    const before = { ...fixture.calls };
    fixture.recover();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fixture.calls.balances).toBe(before.balances + 1));
    await waitFor(() => expect(fixture.calls.activity).toBe(before.activity + 1));
    await waitFor(() => expect(fixture.calls.actions).toBe(before.actions + 1));
    await waitFor(() => expect(page().queryByText("Couldn't refresh Home.")).toBeNull());
    fixture.failNext();
    fireEvent.click(page().getByRole("button", { name: "Refresh Home" }));
    await page().findByText("Couldn't refresh Home.");
    fireEvent.click(within(tabsNavigation()).getByRole("button", { name: "Invest" }));
    expect(page().queryByRole("button", { name: "Refresh Home" })).toBeNull();
    expect(page().queryByText("Couldn't refresh Home.")).toBeNull();
  });

  test("other panels and settings omit Refresh Home; an open money flow blocks the pull gesture", async () => {
    const fixture = refreshFixture();
    fixture.renderShell();
    await waitForVerifiedShell();
    await waitFor(() => expect(fixture.calls.activity).toBe(1));
    const target = page().getByRole("heading", { name: "Your money" });
    expect(page().getByRole("button", { name: "Refresh Home" })).toBeTruthy();
    fireEvent.click(page().getByRole("link", { name: "Add money" }));
    const dialog = await page().findByRole("dialog", { name: "Add money" });
    expectSheetOpen(dialog);
    expect(page().queryByRole("button", { name: "Refresh Home" })).toBeNull();
    const before = { ...fixture.calls };
    touchPull(target);
    expect(fixture.calls).toEqual(before);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close add money" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Refresh Home" })).toBeTruthy());
    fireEvent.click(within(tabsNavigation()).getByRole("button", { name: "Invest" }));
    expect(page().queryByRole("button", { name: "Refresh Home" })).toBeNull();
    touchPull(target);
    expect(fixture.calls.balances).toBe(before.balances);
    fireEvent.click(within(tabsNavigation()).getByRole("button", { name: "Home" }));
    fireEvent.click(page().getByRole("button", { name: "Account" }));
    expect(page().queryByRole("button", { name: "Refresh Home" })).toBeNull();
  });
});

describe("walletless country preference read", () => {

  for (const accountPreference of [null, { accountProvider: "cdp-embedded" as const, subject: "previous-account", regionId: "BR" as const }]) {
    test(`starts the account country read and resolved-region balances before verification without a matching seed (${accountPreference ? "switched account" : "timed-out seed"})`, async () => {
      const pendingSession = deferred<Response>();
      const pendingPreference = deferred<Response>();
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
        requests.push(path);
        if (path === "/api/session") return pendingSession.promise;
        if (path === "/api/account/country-preference") return pendingPreference.promise;
        if (path === "/api/balances?region=DE") return Response.json(saved);
        throw new Error(`Unexpected read: ${path}`);
      };
      render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER, provisionalSession: session() })} sessionFetch={sessionFetch}>
        <PortfolioHomeExperience detectedCountry="BR" accountPreference={accountPreference}><TestPage /></PortfolioHomeExperience>
      </AccountWalletSessionOwner>);
      await waitFor(() => expect(requests).toContain("/api/account/country-preference"));
      expect(requests).toContain("/api/session");
      expect(requests.filter((path) => path.startsWith("/api/balances?"))).toEqual([]);
      expect(document.body.textContent).not.toContain("1.234,56");
      await act(async () => { pendingPreference.resolve(Response.json({ version: 1, regionId: "DE" })); await pendingPreference.promise; });
      await waitFor(() => expect(requests).toContain("/api/balances?region=DE"));
      expect(requests.filter((path) => path === "/api/account/country-preference")).toHaveLength(1);
      await act(async () => { pendingSession.resolve(Response.json(session())); await pendingSession.promise; });
      await waitFor(() => expect(document.body.textContent).toContain("78,90"));
      expect(document.body.textContent).not.toContain("1.234,56");
      expect(requests.filter((path) => path === "/api/account/country-preference")).toHaveLength(1);
    });
  }

  test("a seeded region keeps its cached balance visible through pending verification and refresh", async () => {
    const verification = deferred<Response>();
    const freshRead = deferred<Response>();
    const cached = buildBalancesSnapshotFixture({
      region: "DE",
      registry: { usdc: { balance: ready("1000000"), value: priced("EUR", "123456"), cashValue: pricedCash("USD", "100") } },
    });
    const fresh = buildBalancesSnapshotFixture({
      region: "DE",
      registry: { usdc: { balance: ready("1000000"), value: priced("EUR", "7890"), cashValue: pricedCash("USD", "100") } },
    });
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(session()), "balances", "DE"), cached, {
      updatedAt: NOW - 60_000,
    });
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      requests.push(path);
      if (path === "/api/session") return verification.promise;
      if (path === "/api/balances?region=DE") return freshRead.promise;
      throw new Error(`Unexpected read: ${path}`);
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER, provisionalSession: session() })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={{ accountProvider: "cdp-embedded", subject: "subject-home", regionId: "DE" }}><TestPage /></PortfolioHomeExperience>
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toContain("/api/balances?region=DE"));
    const total = page().getByLabelText("Total balance");
    expect(total.textContent).toContain("1.234,56");
    expect(requests).toContain("/api/session");
    const painted: string[] = [];
    const observer = new MutationObserver(() => painted.push(total.textContent ?? ""));
    observer.observe(total, { subtree: true, childList: true, characterData: true });
    try {
      await act(async () => { verification.resolve(Response.json(session())); await verification.promise; });
      await waitForVerifiedShell();
      expect(total.textContent).toContain("1.234,56");
      await act(async () => { freshRead.resolve(Response.json(fresh)); await freshRead.promise; });
      await waitFor(() => expect(total.textContent).toContain("78,90"));
      expect(painted.every((text) => text.includes("1.234,56") || text.includes("78,90"))).toBe(true);
      expect(requests.filter((path) => path === "/api/balances?region=DE")).toHaveLength(1);
      expect(requests).not.toContain("/api/balances?region=BR");
    } finally {
      observer.disconnect();
    }
  });

  test("shows balances in the global presentation when the saved country is no longer offered", async () => {
    const fresh = buildBalancesSnapshotFixture({
      region: "GLOBAL",
      registry: { usdc: { balance: ready("1000000") } },
    });
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      requests.push(path);
      if (path === "/api/session") return Response.json(session());
      if (path === "/api/balances?region=GLOBAL") return Response.json(fresh);
      throw new Error(`Unexpected read: ${path}`);
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER, provisionalSession: session() })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={{ accountProvider: "cdp-embedded", subject: "subject-home", regionId: "DE" }}
        regionOffer={{ offered: ["BR"], defaultRegion: "BR" }} />
    </AccountWalletSessionOwner>);
    await waitForVerifiedShell();
    await waitFor(() => expect(requests).toContain("/api/balances?region=GLOBAL"));
    await waitFor(() => expect(page().getByRole("button", { name: "Choose a country in Account to set how money is shown" })).toBeTruthy());
    expect(requests).not.toContain("/api/balances?region=BR");
  });

  test("discards a provisional country response after the owner changes", async () => {
    const verificationA = deferred<Response>();
    const verificationB = deferred<Response>();
    const preferenceA = deferred<Response>();
    const preferenceB = deferred<void>();
    let verificationCount = 0;
    let preferenceCount = 0;
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      requests.push(path);
      if (path === "/api/session") return ++verificationCount === 1 ? verificationA.promise : verificationB.promise;
      if (path === "/api/account/country-preference") {
        return ++preferenceCount === 1 ? preferenceA.promise : preferenceB.promise.then(() => Response.json({ version: 1, regionId: "DE" }));
      }
      if (path === "/api/balances?region=DE") return Response.json({});
      return Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 });
    };
    const shell = (ownerKey: string, provisionalSession: VerifiedAccountSession) => (
      <AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey, provisionalSession })} sessionFetch={sessionFetch}>
        <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}><TestPage /></PortfolioHomeExperience>
      </AccountWalletSessionOwner>
    );
    const view = render(shell(OWNER, session()));
    await waitFor(() => expect(preferenceCount).toBe(1));
    view.rerender(shell(OWNER_B, session(ADDRESS_B, "subject-home-b")));
    await waitFor(() => expect(preferenceCount).toBeGreaterThanOrEqual(2));
    await act(async () => { preferenceA.resolve(Response.json({ version: 1, regionId: "GB" })); await preferenceA.promise; });
    expect(requests.filter((path) => path.startsWith("/api/balances?"))).toEqual([]);
    await act(async () => { preferenceB.resolve(); await preferenceB.promise; });
    await waitFor(() => expect(requests).toContain("/api/balances?region=DE"));
    expect(requests).not.toContain("/api/balances?region=GB");
    const provisionalReadCount = preferenceCount;
    await act(async () => { verificationB.resolve(Response.json(session(ADDRESS_B, "subject-home-b"))); await verificationB.promise; });
    expect(preferenceCount).toBe(provisionalReadCount);
  });

  test("re-reads the country preference if verification returns a different identity", async () => {
    const verification = deferred<Response>();
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      requests.push(path);
      if (path === "/api/session") return verification.promise;
      if (path === "/api/account/country-preference") {
        return Response.json({ version: 1, regionId: requests.filter((request) => request === path).length === 1 ? "GB" : "DE" });
      }
      return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER, provisionalSession: session() })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}><TestPage /></PortfolioHomeExperience>
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toContain("/api/account/country-preference"));
    await act(async () => { verification.resolve(Response.json(session(ADDRESS_B, "subject-home-b"))); await verification.promise; });
    await waitFor(() => expect(requests.filter((path) => path === "/api/account/country-preference")).toHaveLength(2));
    fireEvent.click(await waitForVerifiedShell());
    expect((await page().findByRole("combobox", { name: "Country" })).getAttribute("value")).toContain("Germany");
  });

  test("retries a failed provisional preference read only after verification", async () => {
    const verification = deferred<Response>();
    const requests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      const path = String(input);
      requests.push(path);
      if (path === "/api/session") return verification.promise;
      if (path === "/api/account/country-preference") {
        return requests.filter((request) => request === path).length === 1
          ? Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 })
          : Response.json({ version: 1, regionId: "DE" });
      }
      if (path === "/api/balances?region=DE") return Response.json({});
      throw new Error(`Unexpected read: ${path}`);
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER, provisionalSession: session() })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}><TestPage /></PortfolioHomeExperience>
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toContain("/api/account/country-preference"));
    expect(requests.filter((path) => path === "/api/account/country-preference")).toHaveLength(1);
    expect(requests.filter((path) => path.startsWith("/api/balances?"))).toEqual([]);
    await act(async () => { verification.resolve(Response.json(session())); await verification.promise; });
    await waitFor(() => expect(requests.filter((path) => path === "/api/account/country-preference")).toHaveLength(2));
    await waitFor(() => expect(requests).toContain("/api/balances?region=DE"));
  });

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
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}><TestPage /></PortfolioHomeExperience>
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toContain("/api/account/country-preference"));
    fireEvent.click(await waitForVerifiedShell());
    const country = await page().findByRole("combobox", { name: "Country" });
    expect(country.getAttribute("value")).not.toContain("Mexico");
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    fireEvent.click(page().getByRole("link", { name: "Add money" }));
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

  test("never paints held detected-country balances while the saved-country fetch is pending", async () => {
    const read = deferred<Response>();
    const savedRead = deferred<Response>();
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
      if (path === "/api/balances?region=DE") return savedRead.promise;
      throw new Error(`Unexpected read: ${path}`);
    };
    render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER, provisionalSession: session() })} sessionFetch={sessionFetch}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}><TestPage /></PortfolioHomeExperience>
    </AccountWalletSessionOwner>);
    await waitFor(() => expect(requests).toContain("/api/account/country-preference"));
    await waitForVerifiedShell();
    expect(requests.filter((path) => path === "/api/account/country-preference")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("1.234,56");
    expect(document.body.textContent).not.toContain("78,90");
    expect(requests).not.toContain("/api/balances?region=BR");
    await act(async () => { read.resolve(Response.json({ version: 1, regionId: "DE" })); await read.promise; });
    await waitFor(() => expect(requests).toContain("/api/balances?region=DE"));
    expect(document.body.textContent).not.toContain("1.234,56");
    expect(document.body.textContent).not.toContain("78,90");
    await act(async () => { savedRead.resolve(Response.json(saved)); await savedRead.promise; });
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
        if (path === "/api/activity/orders") return Response.json(emptyOrders());
        if (path === "/api/actions") return Response.json({ version: "1", actions: [] });
        return Response.json({ error: { code: "UNAVAILABLE", message: "Unavailable." } }, { status: 503 });
      };
      render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={sessionFetch}>
        <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}><TestPage /></PortfolioHomeExperience>
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
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}><TestPage /></PortfolioHomeExperience>
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
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={null}><TestPage /></PortfolioHomeExperience>
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
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={{ accountProvider: "cdp-embedded", subject: "subject-home", regionId: null }}><TestPage /></PortfolioHomeExperience>
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
        ><TestPage /></PortfolioHomeExperience>
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
      const seed = { accountProvider: "cdp-embedded" as const, subject: "subject-home", regionId: "DE" as const };
    const view = render(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER })} sessionFetch={fetchFor("subject-home", ADDRESS)}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={seed}><TestPage /></PortfolioHomeExperience>
    </AccountWalletSessionOwner>);
    fireEvent.click(await waitForVerifiedShell());
    const country = await page().findByRole("combobox", { name: "Country" });
    expect(country.getAttribute("value")).toContain("Germany");
    expect(requests).toEqual([]);
    view.rerender(<AccountWalletSessionOwner sdk={sdk({ isSignedIn: true, ownerKey: OWNER_B })} sessionFetch={fetchFor("subject-home-b", ADDRESS_B)}>
      <PortfolioHomeExperience detectedCountry="BR" accountPreference={seed}><TestPage /></PortfolioHomeExperience>
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
      const seed = { accountProvider: "cdp-embedded" as const, subject: "subject-home", regionId: "DE" as const };
    const shell = (signedIn: boolean) => (
      <AccountWalletSessionOwner sdk={sdk(signedIn ? { isSignedIn: true, ownerKey: OWNER } : {})} sessionFetch={sessionFetch}>
        <PortfolioHomeExperience detectedCountry="BR" accountPreference={seed}><TestPage /></PortfolioHomeExperience>
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
        ><TestPage /></PortfolioHomeExperience>
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

describe("shell page context", () => {
  test("only the route's page content mounts while the shell navigation persists", async () => {
    syncLocation("/home");
    render(<HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />);
    await waitForVerifiedShell();
    expect(page().getByLabelText("Total balance")).toBeTruthy();
    expect(page().queryByRole("region", { name: "Cash module" })).toBeNull();

    fireEvent.click(page().getByRole("button", { description: "Open Cash" }));
    expect(window.location.pathname).toBe("/cash");
    expect(page().getByRole("region", { name: "Cash module" })).toBeTruthy();
    expect(page().queryByLabelText("Total balance")).toBeNull();

    fireEvent.click(within(tabsNavigation()).getByRole("button", { name: "Invest" }));
    expect(window.location.pathname).toBe("/invest");
    expect(page().getByRole("region", { name: "Invest module" })).toBeTruthy();
    expect(page().queryByRole("region", { name: "Cash module" })).toBeNull();
    expect(within(tabsNavigation()).getByRole("button", { name: "Invest" }).getAttribute("aria-current")).toBe("page");
  });
});

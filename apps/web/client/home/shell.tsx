"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { isSessionSettling, useAccountWallet } from "@/client/account/cdp-client";
import { AccountSettings } from "@/client/account/account-settings";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { useAppearance } from "@/client/appearance/use-appearance";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowMarketId } from "@/shared/borrowing/config";
import type { AssetKey } from "@/shared/balances/types";
import {
  activityPanelId,
  balancesPanelId,
  borrowPanelId,
  cashPanelId,
  investmentsPanelId,
  isHomeNestedPanelId,
  nestedHomePanelTitle,
  type ShellPanelId,
} from "@/config/navigation";
import {
  commitClientUrl,
  commitFlowUrl,
  flowHref,
  isClientHistoryEntry,
  legacyShellRedirectHref,
  parseShellLocation,
  readClientScrollTop,
  readShellAccountParam,
  replaceClientScrollTop,
  shellHref,
  withoutFlowHref,
  type MoneyGroupId,
  subscribeBeforeClientUrlCommit,
  type ShellFlow,
} from "@/config/shell-location";
import { AppChromeProvider, useOptionalAppChrome, type NestedAppChrome } from "@/components/app-chrome";
import { LoadErrorCard } from "@/components/load-error";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { AuthenticatedBorrowExperience } from "@/client/borrowing/borrowing-experience";
import {
  shellContentFrameClassName,
  shellScrollContainerClassName,
} from "@/components/shell-layout";
import {
  markHomePerformance,
  markHomeStartupOutcome,
  startHomePerformance,
} from "@/client/observability/perf-marks";
import type { HomeStartupRoute } from "@/shared/observability/client-performance.contract";
import {
  balancesAnchorTopologyKey,
  BalancesPage,
  clampHomeScrollTop,
  homeBalancesRestoreScope,
  useBalancesRevealWindow,
} from "./balances-panel";
import { ActivityPage } from "./activity-panel";
import { CashPanel, InvestPanel, InvestmentsPanel } from "./feature-panels";
import { HomePanel } from "./home-panel";
import { MountedShellPanel } from "./panel-shared";
import type { HomeExperienceProps, HomeAssetBalancesPresentation, InvestmentsContentProps } from "./home-types";
import {
  HomeShellRoutingProvider,
  readHomeInboundPanelState,
  type HomeInboundPanelState,
} from "./panel-routing";
import { ShellHeader } from "./shell-chrome";
import { HomeHeaderStatus, headerStatus, homeBalancesStatus, useReloadHomeBalances } from "./home-status";
import { ActionToasts } from "./action-toasts";
import { useBalancesRestore } from "./use-balances-restore";
import { useHomeRefresh } from "./use-home-refresh";
import { PullToRefreshAction, PullToRefreshIndicator, usePullToRefresh } from "@/components/ui/pull-to-refresh";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const AccountSignInSheet = deferSheet(() => import("@/client/account/account-screen").then((module) => module.AccountSignInSheet));

function CashPanelContent({ render, view, onOpenSavings }: {
  render: NonNullable<HomeExperienceProps["cashContent"]>;
  view: "cash" | "savings";
  onOpenSavings: () => void;
}) {
  return render({ view, onOpenSavings });
}

function InvestmentsPanelContent({ render, holding, onOpenHolding, onCloseHolding }: {
  render: NonNullable<HomeExperienceProps["investmentsContent"]>;
} & InvestmentsContentProps) {
  return render({ holding, onOpenHolding, onCloseHolding });
}

function PanelChromeSync({ onChrome }: { onChrome: (chrome: NestedAppChrome | null) => void }) {
  const chrome = useOptionalAppChrome();
  useEffect(() => onChrome(chrome?.nested ?? null), [chrome?.nested, onChrome]);
  return null;
}

const loadingAssetBalances: HomeAssetBalancesPresentation = {
  status: "loading",
  displayTotal: null,
  groups: [],
  breakdown: [],
  summary: null,
  rows: [],
  hiddenRows: [],
  hiddenCount: 0,
};

const panelStartupRoutes: Record<ShellPanelId, Exclude<HomeStartupRoute, "/">> = {
  home: "/home",
  balances: "/balances",
  activity: "/activity",
  cash: "/cash",
  borrow: "/borrow",
  investments: "/investments",
  invest: "/invest",
};

export type DashboardShellProps = Omit<HomeExperienceProps, "landingVisual" | "routeMode">;

export function DashboardShell(props: DashboardShellProps) {
  return (
    <AppChromeProvider>
      <DashboardShellBody {...props} />
    </AppChromeProvider>
  );
}

function DashboardShellBody({
  investContent,
  cashContent,
  investmentsContent,
  initialAccountOpen = false,
  initialPanel = "home",
  initialLocation,
  initialAccountSettingsOpen = false,
  assetBalances,
  balancesRevalidating: balancesRevalidatingProp,
  interruption = null,
  interruptionAnnouncement = null,
  onRetryInterruption,
  presentAssetBalances,
  sendAvailability = [],
  assetMarkResolution,
  showSmallBalances = false,
  onShowSmallBalancesChange = () => {},
  initialAddMoney = false,
  returnedFromProvider = false,
  initialSearch,
  initialSendFlow = false,
  initialSendActionId = null,
  applyInboundUrlIntent = false,
  region,
  regionReady = true,
}: DashboardShellProps) {
  const router = useRouter();
  const account = useAccountWallet();
  const {
    disarmBalancesRestore,
    awaitBalancesAssetDetail,
    armBalancesAccountOverlay,
    isBalancesRestoreArmed,
  } = useBalancesRestore();
  const [initialUrlIntent] = useState(() => readHomeInboundPanelState(
    initialLocation ?? (typeof window === "undefined"
      ? parseShellLocation("/")
      : parseShellLocation(window.location.pathname)),
    new URLSearchParams(
      initialSearch ?? (typeof window === "undefined" ? "" : window.location.search),
    ),
  ));
  const pendingUrlIntentRef = useRef(initialUrlIntent);
  const appliedUrlIntentRef = useRef(false);
  const {
    regionId,
    resolutionSource,
    isPreferenceReady,
    preferenceMessage,
    selectRegion,
  } = region;
  const [activeNavigation, setActiveNavigation] = useState<ShellPanelId>(initialPanel);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const [balancesRevealReset, setBalancesRevealReset] = useState(0);
  const [mountedPanels, setMountedPanels] = useState<ReadonlySet<ShellPanelId>>(
    () => new Set<ShellPanelId>(["home", initialPanel]),
  );
  const [balancesMounted, setBalancesMounted] = useState(initialPanel === balancesPanelId);
  const [revealSmallBalances, setRevealSmallBalances] = useState(false);
  const [forwardRequest, setForwardRequest] = useState(0);
  const pendingBalancesRestoreRef = useRef(false);
  const balancesReturnScrollRef = useRef(0);
  const pendingHistoryScrollRestoreRef = useRef<number | null>(null);
  const pendingShellScrollFrameRef = useRef<number | null>(null);
  const lastNonNullBalancesScopeRef = useRef<string | null>(null);
  const signedOutBoundaryClearedRef = useRef(false);
  const panelStageRef = useRef<HTMLElement>(null);
  const explicitLogoutRef = useRef(false);
  const coldGroupAnchorRef = useRef<MoneyGroupId | null>(
    initialPanel === balancesPanelId
      ? initialUrlIntent.location.group
      : null,
  );
  const [isAccountOpen, setIsAccountOpen] = useState(initialAccountOpen);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(initialAccountSettingsOpen);
  const { preference: appearancePreference, setAppearancePreference } = useAppearance();
  const [urlAddMoney, setUrlAddMoney] = useState(initialAddMoney);
  const [urlReturnedFromProvider, setUrlReturnedFromProvider] = useState(returnedFromProvider);
  const [urlSendFlow, setUrlSendFlow] = useState(initialSendFlow);
  const [urlSendActionId, setUrlSendActionId] = useState<string | null>(initialSendActionId);
  const [urlIntent, setUrlIntent] = useState<HomeInboundPanelState>(initialUrlIntent);
  const [homeDetailsOpen, setHomeDetailsOpen] = useState(false);
  const [popRevision, setPopRevision] = useState(0);
  const [rootRequest, setRootRequest] = useState<{ panel: ShellPanelId; revision: number } | null>(null);
  const [settingsOpenedInApp, setSettingsOpenedInApp] = useState(false);
  const [borrowMarketOpenedInApp, setBorrowMarketOpenedInApp] = useState(false);
  const [cashSavingsOpenedInApp, setCashSavingsOpenedInApp] = useState(() =>
    typeof window !== "undefined" && initialUrlIntent.location.cashView === "savings" &&
    window.history.state?.__cashSavingsOpenedInApp === true,
  );
  const cashSavingsFocusReturnRef = useRef(false);
  const [investmentsHoldingOpenedInApp, setInvestmentsHoldingOpenedInApp] = useState(() =>
    typeof window !== "undefined" && initialUrlIntent.location.holding != null &&
    window.history.state?.__investmentsHoldingOpenedInApp === true,
  );
  const holdingFocusReturnRef = useRef<{ key: AssetKey; scrollIntoView: boolean } | null>(null);
  const investChrome = useOptionalAppChrome();
  const [investmentsChrome, setInvestmentsChrome] = useState<NestedAppChrome | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const contentFrameRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const settingsRegionRef = useRef<HTMLElement>(null);
  const settingsOpenerRef = useRef<HTMLElement | null>(null);
  const settingsFocusHandoffRef = useRef(false);
  const settingsFocusStateRef = useRef<"uninitialized" | "open" | "closed">("uninitialized");
  const cancelPendingShellScroll = useCallback(() => {
    if (pendingShellScrollFrameRef.current === null) return;
    window.cancelAnimationFrame(pendingShellScrollFrameRef.current);
    pendingShellScrollFrameRef.current = null;
  }, []);
  const scheduleShellScroll = useCallback((scroll: () => void) => {
    cancelPendingShellScroll();
    pendingShellScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingShellScrollFrameRef.current = null;
      scroll();
    });
  }, [cancelPendingShellScroll]);

  useEffect(() => () => cancelPendingShellScroll(), [cancelPendingShellScroll]);

  useEffect(() => {
    startHomePerformance(panelStartupRoutes[initialPanel]);
    const frame = window.requestAnimationFrame(() => markHomePerformance("shell:paint"));
    return () => window.cancelAnimationFrame(frame);
  }, [initialPanel]);
  useEffect(() => {
    const shell = shellRef.current;
    const main = mainRef.current;
    if (!shell || !main) return;

    const syncScrollbarWidth = () => {
      const width = Math.max(0, main.offsetWidth - main.clientWidth);
      shell.style.setProperty("--shell-scrollbar-width", `${width}px`);
    };
    syncScrollbarWidth();

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(syncScrollbarWidth);
    observer?.observe(main);
    window.addEventListener("resize", syncScrollbarWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncScrollbarWidth);
    };
  }, []);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    let persistFrame: number | null = null;
    const persistScroll = () => {
      if (persistFrame !== null) {
        window.cancelAnimationFrame(persistFrame);
        persistFrame = null;
      }
      replaceClientScrollTop(main.scrollTop);
    };
    const schedulePersist = () => {
      if (persistFrame !== null) return;
      persistFrame = window.requestAnimationFrame(persistScroll);
    };
    if (readClientScrollTop() === null) replaceClientScrollTop(main.scrollTop);
    const unsubscribe = subscribeBeforeClientUrlCommit(persistScroll);
    main.addEventListener("scroll", schedulePersist, { passive: true });
    return () => {
      if (persistFrame !== null) window.cancelAnimationFrame(persistFrame);
      persistScroll();
      unsubscribe();
      main.removeEventListener("scroll", schedulePersist);
    };
  }, []);

  const applyUrlState = useCallback((intent: ReturnType<typeof readHomeInboundPanelState>) => {
    appliedUrlIntentRef.current = true;
    const legacyHref = legacyShellRedirectHref(
      window.location.pathname,
      new URLSearchParams(window.location.search),
    );
    if (legacyHref) commitClientUrl(legacyHref, "replace");
    setActiveNavigation(intent.panel);
    setMountedPanels((current) => current.has(intent.panel)
      ? current
      : new Set([...current, intent.panel]));
    if (intent.panel === balancesPanelId) setBalancesMounted(true);
    setIsAccountSettingsOpen(intent.account === "settings");
    if (intent.account !== "settings") setSettingsOpenedInApp(false);
    setIsAccountOpen(intent.account === "signin");
    setUrlAddMoney(intent.addMoney);
    setUrlReturnedFromProvider(intent.returnedFromProvider);
    setUrlSendFlow(intent.sendFlow);
    setUrlSendActionId(intent.actionId);
    setUrlIntent(intent);
  }, []);

  const currentUrlIntent = useCallback(() => readHomeInboundPanelState(
    parseShellLocation(window.location.pathname),
    new URLSearchParams(window.location.search),
  ), []);

  const setFlow = useCallback((
    flow: ShellFlow,
    options: { actionId?: string | null; mode?: "push" | "replace" } = {},
  ) => {
    const href = flowHref(
      window.location.pathname,
      flow,
      options.actionId ?? null,
      new URLSearchParams(window.location.search),
    );
    const pushed = commitFlowUrl(href, options.mode ?? "push");
    if (pushed) {
      window.history.replaceState({
        ...window.history.state,
        __homeFundingFlowPushed: flow === "add-money" || flow === "receive",
        __cashSavingsFlowPushed: window.location.pathname === "/cash/savings" &&
          (flow === "save-deposit" || flow === "save-withdraw"),
      }, "");
    }
    applyUrlState(currentUrlIntent());
    return pushed;
  }, [applyUrlState, currentUrlIntent]);

  const clearFlow = useCallback((options: {
    mode?: "push" | "replace";
    fundingReturn?: boolean;
    normalizeInbound?: boolean;
  } = {}) => {
    const next = new URL(
      withoutFlowHref(window.location.pathname, new URLSearchParams(window.location.search)),
      window.location.origin,
    );
    if (!options.normalizeInbound && options.mode !== "push" && window.location.pathname === "/cash/savings" &&
      window.history.state?.__cashSavingsFlowPushed === true &&
      (urlIntent.flow === "save-deposit" || urlIntent.flow === "save-withdraw")) {
      window.history.back();
      return;
    }
    if (options.fundingReturn) {
      next.searchParams.delete("return");
      next.searchParams.delete("add-money");
    }
    commitClientUrl(`${next.pathname}${next.search}`, options.mode ?? "replace");
    applyUrlState(currentUrlIntent());
  }, [applyUrlState, currentUrlIntent, urlIntent.flow]);

  const closeAccount = useCallback(() => {
    setIsAccountOpen(false);
    if (initialAccountOpen || readShellAccountParam(new URLSearchParams(window.location.search)) === "signin") {
      commitClientUrl("/", "replace");
      return;
    }
    window.history.back();
  }, [initialAccountOpen]);

  useEffect(() => {
    const onPopState = () => {
      const intent = currentUrlIntent();
      coldGroupAnchorRef.current = null;
      pendingHistoryScrollRestoreRef.current = intent.panel === balancesPanelId
        ? null
        : readClientScrollTop();
      const restoresBalances = intent.panel === balancesPanelId && isBalancesRestoreArmed();
      pendingBalancesRestoreRef.current = restoresBalances;
      setBorrowMarketOpenedInApp(false);
      cashSavingsFocusReturnRef.current = urlIntent.location.cashView === "savings" &&
        intent.panel === cashPanelId && intent.location.cashView === null;
      setCashSavingsOpenedInApp(intent.panel === cashPanelId &&
        intent.location.cashView === "savings" &&
        window.history.state?.__cashSavingsOpenedInApp === true);
      holdingFocusReturnRef.current = urlIntent.location.holding && intent.panel === investmentsPanelId && !intent.location.holding
        ? { key: urlIntent.location.holding, scrollIntoView: false } : null;
      setInvestmentsHoldingOpenedInApp(intent.panel === investmentsPanelId &&
        intent.location.holding != null && window.history.state?.__investmentsHoldingOpenedInApp === true);
      applyUrlState(intent);
      setPopRevision((revision) => revision + 1);
      if (intent.panel === balancesPanelId &&
        pendingHistoryScrollRestoreRef.current === null &&
        !restoresBalances) {
        mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
        setBalancesRevealReset((resetSignal) => resetSignal + 1);
      }
      setNavigationRequest((request) => request + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyUrlState, currentUrlIntent, isBalancesRestoreArmed, urlIntent.location.cashView, urlIntent.location.holding]);

  useEffect(() => {
    if (forwardRequest !== 0) pendingBalancesRestoreRef.current = false;
    if (forwardRequest !== 0) pendingHistoryScrollRestoreRef.current = null;
  }, [forwardRequest]);

  const isChecking = account.status === "restoring" || account.status === "validating";
  const sessionSettling = isSessionSettling(account);
  const isVerified = account.status === "verified" && account.verification === "server";
  const mayPaintBalances = account.verification !== null;
  useEffect(() => {
    if (isVerified) markHomePerformance("session:verified");
  }, [isVerified]);
  useEffect(() => {
    if (
      !applyInboundUrlIntent ||
      !isVerified ||
      !account.session?.smartAccount ||
      appliedUrlIntentRef.current
    ) return;
    appliedUrlIntentRef.current = true;
    const intent = pendingUrlIntentRef.current;
    applyUrlState(intent);
    setSettingsOpenedInApp(false);
    if (intent.panel !== activeNavigation) {
      setNavigationRequest((request) => request + 1);
    }
  }, [
    account.session?.smartAccount,
    activeNavigation,
    applyInboundUrlIntent,
    applyUrlState,
    isVerified,
  ]);
  const isUnavailable = account.status === "unavailable";
  const isSignedOut = account.status === "signed-out" || account.status === "signout-error";
  useEffect(() => {
    if (isUnavailable) markHomeStartupOutcome("unavailable");
    else if (isSignedOut) markHomeStartupOutcome("signed-out");
  }, [isSignedOut, isUnavailable]);
  useEffect(() => {
    if (isSignedOut) void AccountSignInSheet.preload();
  }, [isSignedOut]);
  const showAllAssetBalances = showSmallBalances || revealSmallBalances;
  const paintedAssetBalances = useMemo(
    () => mayPaintBalances
      ? (presentAssetBalances?.(showAllAssetBalances) ?? assetBalances ?? loadingAssetBalances)
      : loadingAssetBalances,
    [assetBalances, mayPaintBalances, presentAssetBalances, showAllAssetBalances],
  );
  const balancesRevalidating = balancesRevalidatingProp ?? paintedAssetBalances.revalidating === true;
  useEffect(() => {
    if (mayPaintBalances && paintedAssetBalances.status === "ready") {
      markHomePerformance("balances:painted");
    }
  }, [mayPaintBalances, paintedAssetBalances.status]);

  const balancesScope = homeBalancesRestoreScope({
    ownerKey: account.ownerKey,
    provider: account.session?.accountProvider ?? null,
    subject: account.session?.user.subject ?? null,
    smartAccount: account.session?.smartAccount?.address ?? null,
    region: regionId,
  });
  const balancesReveal = useBalancesRevealWindow(
    balancesScope,
    paintedAssetBalances.rows,
    balancesRevealReset,
  );
  const balancesAnchorKey = useMemo(
    () => balancesAnchorTopologyKey(paintedAssetBalances),
    [paintedAssetBalances],
  );
  const previousNavigationRef = useRef(activeNavigation);

  useEffect(() => {
    if (isSignedOut) {
      if (signedOutBoundaryClearedRef.current) return;
      signedOutBoundaryClearedRef.current = true;
      cancelPendingShellScroll();
      const hadScope = lastNonNullBalancesScopeRef.current !== null;
      lastNonNullBalancesScopeRef.current = null;
      disarmBalancesRestore();
      pendingBalancesRestoreRef.current = false;
      balancesReturnScrollRef.current = 0;
      pendingHistoryScrollRestoreRef.current = null;
      coldGroupAnchorRef.current = null;
      if (hadScope) setBalancesRevealReset((resetSignal) => resetSignal + 1);
      return;
    }
    signedOutBoundaryClearedRef.current = false;
    if (!isPreferenceReady || balancesScope === null) return;

    const previousScope = lastNonNullBalancesScopeRef.current;
    lastNonNullBalancesScopeRef.current = balancesScope;
    if (previousScope === null) {
      if (activeNavigation === balancesPanelId) {
        coldGroupAnchorRef.current = urlIntent.location.group;
      }
      return;
    }
    if (previousScope === balancesScope) return;

    cancelPendingShellScroll();
    disarmBalancesRestore();
    pendingBalancesRestoreRef.current = false;
    balancesReturnScrollRef.current = 0;
    pendingHistoryScrollRestoreRef.current = null;
    coldGroupAnchorRef.current = activeNavigation === balancesPanelId
      ? urlIntent.location.group
      : null;
    setBalancesRevealReset((resetSignal) => resetSignal + 1);
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [
    activeNavigation,
    balancesScope,
    cancelPendingShellScroll,
    disarmBalancesRestore,
    isPreferenceReady,
    isSignedOut,
    urlIntent.location.group,
  ]);

  useEffect(() => {
    const group = coldGroupAnchorRef.current;
    if (!group || activeNavigation !== balancesPanelId) {
      coldGroupAnchorRef.current = null;
      return;
    }
    if (!isPreferenceReady || balancesScope === null) return;
    if (paintedAssetBalances.status !== "ready") return;
    const target = document.getElementById(group);
    if (!target) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
    if (balancesRevalidating || !isVerified) return;
    coldGroupAnchorRef.current = null;
  }, [
    activeNavigation,
    balancesAnchorKey,
    balancesRevalidating,
    balancesScope,
    isPreferenceReady,
    isVerified,
    paintedAssetBalances.status,
  ]);

  useEffect(() => {
    if (navigationRequest === 0 || !panelStageRef.current) return;
    panelStageRef.current.focus({ preventScroll: true });
    if (cashSavingsFocusReturnRef.current) {
      cashSavingsFocusReturnRef.current = false;
      mainRef.current?.querySelector<HTMLButtonElement>(
        '[aria-labelledby="cash-savings-heading"] button',
      )?.focus({ preventScroll: true });
    }
    const holdingReturn = holdingFocusReturnRef.current;
    holdingFocusReturnRef.current = null;
    const holdingRow = holdingReturn && mainRef.current?.querySelector<HTMLElement>(
      `[data-holding-key="${CSS.escape(holdingReturn.key)}"]`,
    );
    holdingRow?.closest("button")?.focus({ preventScroll: true });
    cancelPendingShellScroll();
    const historyScrollTop = pendingHistoryScrollRestoreRef.current;
    pendingHistoryScrollRestoreRef.current = null;
    if (historyScrollTop !== null) {
      const restoreHistoryScroll = () => {
        mainRef.current?.scrollTo({
          top: clampHomeScrollTop(mainRef.current, historyScrollTop),
          behavior: "auto",
        });
      };
      restoreHistoryScroll();
      scheduleShellScroll(restoreHistoryScroll);
      pendingBalancesRestoreRef.current = false;
      if (activeNavigation === balancesPanelId) disarmBalancesRestore();
      previousNavigationRef.current = activeNavigation;
      return cancelPendingShellScroll;
    }
    const isBalances = activeNavigation === balancesPanelId;
    const shouldPreserveBalances = isBalances && pendingBalancesRestoreRef.current;
    if (isBalances) {
      pendingBalancesRestoreRef.current = false;
      if (shouldPreserveBalances) {
        const restoreBalancesScroll = () => {
          mainRef.current?.scrollTo({
            top: clampHomeScrollTop(mainRef.current, balancesReturnScrollRef.current),
            behavior: "auto",
          });
        };
        restoreBalancesScroll();
        scheduleShellScroll(restoreBalancesScroll);
      }
      disarmBalancesRestore();
    }
    const preservesPossibleAssetReturn =
      activeNavigation === "invest" && previousNavigationRef.current === balancesPanelId;
    previousNavigationRef.current = activeNavigation;
    if (!shouldPreserveBalances && !preservesPossibleAssetReturn) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const targetGroup = isBalances ? urlIntent.location.group : null;
      if (targetGroup) {
        scheduleShellScroll(() => {
          document.getElementById(targetGroup)?.scrollIntoView({
            block: "start",
            behavior: reducedMotion ? "auto" : "smooth",
          });
        });
      } else {
        mainRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
      }
    }
    if (holdingReturn?.scrollIntoView) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      holdingRow?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    }
    return cancelPendingShellScroll;
  }, [
    activeNavigation,
    cancelPendingShellScroll,
    disarmBalancesRestore,
    navigationRequest,
    scheduleShellScroll,
    urlIntent.location.group,
  ]);

  useEffect(() => {
    const focusHandedOff = settingsFocusHandoffRef.current;
    settingsFocusHandoffRef.current = false;
    const previousState = settingsFocusStateRef.current;
    settingsFocusStateRef.current = isAccountSettingsOpen ? "open" : "closed";
    if (isAccountSettingsOpen) {
      if (previousState !== "open") settingsRegionRef.current?.focus({ preventScroll: true });
      return;
    }
    if (previousState !== "open" || focusHandedOff) return;
    const opener = settingsOpenerRef.current;
    settingsOpenerRef.current = null;
    if (opener?.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) {
      opener.focus({ preventScroll: true });
      return;
    }
    const accountTrigger = shellRef.current
      ?.querySelector<HTMLButtonElement>("[data-shell-account-action] button");
    if (accountTrigger && !accountTrigger.disabled) {
      accountTrigger.focus({ preventScroll: true });
      return;
    }
    panelStageRef.current?.focus({ preventScroll: true });
  }, [isAccountSettingsOpen]);

  const activitySession: VerifiedAccountSession | null =
    isVerified && account.session?.smartAccount ? account.session : null;
  const homeRefreshEnabled = activitySession !== null && activeNavigation === "home" && !isAccountSettingsOpen;
  const flowOpen = urlIntent.flow !== null || urlIntent.addMoney || urlAddMoney || urlSendFlow;
  const { state: refreshState, refresh } = useHomeRefresh({
    session: activitySession,
    regionId,
    fetchActivity: account.fetchActivity,
    enabled: homeRefreshEnabled,
  });
  const gestureEnabled = homeRefreshEnabled && !flowOpen && !isAccountOpen && !homeDetailsOpen;
  const { phase: pullPhase, indicatorRef } = usePullToRefresh({
    scrollRef: mainRef,
    contentRef: contentFrameRef,
    enabled: gestureEnabled,
    refreshing: refreshState.phase === "refreshing",
    onRefresh: () => { void refresh(); },
  });
  useEffect(() => {
    if (isSignedOut && !explicitLogoutRef.current) {
      router.replace("/?account=signin", { scroll: false });
    }
  }, [isSignedOut, router]);

  function navigateTo(
    nextNavigation: ShellPanelId,
    group: MoneyGroupId | null = null,
    market: BorrowMarketId | null = null,
    cashView: "savings" | null = null,
    holding: AssetKey | null = null,
  ) {
    settingsOpenerRef.current = null;
    settingsFocusHandoffRef.current = true;
    const skipHistory = activeNavigation === nextNavigation && !isAccountSettingsOpen &&
      (nextNavigation !== "borrow" || urlIntent.location.market === market) &&
      (nextNavigation !== "cash" || urlIntent.location.cashView === cashView) &&
      (nextNavigation !== investmentsPanelId || urlIntent.location.holding === holding) &&
      (nextNavigation !== "invest" || window.location.pathname === shellHref({ panel: nextNavigation }));
    setRootRequest((request) => ({ panel: nextNavigation, revision: (request?.revision ?? 0) + 1 }));
    setIsAccountSettingsOpen(false);
    setSettingsOpenedInApp(false);
    if (nextNavigation !== "borrow") setBorrowMarketOpenedInApp(false);
    if (nextNavigation !== "cash") setCashSavingsOpenedInApp(false);
    if (nextNavigation !== investmentsPanelId) setInvestmentsHoldingOpenedInApp(false);
    if (!skipHistory) {
      setForwardRequest((request) => request + 1);
      const mayOpenAssetDetail = activeNavigation === balancesPanelId && nextNavigation === "invest";
      if (mayOpenAssetDetail) {
        balancesReturnScrollRef.current = mainRef.current?.scrollTop ?? 0;
        awaitBalancesAssetDetail();
      } else {
        disarmBalancesRestore();
      }
      if (nextNavigation === balancesPanelId || !mayOpenAssetDetail) {
        setBalancesRevealReset((resetSignal) => resetSignal + 1);
      }
    }
    setActiveNavigation(nextNavigation);
    setMountedPanels((current) => current.has(nextNavigation)
      ? current
      : new Set([...current, nextNavigation]));
    if (nextNavigation === balancesPanelId) setBalancesMounted(true);
    setNavigationRequest((request) => request + 1);
    if (!skipHistory) {
      commitClientUrl(shellHref({ panel: nextNavigation, group, market, cashView, holding }), "push",
        { __cashSavingsOpenedInApp: nextNavigation === cashPanelId && cashView === "savings",
          __cashSavingsFlowPushed: false,
          __investmentsHoldingOpenedInApp: nextNavigation === investmentsPanelId && holding !== null });
      setUrlIntent(currentUrlIntent());
    }
  }

  function selectCashSavings() {
    setCashSavingsOpenedInApp(true);
    navigateTo(cashPanelId, null, null, "savings");
  }

  function leaveCashSavings() {
    if (cashSavingsOpenedInApp && isClientHistoryEntry()) {
      setCashSavingsOpenedInApp(false);
      window.history.back();
      return;
    }
    commitClientUrl(shellHref({ panel: cashPanelId }), "replace");
    applyUrlState(currentUrlIntent());
    setNavigationRequest((request) => request + 1);
  }

  function selectInvestmentHolding(holding: AssetKey | null) {
    if (holding) {
      setInvestmentsHoldingOpenedInApp(true);
      navigateTo(investmentsPanelId, null, null, null, holding);
      return;
    }
    const previousHolding = urlIntent.location.holding;
    if (!previousHolding) return;
    holdingFocusReturnRef.current = { key: previousHolding, scrollIntoView: false };
    if (investmentsHoldingOpenedInApp && isClientHistoryEntry()) {
      setInvestmentsHoldingOpenedInApp(false);
      window.history.back();
      return;
    }
    holdingFocusReturnRef.current.scrollIntoView = true;
    setInvestmentsHoldingOpenedInApp(false);
    commitClientUrl(shellHref({ panel: investmentsPanelId }), "replace",
      { __investmentsHoldingOpenedInApp: false });
    applyUrlState(currentUrlIntent());
    setNavigationRequest((request) => request + 1);
  }

  function selectBorrowMarket(market: BorrowMarketId | null) {
    if (market) {
      setBorrowMarketOpenedInApp(true);
      navigateTo("borrow", null, market);
      return;
    }
    if (borrowMarketOpenedInApp) {
      setBorrowMarketOpenedInApp(false);
      window.history.back();
      return;
    }
    commitClientUrl(shellHref({ panel: "borrow" }), "replace");
    applyUrlState(currentUrlIntent());
    setNavigationRequest((request) => request + 1);
  }

  function openAccountSettings(opener?: HTMLButtonElement) {
    settingsOpenerRef.current = opener ?? shellRef.current
      ?.querySelector<HTMLButtonElement>("[data-shell-account-action] button") ?? null;
    setForwardRequest((request) => request + 1);
    if (activeNavigation === balancesPanelId && !isAccountSettingsOpen) {
      balancesReturnScrollRef.current = mainRef.current?.scrollTop ?? 0;
      armBalancesAccountOverlay();
    } else {
      disarmBalancesRestore();
      setBalancesRevealReset((resetSignal) => resetSignal + 1);
    }
    setIsAccountSettingsOpen(true);
    setSettingsOpenedInApp(true);
    commitClientUrl(shellHref({
      ...parseShellLocation(window.location.pathname),
      account: "settings",
    }));
  }

  function openAccount() {
    if (isVerified || (account.status === "unavailable" && account.isSignedIn)) {
      openAccountSettings();
      return;
    }
    setIsAccountOpen(true);
    if (readShellAccountParam(new URLSearchParams(window.location.search)) !== "signin") {
      commitClientUrl("/?account=signin");
    }
  }

  function closeAccountSettings() {
    if (settingsOpenedInApp) {
      window.history.back();
      return;
    }
    setIsAccountSettingsOpen(false);
    setForwardRequest((request) => request + 1);
    disarmBalancesRestore();
    setBalancesRevealReset((resetSignal) => resetSignal + 1);
    commitClientUrl(shellHref(parseShellLocation(window.location.pathname)), "replace");
  }

  function signOut() {
    explicitLogoutRef.current = true;
    setIsAccountSettingsOpen(false);
    settingsOpenerRef.current = null;
    settingsFocusHandoffRef.current = true;
    setForwardRequest((request) => request + 1);
    cancelPendingShellScroll();
    lastNonNullBalancesScopeRef.current = null;
    pendingBalancesRestoreRef.current = false;
    balancesReturnScrollRef.current = 0;
    pendingHistoryScrollRestoreRef.current = null;
    coldGroupAnchorRef.current = null;
    disarmBalancesRestore();
    setBalancesRevealReset((resetSignal) => resetSignal + 1);
    void account.signOut({
      onNavigationSafe: () => {
        router.replace("/", { scroll: false });
      },
    }).catch(() => {});
  }

  const nestedChromeTitle = isAccountSettingsOpen
    ? null
    : isHomeNestedPanelId(activeNavigation)
      ? activeNavigation === cashPanelId && urlIntent.location.cashView === "savings"
        ? "Savings"
        : activeNavigation === investmentsPanelId && urlIntent.location.holding
          ? investmentsChrome?.title ?? "Investments"
          : nestedHomePanelTitle(activeNavigation)
      : activeNavigation === "invest"
        ? investChrome?.nested?.title ?? null
        : null;
  const nestedChromeBackLabel = isHomeNestedPanelId(activeNavigation)
    ? "Back"
    : investChrome?.nested?.backLabel ?? "Back";
  function leaveHomeNestedPanel() {
    if (activeNavigation === balancesPanelId || !isClientHistoryEntry()) {
      navigateTo("home");
      return;
    }
    replaceClientScrollTop(mainRef.current?.scrollTop ?? 0);
    window.history.back();
  }

  const onNestedChromeBack = isHomeNestedPanelId(activeNavigation)
    ? activeNavigation === "borrow" && urlIntent.location.market
      ? () => selectBorrowMarket(null)
      : activeNavigation === cashPanelId && urlIntent.location.cashView === "savings"
        ? leaveCashSavings
      : activeNavigation === investmentsPanelId && urlIntent.location.holding
        ? () => selectInvestmentHolding(null)
        : leaveHomeNestedPanel
    : investChrome?.nested?.onBack ?? (() => {});

  const reloadBalances = useReloadHomeBalances();
  const retryHomeReads = interruption ? onRetryInterruption ?? reloadBalances : reloadBalances;
  const balanceRowRetry = headerStatus({ interruption, coverage: null })?.recovery === "none"
    ? undefined
    : retryHomeReads;
  const homeStatus = isVerified && !isAccountSettingsOpen
    ? headerStatus({
      interruption,
      coverage: activeNavigation === "home" ? homeBalancesStatus(paintedAssetBalances) : null,
    })
    : null;

  const navigateToRef = useRef(navigateTo);
  useEffect(() => { navigateToRef.current = navigateTo; });
  const openPanel = useCallback((panel: ShellPanelId) => navigateToRef.current(panel), []);
  const routingValue = useMemo(() => ({
    state: urlIntent,
    popRevision,
    rootRequest,
    openPanel,
    setFlow,
    clearFlow,
  }), [clearFlow, openPanel, popRevision, rootRequest, setFlow, urlIntent]);

  return (
    <HomeShellRoutingProvider value={routingValue}>
      <div
        ref={shellRef}
        className="flex h-svh max-h-svh flex-col overflow-hidden bg-muted [--shell-scrollbar-width:0px]"
      >
        <span role="status" className="sr-only">{isVerified && interruption && interruptionAnnouncement
          ? headerStatus({ interruption: { kind: interruptionAnnouncement }, coverage: null })?.message
          : null}</span>
      <ShellHeader
        isAccountSettingsOpen={isAccountSettingsOpen}
        nestedChromeTitle={nestedChromeTitle}
        nestedChromeBackLabel={nestedChromeBackLabel}
        onNestedChromeBack={onNestedChromeBack}
        routeMode="dashboard"
        activeNavigation={activeNavigation}
        isVerified={isVerified}
        account={account}
        onHome={() => navigateTo("home")}
        onDashboard={() => router.replace("/home")}
        onSignIn={openAccount}
        onSignOut={signOut}
        onOpenSettings={openAccountSettings}
        onCloseSettings={closeAccountSettings}
        status={homeStatus ? (
          <HomeHeaderStatus
            status={homeStatus}
            onRetry={retryHomeReads}
            onOpenAccount={() => openAccountSettings()}
          />
        ) : null}
      />
      <main
        ref={mainRef}
        data-app-main-authenticated
        className={`relative order-1 min-h-0 flex-1 overscroll-contain overflow-x-hidden bg-muted pb-4 scroll-pb-4 sm:order-2 ${shellScrollContainerClassName}`}
      >
        {homeRefreshEnabled ? <PullToRefreshIndicator phase={pullPhase} indicatorRef={indicatorRef} /> : null}
        {gestureEnabled ? <PullToRefreshAction label="Refresh Home" refreshing={refreshState.phase === "refreshing"} onRefresh={() => { void refresh(); }} /> : null}
        <div ref={contentFrameRef} className={`${shellContentFrameClassName} py-4 sm:py-6`}>
        <span role="status" aria-live="polite" className="sr-only">{homeRefreshEnabled
          ? refreshState.phase === "refreshing" ? "Refreshing Home" : refreshState.phase === "complete" ? "Home updated" : null
          : null}</span>
        {homeRefreshEnabled && (refreshState.phase === "failed" || refreshState.phase === "partial") ? (
          <Alert className="mb-4" role="alert">
            <AlertDescription>{refreshState.phase === "failed" ? "Couldn't refresh Home." : "Some of Home didn't refresh."}</AlertDescription>
            <AlertAction>
              <Button variant="outline" size="touch" onClick={() => { void refresh(); }}>Retry</Button>
            </AlertAction>
          </Alert>
        ) : null}
        {isUnavailable ? (
          <div className="mb-4">
            <LoadErrorCard
              description={account.message ?? "Account check unavailable."}
              onRetry={() => void account.retrySessionValidation()}
            />
          </div>
        ) : null}

        {isSignedOut ? (
          <section aria-busy="true" aria-label="Signed out">
            <span className="sr-only">Signed out</span>
          </section>
        ) : (
          <section
            ref={isAccountSettingsOpen ? settingsRegionRef : panelStageRef}
            className="outline-none"
            id="navigation-panel"
            tabIndex={-1}
            aria-labelledby={
              isAccountSettingsOpen || isHomeNestedPanelId(activeNavigation) || nestedChromeTitle
                ? undefined
                : `${activeNavigation}-nav`
            }
            aria-label={
              isAccountSettingsOpen
                ? "Account settings"
                  : nestedChromeTitle ?? undefined
            }
            aria-busy={isAccountSettingsOpen ? undefined : isChecking}
          >
            {isAccountSettingsOpen ? (
              <AccountSettings
                regionId={regionId}
                onRegionChange={selectRegion}
                resolutionSource={resolutionSource}
                preferenceMessage={preferenceMessage}
                isPreferenceReady={isPreferenceReady}
                accountAddress={isVerified ? (account.session?.smartAccount?.address ?? null) : null}
                accountOwnerKey={isVerified && account.session?.smartAccount ? dataOwnerKey(account.session) : null}
                fetchAccountResource={account.fetchAccountResource}
                showSmallBalances={showSmallBalances}
                onShowSmallBalancesChange={onShowSmallBalancesChange}
                appearancePreference={appearancePreference}
                onAppearancePreferenceChange={setAppearancePreference}
                onSignOut={signOut}
              />
            ) : (
              <div>
                {mountedPanels.has("home") ? (
                  <MountedShellPanel active={activeNavigation === "home"}>
                    <HomePanel
                      assetBalances={paintedAssetBalances}
                      activitySession={activitySession}
                      onRetryBalances={balanceRowRetry}
                      sessionSettling={sessionSettling}
                      sendAvailability={sendAvailability}
                      assetMarkResolution={assetMarkResolution}
                      fetchActivity={account.fetchActivity}
                      fetchOperations={account.fetchOperations}
                      onOpenCash={() => navigateTo(cashPanelId)}
                      onOpenInvestments={() => navigateTo(
                        paintedAssetBalances.summary?.investments.ownedCount === 0 &&
                        paintedAssetBalances.summary.investments.status === "complete"
                          ? "invest" : investmentsPanelId,
                      )}
                      onOpenBorrow={() => navigateTo(borrowPanelId)}
                      initialAddMoney={urlAddMoney}
                      returnedFromProvider={urlReturnedFromProvider}
                      initialSendFlow={urlSendFlow}
                      initialSendActionId={urlSendActionId}
                      regionId={regionId}
                      regionReady={regionReady}
                      onDetailsOpenChange={setHomeDetailsOpen}
                    />
                  </MountedShellPanel>
                ) : null}
                {balancesMounted ? (
                  <MountedShellPanel active={activeNavigation === balancesPanelId}>
                    <BalancesPage
                      active={activeNavigation === balancesPanelId}
                      assetBalances={paintedAssetBalances}
                      showSmallBalances={showSmallBalances}
                      revealSmallBalances={revealSmallBalances}
                      onRevealSmallBalancesChange={setRevealSmallBalances}
                      isChecking={isChecking}
                      revealedCount={balancesReveal.count}
                      onRevealMore={balancesReveal.extend}
                    />
                  </MountedShellPanel>
                ) : null}
                {mountedPanels.has(activityPanelId) ? (
                  <MountedShellPanel active={activeNavigation === activityPanelId}>
                    <ActivityPage
                      activitySession={activitySession}
                      fetchActivity={account.fetchActivity}
                      fetchOperations={account.fetchOperations}
                      regionId={regionId}
                      showSessionShimmer={activitySession ? !regionReady : (
                        sessionSettling ||
                        paintedAssetBalances.status === "loading" ||
                        paintedAssetBalances.revalidating === true
                      )}
                    />
                  </MountedShellPanel>
                ) : null}
                {mountedPanels.has(cashPanelId) ? (
                  <MountedShellPanel active={activeNavigation === cashPanelId}>
                    <CashPanel
                      regionId={regionId}
                      isVerified={isVerified}
                      isChecking={isChecking}
                      content={cashContent ? <CashPanelContent render={cashContent} view={urlIntent.location.cashView === "savings" ? "savings" : "cash"} onOpenSavings={selectCashSavings} /> : null}
                    />
                  </MountedShellPanel>
                ) : null}
                {mountedPanels.has(borrowPanelId) ? (
                  <MountedShellPanel active={activeNavigation === borrowPanelId}>
                    <AuthenticatedBorrowExperience
                      selectedMarketId={urlIntent.location.market}
                      onSelectMarket={selectBorrowMarket}
                      regionId={regionId}
                      assetMarkResolution={assetMarkResolution}
                      borrowSummary={paintedAssetBalances.summary?.borrow ?? null}
                    />
                  </MountedShellPanel>
                ) : null}
                {mountedPanels.has(investmentsPanelId) ? (
                  <MountedShellPanel active={activeNavigation === investmentsPanelId}>
                    <AppChromeProvider>
                      <PanelChromeSync onChrome={setInvestmentsChrome} />
                      <InvestmentsPanel regionId={regionId} content={investmentsContent ? (
                        <InvestmentsPanelContent render={investmentsContent}
                          holding={urlIntent.location.holding ?? null}
                          onOpenHolding={selectInvestmentHolding}
                          onCloseHolding={() => selectInvestmentHolding(null)} />
                      ) : null} />
                    </AppChromeProvider>
                  </MountedShellPanel>
                ) : null}
                {mountedPanels.has("invest") ? (
                  <MountedShellPanel active={activeNavigation === "invest"}>
                    <InvestPanel regionId={regionId} content={investContent} />
                  </MountedShellPanel>
                ) : null}
              </div>
            )}
          </section>
        )}
        </div>
      </main>
      {!isSignedOut ? (
        <PrimaryNavigation activeNavigation={activeNavigation} onNavigate={navigateTo} />
      ) : null}
      {isVerified ? (
        <ActionToasts session={account.session} fetchOperations={account.fetchOperations} />
      ) : null}
        <AccountSignInSheet
          open={isAccountOpen}
          onClose={closeAccount}
          onVerified={() => router.replace("/home")}
        />
      </div>
    </HomeShellRoutingProvider>
  );
}

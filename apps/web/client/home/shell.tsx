"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { restoreHoldingReturn } from "@/client/investments/restore-holding-return";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { isSessionSettling, useAccountWallet } from "@/client/account/cdp-client";
import { AccountSettings } from "@/client/account/account-settings";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { useAppearance } from "@/client/appearance/use-appearance";
import { borrowPanelId, cashPanelId, investmentsPanelId, isHomeNestedPanelId, nestedHomePanelTitle, type ShellPanelId } from "@/config/navigation";
import { backClientHistory, commitClientUrl, commitFlowUrl, flowHref, parseShellLocation, parseShellOverlayIntent, readClientHistoryFlag, readShellHistoryOrigin, shellHref, withoutFlowHref, writeShellHistoryOrigin, type ShellFlow } from "@/config/shell-location";
import { AppChromeProvider, useOptionalAppChrome, type NestedAppChrome } from "@/components/app-chrome";
import { LoadErrorCard } from "@/components/load-error";
import { useBreakpointFocusHandoff } from "@/components/breakpoint-focus";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { shellFrameClassName, shellNavigationClearanceClassName, shellDesktopContentClassName } from "@/components/shell-layout";
import { markHomePerformance, markHomeStartupOutcome, startHomePerformance } from "@/client/observability/perf-marks";
import { beginHomeNavigation, discardHomeInteractionSamples, commitHomeNavigation, takeHomeHistoryTraversal } from "@/client/observability/interaction-performance";
import { useHomeScrollPerformance } from "@/client/observability/use-home-scroll-performance";
import { ShellHeader } from "./shell-chrome";
import { HomeShellRoutingProvider, readHomeInboundPanelState, useActivityReturnOwnerBoundary, type ActivityDetailReturn } from "./panel-routing";
import { ShellPageProvider } from "./shell-page-context";
import { useShellDocumentScrollRestoration } from "./use-shell-document-scroll-restoration";
import { HomeHeaderStatus, headerStatus, homeBalancesStatus, useReloadHomeBalances } from "./home-status";
import { ActionToasts } from "./action-toasts";
import { scheduleAfterPaint } from "./after-paint";
import { useHomeRefresh } from "./use-home-refresh";
import { PullToRefreshAction, PullToRefreshIndicator, usePullToRefresh } from "@/components/ui/pull-to-refresh";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FundingActions } from "@/client/funding/funding-actions";
import { TransferActions } from "@/client/transfers";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import type { HomeExperienceProps, HomeAssetBalancesPresentation } from "./home-types";
import type { AssetKey } from "@/shared/balances/types";
import type { HomeInteractionRoute } from "@/shared/observability/client-performance.contract";

const AccountSignInSheet = deferSheet(() => import("@/client/account/account-screen").then((module) => module.AccountSignInSheet));
const EmailShareSheet = deferSheet(() => import("@/client/account/email-share-sheet").then((module) => module.EmailShareSheet));
const loadingAssetBalances: HomeAssetBalancesPresentation = {
  status: "loading", displayTotal: null, breakdown: [], summary: null,
};
const startupRoutes: Record<ShellPanelId, HomeInteractionRoute> = {
  home: "/home", card: "/card", activity: "/activity", cash: "/cash", borrow: "/borrow", investments: "/investments", invest: "/invest",
};

export type DashboardShellProps = Omit<HomeExperienceProps, "landingVisual" | "routeMode"> & { children?: ReactNode };

export function DashboardShell(props: DashboardShellProps) {
  return <AppChromeProvider><DashboardShellBody {...props} /></AppChromeProvider>;
}

function DashboardShellBody({
  children, investContent, cashContent, investmentsContent, cardsEnabled = false, initialAccountOpen = false,
  initialAccountSettingsOpen = false, assetBalances, initialRateLabels,
  interruption = null, interruptionAnnouncement = null, onRetryInterruption,
  sendAvailability = [], canOpenAssetDetail = () => false, assetMarkResolution,
  showSmallBalances = false, onShowSmallBalancesChange = () => {},
  region, regionReady = true,
}: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const location = parseShellLocation(pathname);
  const [urlSearchOverride, setUrlSearchOverride] = useState<string | null>(null);
  const [flowOrigin, setFlowOrigin] = useState<{ href: string; opener: HTMLElement | null } | null>(null);
  const [accountOpener, setAccountOpener] = useState<HTMLElement | null>(null);
  const currentSearch = new URLSearchParams(urlSearchOverride ?? searchParams.toString());
  const overlay = parseShellOverlayIntent(currentSearch);
  const urlIntent = readHomeInboundPanelState(location, currentSearch);
  const flowOpener = flowOrigin?.href === `${pathname}${currentSearch.size ? `?${currentSearch}` : ""}` ? flowOrigin.opener : null;
  if (flowOrigin !== null && flowOpener === null && flowOrigin.opener !== null) setFlowOrigin(null);
  const activeNavigation = location.panel;
  const account = useAccountWallet();
  const { preference: appearancePreference, setAppearancePreference } = useAppearance();
  const [homeDetailsOpen, setHomeDetailsOpen] = useState(false);
  const [investmentsChrome, setInvestmentsChrome] = useState<NestedAppChrome | null>(null);
  const [popRevision, setPopRevision] = useState(0);
  const [rootRequest, setRootRequest] = useState<{ panel: ShellPanelId; revision: number } | null>(null);
  const [settingsOpenedInApp, setSettingsOpenedInApp] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(initialAccountOpen);
  const [settingsRequested, setSettingsRequested] = useState(initialAccountSettingsOpen);
  const isAccountSettingsOpen = overlay.account === "settings" || settingsRequested;
  const explicitLogoutRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const contentFrameRef = useRef<HTMLDivElement>(null);
  const settingsRegionRef = useRef<HTMLElement>(null);
  const panelStageRef = useRef<HTMLElement>(null);
  const wasSettingsOpenRef = useRef(false);
  const previousPanelRef = useRef(activeNavigation);
  const activeNavigationRef = useRef(activeNavigation);
  const previousLocationRef = useRef(location);
  const holdingRestoreRef = useRef<(() => void) | null>(null);
  const [investmentsReturnHolding, setInvestmentsReturnHolding] = useState<AssetKey | null>(null);
  const pendingOriginRef = useRef<{ origin: string; target: string } | null>(null);
  const activityReturnRef = useRef<ActivityDetailReturn | null>(null);
  const [activityReturn, setActivityReturnState] = useState<ActivityDetailReturn | null>(null);
  useBreakpointFocusHandoff();
  useHomeScrollPerformance("document", startupRoutes[activeNavigation], "first-visit");

  const isChecking = account.status === "restoring" || account.status === "validating";
  const isAccountRailBusy = isChecking || account.status === "signing-out";
  const isVerified = account.status === "verified" && account.verification === "server";
  const isSignedOut = account.status === "signed-out" || account.status === "signout-error";
  const isSignedInAccount = account.status === "verified" || (account.status === "unavailable" && account.isSignedIn);
  const isUnavailable = account.status === "unavailable";
  const sessionSettling = isSessionSettling(account);
  const mayPaintBalances = account.verification !== null;
  const paintedAssetBalances = useMemo(() => mayPaintBalances
    ? (assetBalances ?? loadingAssetBalances)
    : loadingAssetBalances, [mayPaintBalances, assetBalances]);
  const activitySession = isVerified && account.session?.smartAccount ? account.session : null;
  const activityOwner = activitySession ? dataOwnerKey(activitySession) : null;
  useShellDocumentScrollRestoration(pathname, activityOwner);
  const homeRefreshEnabled = activitySession !== null && activeNavigation === "home" && !isAccountSettingsOpen;
  const flowOpen = overlay.flow !== null || overlay.addMoney || overlay.returnedFromFunding;
  const { state: refreshState, refresh } = useHomeRefresh({
    session: activitySession, regionId: region.regionId, fetchActivity: account.fetchActivity, enabled: homeRefreshEnabled,
  });
  const { phase: pullPhase, indicatorRef, actionRef } = usePullToRefresh({
    scrollRef: mainRef, scrollElement: "document", contentRef: contentFrameRef,
    enabled: homeRefreshEnabled && !flowOpen && !isAccountOpen && !homeDetailsOpen,
    refreshing: refreshState.phase === "refreshing", onRefresh: () => { void refresh(); },
  });
  useEffect(() => {
    for (const panel of ["home", "activity", "cash", "cash/savings", "borrow", "investments", "invest"])
      if (`/${panel}` !== pathname) router.prefetch(`/${panel}`);
    if (cardsEnabled && pathname !== "/card") router.prefetch("/card");
  }, [router, pathname, cardsEnabled]);
  useEffect(() => {
    startHomePerformance(startupRoutes[activeNavigation]);
    const frame = requestAnimationFrame(() => markHomePerformance("shell:paint"));
    return () => cancelAnimationFrame(frame);
  }, [activeNavigation]);
  useEffect(() => { commitHomeNavigation(startupRoutes[activeNavigation]); }, [activeNavigation]);
  useLayoutEffect(() => {
    const from = activeNavigationRef.current;
    activeNavigationRef.current = activeNavigation;
    if (from === activeNavigation) return;
    const startedAt = takeHomeHistoryTraversal(window.location.pathname);
    if (startedAt !== null) beginHomeNavigation({ from: startupRoutes[from], to: startupRoutes[activeNavigation], cache: "first-visit", trigger: "history", startedAt });
  }, [activeNavigation]);
  useEffect(() => {
    if (isVerified) markHomePerformance("session:verified");
    if (mayPaintBalances && paintedAssetBalances.status === "ready") markHomePerformance("balances:painted");
  }, [isVerified, mayPaintBalances, paintedAssetBalances.status]);
  useEffect(() => {
    if (isUnavailable) markHomeStartupOutcome("unavailable");
    else if (isSignedOut) markHomeStartupOutcome("signed-out");
  }, [isUnavailable, isSignedOut]);
  useEffect(() => {
    if (isSignedOut) {
      void AccountSignInSheet.preload();
      if (!explicitLogoutRef.current) router.replace("/?account=signin", { scroll: false });
    }
  }, [isSignedOut, router]);
  useEffect(() => {
    const onPop = () => {
      const pending = activityReturnRef.current;
      if (pending?.suspended && pending.path === window.location.pathname) {
        activityReturnRef.current = { ...pending, opening: false, suspended: false };
        setActivityReturnState(activityReturnRef.current);
      }
      pendingOriginRef.current = null;
      setFlowOrigin(null);
      setAccountOpener(null);
      setUrlSearchOverride(null); setSettingsRequested(false); setPopRevision((revision) => revision + 1); };
    const onVisibility = () => { if (document.visibilityState !== "visible") discardHomeInteractionSamples(); };
    window.addEventListener("popstate", onPop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("visibilitychange", onVisibility); discardHomeInteractionSamples(); };
  }, []);
  useLayoutEffect(() => {
    const pending = pendingOriginRef.current;
    if (pending === null) return;
    pendingOriginRef.current = null;
    if (pending.target === pathname) writeShellHistoryOrigin(pending.origin);
  }, [pathname]);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const syncWidth = () => shell.style.setProperty("--shell-scrollbar-width", `${Math.max(0, window.innerWidth - document.documentElement.clientWidth)}px`);
    syncWidth();
    window.addEventListener("resize", syncWidth);
    return () => window.removeEventListener("resize", syncWidth);
  }, []);
  useEffect(() => {
    if (isAccountSettingsOpen) {
      wasSettingsOpenRef.current = true;
      settingsRegionRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!wasSettingsOpenRef.current) return;
    wasSettingsOpenRef.current = false;
    const visible = (target: HTMLElement | null): target is HTMLElement =>
      Boolean(target && target.isConnected && target.getClientRects().length > 0 &&
        !(target instanceof HTMLButtonElement && target.disabled));
    const previous = accountOpener;
    const rail = shellRef.current?.querySelector<HTMLElement>("[data-rail-account-action]") ?? null;
    const header = shellRef.current?.querySelector<HTMLElement>("[data-shell-account-action] button") ?? null;
    const target = visible(previous) ? previous : visible(rail) ? rail : visible(header) ? header : panelStageRef.current;
    target?.focus({ preventScroll: true });
    setAccountOpener(null);
  }, [isAccountSettingsOpen, accountOpener]);
  useLayoutEffect(() => {
    const previous = previousLocationRef.current;
    previousLocationRef.current = location;
    if (previous.cashView === "savings" && location.panel === "cash" && location.cashView === null) {
      mainRef.current?.querySelector<HTMLButtonElement>('[aria-labelledby="cash-savings-heading"] button')?.focus({ preventScroll: true });
    }
    if (previous.panel !== location.panel || previous.holding !== location.holding) {
      holdingRestoreRef.current?.();
      holdingRestoreRef.current = null;
    }
    const main = mainRef.current;
    if (!previous.holding || location.panel !== "investments" || location.holding || !main) return;
    const row = main.querySelector<HTMLElement>(`[data-holding-key="${CSS.escape(previous.holding)}"]`);
    if (row || !main.querySelector('[aria-labelledby="investments-held-heading"][aria-busy="true"]')) {
      row?.closest("button")?.focus({ preventScroll: true });
      return;
    }
    holdingRestoreRef.current = restoreHoldingReturn(main, previous.holding, (restored) => {
      holdingRestoreRef.current = null;
      restored?.closest("button")?.focus({ preventScroll: true });
      restored?.scrollIntoView({ block: "center", behavior: "auto" });
    });
  }, [location]);
  useEffect(() => () => {
    holdingRestoreRef.current?.();
    holdingRestoreRef.current = null;
  }, [account.ownerKey, isAccountSettingsOpen]);
  useEffect(() => {
    if (previousPanelRef.current === activeNavigation) return;
    previousPanelRef.current = activeNavigation;
    setSettingsRequested(false);
    const stage = panelStageRef.current;
    if (!stage) return;
    let focusMoved = false;
    const onFocus = () => { focusMoved = true; };
    document.addEventListener("focusin", onFocus);
    const cancel = scheduleAfterPaint(() => {
      document.removeEventListener("focusin", onFocus);
      if (focusMoved || panelStageRef.current !== stage) return;
      stage.focus({ preventScroll: true });
    });
    return () => {
      document.removeEventListener("focusin", onFocus);
      cancel();
    };
  }, [activeNavigation]);
  const pushRoute = useCallback((href: string) => {
    setFlowOrigin(null);
    setAccountOpener(null);
    const target = new URL(href, window.location.origin);
    if (`${target.pathname}${target.search}` === `${window.location.pathname}${window.location.search}`) {
      router.push(href);
      return;
    }
    const targetPanel = parseShellLocation(target.pathname).panel;
    pendingOriginRef.current = target.pathname === window.location.pathname || targetPanel === "home" || targetPanel === "invest"
      ? null : { origin: window.location.pathname, target: target.pathname };
    router.push(href);
  }, [router, setFlowOrigin, setAccountOpener]);
  const leaveRoute = useCallback((href: string) => {
    setFlowOrigin(null);
    setAccountOpener(null);
    if (readShellHistoryOrigin() !== null) router.back();
    else router.replace(href);
  }, [router, setFlowOrigin, setAccountOpener]);

  const navigateTo = useCallback((panel: ShellPanelId) => {
    setFlowOrigin(null);
    setAccountOpener(null);
    setInvestmentsReturnHolding(null);
    takeHomeHistoryTraversal(null);
    if (panel !== activeNavigation) beginHomeNavigation({ from: startupRoutes[activeNavigation], to: startupRoutes[panel], cache: "first-visit", trigger: "in-app" });
    activityReturnRef.current = null;
    setActivityReturnState(null);
    setUrlSearchOverride(null);
    setRootRequest((current) => ({ panel, revision: (current?.revision ?? 0) + 1 }));
    setSettingsRequested(false);
    const href = shellHref({ panel });
    if (window.location.pathname === href) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    if (`${window.location.pathname}${window.location.search}` !== href) pushRoute(href);
  }, [pushRoute, activeNavigation, setUrlSearchOverride, setFlowOrigin, setAccountOpener]);
  const setFlow = useCallback((flow: ShellFlow, options: { actionId?: string | null; mode?: "push" | "replace"; opener?: HTMLElement | null } = {}) => {
    const href = flowHref(window.location.pathname, flow, options.actionId ?? null,
      new URLSearchParams(window.location.search));
    const pushed = commitFlowUrl(href, options.mode ?? "push");
    setFlowOrigin({ href, opener: options.opener ?? null });
    setUrlSearchOverride(new URL(href, window.location.origin).search);
    if (pushed) window.history.replaceState({ ...window.history.state,
      __homeFundingFlowPushed: flow === "add-money" || flow === "receive",
      __cashSavingsFlowPushed: window.location.pathname === "/cash/savings" &&
        (flow === "save-deposit" || flow === "save-withdraw"),
    }, "");
    return pushed;
  }, [setUrlSearchOverride, setFlowOrigin]);
  const clearFlow = useCallback((options: {
    mode?: "push" | "replace"; fundingReturn?: boolean; normalizeInbound?: boolean;
  } = {}) => {
    setFlowOrigin(null);
    if (!options.normalizeInbound && options.mode !== "push" && window.location.pathname === "/cash/savings" &&
      readClientHistoryFlag("cashSavingsFlowPushed") &&
      (overlay.flow === "save-deposit" || overlay.flow === "save-withdraw")) {
      backClientHistory();
      return;
    }
    const next = new URL(withoutFlowHref(window.location.pathname, new URLSearchParams(window.location.search)), window.location.origin);
    if (options.fundingReturn) { next.searchParams.delete("return"); next.searchParams.delete("add-money"); }
    commitClientUrl(`${next.pathname}${next.search}`, options.mode ?? "replace");
    setUrlSearchOverride(next.search);
  }, [overlay.flow, setUrlSearchOverride, setFlowOrigin]);
  const openCashSavings = () => {
    pushRoute(shellHref({ panel: "cash", cashView: "savings" }));
  };
  const openInvestmentHolding = (holding: AssetKey) => {
    setInvestmentsReturnHolding(null);
    pushRoute(shellHref({ panel: "investments", holding }));
  };
  const openAssetDetail = useCallback((key: string) => {
    if (!canOpenAssetDetail(key)) return false;
    pushRoute(shellHref({ panel: "investments", holding: key as AssetKey }));
    return true;
  }, [pushRoute, canOpenAssetDetail]);
  const closeInvestmentHolding = () => {
    setInvestmentsReturnHolding(location.holding ?? null);
    leaveRoute(shellHref({ panel: "investments" }));
  };
  const routingValue = {
    activityReturn,
    getActivityReturn: () => activityReturnRef.current,
    setActivityReturn: (value: ActivityDetailReturn | null) => { activityReturnRef.current = value; setActivityReturnState(value); },
    state: urlIntent, flowOpener, popRevision, rootRequest, openPanel: navigateTo, leaveRoute, pushRoute,
    canOpenAssetDetail, openAssetDetail, setFlow, clearFlow,
  };
  useActivityReturnOwnerBoundary(activityOwner, routingValue);
  const { regionId, resolutionSource, isPreferenceReady, preferenceMessage, selectRegion, offeredCountries } = region;
  const reloadBalances = useReloadHomeBalances();
  const retryHomeReads = onRetryInterruption ?? reloadBalances;
  const balanceRowRetry = headerStatus({ interruption, coverage: null })?.recovery === "none" ? undefined : retryHomeReads;
  const pageValue = {
    paintedAssetBalances, activitySession, fetchActivity: account.fetchActivity, fetchOperations: account.fetchOperations,
    regionId, regionReady, initialRateLabels, sessionSettling, isChecking, isVerified, sendAvailability, assetMarkResolution,
    showSmallBalances,
    cardsEnabled,
    cashContent, investContent, investmentsContent, onHomeDetailsOpenChange: setHomeDetailsOpen, onInvestmentsChromeChange: setInvestmentsChrome, openInvestmentHolding, closeInvestmentHolding, investmentsReturnHolding: location.panel === "investments" ? investmentsReturnHolding : null, openCashSavings,
    onRetryBalances: balanceRowRetry, initialAddMoney: urlIntent.addMoney,
    returnedFromProvider: urlIntent.returnedFromProvider, initialSendFlow: urlIntent.sendFlow,
    initialSendActionId: urlIntent.actionId,
  };
  const openAccountSettings = (opener?: HTMLButtonElement) => {
    setAccountOpener(opener ?? null);
    setSettingsOpenedInApp(true);
    commitClientUrl(shellHref({ ...location, account: "settings" }));
    setUrlSearchOverride("?account=settings");
    setSettingsRequested(true);
  };
  const closeAccountSettings = () => {
    if (settingsOpenedInApp) { setSettingsOpenedInApp(false); backClientHistory(); }
    else {
      commitClientUrl(shellHref(location), "replace");
      setUrlSearchOverride("");
    }
    setSettingsRequested(false);
  };
  const signOut = () => {
    activityReturnRef.current = null;
    setActivityReturnState(null);
    explicitLogoutRef.current = true;
    setUrlSearchOverride(null);
    setSettingsOpenedInApp(false);
    setSettingsRequested(false);
    void account.signOut({ onNavigationSafe: () => router.replace("/", { scroll: false }) }).catch(() => {}); // oxlint-disable-line home/no-silent-catch -- account sign-out owns its signout-error state; navigation is only called when safe
  };
  const investChrome = useOptionalAppChrome();
  const nestedChromeTitle = isAccountSettingsOpen ? null : isHomeNestedPanelId(activeNavigation)
    ? activeNavigation === cashPanelId && location.cashView === "savings" ? "Savings"
      : activeNavigation === investmentsPanelId && location.holding ? investmentsChrome?.title ?? "Investments"
      : nestedHomePanelTitle(activeNavigation)
    : activeNavigation === "invest" ? investChrome?.nested?.title ?? null : null;
  const shellParentHref = activeNavigation === investmentsPanelId && location.holding
    ? shellHref({ panel: "investments" })
    : activeNavigation === cashPanelId && location.cashView === "savings"
    ? shellHref({ panel: "cash" })
    : activeNavigation === borrowPanelId && location.market
    ? shellHref({ panel: "borrow" })
    : isHomeNestedPanelId(activeNavigation) ? shellHref({ panel: "home" }) : null;
  const onNestedChromeBack = activeNavigation === investmentsPanelId && location.holding
    ? closeInvestmentHolding
    : shellParentHref !== null
    ? () => leaveRoute(shellParentHref)
    : investChrome?.nested?.onBack ?? (() => router.push("/invest"));
  const homeStatus = isVerified && !isAccountSettingsOpen ? headerStatus({
    interruption, coverage: activeNavigation === "home" ? homeBalancesStatus(paintedAssetBalances) : null,
  }) : null;

  return <HomeShellRoutingProvider value={routingValue}><ShellPageProvider value={pageValue}>
    <div ref={shellRef} className="flex min-h-svh flex-col bg-muted [--shell-scrollbar-width:0px] lg:flex-row">
      {!isSignedOut ? <PrimaryNavigation layout="rail" cardsEnabled={cardsEnabled} activeNavigation={activeNavigation} onNavigate={navigateTo}
        isAccountSettingsOpen={isAccountSettingsOpen} account={isAccountRailBusy || isSignedInAccount ? {
          status: isAccountRailBusy ? "loading" : "ready", ownerKey: account.ownerKey,
          address: account.session?.smartAccount?.address ?? null, disabled: isAccountRailBusy,
        } : undefined} onOpenAccount={openAccountSettings} /> : null}
      <div className="flex min-h-svh min-w-0 flex-1 flex-col">
        <span role="status" className="sr-only">{isVerified && interruption && interruptionAnnouncement
          ? headerStatus({ interruption: { kind: interruptionAnnouncement }, coverage: null })?.message : null}</span>
        <ShellHeader hasDesktopRail={!isSignedOut} isAccountSettingsOpen={isAccountSettingsOpen}
          nestedChromeTitle={nestedChromeTitle} nestedChromeBackLabel={isHomeNestedPanelId(activeNavigation) ? "Back" : investChrome?.nested?.backLabel ?? "Back"} onNestedChromeBack={onNestedChromeBack}
          routeMode="dashboard" activeNavigation={activeNavigation} isVerified={isVerified} account={account}
          onHome={() => navigateTo("home")} onDashboard={() => router.replace("/home")}
          onSignIn={(opener) => { setAccountOpener(opener); setIsAccountOpen(true); router.push("/?account=signin"); }}
          onSignOut={signOut} onOpenSettings={openAccountSettings} onCloseSettings={closeAccountSettings}
          status={homeStatus ? <HomeHeaderStatus status={homeStatus} onRetry={retryHomeReads} onOpenAccount={() => openAccountSettings()} /> : null} />
        <main ref={mainRef} data-app-main-authenticated className={`relative min-w-0 flex-1 bg-muted ${shellNavigationClearanceClassName}`}>
          {homeRefreshEnabled ? <PullToRefreshAction label="Refresh Home" refreshing={refreshState.phase === "refreshing"}
            onRefresh={() => { void refresh(); }} actionRef={actionRef} /> : null}
          {homeRefreshEnabled ? <PullToRefreshIndicator phase={pullPhase} indicatorRef={indicatorRef} /> : null}
          <div ref={contentFrameRef} className={`${shellFrameClassName} py-4 sm:py-6`}>
            <span role="status" aria-live="polite" className="sr-only">{homeRefreshEnabled
              ? refreshState.phase === "refreshing" ? "Refreshing Home" : refreshState.phase === "complete" ? "Home updated" : null : null}</span>
            {homeRefreshEnabled && (refreshState.phase === "failed" || refreshState.phase === "partial") ? <Alert className="mb-4" role="alert">
              <AlertDescription>{refreshState.phase === "failed" ? "Couldn't refresh Home." : "Some of Home didn't refresh."}</AlertDescription>
              <AlertAction><Button variant="outline" size="touch" onClick={() => { void refresh(); }}>Retry</Button></AlertAction>
            </Alert> : null}
            {isUnavailable ? <div className="mb-4"><LoadErrorCard description={account.message ?? "Account check unavailable."}
              onRetry={() => void account.retrySessionValidation()} /></div> : null}
            {isSignedOut ? <section aria-busy="true" aria-label="Signed out"><span className="sr-only">Signed out</span></section> :
              <section ref={isAccountSettingsOpen ? settingsRegionRef : panelStageRef} className="outline-none"
                id="navigation-panel" tabIndex={-1} data-breakpoint-peer={isAccountSettingsOpen ? "account-settings" : undefined}
                aria-labelledby={isAccountSettingsOpen || isHomeNestedPanelId(activeNavigation) || nestedChromeTitle ? undefined : `${activeNavigation}-nav`}
                aria-label={isAccountSettingsOpen ? "Account settings" : nestedChromeTitle ?? undefined}
                aria-busy={isAccountSettingsOpen ? undefined : isChecking}>
                {isAccountSettingsOpen ? <div className={shellDesktopContentClassName}><AccountSettings
                  regionId={regionId} onRegionChange={selectRegion} resolutionSource={resolutionSource}
                  offeredCountries={offeredCountries}
                  preferenceMessage={preferenceMessage} isPreferenceReady={isPreferenceReady}
                  accountAddress={isVerified ? account.session?.smartAccount?.address ?? null : null}
                  accountOwnerKey={isVerified && account.session?.smartAccount ? dataOwnerKey(account.session) : null}
                  fetchAccountResource={account.fetchAccountResource} showSmallBalances={showSmallBalances}
                  onShowSmallBalancesChange={onShowSmallBalancesChange} appearancePreference={appearancePreference}
                  onAppearancePreferenceChange={setAppearancePreference} onSignOut={signOut} /></div> : children}
              </section>}
          </div>
        </main>
        {!isSignedOut ? <PrimaryNavigation activeNavigation={activeNavigation} cardsEnabled={cardsEnabled} onNavigate={navigateTo} /> : null}
        {activeNavigation !== "home" ? <>
          <FundingActions showTrigger={false} initialOpen={urlIntent.addMoney} returnedFromProvider={urlIntent.returnedFromProvider}
            regionId={regionId} regionReady={regionReady} />
          <PresentationRegionProvider regionId={regionId}><TransferActions showTrigger={false}
            initialOpen={urlIntent.sendFlow} initialActionId={urlIntent.actionId}
            availableAssets={sendAvailability} assetMarkResolution={assetMarkResolution ?? { images: {}, pending: false }}
            regionId={regionId} regionReady={regionReady} /></PresentationRegionProvider>
        </> : null}
        {isVerified ? <ActionToasts session={account.session} regionId={regionId} fetchOperations={account.fetchOperations} /> : null}
      {account.emailRequest ? (
        <EmailShareSheet
          open={account.emailRequest.pending}
          opener={null}
          onShare={account.emailRequest.share}
          onNotNow={account.emailRequest.dismiss}
        />
      ) : null}
        <AccountSignInSheet open={isAccountOpen} opener={accountOpener} onClose={() => { setIsAccountOpen(false); router.replace("/"); }}
          onVerified={() => window.location.replace("/home")} />
      </div>
    </div>
  </ShellPageProvider></HomeShellRoutingProvider>;
}

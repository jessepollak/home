"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { AccountSignInSheet } from "@/client/account/account-screen";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  balancesPanelId,
  isHomeNestedPanelId,
  nestedHomePanelTitle,
  type ShellPanelId,
} from "@/config/navigation";
import {
  commitClientUrl,
  flowHref,
  parseShellLocation,
  shellHref,
  withoutFlowHref,
  type ShellFlow,
} from "@/config/shell-location";
import { presentationRegions } from "@/config/regions";
import { useOptionalAppChrome } from "@/components/app-chrome";
import { markHomePerformance } from "@/client/observability/perf-marks";
import {
  balancesListKey,
  clampHomeScrollTop,
  homeBalancesRestoreScope,
  useBalancesRevealWindow,
} from "./balances-panel";
import type { HomeExperienceProps, HomeAssetBalancesPresentation } from "./home-types";
import {
  HomeShellRoutingProvider,
  homePanelHref,
  readHomeInboundPanelState,
  type HomeInboundPanelState,
} from "./panel-routing";
import { ShellHeader, SignedOutLanding } from "./shell-chrome";
import { DashboardShell } from "./shell-panels";
import { ActionToasts } from "./action-toasts";
import { useHomeRegion } from "./use-home-region";

const loadingAssetBalances: HomeAssetBalancesPresentation = {
  status: "loading",
  displayTotal: null,
  statusLabel: "Updating…",
  items: [],
};

type RegionStyle = CSSProperties & {
  "--region-accent": string;
  "--region-accent-soft": string;
  "--region-surface": string;
};

type HomeShellProps = HomeExperienceProps & {
  disarmBalancesRestore: () => void;
  awaitBalancesAssetDetail: () => void;
  armBalancesAccountOverlay: () => void;
  isBalancesRestoreArmed: () => boolean;
};

export function HomeShell({
  detectedCountry = null,
  investContent,
  savingsContent,
  initialAccountOpen = false,
  initialPanel = "home",
  initialAccountSettingsOpen = false,
  assetBalances,
  assetMarkResolution,
  landingVisual,
  routeMode = "landing",
  initialAddMoney = false,
  returnedFromCoinbase = false,
  initialSendFlow = false,
  initialSendActionId = null,
  applyInboundUrlIntent = false,
  selectedRegionId,
  onRegionChange,
  disarmBalancesRestore,
  awaitBalancesAssetDetail,
  armBalancesAccountOverlay,
  isBalancesRestoreArmed,
}: HomeShellProps) {
  const router = useRouter();
  const account = useAccountWallet();
  const [initialUrlIntent] = useState(() => readHomeInboundPanelState(
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search),
  ));
  const pendingUrlIntentRef = useRef(initialUrlIntent);
  const appliedUrlIntentRef = useRef(false);
  const {
    regionId,
    resolutionSource,
    isPreferenceReady,
    preferenceMessage,
    selectRegion,
  } = useHomeRegion({ detectedCountry, selectedRegionId, onRegionChange });
  const [activeNavigation, setActiveNavigation] = useState<ShellPanelId>(initialPanel);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const [balancesRevealReset, setBalancesRevealReset] = useState(0);
  const [mountedPanels, setMountedPanels] = useState<ReadonlySet<ShellPanelId>>(
    () => new Set<ShellPanelId>(["home", initialPanel]),
  );
  const [balancesMounted, setBalancesMounted] = useState(initialPanel === balancesPanelId);
  const [forwardRequest, setForwardRequest] = useState(0);
  const pendingBalancesRestoreRef = useRef(false);
  const balancesReturnScrollRef = useRef(0);
  const panelStageRef = useRef<HTMLElement>(null);
  const explicitLogoutRef = useRef(false);
  const [isAccountOpen, setIsAccountOpen] = useState(
    initialAccountOpen || (routeMode === "landing" && initialUrlIntent.account === "signin"),
  );
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(initialAccountSettingsOpen);
  const [urlAddMoney, setUrlAddMoney] = useState(initialAddMoney);
  const [urlReturnedFromCoinbase, setUrlReturnedFromCoinbase] = useState(returnedFromCoinbase);
  const [urlSendFlow, setUrlSendFlow] = useState(initialSendFlow);
  const [urlSendActionId, setUrlSendActionId] = useState<string | null>(initialSendActionId);
  const [urlIntent, setUrlIntent] = useState<HomeInboundPanelState>(initialUrlIntent);
  const [popRevision, setPopRevision] = useState(0);
  const [settingsOpenedInApp, setSettingsOpenedInApp] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const shellPath = routeMode === "landing" ? "/" : "/dashboard";
  const investChrome = useOptionalAppChrome();
  const scrollContextId = account.ownerKey && account.session?.user.subject
    ? [
        account.ownerKey,
        account.session.accountProvider,
        account.session.user.subject,
        account.session.smartAccount?.address.toLowerCase() ?? "none",
        regionId,
      ].join("\u0000")
    : null;
  const previousScrollContextRef = useRef(scrollContextId);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => markHomePerformance("shell:paint"));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (previousScrollContextRef.current === scrollContextId) return;
    previousScrollContextRef.current = scrollContextId;
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [scrollContextId]);
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  const applyUrlState = useCallback((intent: ReturnType<typeof readHomeInboundPanelState>) => {
    setActiveNavigation(intent.panel);
    setMountedPanels((current) => current.has(intent.panel)
      ? current
      : new Set([...current, intent.panel]));
    if (intent.panel === balancesPanelId) setBalancesMounted(true);
    setIsAccountSettingsOpen(intent.account === "settings");
    if (intent.account !== "settings") setSettingsOpenedInApp(false);
    setIsAccountOpen(intent.account === "signin");
    setUrlAddMoney(intent.addMoney);
    setUrlReturnedFromCoinbase(intent.returnedFromCoinbase);
    setUrlSendFlow(intent.sendFlow);
    setUrlSendActionId(intent.actionId);
    setUrlIntent(intent);
  }, []);

  const setFlow = useCallback((
    flow: ShellFlow,
    options: { actionId?: string | null; mode?: "push" | "replace" } = {},
  ) => {
    const href = flowHref(
      shellPath,
      flow,
      options.actionId ?? null,
      new URLSearchParams(window.location.search),
    );
    commitClientUrl(href, options.mode ?? "push");
    applyUrlState(readHomeInboundPanelState(new URLSearchParams(window.location.search)));
  }, [applyUrlState, shellPath]);

  const clearFlow = useCallback((options: {
    mode?: "push" | "replace";
    fundingReturn?: boolean;
  } = {}) => {
    const next = new URL(
      withoutFlowHref(shellPath, new URLSearchParams(window.location.search)),
      window.location.origin,
    );
    if (options.fundingReturn) {
      next.searchParams.delete("return");
      next.searchParams.delete("add-money");
    }
    commitClientUrl(`${next.pathname}${next.search}`, options.mode ?? "replace");
    applyUrlState(readHomeInboundPanelState(new URLSearchParams(window.location.search)));
  }, [applyUrlState, shellPath]);

  const closeAccount = useCallback(() => {
    setIsAccountOpen(false);
    const location = parseShellLocation(new URLSearchParams(window.location.search));
    if (initialAccountOpen || location.account === "signin") {
      commitClientUrl("/", "replace");
      return;
    }
    window.history.back();
  }, [initialAccountOpen]);

  useEffect(() => {
    const onPopState = () => {
      const intent = readHomeInboundPanelState(new URLSearchParams(window.location.search));
      const restoresBalances = intent.panel === balancesPanelId && isBalancesRestoreArmed();
      pendingBalancesRestoreRef.current = restoresBalances;
      applyUrlState(intent);
      setPopRevision((revision) => revision + 1);
      if (intent.panel === balancesPanelId && !restoresBalances) {
        mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
        setBalancesRevealReset((resetSignal) => resetSignal + 1);
      }
      if (restoresBalances) setNavigationRequest((request) => request + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyUrlState, isBalancesRestoreArmed]);

  useEffect(() => {
    if (forwardRequest !== 0) pendingBalancesRestoreRef.current = false;
  }, [forwardRequest]);

  const region = presentationRegions[regionId];
  const regionStyle: RegionStyle = {
    "--region-accent": region.theme.accent,
    "--region-accent-soft": region.theme.accentSoft,
    "--region-surface": region.theme.surface,
  };
  const isChecking = account.status === "restoring" || account.status === "validating";
  const isVerified = account.status === "verified";
  useEffect(() => {
    if (isVerified) markHomePerformance("session:verified");
    if (isVerified && account.session?.smartAccount) markHomePerformance("wallet:ready");
  }, [account.session?.smartAccount, isVerified]);
  useEffect(() => {
    if (
      !applyInboundUrlIntent ||
      routeMode !== "dashboard" ||
      !isVerified ||
      !account.session?.smartAccount ||
      appliedUrlIntentRef.current
    ) return;
    appliedUrlIntentRef.current = true;
    applyUrlState(pendingUrlIntentRef.current);
    setSettingsOpenedInApp(false);
    setNavigationRequest((request) => request + 1);
  }, [account.session?.smartAccount, applyInboundUrlIntent, applyUrlState, isVerified, routeMode]);
  const isUnavailable = account.status === "unavailable";
  const isSignedOut = account.status === "signed-out" || account.status === "signout-error";
  const paintedAssetBalances = isVerified
    ? (assetBalances ?? loadingAssetBalances)
    : loadingAssetBalances;
  useEffect(() => {
    if (isVerified && paintedAssetBalances.status === "ready") {
      markHomePerformance("balances:painted");
    }
  }, [isVerified, paintedAssetBalances.status]);

  const balancesScope = homeBalancesRestoreScope({
    ownerKey: account.ownerKey,
    provider: account.session?.accountProvider ?? null,
    subject: account.session?.user.subject ?? null,
    smartAccount: account.session?.smartAccount?.address ?? null,
    region: regionId,
  });
  const balancesReveal = useBalancesRevealWindow(
    balancesScope,
    paintedAssetBalances.items,
    balancesRevealReset,
  );
  const balancesListId = balancesListKey(paintedAssetBalances.items);
  const previousBalancesListIdRef = useRef(balancesListId);
  const previousNavigationRef = useRef(activeNavigation);
  useEffect(() => {
    if (previousBalancesListIdRef.current === balancesListId) return;
    previousBalancesListIdRef.current = balancesListId;
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [balancesListId]);

  useEffect(() => {
    if (navigationRequest === 0 || !panelStageRef.current) return;
    panelStageRef.current.focus({ preventScroll: true });
    let restoreFrame: number | null = null;
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
        restoreFrame = window.requestAnimationFrame(restoreBalancesScroll);
      }
      disarmBalancesRestore();
    }
    const preservesPossibleAssetReturn =
      activeNavigation === "invest" && previousNavigationRef.current === balancesPanelId;
    previousNavigationRef.current = activeNavigation;
    if (!shouldPreserveBalances && !preservesPossibleAssetReturn) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      mainRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    }
    return () => {
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
    };
  }, [activeNavigation, disarmBalancesRestore, navigationRequest]);

  const activitySession: VerifiedAccountSession | null =
    isVerified && account.session?.smartAccount ? account.session : null;
  useEffect(() => {
    if (routeMode === "dashboard" && isSignedOut && !explicitLogoutRef.current) {
      router.replace("/?account=signin", { scroll: false });
    }
  }, [isSignedOut, routeMode, router]);

  function navigateTo(nextNavigation: ShellPanelId) {
    const skipHistory = activeNavigation === nextNavigation && !isAccountSettingsOpen;
    setIsAccountSettingsOpen(false);
    setSettingsOpenedInApp(false);
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
      commitClientUrl(homePanelHref(shellPath, nextNavigation));
      setUrlIntent(readHomeInboundPanelState(new URLSearchParams(window.location.search)));
    }
  }

  function openAccountSettings() {
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
    const current = parseShellLocation(new URLSearchParams(window.location.search));
    commitClientUrl(shellHref(shellPath, {
      panel: activeNavigation,
      account: "settings",
      shelf: current.shelf,
      asset: current.asset,
    }));
  }

  function openAccount() {
    if (isVerified || (account.status === "unavailable" && account.isSignedIn)) {
      openAccountSettings();
      return;
    }
    setIsAccountOpen(true);
    if (parseShellLocation(new URLSearchParams(window.location.search)).account !== "signin") {
      commitClientUrl(shellHref("/", { account: "signin" }));
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
    const current = parseShellLocation(new URLSearchParams(window.location.search));
    commitClientUrl(shellHref(shellPath, {
      panel: activeNavigation,
      shelf: current.shelf,
      asset: current.asset,
    }), "replace");
  }

  function signOut() {
    setIsAccountSettingsOpen(false);
    setForwardRequest((request) => request + 1);
    disarmBalancesRestore();
    setBalancesRevealReset((resetSignal) => resetSignal + 1);
    if (routeMode === "dashboard") {
      explicitLogoutRef.current = true;
      router.replace("/", { scroll: false });
    }
    void account.signOut().catch(() => {});
  }

  const nestedChromeTitle = isAccountSettingsOpen
    ? null
    : isHomeNestedPanelId(activeNavigation)
      ? nestedHomePanelTitle(activeNavigation) ?? "Save"
      : activeNavigation === "invest"
        ? investChrome?.nested?.title ?? null
        : null;
  const nestedChromeBackLabel = isHomeNestedPanelId(activeNavigation)
    ? "Back"
    : investChrome?.nested?.backLabel ?? "Back";
  const onNestedChromeBack = isHomeNestedPanelId(activeNavigation)
    ? () => navigateTo("home")
    : investChrome?.nested?.onBack ?? (() => {});

  const routingValue = useMemo(() => ({
    state: urlIntent,
    popRevision,
    setFlow,
    clearFlow,
  }), [clearFlow, popRevision, setFlow, urlIntent]);

  return (
    <HomeShellRoutingProvider value={routingValue}>
      <div className={`app-frame${routeMode === "dashboard" ? " app-frame-shell" : ""}`} style={regionStyle}>
      <ShellHeader
        isAccountSettingsOpen={isAccountSettingsOpen}
        nestedChromeTitle={nestedChromeTitle}
        nestedChromeBackLabel={nestedChromeBackLabel}
        onNestedChromeBack={onNestedChromeBack}
        routeMode={routeMode}
        activeNavigation={activeNavigation}
        isVerified={isVerified}
        account={account}
        onHome={() => navigateTo("home")}
        onDashboard={() => router.replace("/dashboard")}
        onSignIn={openAccount}
        onSignOut={signOut}
        onOpenSettings={openAccountSettings}
        onCloseSettings={closeAccountSettings}
      />
      {routeMode === "dashboard" ? (
        <DashboardShell
          mainRef={mainRef}
          panelStageRef={panelStageRef}
          isUnavailable={isUnavailable}
          unavailableMessage={account.message}
          retrySessionValidation={account.retrySessionValidation}
          isAccountSettingsOpen={isAccountSettingsOpen}
          isSignedOut={isSignedOut}
          isChecking={isChecking}
          isVerified={isVerified}
          activeNavigation={activeNavigation}
          nestedChromeTitle={nestedChromeTitle}
          regionId={regionId}
          resolutionSource={resolutionSource}
          preferenceMessage={preferenceMessage}
          isPreferenceReady={isPreferenceReady}
          accountAddress={account.session?.smartAccount?.address ?? null}
          selectRegion={selectRegion}
          signOut={signOut}
          paintedAssetBalances={paintedAssetBalances}
          assetMarkResolution={assetMarkResolution}
          activitySession={activitySession}
          fetchActivity={account.fetchActivity}
          fetchOperations={account.fetchOperations}
          navigateTo={navigateTo}
          urlAddMoney={urlAddMoney}
          urlReturnedFromCoinbase={urlReturnedFromCoinbase}
          urlSendFlow={urlSendFlow}
          urlSendActionId={urlSendActionId}
          mountedPanels={mountedPanels}
          balancesMounted={balancesMounted}
          balancesReveal={balancesReveal}
          savingsContent={savingsContent}
          investContent={investContent}
        />
      ) : (
        <SignedOutLanding
          isVerified={isVerified}
          signOutError={account.status === "signout-error" ? account.message : null}
          landingVisual={landingVisual}
          showCreateAccount={account.signInAvailability === "ready"}
          onDashboard={() => router.replace("/dashboard")}
          onSignIn={openAccount}
          onRetrySignOut={() => void account.signOut().catch(() => {})}
        />
      )}
      {routeMode === "dashboard" && isVerified ? (
        <ActionToasts session={account.session} fetchOperations={account.fetchOperations} />
      ) : null}
        <AccountSignInSheet
          open={isAccountOpen}
          onClose={closeAccount}
          onVerified={() => router.replace("/dashboard")}
        />
      </div>
    </HomeShellRoutingProvider>
  );
}

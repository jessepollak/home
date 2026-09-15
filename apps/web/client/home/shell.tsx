"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { AccountSignInSheet } from "@/client/account/account-screen";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowMarketId } from "@/shared/borrowing/config";
import {
  balancesPanelId,
  isHomeNestedPanelId,
  nestedHomePanelTitle,
  type ShellPanelId,
} from "@/config/navigation";
import {
  commitClientUrl,
  flowHref,
  homeHrefWithOverlays,
  isClientHistoryEntry,
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
import { useOptionalAppChrome } from "@/components/app-chrome";
import {
  markHomePerformance,
  markHomeStartupOutcome,
  startHomePerformance,
} from "@/client/observability/perf-marks";
import type { HomeStartupRoute } from "@/shared/observability/client-performance.contract";
import {
  balancesAnchorTopologyKey,
  clampHomeScrollTop,
  homeBalancesRestoreScope,
  useBalancesRevealWindow,
} from "./balances-panel";
import type { HomeExperienceProps, HomeAssetBalancesPresentation } from "./home-types";
import {
  HomeShellRoutingProvider,
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
  groups: [],
  breakdown: [],
  rows: [],
  hiddenRows: [],
  hiddenCount: 0,
};

type HomeShellProps = HomeExperienceProps & {
  disarmBalancesRestore: () => void;
  awaitBalancesAssetDetail: () => void;
  armBalancesAccountOverlay: () => void;
  isBalancesRestoreArmed: () => boolean;
};

// Startup telemetry keeps closed low-cardinality route labels: dynamic L2
// paths normalize to their canonical L1 page.
const panelStartupRoutes: Record<ShellPanelId, Exclude<HomeStartupRoute, "/">> = {
  home: "/home",
  balances: "/balances",
  activity: "/activity",
  save: "/save",
  borrow: "/borrow",
  invest: "/invest",
};

export function HomeShell({
  detectedCountry = null,
  investContent,
  savingsContent,
  initialAccountOpen = false,
  initialPanel = "home",
  initialLocation,
  initialAccountSettingsOpen = false,
  assetBalances,
  balancesRevalidating: balancesRevalidatingProp,
  presentAssetBalances,
  sendAvailability = [],
  assetMarkResolution,
  showSmallBalances = false,
  onShowSmallBalancesChange = () => {},
  landingVisual,
  routeMode = "landing",
  initialAddMoney = false,
  returnedFromProvider = false,
  initialSearch,
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
  // The pathname is authoritative for page state and the query string only ever
  // carries ephemeral overlays. The server page passes its validated canonical
  // location so SSR and the first hydrated render agree; the client falls back
  // to parsing window.location for mounts without an explicit location (landing).
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
  } = useHomeRegion({ detectedCountry, selectedRegionId, onRegionChange });
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
  const landingRedirectedRef = useRef(false);
  // A cold load that lands directly on /balances/<group> must anchor the
  // requested group exactly like the in-app More action: navigationRequest is
  // still 0 and balances paint only after the session verifies, so the armed
  // group is anchored once the target section first renders (#460).
  const coldGroupAnchorRef = useRef<MoneyGroupId | null>(
    routeMode === "dashboard" && initialPanel === balancesPanelId
      ? initialUrlIntent.location.group
      : null,
  );
  const [isAccountOpen, setIsAccountOpen] = useState(
    initialAccountOpen || (routeMode === "landing" && initialUrlIntent.account === "signin"),
  );
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(initialAccountSettingsOpen);
  const [urlAddMoney, setUrlAddMoney] = useState(initialAddMoney);
  const [urlReturnedFromProvider, setUrlReturnedFromProvider] = useState(returnedFromProvider);
  const [urlSendFlow, setUrlSendFlow] = useState(initialSendFlow);
  const [urlSendActionId, setUrlSendActionId] = useState<string | null>(initialSendActionId);
  const [urlIntent, setUrlIntent] = useState<HomeInboundPanelState>(initialUrlIntent);
  const [popRevision, setPopRevision] = useState(0);
  const [settingsOpenedInApp, setSettingsOpenedInApp] = useState(false);
  const [borrowMarketOpenedInApp, setBorrowMarketOpenedInApp] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const investChrome = useOptionalAppChrome();
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
    // Dynamic L2 paths normalize to their low-cardinality L1 page label.
    startHomePerformance(routeMode === "landing" ? "/" : panelStartupRoutes[initialPanel]);
    const frame = window.requestAnimationFrame(() => markHomePerformance("shell:paint"));
    return () => window.cancelAnimationFrame(frame);
  }, [initialPanel, routeMode]);
  useEffect(() => {
    const shell = shellRef.current;
    const main = mainRef.current;
    if (!shell || !main || routeMode !== "dashboard") return;

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
  }, [routeMode]);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);
  useEffect(() => {
    const main = mainRef.current;
    if (!main || routeMode !== "dashboard") return;
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
  }, [routeMode]);

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
    setUrlReturnedFromProvider(intent.returnedFromProvider);
    setUrlSendFlow(intent.sendFlow);
    setUrlSendActionId(intent.actionId);
    setUrlIntent(intent);
  }, []);

  // Overlays commit on top of the current canonical pathname; the pathname is
  // never changed by overlay state.
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
    commitClientUrl(href, options.mode ?? "push");
    applyUrlState(currentUrlIntent());
  }, [applyUrlState, currentUrlIntent]);

  const clearFlow = useCallback((options: {
    mode?: "push" | "replace";
    fundingReturn?: boolean;
  } = {}) => {
    const next = new URL(
      withoutFlowHref(window.location.pathname, new URLSearchParams(window.location.search)),
      window.location.origin,
    );
    if (options.fundingReturn) {
      next.searchParams.delete("return");
      next.searchParams.delete("add-money");
    }
    commitClientUrl(`${next.pathname}${next.search}`, options.mode ?? "replace");
    applyUrlState(currentUrlIntent());
  }, [applyUrlState, currentUrlIntent]);

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
      // The pathname is authoritative: reparsed on every history entry.
      const intent = currentUrlIntent();
      // Balances restores only proven asset/account returns; ordinary history returns reset it.
      // History navigation owns its own scroll behavior: never fire the cold-load group anchor.
      coldGroupAnchorRef.current = null;
      pendingHistoryScrollRestoreRef.current = intent.panel === balancesPanelId
        ? null
        : readClientScrollTop();
      const restoresBalances = intent.panel === balancesPanelId && isBalancesRestoreArmed();
      pendingBalancesRestoreRef.current = restoresBalances;
      setBorrowMarketOpenedInApp(false);
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
  }, [applyUrlState, currentUrlIntent, isBalancesRestoreArmed]);

  useEffect(() => {
    if (forwardRequest !== 0) pendingBalancesRestoreRef.current = false;
    if (forwardRequest !== 0) pendingHistoryScrollRestoreRef.current = null;
  }, [forwardRequest]);

  const isChecking = account.status === "restoring" || account.status === "validating";
  const isVerified = account.status === "verified" && account.verification === "server";
  const mayPaintBalances = account.verification !== null;
  useEffect(() => {
    if (isVerified) markHomePerformance("session:verified");
  }, [isVerified]);
  useEffect(() => {
    if (
      !applyInboundUrlIntent ||
      routeMode !== "dashboard" ||
      !isVerified ||
      !account.session?.smartAccount ||
      appliedUrlIntentRef.current
    ) return;
    appliedUrlIntentRef.current = true;
    const intent = pendingUrlIntentRef.current;
    applyUrlState(intent);
    setSettingsOpenedInApp(false);
    // The server-selected panel already painted this destination on first render
    // (initialPanel); reapplying the same panel must not refocus the panel stage
    // or reset its scroll (#460). Only a panel change is a navigation event.
    if (intent.panel !== activeNavigation) {
      setNavigationRequest((request) => request + 1);
    }
  }, [
    account.session?.smartAccount,
    activeNavigation,
    applyInboundUrlIntent,
    applyUrlState,
    isVerified,
    routeMode,
  ]);
  const isUnavailable = account.status === "unavailable";
  const isSignedOut = account.status === "signed-out" || account.status === "signout-error";
  useEffect(() => {
    if (isUnavailable) markHomeStartupOutcome("unavailable");
    else if (isSignedOut) markHomeStartupOutcome("signed-out");
  }, [isSignedOut, isUnavailable]);
  const showAllAssetBalances = showSmallBalances || revealSmallBalances;
  const paintedAssetBalances = useMemo(
    () => mayPaintBalances
      ? (presentAssetBalances?.(showAllAssetBalances) ?? assetBalances ?? loadingAssetBalances)
      : loadingAssetBalances,
    [assetBalances, mayPaintBalances, presentAssetBalances, showAllAssetBalances],
  );
  // The owning experience threads the live revalidation state; presentation
  // fixtures that carry it directly keep working when the prop is absent.
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

  // This is the sole scope boundary for Balances scroll provenance. Preference
  // hydration settles before the first baseline so a persisted region is not
  // mistaken for an explicit region switch.
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

  // A provisional cached paint may anchor but stays armed until the session is
  // server-verified; once verified, an in-flight revalidation retains it and
  // the first settled pass consumes it (#462). Scope precedes this effect so a
  // canonical group re-armed for a new scope is observed in the same commit.
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
    return cancelPendingShellScroll;
  }, [
    activeNavigation,
    cancelPendingShellScroll,
    disarmBalancesRestore,
    navigationRequest,
    scheduleShellScroll,
    urlIntent.location.group,
  ]);

  const activitySession: VerifiedAccountSession | null =
    isVerified && account.session?.smartAccount ? account.session : null;
  useEffect(() => {
    if (
      routeMode === "landing" &&
      account.verification !== null &&
      readShellAccountParam(new URLSearchParams(window.location.search)) !== "signin" &&
      !landingRedirectedRef.current
    ) {
      landingRedirectedRef.current = true;
      // Preserve only allowlisted ephemeral overlay intent; /?account=signin stays root.
      router.replace(
        homeHrefWithOverlays(new URLSearchParams(window.location.search)),
        { scroll: false },
      );
    }
  }, [account.verification, routeMode, router]);
  useEffect(() => {
    if (routeMode === "dashboard" && isSignedOut && !explicitLogoutRef.current) {
      router.replace("/?account=signin", { scroll: false });
    }
  }, [isSignedOut, routeMode, router]);

  function navigateTo(
    nextNavigation: ShellPanelId,
    group: MoneyGroupId | null = null,
    market: BorrowMarketId | null = null,
  ) {
    const skipHistory = activeNavigation === nextNavigation && !isAccountSettingsOpen &&
      (nextNavigation !== "borrow" || urlIntent.location.market === market);
    setIsAccountSettingsOpen(false);
    setSettingsOpenedInApp(false);
    if (nextNavigation !== "borrow") setBorrowMarketOpenedInApp(false);
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
      commitClientUrl(shellHref({ panel: nextNavigation, group, market }));
      setUrlIntent(currentUrlIntent());
    }
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
        if (routeMode === "dashboard") router.replace("/", { scroll: false });
      },
    }).catch(() => {});
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
  function leaveHomeNestedPanel() {
    // Home is a forward visit from Balances so browser Back can reopen a fresh Balances panel.
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
      : leaveHomeNestedPanel
    : investChrome?.nested?.onBack ?? (() => {});

  const routingValue = useMemo(() => ({
    state: urlIntent,
    popRevision,
    setFlow,
    clearFlow,
  }), [clearFlow, popRevision, setFlow, urlIntent]);

  return (
    <HomeShellRoutingProvider value={routingValue}>
      <div
        ref={shellRef}
        className={routeMode === "dashboard"
          ? "flex h-svh max-h-svh flex-col overflow-hidden bg-muted [--shell-scrollbar-width:0px]"
          : "flex min-h-svh flex-col bg-background"}
      >
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
        onDashboard={() => router.replace("/home")}
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
          accountOwnerKey={account.ownerKey}
          selectRegion={selectRegion}
          signOut={signOut}
          paintedAssetBalances={paintedAssetBalances}
          sendAvailability={sendAvailability}
          assetMarkResolution={assetMarkResolution}
          showSmallBalances={showSmallBalances}
          onShowSmallBalancesChange={onShowSmallBalancesChange}
          revealSmallBalances={revealSmallBalances}
          onRevealSmallBalancesChange={setRevealSmallBalances}
          activitySession={activitySession}
          fetchActivity={account.fetchActivity}
          fetchOperations={account.fetchOperations}
          navigateTo={navigateTo}
          borrowMarket={urlIntent.location.market}
          onSelectBorrowMarket={selectBorrowMarket}
          urlAddMoney={urlAddMoney}
          urlReturnedFromProvider={urlReturnedFromProvider}
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
          onDashboard={() => router.replace("/home")}
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
          onVerified={() => router.replace("/home")}
        />
      </div>
    </HomeShellRoutingProvider>
  );
}

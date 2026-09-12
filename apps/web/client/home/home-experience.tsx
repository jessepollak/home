"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  readAnonymousCountryPreference,
  writeAnonymousCountryPreference,
} from "@/config/country-preference";
import {
  activityPanelId,
  balancesPanelId,
  isHomeNestedPanelId,
  nestedHomePanelTitle,
  savePanelId,
  type ShellPanelId,
} from "@/config/navigation";
import { parseShellLocation, shellHref } from "@/config/shell-location";
import { AppChromeProvider, useOptionalAppChrome } from "@/components/app-chrome";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { CurrencyMark } from "@/components/currency-mark";
import { ProfileMark } from "@/components/profile-mark";
import {
  presentationRegions,
  resolvePresentation,
  type RegionId,
  type ResolutionSource,
} from "@/config/regions";
import { BalanceRow } from "@/components/finance-rows";
import { HomeMark } from "@/components/home-mark";
import { AccountSignInSheet } from "@/client/account/account-screen";
import { AccountSettings } from "@/client/account/account-settings";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  ActivityPanel,
  type ActivityPanelDensity,
  type FetchActivity,
} from "@/client/activity";
import {
  MoneyDataRefreshProvider,
  RecentMoneyActions,
  type PreparedMoneyAction,
} from "@/client/money-actions";
import type { VerifiedPortfolioSession } from "@/client/portfolio";
import { FundingActions } from "@/client/funding/funding-actions";
import {
  deleteHomeBalancesPresentation,
  presentHomeBalanceMark,
  presentHomeBalanceRow,
  presentPortfolioValuation,
  previewHomeBalanceItems,
  usePaintedHomeBalances,
  usePortfolioValuation,
  writeHomeBalancesPresentation,
  type HomeAssetBalanceItem,
  type HomeAssetBalancesPresentation,
} from "@/client/portfolio";
import { TransferActions } from "@/client/transfers";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { PiggyBank } from "lucide-react";

export type { HomeAssetBalanceItem, HomeAssetBalancesPresentation };

const loadingAssetBalances: HomeAssetBalancesPresentation = {
  status: "loading",
  displayTotal: null,
  statusLabel: "Updating…",
  items: [],
};

export type HomeExperienceProps = {
  detectedCountry?: string | null;
  investContent?: ReactNode;
  savingsContent?: ReactNode;
  initialAccountOpen?: boolean;
  initialPanel?: ShellPanelId;
  initialAccountSettingsOpen?: boolean;
  assetBalances?: HomeAssetBalancesPresentation;
  assetMarkResolution?: AssetMarkResolution;
  landingVisual?: ReactNode;
  routeMode?: "landing" | "dashboard";
  initialAddMoney?: boolean;
  returnedFromCoinbase?: boolean;
  activityRefreshTrigger?: string | number;
  onTransferConfirmed?: () => void;
  selectedRegionId?: RegionId;
  onRegionChange?: (region: RegionId) => void;
};

export function PortfolioHomeExperience(
  props: Omit<
    HomeExperienceProps,
    "activityRefreshTrigger" | "assetBalances" | "onTransferConfirmed"
  >,
) {
  const account = useAccountWallet();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedRegion, setSelectedRegion] = useState<RegionId>(
    () => resolvePresentation({ detectedCountry: props.detectedCountry }).region.id,
  );
  const session: VerifiedPortfolioSession | null =
    account.status === "verified" && account.session?.smartAccount
      ? {
          subject: account.session.user.subject,
          smartAccountAddress: account.session.smartAccount.address,
          chainId: account.session.smartAccount.chainId,
        }
      : null;
  const sessionSubject = session?.subject ?? null;
  const sessionSmartAccount = session?.smartAccountAddress ?? null;
  const valuation = usePortfolioValuation(
    session,
    selectedRegion,
    account.fetchPortfolioValuation,
    refreshTrigger,
  );
  const presentedValuation = useMemo(
    () => presentPortfolioValuation(valuation),
    [valuation],
  );
  const refreshWalletData = useCallback(() => {
    if (sessionSubject && sessionSmartAccount) {
      deleteHomeBalancesPresentation(
        () => window.localStorage,
        {
          subject: sessionSubject,
          smartAccount: sessionSmartAccount,
          region: selectedRegion,
        },
      );
    }
    setRefreshTrigger((trigger) => trigger + 1);
  }, [selectedRegion, sessionSmartAccount, sessionSubject]);

  return (
    <MoneyDataRefreshProvider onConfirmed={refreshWalletData}>
      <HomeExperience
        {...props}
        activityRefreshTrigger={refreshTrigger}
        assetBalances={presentedValuation}
        selectedRegionId={selectedRegion}
        onRegionChange={setSelectedRegion}
        onTransferConfirmed={refreshWalletData}
      />
    </MoneyDataRefreshProvider>
  );
}

type RegionStyle = CSSProperties & {
  "--region-accent": string;
  "--region-accent-soft": string;
  "--region-surface": string;
};

type BalancesRestoreProvenance =
  | "disarmed"
  | "awaiting-asset-detail"
  | "asset-detail"
  | "account-overlay";

function BalancesRestoreChromeObserver({
  onChrome,
}: {
  onChrome: (backLabel: string) => void;
}) {
  const chrome = useOptionalAppChrome();
  const backLabel = chrome?.nested?.backLabel ?? null;
  useEffect(() => {
    if (backLabel) onChrome(backLabel);
  }, [backLabel, onChrome]);
  return null;
}

export function HomeExperience(props: HomeExperienceProps) {
  const provenanceRef = useRef<BalancesRestoreProvenance>("disarmed");
  const disarmBalancesRestore = useCallback(() => {
    provenanceRef.current = "disarmed";
  }, []);
  const awaitBalancesAssetDetail = useCallback(() => {
    provenanceRef.current = "awaiting-asset-detail";
  }, []);
  const armBalancesAccountOverlay = useCallback(() => {
    provenanceRef.current = "account-overlay";
  }, []);
  const isBalancesRestoreArmed = useCallback(
    () =>
      provenanceRef.current === "asset-detail" ||
      provenanceRef.current === "account-overlay",
    [],
  );
  const observeBalancesChrome = useCallback((backLabel: string) => {
    // Only actual asset-detail chrome may promote the pending candidate.
    // Category chrome is a different forward push and permanently disarms it.
    if (
      backLabel === "Back" &&
      provenanceRef.current === "awaiting-asset-detail"
    ) {
      provenanceRef.current = "asset-detail";
      return;
    }
    if (backLabel !== "Back") provenanceRef.current = "disarmed";
  }, []);

  return (
    <AppChromeProvider>
      <BalancesRestoreChromeObserver onChrome={observeBalancesChrome} />
      <HomeExperienceView
        {...props}
        disarmBalancesRestore={disarmBalancesRestore}
        awaitBalancesAssetDetail={awaitBalancesAssetDetail}
        armBalancesAccountOverlay={armBalancesAccountOverlay}
        isBalancesRestoreArmed={isBalancesRestoreArmed}
      />
    </AppChromeProvider>
  );
}

function HomeExperienceView({
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
  activityRefreshTrigger,
  onTransferConfirmed,
  selectedRegionId,
  onRegionChange,
  disarmBalancesRestore,
  awaitBalancesAssetDetail,
  armBalancesAccountOverlay,
  isBalancesRestoreArmed,
}: HomeExperienceProps & {
  disarmBalancesRestore: () => void;
  awaitBalancesAssetDetail: () => void;
  armBalancesAccountOverlay: () => void;
  isBalancesRestoreArmed: () => boolean;
}) {
  const router = useRouter();
  const account = useAccountWallet();
  const initial = resolvePresentation({ detectedCountry });
  const [internalRegionId, setInternalRegionId] = useState<RegionId>(
    initial.region.id,
  );
  const regionId = selectedRegionId ?? internalRegionId;
  const [resolutionSource, setResolutionSource] =
    useState<ResolutionSource>(initial.source);
  const [activeNavigation, setActiveNavigation] =
    useState<ShellPanelId>(initialPanel);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const [balancesRevealReset, setBalancesRevealReset] = useState(0);
  const [forwardRequest, setForwardRequest] = useState(0);
  // Tracks whether the panel change that just happened was a history pop
  // (browser/app Back) or an explicit forward push. The ref is written from
  // effects and the popstate listener, never during render.
  const navigationIntentRef = useRef<"push" | "pop">("push");
  // Balances restoration is denied by default. A direct Invest entry may hold
  // a candidate only until actual asset-detail chrome proves the return path;
  // the explicitly supported Account overlay path arms independently.
  const panelStageRef = useRef<HTMLElement>(null);
  const explicitLogoutRef = useRef(false);
  const lastBalanceCacheWriteRef = useRef<{
    identity: string;
    live: HomeAssetBalancesPresentation;
  } | null>(null);
  const [isPreferenceReady, setIsPreferenceReady] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [isAccountOpen, setIsAccountOpen] = useState(initialAccountOpen);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(
    initialAccountSettingsOpen,
  );
  const [settingsOpenedInApp, setSettingsOpenedInApp] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const panelScrollRef = useRef<
    Partial<
      Record<
        ShellPanelId | "account",
        { top: number; identity: string | null }
      >
    >
  >({});
  const shellPath = routeMode === "landing" ? "/" : "/dashboard";
  const investChrome = useOptionalAppChrome();
  const panelKey: ShellPanelId | "account" = isAccountSettingsOpen
    ? "account"
    : activeNavigation;
  // Ephemeral identity for the current owner/provider/region. It fences any
  // saved scroll offset so a different account or presentation scope never
  // restores someone else's position. The Balances panel additionally fences
  // by the current list identity below. No raw account or private data is stored.
  const scrollContextId =
    account.ownerKey && account.session?.user.subject
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
    if (previousScrollContextRef.current === scrollContextId) return;
    previousScrollContextRef.current = scrollContextId;
    panelScrollRef.current = {};
  }, [scrollContextId]);

  const closeAccount = useCallback(() => {
    setIsAccountOpen(false);
    if (initialAccountOpen) {
      router.replace("/", { scroll: false });
      return;
    }
    router.back();
  }, [initialAccountOpen, router]);

  useEffect(() => {
    const onPopState = () => {
      navigationIntentRef.current = "pop";
      const location = parseShellLocation(
        new URLSearchParams(window.location.search),
      );
      setActiveNavigation(location.panel);
      setIsAccountSettingsOpen(location.account === "settings");
      if (location.account !== "settings") setSettingsOpenedInApp(false);
      setIsAccountOpen(location.account === "signin");
      if (location.panel === balancesPanelId && !isBalancesRestoreArmed()) {
        delete panelScrollRef.current[balancesPanelId];
        setBalancesRevealReset((resetSignal) => resetSignal + 1);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isBalancesRestoreArmed]);

  useEffect(() => {
    if (forwardRequest === 0) return;
    navigationIntentRef.current = "push";
  }, [forwardRequest]);

  useEffect(() => {
    const persistedCountry = readAnonymousCountryPreference(
      () => window.localStorage,
    );
    const resolved = resolvePresentation({
      persistedCountry,
      detectedCountry,
    });
    const hydrationFrame = window.requestAnimationFrame(() => {
      setInternalRegionId(resolved.region.id);
      onRegionChange?.(resolved.region.id);
      setResolutionSource(resolved.source);
      setIsPreferenceReady(true);
    });

    return () => window.cancelAnimationFrame(hydrationFrame);
  }, [detectedCountry, onRegionChange]);

  const region = presentationRegions[regionId];
  const regionStyle: RegionStyle = {
    "--region-accent": region.theme.accent,
    "--region-accent-soft": region.theme.accentSoft,
    "--region-surface": region.theme.surface,
  };
  const isChecking =
    account.status === "restoring" || account.status === "validating";
  const isVerified = account.status === "verified";
  const isUnavailable = account.status === "unavailable";
  const isSignedOut =
    account.status === "signed-out" || account.status === "signout-error";
  const liveAssetBalances = isVerified
    ? (assetBalances ?? loadingAssetBalances)
    : loadingAssetBalances;
  const paintedAssetBalances = usePaintedHomeBalances({
    ownerKey: isSignedOut ? null : account.ownerKey,
    subject: account.session?.user.subject ?? null,
    smartAccount: account.session?.smartAccount?.address ?? null,
    region: regionId,
    live: liveAssetBalances,
  });
  const balancesOwnerKey = account.ownerKey;
  const balancesSubject = account.session?.user.subject ?? null;
  const balancesSmartAccount = account.session?.smartAccount?.address ?? null;
  const balancesProvider = account.session?.accountProvider ?? null;
  const balancesScope = homeBalancesRestoreScope({
    ownerKey: balancesOwnerKey,
    provider: balancesProvider,
    subject: balancesSubject,
    smartAccount: balancesSmartAccount,
    region: regionId,
  });
  const balancesReveal = useBalancesRevealWindow(
    balancesScope,
    paintedAssetBalances.items,
    balancesRevealReset,
  );
  const balancesListId = balancesListKey(paintedAssetBalances.items);
  const panelScrollIdentity =
    panelKey === balancesPanelId && scrollContextId
      ? `${scrollContextId}\u0000${balancesListId}`
      : scrollContextId;
  const previousBalancesListIdRef = useRef(balancesListId);
  useEffect(() => {
    if (previousBalancesListIdRef.current === balancesListId) return;
    previousBalancesListIdRef.current = balancesListId;
    delete panelScrollRef.current[balancesPanelId];
  }, [balancesListId]);

  useEffect(() => {
    if (navigationRequest === 0) return;

    const panelStage = panelStageRef.current;
    if (!panelStage) return;

    panelStage.focus({ preventScroll: true });
    const saved = panelScrollRef.current[panelKey];
    const isBalances = panelKey === balancesPanelId;
    const shouldRestore = isBalances
      ? navigationIntentRef.current === "pop" && isBalancesRestoreArmed()
      : navigationIntentRef.current === "pop";
    const preservedTop =
      shouldRestore && saved?.identity === panelScrollIdentity
        ? saved.top
        : 0;
    if (!shouldRestore) {
      panelScrollRef.current[panelKey] = undefined;
    }
    if (isBalances) {
      disarmBalancesRestore();
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    mainRef.current?.scrollTo({
      top: clampHomeScrollTop(mainRef.current, preservedTop),
      behavior: reducedMotion || preservedTop > 0 ? "auto" : "smooth",
    });
  }, [
    disarmBalancesRestore,
    isBalancesRestoreArmed,
    panelKey,
    panelScrollIdentity,
    navigationRequest,
  ]);

  const activitySession: VerifiedAccountSession | null =
    isVerified && account.session?.smartAccount ? account.session : null;
  const fetchAccountResource = account.fetchAccountResource;
  const readOperation = useCallback(
    (id: string, signal?: AbortSignal) => fetchAccountResource(
      `/api/actions/${encodeURIComponent(id)}`,
      { signal },
    ),
    [fetchAccountResource],
  );

  useEffect(() => {
    if (
      routeMode === "dashboard" &&
      isSignedOut &&
      !explicitLogoutRef.current
    ) {
      router.replace("/?account=signin", { scroll: false });
    }
  }, [isSignedOut, routeMode, router]);

  useEffect(() => {
    if (
      !isVerified ||
      !account.ownerKey ||
      !account.session?.user.subject ||
      !account.session.smartAccount?.address ||
      assetBalances?.status !== "ready" ||
      paintedAssetBalances.status !== "ready"
    ) {
      lastBalanceCacheWriteRef.current = null;
      return;
    }

    const identity = `${account.ownerKey}\u0000${account.session.user.subject}\u0000${account.session.smartAccount.address.toLowerCase()}\u0000${regionId}`;
    if (
      lastBalanceCacheWriteRef.current?.identity === identity &&
      lastBalanceCacheWriteRef.current.live === assetBalances
    ) {
      return;
    }

    const didWrite = writeHomeBalancesPresentation(
      () => window.localStorage,
      {
        ownerKey: account.ownerKey,
        subject: account.session.user.subject,
        smartAccount: account.session.smartAccount.address,
        region: regionId,
      },
      paintedAssetBalances,
    );
    if (didWrite) {
      lastBalanceCacheWriteRef.current = { identity, live: assetBalances };
    }
  }, [
    account.ownerKey,
    account.session?.smartAccount?.address,
    account.session?.user.subject,
    assetBalances,
    isVerified,
    paintedAssetBalances,
    regionId,
  ]);

  function selectRegion(nextRegionId: RegionId) {
    setInternalRegionId(nextRegionId);
    onRegionChange?.(nextRegionId);
    setResolutionSource("explicit");
    const didPersist = writeAnonymousCountryPreference(
      () => window.localStorage,
      nextRegionId,
    );
    setPreferenceMessage(
      didPersist
        ? "Country preference saved on this device."
        : "Country updated for this visit. Browser storage is unavailable.",
    );
  }

  function navigateTo(nextNavigation: ShellPanelId) {
    const skipHistory =
      activeNavigation === nextNavigation && !isAccountSettingsOpen;
    setIsAccountSettingsOpen(false);
    setSettingsOpenedInApp(false);
    if (!skipHistory) {
      setForwardRequest((request) => request + 1);
      const mayOpenAssetDetail =
        activeNavigation === balancesPanelId && nextNavigation === "invest";
      if (mayOpenAssetDetail) {
        awaitBalancesAssetDetail();
      } else {
        disarmBalancesRestore();
      }
      if (!mayOpenAssetDetail) {
        delete panelScrollRef.current[balancesPanelId];
      }
      if (nextNavigation === balancesPanelId || !mayOpenAssetDetail) {
        setBalancesRevealReset((resetSignal) => resetSignal + 1);
      }
    }
    setActiveNavigation(nextNavigation);
    setNavigationRequest((request) => request + 1);
    if (skipHistory) return;
    router.push(shellHref(shellPath, { panel: nextNavigation }), {
      scroll: false,
    });
  }

  function openAccountSettings() {
    setForwardRequest((request) => request + 1);
    if (activeNavigation === balancesPanelId && !isAccountSettingsOpen) {
      armBalancesAccountOverlay();
    } else {
      disarmBalancesRestore();
      delete panelScrollRef.current[balancesPanelId];
      setBalancesRevealReset((resetSignal) => resetSignal + 1);
    }
    setIsAccountSettingsOpen(true);
    setSettingsOpenedInApp(true);
    const current = parseShellLocation(
      new URLSearchParams(window.location.search),
    );
    router.push(
      shellHref(shellPath, {
        panel: activeNavigation,
        account: "settings",
        shelf: current.shelf,
        asset: current.asset,
      }),
      { scroll: false },
    );
  }

  function openAccount() {
    if (isVerified || (account.status === "unavailable" && account.isSignedIn)) {
      openAccountSettings();
      return;
    }
    setIsAccountOpen(true);
    if (
      parseShellLocation(new URLSearchParams(window.location.search)).account ===
      "signin"
    ) {
      return;
    }
    router.push(shellHref("/", { account: "signin" }), { scroll: false });
  }

  function closeAccountSettings() {
    if (settingsOpenedInApp) {
      navigationIntentRef.current = "pop";
      router.back();
      return;
    }
    setIsAccountSettingsOpen(false);
    setForwardRequest((request) => request + 1);
    disarmBalancesRestore();
    delete panelScrollRef.current[balancesPanelId];
    setBalancesRevealReset((resetSignal) => resetSignal + 1);
    const current = parseShellLocation(
      new URLSearchParams(window.location.search),
    );
    router.replace(
      shellHref(shellPath, {
        panel: activeNavigation,
        shelf: current.shelf,
        asset: current.asset,
      }),
      { scroll: false },
    );
  }

  function signOut() {
    setIsAccountSettingsOpen(false);
    setForwardRequest((request) => request + 1);
    disarmBalancesRestore();
    delete panelScrollRef.current[balancesPanelId];
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

  return (
    <div
      className={`app-frame${routeMode === "dashboard" ? " app-frame-shell" : ""}`}
      style={regionStyle}
    >
      <header className="app-header">
        <div className="app-header-start">
          {isAccountSettingsOpen ? (
            <h1 className="app-header-lead-title">Account</h1>
          ) : nestedChromeTitle ? (
            <NestedHomeHeader
              title={nestedChromeTitle}
              backLabel={nestedChromeBackLabel}
              onBack={onNestedChromeBack}
            />
          ) : routeMode === "dashboard" && activeNavigation === "invest" ? (
            <h1 className="app-header-lead-title">Invest</h1>
          ) : (
            <HomeMark
              onClick={() => {
                if (isVerified) navigateTo("home");
              }}
            />
          )}
        </div>
        <span className="app-header-title-slot" aria-hidden="true" />
        <div className="app-header-end">
          {isAccountSettingsOpen ? (
            <button
              className="header-done-link"
              type="button"
              onClick={closeAccountSettings}
            >
              Done
            </button>
          ) : (
            <HeaderAccountAction
              status={account.status}
              isSignedIn={account.isSignedIn}
              routeMode={routeMode}
              ownerKey={account.ownerKey}
              address={account.session?.smartAccount?.address ?? null}
              onDashboard={() => router.replace("/dashboard")}
              onSignIn={openAccount}
              onSignOut={signOut}
              onOpenSettings={openAccountSettings}
            />
          )}
        </div>
      </header>

      {routeMode === "dashboard" ? (
        <>
          <main
            ref={mainRef}
            className="app-main app-main-authenticated"
            onScroll={(event) => {
              panelScrollRef.current[panelKey] = {
                top: event.currentTarget.scrollTop,
                identity: panelScrollIdentity,
              };
            }}
          >
            {isUnavailable ? (
              <div className="dashboard-notice" role="alert">
                <span>{account.message ?? "Your private details remain hidden."}</span>
                <button type="button" onClick={() => void account.retrySessionValidation()}>
                  Retry account check
                </button>
              </div>
            ) : null}

            {isAccountSettingsOpen ? (
              <div className="panel-fade" key={panelKey}>
                <AccountSettings
                  regionId={regionId}
                  onRegionChange={selectRegion}
                  resolutionSource={resolutionSource}
                  preferenceMessage={preferenceMessage}
                  isPreferenceReady={isPreferenceReady}
                  accountAddress={
                    isVerified ? account.session?.smartAccount?.address ?? null : null
                  }
                  onSignOut={signOut}
                />
              </div>
            ) : isSignedOut ? (
              <section
                className="panel-stage"
                aria-busy="true"
                aria-label="Signed out"
              >
                <span className="sr-status">Signed out</span>
              </section>
            ) : (
              <section
                ref={panelStageRef}
                className="panel-stage"
                id="navigation-panel"
                tabIndex={-1}
                aria-labelledby={
                  isHomeNestedPanelId(activeNavigation) || nestedChromeTitle
                    ? undefined
                    : `${activeNavigation}-nav`
                }
                aria-label={
                  activeNavigation === savePanelId
                    ? "Savings"
                    : nestedChromeTitle ?? undefined
                }
                aria-busy={isChecking}
              >
                <div className="panel-fade" key={panelKey}>
                  {activeNavigation === "home" ? (
                    <HomePanel
                      assetBalances={paintedAssetBalances}
                      assetMarkResolution={assetMarkResolution}
                      activitySession={activitySession}
                      fetchActivity={account.fetchActivity}
                      fetchOperations={account.fetchOperations}
                      readOperation={readOperation}
                      checkOperation={account.checkMoneyAction}
                      activityRefreshTrigger={activityRefreshTrigger}
                      onTransferConfirmed={onTransferConfirmed}
                      onOpenSave={() => navigateTo(savePanelId)}
                      onOpenBalances={() => navigateTo(balancesPanelId)}
                      onOpenActivity={() => navigateTo(activityPanelId)}
                      initialAddMoney={initialAddMoney}
                      returnedFromCoinbase={returnedFromCoinbase}
                      regionId={regionId}
                    />
                  ) : null}
                  {activeNavigation === balancesPanelId ? (
                    <BalancesPage
                      assetBalances={paintedAssetBalances}
                      assetMarkResolution={assetMarkResolution}
                      isChecking={isChecking}
                      revealedCount={balancesReveal.count}
                      onRevealMore={balancesReveal.extend}
                    />
                  ) : null}
                  {activeNavigation === activityPanelId ? (
                    <ActivityPage
                      activitySession={activitySession}
                      fetchActivity={account.fetchActivity}
                      fetchOperations={account.fetchOperations}
                      readOperation={readOperation}
                      checkOperation={account.checkMoneyAction}
                      activityRefreshTrigger={activityRefreshTrigger}
                      showSessionShimmer={!activitySession && (
                        paintedAssetBalances.status === "loading" ||
                        paintedAssetBalances.revalidating === true
                      )}
                    />
                  ) : null}
                  {activeNavigation === savePanelId ? (
                    <div id="save-panel">
                      {isVerified
                        ? (savingsContent ?? <EmptyPanel label="Savings" />)
                        : isChecking
                          ? <SavePanelShell />
                          : <EmptyPanel label="Savings" />}
                    </div>
                  ) : null}
                  {activeNavigation === "invest" ? (
                    <PresentationRegionProvider regionId={regionId}>
                      {investContent ?? <EmptyPanel label="Investments" />}
                    </PresentationRegionProvider>
                  ) : null}
                </div>
              </section>
            )}
          </main>
          {!isSignedOut ? (
            <PrimaryNavigation
              activeNavigation={activeNavigation}
              onNavigate={navigateTo}
            />
          ) : null}
        </>
      ) : (
        <SignedOutLanding
          isVerified={isVerified}
          signOutError={
            account.status === "signout-error" ? account.message : null
          }
          landingVisual={landingVisual}
          showCreateAccount={account.signInAvailability === "ready"}
          onDashboard={() => router.replace("/dashboard")}
          onSignIn={openAccount}
          onRetrySignOut={() => void account.signOut().catch(() => {})}
        />
      )}

      <AccountSignInSheet
        open={isAccountOpen}
        onClose={closeAccount}
        onVerified={() => router.replace("/dashboard")}
      />
    </div>
  );
}

export function clampHomeScrollTop(
  main: HTMLElement | null,
  top: number,
): number {
  if (!main || top <= 0) return Math.max(0, top);
  const maxTop = Math.max(0, main.scrollHeight - main.clientHeight);
  // When the environment cannot measure a scrollable range (maxTop is zero),
  // defer to the browser's native clamp rather than forcing the offset to zero.
  return maxTop > 0 ? Math.min(top, maxTop) : top;
}

function HeaderAccountAction({
  status,
  isSignedIn,
  routeMode,
  ownerKey,
  address,
  onDashboard,
  onSignIn,
  onSignOut,
  onOpenSettings,
}: {
  status: ReturnType<typeof useAccountWallet>["status"];
  isSignedIn: boolean;
  routeMode: "landing" | "dashboard";
  ownerKey: string | null;
  address: string | null;
  onDashboard: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
}) {
  if (status === "signout-error") {
    return (
      <button className="header-account-link" type="button" onClick={onSignOut}>
        Retry sign out
      </button>
    );
  }

  if (routeMode === "dashboard") {
    const checking = status === "restoring" || status === "validating";
    const signedIn = status === "verified" || (status === "unavailable" && isSignedIn);
    if (checking || signedIn) {
      return (
        <ProfileMark
          status={checking ? "loading" : "ready"}
          ownerKey={ownerKey}
          address={address}
          disabled={checking}
          onClick={signedIn && !checking ? onOpenSettings : undefined}
        />
      );
    }
  }

  if (status === "restoring" || status === "validating") {
    return (
      <button
        className="header-account-link header-account-quiet"
        type="button"
        disabled
      >
        Account
      </button>
    );
  }

  if (status === "verified" || (status === "unavailable" && isSignedIn)) {
    return (
      <button className="header-account-link" type="button" onClick={onDashboard}>
        Dashboard
      </button>
    );
  }

  return (
    <button className="header-account-link" type="button" onClick={onSignIn}>
      Sign in
    </button>
  );
}

function SignedOutLanding({
  isVerified,
  signOutError,
  landingVisual,
  showCreateAccount,
  onDashboard,
  onSignIn,
  onRetrySignOut,
}: {
  isVerified: boolean;
  signOutError: string | null;
  landingVisual?: ReactNode;
  showCreateAccount: boolean;
  onDashboard: () => void;
  onSignIn: () => void;
  onRetrySignOut: () => void;
}) {
  return (
    <main className={`landing-main${landingVisual ? " landing-main-with-visual" : ""}`}>
      {landingVisual ? (
        <div className="landing-visual">
          {landingVisual}
        </div>
      ) : null}
      <section className="landing-hero" aria-labelledby="landing-title">
        <h1 id="landing-title">One home for your money.</h1>
        <p className="landing-copy">
          Invest in any asset, earn more on your savings, and grow your wealth.
        </p>
        <div className="landing-actions">
          {isVerified ? (
            <button className="landing-primary" type="button" onClick={onDashboard}>
              Open dashboard
            </button>
          ) : (
            <>
              <button className="landing-primary" type="button" onClick={onSignIn}>
                Sign in
              </button>
              {showCreateAccount ? (
                <button className="landing-secondary" type="button" onClick={onSignIn}>
                  Create account
                </button>
              ) : null}
            </>
          )}
        </div>
        {signOutError ? (
          <div className="landing-status" role="alert">
            <p>{signOutError}</p>
            <button type="button" onClick={onRetrySignOut}>
              Retry sign out
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function NestedHomeHeader({
  title,
  backLabel,
  onBack,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="header-leading">
      <button className="header-back-link" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        <span className="sr-only">{backLabel}</span>
      </button>
      <h1 className="header-panel-title app-header-title">{title}</h1>
    </div>
  );
}

function SectionTapIn({
  headingId,
  title,
  onOpen,
}: {
  headingId: string;
  title: "Balances" | "Activity";
  onOpen: () => void;
}) {
  return (
    <button
      className="section-tap-in"
      type="button"
      onClick={onOpen}
      aria-label={title}
    >
      <h2 id={headingId}>{title}</h2>
      <span className="section-tap-in-affordance" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function HomePanel({
  assetBalances,
  assetMarkResolution,
  activitySession,
  fetchActivity,
  fetchOperations,
  readOperation,
  checkOperation,
  activityRefreshTrigger,
  onTransferConfirmed,
  onOpenSave,
  onOpenBalances,
  onOpenActivity,
  initialAddMoney = false,
  returnedFromCoinbase = false,
  regionId,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  assetMarkResolution?: AssetMarkResolution;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  readOperation: (id: string, signal?: AbortSignal) => Promise<unknown>;
  checkOperation?: (action: PreparedMoneyAction) => Promise<unknown>;
  activityRefreshTrigger?: string | number;
  onTransferConfirmed?: () => void;
  onOpenSave: () => void;
  onOpenBalances: () => void;
  onOpenActivity: () => void;
  initialAddMoney?: boolean;
  returnedFromCoinbase?: boolean;
  regionId: RegionId;
}) {
  const isLoading = assetBalances?.status === "loading";
  const isRevalidating = assetBalances?.revalidating === true;
  const showSessionShimmer = !activitySession && (isLoading || isRevalidating);
  const heroLabel = isLoading
    ? "Updating…"
    : assetBalances?.status === "unavailable"
      ? "Balance unavailable"
      : "Total balance";
  const balanceItems = assetBalances?.items ?? [];
  const balanceStatusLabel =
    assetBalances?.totalStatus === "partial"
      ? "Unavailable"
      : assetBalances?.statusLabel;
  const showBalanceStatus =
    assetBalances?.status !== "loading" &&
    balanceStatusLabel !== "Updating…" &&
    Boolean(balanceStatusLabel);

  return (
    <div className="home-panel">
      <section
        className="balance-hero"
        aria-label={heroLabel}
        aria-busy={isLoading || isRevalidating || undefined}
      >
        {isLoading ? (
          <span
            className="shimmer balance-hero-shimmer"
            data-shimmer="hero"
            aria-hidden="true"
          />
        ) : (
          <p className="balance-hero-total">
            {assetBalances?.displayTotal ?? "—"}
          </p>
        )}
        {showBalanceStatus ? (
          <p
            className="balance-status"
            data-total-status={assetBalances?.totalStatus}
          >
            {balanceStatusLabel}
          </p>
        ) : null}
        {isLoading || isRevalidating ? (
          <span className="sr-status">Updating…</span>
        ) : null}
      </section>

      <div className="action-row" aria-label="Money actions">
        <FundingActions
          initialOpen={initialAddMoney}
          returnedFromCoinbase={returnedFromCoinbase}
          regionId={regionId}
        />
        <TransferActions
          onTransferConfirmed={onTransferConfirmed}
          availableByAsset={availableSendBalances(balanceItems)}
        />
      </div>

      <section className="balances-panel" aria-labelledby="balances-heading">
        <SectionTapIn
          headingId="balances-heading"
          title="Balances"
          onOpen={onOpenBalances}
        />
        <HomeBalancesList
          items={previewHomeBalanceItems(balanceItems)}
          isLoading={isLoading}
          isUnavailable={assetBalances?.status === "unavailable"}
          assetMarkResolution={assetMarkResolution}
        />
      </section>

      {showSessionShimmer ? (
        <button
          className="save-teaser"
          type="button"
          onClick={onOpenSave}
          aria-label="Save"
        >
          <span className="shimmer shimmer-save-icon" aria-hidden="true" />
          <span className="shimmer shimmer-line shimmer-line-save" aria-hidden="true" />
          <span className="shimmer shimmer-pill" aria-hidden="true" />
        </button>
      ) : (
        <button
          className="save-teaser"
          type="button"
          onClick={onOpenSave}
          aria-label="Save"
        >
          <span className="save-teaser-icon" aria-hidden="true">
            <PiggyBank size={20} strokeWidth={1.9} />
          </span>
          <span className="save-teaser-label">Save</span>
          <span className="save-teaser-action">
            Earn <span aria-hidden="true">›</span>
          </span>
        </button>
      )}

      {showSessionShimmer ? (
        <section
          className="activity-panel"
          aria-labelledby="activity-title"
          aria-busy="true"
        >
          <SectionTapIn
            headingId="activity-title"
            title="Activity"
            onOpen={onOpenActivity}
          />
          <ShimmerRows count={2} />
        </section>
      ) : (
        <div className="activity-panel activity-panel-slot">
          <ConnectedActivityPanel
            density="teaser"
            header={
              <SectionTapIn
                headingId="activity-title"
                title="Activity"
                onOpen={onOpenActivity}
              />
            }
            activitySession={activitySession}
            fetchActivity={fetchActivity}
            fetchOperations={fetchOperations}
            readOperation={readOperation}
            checkOperation={checkOperation}
            activityRefreshTrigger={activityRefreshTrigger}
          />
        </div>
      )}
    </div>
  );
}

function BalancesPage({
  assetBalances,
  assetMarkResolution,
  isChecking,
  revealedCount,
  onRevealMore,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  assetMarkResolution?: AssetMarkResolution;
  isChecking: boolean;
  revealedCount: number;
  onRevealMore: () => void;
}) {
  const isLoading = assetBalances?.status === "loading" || isChecking;
  const balanceStatusLabel =
    assetBalances?.totalStatus === "partial"
      ? "Unavailable"
      : assetBalances?.statusLabel;
  const showBalanceStatus =
    assetBalances?.status !== "loading" &&
    balanceStatusLabel !== "Updating…" &&
    Boolean(balanceStatusLabel);
  return (
    <section className="balances-panel nested-home-panel" aria-label="Balances">
      {showBalanceStatus ? (
        <p
          className="balance-status balance-status-panel"
          data-total-status={assetBalances?.totalStatus}
        >
          {balanceStatusLabel}
        </p>
      ) : null}
      <IncrementalBalancesList
        items={assetBalances?.items ?? []}
        isLoading={isLoading}
        isUnavailable={assetBalances?.status === "unavailable"}
        assetMarkResolution={assetMarkResolution}
        revealedCount={revealedCount}
        onRevealMore={onRevealMore}
      />
    </section>
  );
}

function ActivityPage({
  activitySession,
  fetchActivity,
  fetchOperations,
  readOperation,
  checkOperation,
  activityRefreshTrigger,
  showSessionShimmer,
}: {
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  readOperation: (id: string, signal?: AbortSignal) => Promise<unknown>;
  checkOperation?: (action: PreparedMoneyAction) => Promise<unknown>;
  activityRefreshTrigger?: string | number;
  showSessionShimmer: boolean;
}) {
  if (showSessionShimmer) {
    return (
      <section className="activity-panel nested-home-panel" aria-label="Activity" aria-busy="true">
        <ShimmerRows count={4} />
      </section>
    );
  }
  return (
    <div className="activity-panel activity-panel-slot nested-home-panel">
      <ConnectedActivityPanel
        density="page"
        header={null}
        activitySession={activitySession}
        fetchActivity={fetchActivity}
        fetchOperations={fetchOperations}
        readOperation={readOperation}
        checkOperation={checkOperation}
        activityRefreshTrigger={activityRefreshTrigger}
      />
    </div>
  );
}

function ConnectedActivityPanel({
  density,
  header,
  activitySession,
  fetchActivity,
  fetchOperations,
  readOperation,
  checkOperation,
  activityRefreshTrigger,
}: {
  density: ActivityPanelDensity;
  header?: ReactNode | null;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  readOperation: (id: string, signal?: AbortSignal) => Promise<unknown>;
  checkOperation?: (action: PreparedMoneyAction) => Promise<unknown>;
  activityRefreshTrigger?: string | number;
}) {
  const [indexedTransactionHashes, setIndexedTransactionHashes] = useState<string[]>([]);
  const [localActionCount, setLocalActionCount] = useState(0);
  const updateIndexedTransactionHashes = useCallback((hashes: string[]) => {
    setIndexedTransactionHashes((current) =>
      current.length === hashes.length && current.every((hash, index) => hash === hashes[index])
        ? current
        : hashes
    );
  }, []);

  return (
    <ActivityPanel
      session={activitySession}
      fetchActivity={fetchActivity}
      refreshTrigger={activityRefreshTrigger}
      onTransactionHashesChange={updateIndexedTransactionHashes}
      suppressEmpty={localActionCount > 0}
      density={density}
      header={header}
      leading={
        <RecentMoneyActions
          session={activitySession}
          fetchOperations={fetchOperations}
          readOperation={readOperation}
          checkOperation={checkOperation}
          refreshTrigger={activityRefreshTrigger}
          excludeTransactionHashes={indexedTransactionHashes}
          embedded
          showUnavailableNotice={false}
          onVisibleCountChange={setLocalActionCount}
        />
      }
    />
  );
}

function HomeBalancesList({
  items,
  isLoading,
  isUnavailable = false,
  assetMarkResolution,
}: {
  items: readonly HomeAssetBalanceItem[];
  isLoading: boolean;
  isUnavailable?: boolean;
  assetMarkResolution?: AssetMarkResolution;
}) {
  if (items.length > 0) {
    return (
      <ul className="supplied-asset-list">
        {items.map((asset) => (
          <HomeBalanceRowView
            key={asset.id}
            asset={asset}
            assetMarkResolution={assetMarkResolution}
          />
        ))}
      </ul>
    );
  }
  if (isLoading) {
    return <ShimmerRows count={2} />;
  }
  if (isUnavailable) return null;
  return <p className="balances-empty">No balances yet</p>;
}

const BALANCES_BATCH_SIZE = 10;

type BalancesRevealWindow = {
  key: string;
  resetSignal: number;
  count: number;
};

export function homeBalancesRestoreScope(input: {
  ownerKey: string | null;
  provider: string | null;
  subject: string | null;
  smartAccount: string | null;
  region: RegionId;
}): string | null {
  const { ownerKey, provider, subject, smartAccount, region } = input;
  if (!ownerKey || !provider || !subject || !smartAccount) return null;
  return `${ownerKey}\u0000${provider}\u0000${subject}\u0000${smartAccount.toLowerCase()}\u0000${region}`;
}

function balancesListKey(items: readonly HomeAssetBalanceItem[]): string {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      assetKey: item.assetKey ?? null,
      group: item.group ?? null,
      name: item.name,
      detail: item.detail ?? null,
      displayBalance: item.displayBalance,
      displayContext: item.displayContext ?? null,
      currencyCode: item.currencyCode ?? null,
      tone: item.tone ?? null,
    })),
  );
}

function useBalancesRevealWindow(
  scope: string | null,
  items: readonly HomeAssetBalanceItem[],
  resetSignal: number,
) {
  const [revealWindow, setRevealWindow] = useState<BalancesRevealWindow>(() => {
    const key = `${scope ?? ""}\u0000${balancesListKey(items)}`;
    return { key, resetSignal, count: BALANCES_BATCH_SIZE };
  });
  const key = `${scope ?? ""}\u0000${balancesListKey(items)}`;
  if (revealWindow.key !== key || revealWindow.resetSignal !== resetSignal) {
    setRevealWindow({ key, resetSignal, count: BALANCES_BATCH_SIZE });
  }

  const count = Math.min(revealWindow.count, items.length);
  const extend = useCallback(() => {
    setRevealWindow((current) =>
      current.key === key
        ? {
            key,
            resetSignal: current.resetSignal,
            count: Math.min(
              current.count + BALANCES_BATCH_SIZE,
              items.length,
            ),
          }
        : current,
    );
  }, [key, items.length]);

  return { count, extend };
}

function IncrementalBalancesList({
  items,
  isLoading,
  isUnavailable = false,
  assetMarkResolution,
  revealedCount,
  onRevealMore,
}: {
  items: readonly HomeAssetBalanceItem[];
  isLoading: boolean;
  isUnavailable?: boolean;
  assetMarkResolution?: AssetMarkResolution;
  revealedCount: number;
  onRevealMore: () => void;
}) {
  const count = Math.min(revealedCount, items.length);
  const hasMore = count < items.length;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onRevealMore();
        }
      },
      { rootMargin: "0px 0px 40% 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [revealedCount, items.length, hasMore, onRevealMore]);

  if (items.length === 0) {
    if (isLoading) {
      return <ShimmerRows count={2} />;
    }
    if (isUnavailable) return null;
    return <p className="balances-empty">No balances yet</p>;
  }

  return (
    <>
      <ul className="supplied-asset-list">
        {items.slice(0, count).map((asset) => (
          <HomeBalanceRowView
            key={asset.id}
            asset={asset}
            assetMarkResolution={assetMarkResolution}
          />
        ))}
      </ul>
      {hasMore ? (
        <div
          ref={sentinelRef}
          className="balances-sentinel"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}

function HomeBalanceRowView({
  asset,
  assetMarkResolution,
}: {
  asset: HomeAssetBalanceItem;
  assetMarkResolution?: AssetMarkResolution;
}) {
  if (asset.displayContext === "Updating…") {
    return (
      <li className="shimmer-row" data-shimmer="row">
        <CurrencyMark pending />
        <span className="shimmer-identity">
          <span
            className="shimmer shimmer-line shimmer-line-wide"
            aria-hidden="true"
          />
          <span
            className="shimmer shimmer-line shimmer-line-narrow"
            aria-hidden="true"
          />
        </span>
        <span className="shimmer shimmer-pill" aria-hidden="true" />
        <span className="sr-status">Updating…</span>
      </li>
    );
  }

  const row = presentHomeBalanceRow(asset);
  const mark = presentHomeBalanceMark(asset, assetMarkResolution);
  return (
    <BalanceRow
      icon={
        <CurrencyMark
          currency={mark.currency}
          symbol={mark.symbol}
          src={mark.imageUrl}
          pending={mark.pending}
        />
      }
      iconTone="mark"
      label={asset.name}
      context={asset.displayContext}
      value={
        row.accessibleBalance ? (
          <span
            aria-label={row.accessibleBalance}
            title={row.accessibleBalance}
          >
            {row.visualBalance}
          </span>
        ) : (
          row.visualBalance
        )
      }
      valueTone={row.tone}
    />
  );
}

function availableSendBalances(
  items: readonly HomeAssetBalanceItem[],
): Partial<Record<"usdc" | "eth", string>> {
  const availableItems = items.filter(
    (item) => item.tone !== "error" && item.displayBalance !== "—",
  );
  const cashUsd = availableItems.find(
    (item) => item.group === "cash" && item.currencyCode === "USD",
  );
  const eth = availableItems.find((item) => item.detail === "ETH");
  return {
    ...(cashUsd?.displayBalance ? { usdc: cashUsd.displayBalance } : {}),
    ...(eth ? { eth: eth.displayContext ?? eth.displayBalance } : {}),
  };
}

function ShimmerRows({ count }: { count: number }) {
  return (
    <ul className="shimmer-list">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="shimmer-row" data-shimmer="row">
          <CurrencyMark pending />
          <span className="shimmer-identity">
            <span className="shimmer shimmer-line shimmer-line-wide" aria-hidden="true" />
            <span className="shimmer shimmer-line shimmer-line-narrow" aria-hidden="true" />
          </span>
          <span className="shimmer shimmer-pill" aria-hidden="true" />
        </li>
      ))}
    </ul>
  );
}

function SavePanelShell() {
  return (
    <section className="save-panel-shell" aria-busy="true">
      <div className="save-panel-shell-hero">
        <span
          className="shimmer balance-hero-shimmer"
          data-shimmer="hero"
          aria-hidden="true"
        />
        <span className="sr-status">Updating…</span>
      </div>
      <ShimmerRows count={2} />
    </section>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <section className="empty-panel" aria-label={label}>
      <strong>{label} unavailable</strong>
    </section>
  );
}

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
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  readAnonymousCountryPreference,
  writeAnonymousCountryPreference,
} from "@/config/country-preference";
import { savePanelId, type ShellPanelId } from "@/config/navigation";
import { parseShellLocation, shellHref } from "@/config/shell-location";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { CurrencyMark } from "@/components/currency-mark";
import {
  presentationRegions,
  resolvePresentation,
  type RegionId,
  type ResolutionSource,
} from "@/config/regions";
import { BalanceRow } from "@/components/finance-rows";
import { HomeMark } from "@/components/home-mark";
import { AccountSignInSheet } from "@/features/account/account-screen";
import { AccountSettings } from "@/features/account/account-settings";
import { useAccountWallet } from "@/features/account/cdp-client";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { ActivityPanel, type FetchActivity } from "@/features/activity";
import {
  MoneyDataRefreshProvider,
  RecentMoneyActions,
  type PreparedMoneyAction,
} from "@/features/money-actions";
import type { VerifiedPortfolioSession } from "@/features/portfolio";
import {
  deleteHomeBalancesPresentation,
  presentHomeBalanceRow,
  presentPortfolioValuation,
  usePaintedHomeBalances,
  usePortfolioValuation,
  writeHomeBalancesPresentation,
  type HomeAssetBalanceItem,
  type HomeAssetBalancesPresentation,
} from "@/features/portfolio-valuation";
import { TransferActions } from "@/features/transfers";
import { PresentationRegionProvider } from "@/features/invest/presentation-quote";
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
  landingVisual?: ReactNode;
  routeMode?: "landing" | "dashboard";
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

export function HomeExperience({
  detectedCountry = null,
  investContent,
  savingsContent,
  initialAccountOpen = false,
  initialPanel = "home",
  initialAccountSettingsOpen = false,
  assetBalances,
  landingVisual,
  routeMode = "landing",
  activityRefreshTrigger,
  onTransferConfirmed,
  selectedRegionId,
  onRegionChange,
}: HomeExperienceProps) {
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
  const shellPath = routeMode === "landing" ? "/" : "/dashboard";

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
      const location = parseShellLocation(
        new URLSearchParams(window.location.search),
      );
      setActiveNavigation(location.panel);
      setIsAccountSettingsOpen(location.account === "settings");
      if (location.account !== "settings") setSettingsOpenedInApp(false);
      setIsAccountOpen(location.account === "signin");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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

  useEffect(() => {
    if (navigationRequest === 0) return;

    const panelStage = panelStageRef.current;
    if (!panelStage) return;

    panelStage.focus({ preventScroll: true });
    panelStage.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }, [activeNavigation, navigationRequest]);

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
    setActiveNavigation(nextNavigation);
    setNavigationRequest((request) => request + 1);
    if (skipHistory) return;
    router.push(shellHref(shellPath, { panel: nextNavigation }), {
      scroll: false,
    });
  }

  function openAccountSettings() {
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
    setIsAccountSettingsOpen(false);
    if (settingsOpenedInApp) {
      setSettingsOpenedInApp(false);
      router.back();
      return;
    }
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
    if (routeMode === "dashboard") {
      explicitLogoutRef.current = true;
      router.replace("/", { scroll: false });
    }
    void account.signOut().catch(() => {});
  }

  return (
    <div className="app-frame" style={regionStyle}>
      <header className="app-header">
        {isAccountSettingsOpen ? (
          <h1 className="account-settings-title">Account</h1>
        ) : activeNavigation === savePanelId ? (
          <button
            className="header-back-link"
            type="button"
            onClick={() => navigateTo("home")}
          >
            <span aria-hidden="true">←</span>
            <span className="sr-only">Back</span>
          </button>
        ) : (
          <HomeMark
            onClick={() => {
              if (isVerified) navigateTo("home");
            }}
          />
        )}

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
            onDashboard={() => router.replace("/dashboard")}
            onSignIn={openAccount}
            onSignOut={signOut}
            onOpenSettings={openAccountSettings}
          />
        )}
      </header>

      {routeMode === "dashboard" ? (
        <main className="app-main app-main-authenticated">
          {isUnavailable ? (
            <div className="dashboard-notice" role="alert">
              <span>{account.message ?? "Your private details remain hidden."}</span>
              <button type="button" onClick={() => void account.retrySessionValidation()}>
                Retry account check
              </button>
            </div>
          ) : null}

          {isAccountSettingsOpen ? (
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
          ) : isSignedOut ? (
            <section
              className="panel-stage"
              aria-busy="true"
              aria-label="Signed out"
            >
              <span className="sr-status">Signed out</span>
            </section>
          ) : (
            <>
              <PrimaryNavigation
                activeNavigation={activeNavigation}
                onNavigate={navigateTo}
              />

              <section
                ref={panelStageRef}
                className="panel-stage"
                id="navigation-panel"
                tabIndex={-1}
                aria-labelledby={
                  activeNavigation === savePanelId
                    ? undefined
                    : `${activeNavigation}-nav`
                }
                aria-label={
                  activeNavigation === savePanelId ? "Savings" : undefined
                }
                aria-busy={isChecking}
              >
                {activeNavigation === "home" ? (
                  <HomePanel
                    assetBalances={paintedAssetBalances}
                    activitySession={activitySession}
                    fetchActivity={account.fetchActivity}
                    fetchOperations={account.fetchOperations}
                    readOperation={readOperation}
                    recoverOperation={account.executeMoneyAction}
                    activityRefreshTrigger={activityRefreshTrigger}
                    onTransferConfirmed={onTransferConfirmed}
                    onOpenSave={() => navigateTo(savePanelId)}
                  />
                ) : null}
                {activeNavigation === savePanelId
                  ? (
                    <div id="save-panel">
                      {isVerified
                        ? (savingsContent ?? <EmptyPanel label="Savings" />)
                        : isChecking
                          ? <SavePanelShell />
                          : <EmptyPanel label="Savings" />}
                    </div>
                  )
                  : null}
                {activeNavigation === "invest" ? (
                  <PresentationRegionProvider regionId={regionId}>
                    {investContent ?? <EmptyPanel label="Investments" />}
                  </PresentationRegionProvider>
                ) : null}
              </section>
            </>
          )}
        </main>
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

function HeaderAccountAction({
  status,
  isSignedIn,
  routeMode,
  onDashboard,
  onSignIn,
  onSignOut,
  onOpenSettings,
}: {
  status: ReturnType<typeof useAccountWallet>["status"];
  isSignedIn: boolean;
  routeMode: "landing" | "dashboard";
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
    return routeMode === "landing" ? (
      <button className="header-account-link" type="button" onClick={onDashboard}>
        Dashboard
      </button>
    ) : (
      <button
        className="header-account-link header-account-quiet"
        type="button"
        onClick={onOpenSettings}
      >
        Account
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

function HomePanel({
  assetBalances,
  activitySession,
  fetchActivity,
  fetchOperations,
  readOperation,
  recoverOperation,
  activityRefreshTrigger,
  onTransferConfirmed,
  onOpenSave,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  readOperation: (id: string, signal?: AbortSignal) => Promise<unknown>;
  recoverOperation?: (action: PreparedMoneyAction) => Promise<unknown>;
  activityRefreshTrigger?: string | number;
  onTransferConfirmed?: () => void;
  onOpenSave: () => void;
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
        {isLoading || isRevalidating ? (
          <span className="sr-status">Updating…</span>
        ) : null}
      </section>

      <div className="action-row" aria-label="Money actions">
        <Link href="/fund">
          <PlusIcon />
          <span>Add money</span>
        </Link>
        <TransferActions
          onTransferConfirmed={onTransferConfirmed}
          availableByAsset={availableSendBalances(balanceItems)}
        />
      </div>

      <section className="balances-panel" aria-labelledby="balances-heading">
        <h2 id="balances-heading">Balances</h2>
        {balanceItems.length > 0 ? (
          <ul className="supplied-asset-list">
            {balanceItems.map((asset) => {
              const row = presentHomeBalanceRow(asset);
              return (
                <BalanceRow
                  key={asset.id}
                  icon={
                    <CurrencyMark
                      currency={asset.currencyCode}
                      symbol={asset.detail ?? asset.name}
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
            })}
          </ul>
        ) : isLoading ? (
          <ShimmerRows count={2} />
        ) : (
          <p className="balances-empty">No balances yet</p>
        )}
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
          <h2 id="activity-title">Activity</h2>
          <ShimmerRows count={2} />
        </section>
      ) : (
        <div className="activity-panel activity-panel-slot">
          <ActivityPanel
            session={activitySession}
            fetchActivity={fetchActivity}
            refreshTrigger={activityRefreshTrigger}
            onTransactionHashesChange={updateIndexedTransactionHashes}
            suppressEmpty={localActionCount > 0}
            leading={
              <RecentMoneyActions
                session={activitySession}
                fetchOperations={fetchOperations}
                readOperation={readOperation}
                recoverOperation={recoverOperation}
                refreshTrigger={activityRefreshTrigger}
                excludeTransactionHashes={indexedTransactionHashes}
                embedded
                onVisibleCountChange={setLocalActionCount}
              />
            }
          />
        </div>
      )}
    </div>
  );
}

function availableSendBalances(
  items: readonly HomeAssetBalanceItem[],
): Partial<Record<"usdc" | "eth", string>> {
  const cashUsd = items.find((item) => item.group === "cash" && item.currencyCode === "USD");
  const cash = cashUsd ?? items.find((item) => item.group === "cash");
  const eth = items.find((item) => item.detail === "ETH");
  return {
    ...(cash?.displayBalance ? { usdc: cash.displayBalance } : {}),
    ...(eth ? { eth: eth.displayContext ?? eth.displayBalance } : {}),
  };
}

function ShimmerRows({ count }: { count: number }) {
  return (
    <ul className="shimmer-list">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="shimmer-row" data-shimmer="row">
          <span className="shimmer shimmer-mark" aria-hidden="true" />
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

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

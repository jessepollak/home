"use client";

import {
  useCallback,
  useEffect,
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
} from "@/features/money-actions";
import {
  usePortfolio,
  type VerifiedPortfolioSession,
} from "@/features/portfolio";
import {
  presentPortfolioValuation,
  usePortfolioValuation,
  type HomeAssetBalanceItem,
  type HomeAssetBalancesPresentation,
} from "@/features/portfolio-valuation";
import { TransferActions } from "@/features/transfers";
import { PiggyBank } from "lucide-react";

export type { HomeAssetBalanceItem, HomeAssetBalancesPresentation };

export type HomeExperienceProps = {
  detectedCountry?: string | null;
  investContent?: ReactNode;
  savingsContent?: ReactNode;
  initialAccountOpen?: boolean;
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
  usePortfolio(session, account.fetchPortfolio, refreshTrigger);
  const valuation = usePortfolioValuation(
    session,
    selectedRegion,
    account.fetchPortfolioValuation,
    refreshTrigger,
  );
  const refreshWalletData = useCallback(() => {
    setRefreshTrigger((trigger) => trigger + 1);
  }, []);

  return (
    <MoneyDataRefreshProvider onConfirmed={refreshWalletData}>
      <HomeExperience
        {...props}
        activityRefreshTrigger={refreshTrigger}
        assetBalances={presentPortfolioValuation(valuation)}
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
    useState<ShellPanelId>("home");
  const [navigationRequest, setNavigationRequest] = useState(0);
  const panelStageRef = useRef<HTMLElement>(null);
  const explicitLogoutRef = useRef(false);
  const [isPreferenceReady, setIsPreferenceReady] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [isAccountOpen, setIsAccountOpen] = useState(initialAccountOpen);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);

  const closeAccount = useCallback(() => {
    setIsAccountOpen(false);
    if (initialAccountOpen) {
      router.replace("/", { scroll: false });
    }
  }, [initialAccountOpen, router]);

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
    setIsAccountSettingsOpen(false);
    setActiveNavigation(nextNavigation);
    setNavigationRequest((request) => request + 1);
  }

  function openAccount() {
    if (isVerified || (account.status === "unavailable" && account.isSignedIn)) {
      setIsAccountSettingsOpen(true);
      return;
    }
    setIsAccountOpen(true);
  }

  function closeAccountSettings() {
    setIsAccountSettingsOpen(false);
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
            onOpenSettings={() => setIsAccountSettingsOpen(true)}
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
          ) : isChecking || isSignedOut ? (
            <section
              className="panel-stage"
              aria-busy="true"
              aria-label={isSignedOut ? "Signed out" : "Restoring"}
            >
              <span className="sr-status">
                {isSignedOut ? "Signed out" : "Updating…"}
              </span>
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
                    assetBalances={
                      isVerified
                        ? assetBalances
                        : {
                            status: "loading",
                            displayTotal: null,
                            statusLabel: "Updating…",
                            items: [],
                          }
                    }
                    activitySession={activitySession}
                    fetchActivity={account.fetchActivity}
                    fetchOperations={account.fetchOperations}
                    readOperation={readOperation}
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
                        : <EmptyPanel label="Savings verifying" />}
                    </div>
                  )
                  : null}
                {activeNavigation === "invest"
                  ? (investContent ?? <EmptyPanel label="Investments" />)
                  : null}
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
      <button className="header-account-link" type="button" disabled>
        Checking…
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
  activityRefreshTrigger,
  onTransferConfirmed,
  onOpenSave,
}: {
  assetBalances?: HomeAssetBalancesPresentation;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  readOperation: (id: string, signal?: AbortSignal) => Promise<unknown>;
  activityRefreshTrigger?: string | number;
  onTransferConfirmed?: () => void;
  onOpenSave: () => void;
}) {
  const isLoading = assetBalances?.status === "loading";
  const heroLabel = isLoading
    ? "Updating…"
    : assetBalances?.status === "unavailable"
      ? "Balance unavailable"
      : "Total balance";
  const balanceItems = (assetBalances?.items ?? []).filter(
    (item) => item.group !== "asset",
  );
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
      <section className="balance-hero" aria-label={heroLabel}>
        <p className="balance-hero-total">{assetBalances?.displayTotal ?? "—"}</p>
        {isLoading ? <span className="sr-status">Updating…</span> : null}
      </section>

      <div className="action-row" aria-label="Money actions">
        <Link href="/fund">
          <PlusIcon />
          <span>Add money</span>
        </Link>
        <TransferActions onTransferConfirmed={onTransferConfirmed} />
      </div>

      <section className="balances-panel" aria-labelledby="balances-heading">
        <h2 id="balances-heading">Balances</h2>
        {balanceItems.length > 0 ? (
          <ul className="supplied-asset-list">
            {balanceItems.map((asset) => (
              <BalanceRow
                key={asset.id}
                icon={
                  <CurrencyMark
                    currency={asset.currencyCode}
                    symbol={asset.name}
                  />
                }
                iconTone="mark"
                label={asset.name}
                value={asset.displayBalance}
                valueTone={asset.tone}
              />
            ))}
          </ul>
        ) : isLoading ? null : (
          <p className="balances-empty">No balances yet</p>
        )}
      </section>

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
              refreshTrigger={activityRefreshTrigger}
              excludeTransactionHashes={indexedTransactionHashes}
              embedded
              onVisibleCountChange={setLocalActionCount}
            />
          }
        />
      </div>
    </div>
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

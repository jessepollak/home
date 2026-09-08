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
import type { NavigationId } from "@/config/navigation";
import { PrimaryNavigation } from "@/components/primary-navigation";
import {
  presentationRegions,
  resolvePresentation,
  type PresentationRegion,
  type RegionId,
  type ResolutionSource,
} from "@/config/regions";
import { CountrySelect } from "@/components/country-select";
import { AssetRow, BalanceRow } from "@/components/finance-rows";
import { HomeMark } from "@/components/home-mark";
import { AccountSignInSheet } from "@/features/account/account-screen";
import { useAccountWallet } from "@/features/account/cdp-client";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { ActivityPanel, type FetchActivity } from "@/features/activity";
import { formatTokenAmount } from "@/features/formatting";
import {
  MoneyDataRefreshProvider,
  RecentMoneyActions,
} from "@/features/money-actions";
import {
  usePortfolio,
  type VerifiedPortfolioSession,
} from "@/features/portfolio";
import {
  formatFiatValue,
  usePortfolioValuation,
  type PortfolioValuationState,
} from "@/features/portfolio-valuation";
import { TransferActions } from "@/features/transfers";

export type HomeAssetBalanceItem = {
  id: string;
  group?: "cash" | "asset";
  name: string;
  detail: string;
  displayBalance: string;
  displayContext?: string;
  tone?: "default" | "muted" | "error";
};

export type HomeAssetBalancesPresentation = {
  status: "loading" | "ready" | "unavailable";
  displayTotal: string | null;
  statusLabel?: string;
  items: readonly HomeAssetBalanceItem[];
};

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

function presentPortfolioValuation(
  valuation: PortfolioValuationState,
): HomeAssetBalancesPresentation {
  if (valuation.status === "loading") {
    return {
      status: "loading",
      displayTotal: null,
      statusLabel: "Updating wallet and savings value",
      items: [],
    };
  }
  if (valuation.status !== "ready") {
    return {
      status: "unavailable",
      displayTotal: null,
      statusLabel: "Wallet and savings value unavailable",
      items: [],
    };
  }

  const { snapshot } = valuation;
  const needsQuoteCurrency =
    snapshot.total.status === "unavailable-no-quote-currency";
  const totalUnavailable = snapshot.total.status === "unavailable";
  const cashItems: HomeAssetBalanceItem[] = snapshot.cashBuckets.map((bucket) => {
    if (bucket.valuationStatus === "unsupported") {
      return {
        id: bucket.id,
        group: "cash",
        name: `${bucket.denominationCurrency} / ${bucket.symbol}`,
        detail: "Verified Base contract unavailable",
        displayBalance: "Unavailable",
        tone: "muted",
      };
    }
    const amount =
      bucket.tokenAmountBaseUnits !== null && bucket.tokenDecimals !== null
        ? formatTokenAmount(bucket.tokenAmountBaseUnits, bucket.tokenDecimals)
        : null;
    return {
      id: bucket.id,
      group: "cash",
      name: `${bucket.denominationCurrency} / ${bucket.symbol}`,
      detail:
        bucket.roles.length === 2
          ? "USDC on Base · local cash"
          : `${bucket.symbol} on Base`,
      displayBalance: amount ? `${amount} ${bucket.symbol}` : "Unavailable",
      displayContext: bucket.indicativeValue
        ? `${formatFiatValue(
            bucket.indicativeValue,
            bucket.denominationCurrency,
          )} indicative`
        : bucket.valuationStatus === "unpriced"
          ? "Exact-contract price unavailable"
          : undefined,
      tone:
        bucket.valuationStatus === "read-unavailable" ? "error" : "default",
    };
  });

  const lineByKey = new Map(
    snapshot.lines.map((line) => [line.holdingAssetKey, line]),
  );
  const cashKeys = new Set<string>(
    snapshot.cashBuckets.flatMap((bucket) =>
      bucket.assetKey ? [bucket.assetKey] : [],
    ),
  );
  const assetItems = snapshot.inventory.holdings.flatMap<HomeAssetBalanceItem>(
    (holding) => {
      if (cashKeys.has(holding.assetKey) || holding.readStatus !== "ready") return [];
      const amount =
        holding.kind === "direct"
          ? holding.balanceBaseUnits
          : holding.underlyingBaseUnits;
      const decimals =
        holding.kind === "direct" ? holding.decimals : holding.underlyingDecimals;
      if (amount === null || BigInt(amount) === BigInt(0)) return [];
      const line = lineByKey.get(holding.assetKey);
      const quantity = formatTokenAmount(amount, decimals);
      return [
        {
          id: holding.id,
          group: "asset",
          name: holding.name,
          detail:
            holding.kind === "vault-position"
              ? `${quantity} USDC in Morpho vault`
              : `${quantity} ${holding.symbol} on Base`,
          displayBalance:
            line?.value && snapshot.quoteCurrency
              ? formatFiatValue(line.value, snapshot.quoteCurrency)
              : "Unpriced",
          displayContext:
            line?.status === "unpriced" ? "Price unavailable" : undefined,
          tone: line?.status === "unpriced" ? "muted" : "default",
        },
      ];
    },
  );

  return {
    status: "ready",
    displayTotal:
      snapshot.total.value && snapshot.total.currency
        ? formatFiatValue(snapshot.total.value, snapshot.total.currency)
        : needsQuoteCurrency
          ? "Choose a country"
          : totalUnavailable
            ? "Unavailable"
            : "—",
    statusLabel: needsQuoteCurrency
      ? "Choose a country to select a local valuation currency"
      : totalUnavailable
        ? "Wallet and savings value unavailable"
        : snapshot.total.status === "partial"
          ? "Partial · wallet and savings only · Borrow separate"
          : "Wallet and savings only · Borrow separate",
    items: [...cashItems, ...assetItems],
  };
}

type RegionStyle = CSSProperties & {
  "--region-accent": string;
  "--region-accent-soft": string;
  "--region-surface": string;
};

const sourceLabels: Record<ResolutionSource, string> = {
  explicit: "Your country choice",
  persisted: "Saved country choice",
  detected: "Suggested country",
  fallback: "No country selected",
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
    useState<NavigationId>("home");
  const [navigationRequest, setNavigationRequest] = useState(0);
  const panelStageRef = useRef<HTMLElement>(null);
  const explicitLogoutRef = useRef(false);
  const [isPreferenceReady, setIsPreferenceReady] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [isAccountOpen, setIsAccountOpen] = useState(initialAccountOpen);

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

  function navigateTo(nextNavigation: NavigationId) {
    setActiveNavigation(nextNavigation);
    setNavigationRequest((request) => request + 1);
  }

  function openAccount() {
    setIsAccountOpen(true);
  }

  function signOut() {
    if (routeMode === "dashboard") {
      explicitLogoutRef.current = true;
      router.replace("/", { scroll: false });
    }
    void account.signOut().catch(() => {});
  }

  return (
    <div className="app-frame" style={regionStyle}>
      <header className="app-header">
        <HomeMark
          onClick={() => {
            if (isVerified) navigateTo("home");
          }}
        />

        <div className="header-country" title={sourceLabels[resolutionSource]}>
          <CountrySelect
            value={regionId}
            onValueChange={selectRegion}
            describedBy="preference-status"
          />
          <p id="preference-status" className="sr-status" aria-live="polite">
            {preferenceMessage ||
              (isPreferenceReady
                ? `${sourceLabels[resolutionSource]}.`
                : "Checking saved country preference.")}
          </p>
        </div>

        <HeaderAccountAction
          status={account.status}
          isSignedIn={account.isSignedIn}
          routeMode={routeMode}
          onDashboard={() => router.replace("/dashboard")}
          onSignIn={openAccount}
          onSignOut={signOut}
        />
      </header>

      {routeMode === "dashboard" ? (
        <main className="app-main app-main-authenticated">
          <div className="main-heading">
            <h1>Portfolio</h1>
          </div>

          {isUnavailable ? (
            <div className="dashboard-notice" role="alert">
              <span>{account.message ?? "Your private details remain hidden."}</span>
              <button type="button" onClick={() => void account.retrySessionValidation()}>
                Retry account check
              </button>
            </div>
          ) : null}

          <PrimaryNavigation
            activeNavigation={activeNavigation}
            onNavigate={navigateTo}
          />

          <section
            ref={panelStageRef}
            className="panel-stage"
            id="navigation-panel"
            tabIndex={-1}
            aria-labelledby={`${activeNavigation}-nav`}
            aria-busy={isChecking}
          >
            {activeNavigation === "home" ? (
              <HomePanel
                region={region}
                accountAddress={
                  isVerified ? account.session?.smartAccount?.address ?? null : null
                }
                assetBalances={
                  isVerified
                    ? assetBalances
                    : {
                        status: "loading",
                        displayTotal: null,
                        statusLabel: "Balances hidden while account verification completes",
                        items: [],
                      }
                }
                activitySession={activitySession}
                fetchActivity={account.fetchActivity}
                fetchOperations={account.fetchOperations}
                readOperation={readOperation}
                activityRefreshTrigger={activityRefreshTrigger}
                onTransferConfirmed={onTransferConfirmed}
                onNavigate={navigateTo}
              />
            ) : null}
            {activeNavigation === "save"
              ? isVerified
                ? (savingsContent ?? <EmptyPanel label="Savings" />)
                : <EmptyPanel label="Savings verifying" />
              : null}
            {activeNavigation === "invest"
              ? (investContent ?? <EmptyPanel label="Investments" />)
              : null}
          </section>
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
}: {
  status: ReturnType<typeof useAccountWallet>["status"];
  isSignedIn: boolean;
  routeMode: "landing" | "dashboard";
  onDashboard: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
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
      <button className="header-account-link" type="button" onClick={onSignOut}>
        Sign out
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
  region,
  accountAddress,
  assetBalances,
  activitySession,
  fetchActivity,
  fetchOperations,
  readOperation,
  activityRefreshTrigger,
  onTransferConfirmed,
  onNavigate,
}: {
  region: PresentationRegion;
  accountAddress: string | null;
  assetBalances?: HomeAssetBalancesPresentation;
  activitySession: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  readOperation: (id: string, signal?: AbortSignal) => Promise<unknown>;
  activityRefreshTrigger?: string | number;
  onTransferConfirmed?: () => void;
  onNavigate: (navigation: NavigationId) => void;
}) {
  const balanceStatus = assetBalances?.statusLabel ??
    (assetBalances?.status === "loading"
      ? "Updating balances"
      : assetBalances?.status === "ready"
        ? "Current balance"
        : "Balance unavailable");
  const suppliedAssets = assetBalances?.items ?? [];
  const cashAssets = suppliedAssets.filter((asset) => asset.group === "cash");
  const otherAssets = suppliedAssets.filter((asset) => asset.group !== "cash");
  const [indexedTransactionHashes, setIndexedTransactionHashes] = useState<string[]>([]);
  const updateIndexedTransactionHashes = useCallback((hashes: string[]) => {
    setIndexedTransactionHashes((current) =>
      current.length === hashes.length && current.every((hash, index) => hash === hashes[index])
        ? current
        : hashes
    );
  }, []);

  return (
    <div className="home-panel">
      <section className="balance-panel" aria-labelledby="balance-heading">
        <div className="balance-heading-row">
          <div>
            <p className="section-kicker">Valuation</p>
            <h2 id="balance-heading">Wallet &amp; savings value</h2>
          </div>
          <span className="connection-status">
            <span aria-hidden="true" />
            {accountAddress ? "Verified" : "Account pending"}
          </span>
        </div>

        <div className="balance-value" aria-label={balanceStatus}>
          <strong>{assetBalances?.displayTotal ?? "—"}</strong>
          <span>{balanceStatus}</span>
        </div>

        <div className="action-row" aria-label="Money actions">
          <Link href="/fund">
            <PlusIcon />
            <span>Add money</span>
          </Link>
          <TransferActions onTransferConfirmed={onTransferConfirmed} />
        </div>

        <dl className="account-details">
          <div>
            <dt>Base account</dt>
            <dd>
              {accountAddress ? (
                <code title={accountAddress}>
                  {accountAddress.slice(0, 6)}…{accountAddress.slice(-4)}
                </code>
              ) : (
                "Setup in progress"
              )}
            </dd>
          </div>
          <div>
            <dt>Country</dt>
            <dd>{region.countryName}</dd>
          </div>
        </dl>
      </section>

      <section className="assets-panel" aria-labelledby="assets-heading">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">Balances</p>
            <h2 id="assets-heading">Assets</h2>
          </div>
          <span>{suppliedAssets.length > 0 ? "Supported inventory" : "Balances not connected"}</span>
        </div>

        {suppliedAssets.length > 0 ? (
          <>
            {cashAssets.length > 0 ? (
              <div className="asset-section" aria-label="Cash">
                <h3>Cash</h3>
                <ul className="supplied-asset-list">
                  {cashAssets.map((asset) => (
                    <BalanceRow
                      key={asset.id}
                      icon={asset.name.slice(0, 1).toUpperCase()}
                      label={asset.name}
                      context={asset.detail}
                      value={asset.displayBalance}
                      valueContext={asset.displayContext}
                      valueTone={asset.tone}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
            {otherAssets.length > 0 ? (
              <div className="asset-section" aria-label="Other supported assets">
                <h3>Other assets</h3>
                <ul className="supplied-asset-list">
                  {otherAssets.map((asset) => (
                    <AssetRow
                      key={asset.id}
                      icon={asset.name.slice(0, 1).toUpperCase()}
                      label={asset.name}
                      context={asset.detail}
                      value={asset.displayBalance}
                      valueContext={asset.displayContext}
                      valueTone={asset.tone}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <div className="asset-overview-list">
            <button type="button" onClick={() => onNavigate("save")}>
              <span className="asset-mark" aria-hidden="true">$</span>
              <span className="asset-overview-name">
                <strong>USDC savings</strong>
                <small>Compare variable rates</small>
              </span>
              <span className="asset-overview-value">
                <strong>—</strong>
                <small>Position unavailable</small>
              </span>
              <ArrowRightIcon />
            </button>
            <button type="button" onClick={() => onNavigate("invest")}>
              <span className="asset-mark asset-mark-blue" aria-hidden="true">↗</span>
              <span className="asset-overview-name">
                <strong>Stocks and memes</strong>
                <small>Browse assets on Base</small>
              </span>
              <span className="asset-overview-value">
                <strong>—</strong>
                <small>Holdings unavailable</small>
              </span>
              <ArrowRightIcon />
            </button>
          </div>
        )}
      </section>

      <div className="activity-panel activity-panel-slot">
        <RecentMoneyActions
          session={activitySession}
          fetchOperations={fetchOperations}
          readOperation={readOperation}
          refreshTrigger={activityRefreshTrigger}
          excludeTransactionHashes={indexedTransactionHashes}
        />
        <ActivityPanel
          session={activitySession}
          fetchActivity={fetchActivity}
          refreshTrigger={activityRefreshTrigger}
          onTransactionHashesChange={updateIndexedTransactionHashes}
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
function ArrowRightIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}

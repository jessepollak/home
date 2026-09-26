import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { ArrowLeft, ChartNoAxesCombined, House, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { HttpResponse, http } from "msw";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import type { AppearancePreference } from "@/shared/appearance/preference";
import { AccountSettings } from "@/client/account/account-settings";
import { profileGlyph } from "@/client/account/basename-profile";
import { AppChromeProvider } from "@/components/app-chrome";
import { HomeOverview, HomeSectionHeading } from "@/client/home/home-overview";
import { HomeHeaderStatus, homeBalancesStatus } from "@/client/home/home-status";
import { ShellHeader } from "@/client/home/shell-chrome";
import type { HomeAssetBalancesPresentation } from "@/client/home/home-types";
import { InvestHub } from "@/client/invest/invest-hub";
import {
  PresentationQuoteProvider,
  PresentationRegionProvider,
  presentationQuoteForRegion,
  type PresentationFxQuote,
} from "@/client/invest/presentation-quote";
import { SavingsExperience } from "@/client/savings/savings-experience";
import { HomeMark } from "@/components/home-mark";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { shellContentFrameClassName, shellScrollContainerClassName } from "@/components/shell-layout";
import { Button } from "@/components/ui/button";
import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import {
  isHomeNestedPanelId,
  navigationItems,
  type NavigationId,
  type ShellPanelId,
} from "@/config/navigation";
import { presentationRegions, type FiatCurrencyCode, type RegionId } from "@/config/regions";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import { computeActivityValuationAmount, unpricedActivityValuation } from "@/shared/activity/valuation";
import type { ExactDecimal } from "@/shared/balances/types";
import {
  borrowPosition,
  buildBalancesSnapshotFixture,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
} from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { BalancesSnapshot, HoldingValue } from "@/shared/balances/types";
import type { MarketDataState } from "@/shared/invest/invest-market";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { formatAddress, presentationMoneyMetadata } from "@/shared/formatting";

const noop = () => undefined;
const previewOnlyMoneyAction = async (): Promise<never> => {
  throw new Error("Money actions are not supported in the desktop shell preview.");
};
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const FIXTURE_NOW = Date.parse("2026-09-10T12:04:00.000Z");
const session: VerifiedAccountSession = {
  user: { subject: "desktop-shell-story-owner" },
  smartAccount: { address: WALLET, chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const signedInAccount = {
  status: "verified", isSignedIn: true, ownerKey: "jesse.base.eth", session: null,
} as unknown as ComponentProps<typeof ShellHeader>["account"];

const activityFxRates: Partial<Record<FiatCurrencyCode, ExactDecimal>> = {
  GBP: { atoms: "79", scale: 2 },
};
const marketFx: PresentationFxQuote[] = Object.entries(activityFxRates).map(([quoteCurrency, rate]) => ({
  quoteCurrency: quoteCurrency as FiatCurrencyCode, quoteUnitsPerUsd: rate ?? null, status: "fresh",
}));

function transfer(id: string, day: number, direction: ActivityTransfer["direction"], amountBaseUnits: string, currency: FiatCurrencyCode, month = 9): ActivityTransfer {
  const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const fxRate = currency === "USD" ? null : activityFxRates[currency];
  return {
    id: `8453:${USDC}:${id}`, logId: id, chainId: 8453, assetId: "usdc", tokenAddress: USDC,
    tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null, walletAddress: WALLET,
    fromAddress: direction === "incoming" ? OTHER : WALLET,
    toAddress: direction === "incoming" ? WALLET : OTHER,
    direction, amountBaseUnits, blockNumber: String(day), blockHash: `0x${"c".repeat(64)}`,
    transactionHash: `0x${day.toString(16).padStart(64, "0")}`, logIndex: "1",
    blockTimestamp: `${date}T12:00:00.000Z`,
    valuation: fxRate === undefined ? unpricedActivityValuation(currency, "fx-unavailable") : {
      status: "priced", currency, method: "peg", peg: "USD", close: null,
      fx: fxRate ? { provider: "Coinbase", base: "USD", quote: currency, date, rate: fxRate, provisional: false } : null,
      amount: computeActivityValuationAmount({ amountBaseUnits, tokenDecimals: 6, unitPrice: null, fxRate }),
    },
  };
}

function activityPage(currency: FiatCurrencyCode, extended = false): ActivityPage {
  return {
    walletAddress: WALLET, chainId: 8453, currency,
    window: { from: "2026-08-23T12:00:00.000Z", to: "2026-09-23T12:00:00.000Z" },
    transfers: [
      transfer("received", 22, "incoming", "25000000", currency),
      transfer("sent", 21, "outgoing", "12000000", currency),
      transfer("received-older", 19, "incoming", "60000000", currency),
      transfer("sent-older", 17, "outgoing", "7500000", currency),
      transfer("received-earliest", 14, "incoming", "11000000", currency),
      ...Array.from({ length: 9 }, (_, index) => transfer(`history-${index}`, 13 - index, index % 2 ? "outgoing" : "incoming", "10000000", currency)),
      ...(extended ? [
        ...Array.from({ length: 4 }, (_, index) => transfer(`early-september-${index}`, 4 - index, "incoming", "10000000", currency)),
        ...Array.from({ length: 8 }, (_, index) => transfer(`late-august-${index}`, 31 - index, "outgoing", "10000000", currency, 8)),
      ] : []),
    ],
    nextCursor: "cursor-2",
    source: {
      provider: "cdp-sql", cached: false, stale: false,
      executionTimestamp: "2026-09-23T12:00:00.000Z", executionTimeMs: 1,
      fetchedAt: "2026-09-23T12:00:00.000Z",
    },
  };
}
const activityHandlers = { retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: noop };
function readyActivity(currency: FiatCurrencyCode, extended = false): UseActivityResult {
  return {
    status: "ready", page: activityPage(currency, extended), loadingMore: true, loadMoreError: false, continuing: true, ...activityHandlers,
  };
}
function emptyActivity(currency: FiatCurrencyCode): UseActivityResult {
  return {
    status: "ready", page: { ...activityPage(currency), transfers: [], nextCursor: null }, loadingMore: false,
    loadMoreError: false, continuing: false, ...activityHandlers,
  };
}
const loadingActivity: UseActivityResult = {
  status: "loading", page: null, loadingMore: false, loadMoreError: false, continuing: false, ...activityHandlers,
};
const retryActivity = fn();
const failedActivity: UseActivityResult = {
  status: "error", page: null, loadingMore: false, loadMoreError: false, continuing: false,
  error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." },
  ...activityHandlers, retry: retryActivity,
};
const borrowOperation: RecentMoneyActionOperation = {
  action: {
    id: "borrow-proceeds", kind: "borrow", title: "Borrowed",
    amounts: [{ direction: "receive", assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000" }],
    warnings: [], expiresAt: "2026-09-16T12:00:00.000Z", createdAt: "2026-09-16T12:00:00.000Z",
  },
  status: "confirmed", createdAt: "2026-09-16T12:00:00.000Z", updatedAt: "2026-09-16T12:00:00.000Z",
};
function presentation(snapshot: BalancesSnapshot): HomeAssetBalancesPresentation {
  return presentBalances({ status: "ready", snapshot, error: null });
}
function regionBalances(state: ShellState, regionId: RegionId): HomeAssetBalancesPresentation {
  const quote = presentationRegions[regionId].currency.code as FiatCurrencyCode | null;
  const value = (atoms: string): HoldingValue => {
    if (quote === null) return { status: "unpriced", reason: "no-quote-currency" };
    if (quote === "USD") return priced(quote, atoms);
    const rate = activityFxRates[quote];
    if (rate === undefined) return { status: "unpriced", reason: "fx-unavailable" };
    return priced(quote, String(BigInt(atoms) * BigInt(rate.atoms)), 2 + rate.scale);
  };
  const cash = {
    usdc: { balance: ready("12340000"), value: value("1234"), cashValue: pricedCash("USD", "1234") },
  };
  if (state === "empty") return presentation(buildBalancesSnapshotFixture({ region: regionId }));
  if (state === "balances-error") return presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" });
  if (state === "partial") {
    return presentation(buildBalancesSnapshotFixture({
      region: regionId,
      registry: { ...cash, eth: { balance: unavailableBalance, value: { status: "unavailable" } } },
      borrow: { coverage: "partial", positions: [] },
    }));
  }
  const position = borrowPosition({
    collateralBaseUnits: "100000", collateralValue: value("7821"),
    debtBaseUnits: "30010000", debtValue: value("3001"),
  });
  return presentation(buildBalancesSnapshotFixture({
    region: regionId, registry: cash, borrow: { coverage: "complete", positions: [position] },
  }));
}
const loadingBalances = presentBalances({ status: "loading", snapshot: null, error: null });

const stockMarket: MarketDataState = {
  status: "ready",
  snapshots: stockAssets.slice(0, 6).map((asset, index) => ({
    assetId: asset.id, displayPrice: ["$127.45", "$741.30", "$334.80", "$204.11", "$87.24", "$186.62"][index]!,
    asOf: "Sep 23", sourceLabel: "Coinbase", changeLabel: "+1.42%",
  })),
};
const cryptoMarket: MarketDataState = {
  status: "ready",
  snapshots: cryptoAssets.map((asset) => ({
    assetId: asset.id, displayPrice: "$2.31", asOf: "Sep 23", sourceLabel: "Coinbase", changeLabel: "+0.84%",
  })),
};
const memeMarket: MarketDataState = { status: "ready", snapshots: [] };

const [GAUNTLET, SPARK] = MORPHO_V1_CANDIDATE_ADDRESSES;
function candidate(vaultAddress: MorphoVaultCandidate["vaultAddress"], name: string, netApy: number): MorphoVaultCandidate {
  return {
    version: "v1", vaultAddress, name, symbol: "USDC vault", listed: true, chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, curatorAddress: null,
    grossApy: netApy + 0.005, netApy, feeRate: 0.1,
    totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000",
    stateAsOf: "2026-09-10T12:00:00.000Z", blockNumber: "51026404",
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
  };
}
const vaultsFixture: MorphoVaultsResult = {
  version: "v1", chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [candidate(SPARK, "Spark USDC Vault", 0.041), candidate(GAUNTLET, "Gauntlet USDC Prime", 0.0385)],
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
  stale: false,
};
const fundedPositions = MORPHO_V1_CANDIDATE_ADDRESSES.map((vaultAddress) => ({
  vaultAddress, position: { assetsRaw: vaultAddress === SPARK ? "987654321" : vaultAddress === GAUNTLET ? "123456789" : "0" },
}));

type ShellState = "funded" | "loading" | "empty" | "partial" | "balances-error" | "activity-error";
type DesktopShellProps = { initialPanel: "home" | "invest" | "save"; initialRailCollapsed?: boolean; extendedActivity?: boolean; state: ShellState };

function DesktopRail({ active, collapsed, onToggle, navigate, openAccount, accountButtonRef }: {
  active: ShellPanelId;
  collapsed: boolean;
  onToggle: () => void;
  navigate: (id: NavigationId) => void;
  openAccount: (opener: HTMLButtonElement) => void;
  accountButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const reducedMotion = useReducedMotion();
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside
      id="desktop-rail"
      data-desktop-rail=""
      data-rail-state={collapsed ? "collapsed" : "expanded"}
      className={`sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-e bg-background transition-[width] duration-[180ms] ease-out motion-reduce:transition-none lg:flex ${collapsed ? "w-16" : "w-60"}`}
    >
      <div className="flex h-dvh w-60 shrink-0 flex-col">
        <div className="flex h-14 shrink-0 items-center px-[10px]">
          <HomeMark compact className="!size-11 !left-0 !-top-2 [&>span]:!left-2 [&>span]:!bottom-2" onClick={() => navigate("home")} />
        </div>
        <nav className="flex flex-col gap-2 py-4" aria-label="Main navigation">
          {navigationItems.map((item) => {
            const Icon = item.id === "home" ? House : ChartNoAxesCombined;
            const isActive = active === item.id || (item.id === "home" && isHomeNestedPanelId(active));
            return (
              <Button
                key={item.id}
                id={`${item.id}-rail-nav`}
                variant="navigation"
                size="lg"
                className={`relative min-h-11 justify-start gap-3 px-[21px] text-sm font-medium focus-visible:ring-inset ${collapsed ? "w-16" : "w-60"}`}
                onClick={() => navigate(item.id)}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                aria-controls="navigation-panel"
              >
                {isActive ? (
                  <motion.span
                    layoutId="desktop-navigation-indicator"
                    className="absolute start-2 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                    transition={reducedMotion ? { duration: 0 } : { duration: 0.12, ease: "easeOut" }}
                    aria-hidden="true"
                    data-rail-indicator=""
                    data-reduced-motion={reducedMotion ? "true" : "false"}
                  />
                ) : null}
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span aria-hidden={collapsed} className={`truncate transition-opacity ease-out motion-reduce:delay-0 motion-reduce:duration-0 ${collapsed ? "opacity-0 duration-[80ms] delay-0" : "opacity-100 duration-[100ms] delay-[80ms]"}`}>{item.label}</span>
              </Button>
            );
          })}
        </nav>
        <div className="mt-auto">
          <div className="px-[10px] pb-2">
            <Button variant="ghost" size="icon" className="size-11 focus-visible:ring-inset aria-expanded:bg-transparent aria-expanded:text-inherit aria-expanded:hover:bg-muted aria-expanded:active:bg-muted dark:aria-expanded:hover:bg-muted/50 dark:aria-expanded:active:bg-muted/50" aria-label="Sidebar" aria-expanded={!collapsed} aria-controls="desktop-rail" onClick={onToggle}>
              <ToggleIcon className="size-5" aria-hidden="true" />
            </Button>
          </div>
          <div className="border-t px-[10px] py-3">
            <Button ref={accountButtonRef} variant="ghost" size="lg" className={`h-11 justify-start gap-1 px-0 text-sm font-medium focus-visible:ring-inset ${collapsed ? "w-11" : "w-[220px]"}`} aria-label="Account jesse.base.eth" onClick={(event) => openAccount(event.currentTarget)}>
              <span className="grid size-11 shrink-0 place-items-center" aria-hidden="true">
                <span className="grid size-8 place-items-center rounded-full bg-muted text-sm font-semibold lowercase text-foreground">
                  {profileGlyph({ ownerKey: "jesse.base.eth" })}
                </span>
              </span>
              <span aria-hidden={collapsed} className={`truncate transition-opacity ease-out motion-reduce:delay-0 motion-reduce:duration-0 ${collapsed ? "opacity-0 duration-[80ms] delay-0" : "opacity-100 duration-[100ms] delay-[80ms]"}`}>jesse.base.eth</span>
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function isVisibleFocusTarget(element: HTMLElement | null): element is HTMLElement {
  return !!element && element.isConnected && !element.matches(":disabled") && element.getClientRects().length > 0;
}

function DesktopShell({ initialPanel, initialRailCollapsed = false, extendedActivity = false, state }: DesktopShellProps) {
  const [railCollapsed, setRailCollapsed] = useState(initialRailCollapsed);
  const [panel, setPanel] = useState<ShellPanelId>(initialPanel);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [showSmallBalances, setShowSmallBalances] = useState(false);
  const [appearancePreference, setAppearancePreference] = useState<AppearancePreference>("system");
  const [regionId, setRegionId] = useState<RegionId>("US");
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const savedScrollRef = useRef<{ main: number; page: number } | null>(null);
  const focusHandoffRef = useRef(false);
  const wasAccountOpenRef = useRef(false);
  const active = panel;
  const title = accountOpen ? "Account" : panel === "save" ? "Cash" : panel === "invest" ? "Invest" : "Home";
  const balances = state === "loading" ? loadingBalances : regionBalances(state, regionId);
  const activityCurrency = presentationMoneyMetadata(regionId).currency;
  const activity = state === "loading" ? loadingActivity : state === "empty" ? emptyActivity(activityCurrency) : state === "activity-error" ? failedActivity : readyActivity(activityCurrency, extendedActivity);
  const status = !accountOpen && panel === "home" ? homeBalancesStatus(balances) : null;
  const requestPanel = (id: ShellPanelId) => {
    focusHandoffRef.current = true;
    openerRef.current = null;
    setAccountOpen(false);
    setPanel(id);
    setNavigationRequest((request) => request + 1);
  };
  const navigate = (id: NavigationId) => requestPanel(id);
  const openAccount = (opener?: HTMLElement) => {
    const activeElement = document.activeElement;
    openerRef.current = opener ?? (activeElement instanceof HTMLElement ? activeElement : null);
    if (!accountOpen) savedScrollRef.current = { main: mainRef.current?.scrollTop ?? 0, page: rootRef.current?.ownerDocument.defaultView?.scrollY ?? 0 };
    focusHandoffRef.current = false;
    setAccountOpen(true);
  };
  const closeAccount = () => setAccountOpen(false);
  const back = () => requestPanel("home");
  useEffect(() => {
    if (navigationRequest === 0) return;
    if (mainRef.current) mainRef.current.scrollTop = 0;
    rootRef.current?.ownerDocument.defaultView?.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [navigationRequest]);
  useEffect(() => {
    const wasOpen = wasAccountOpenRef.current;
    wasAccountOpenRef.current = accountOpen;
    if (accountOpen) {
      if (wasOpen) return;
      if (mainRef.current) mainRef.current.scrollTop = 0;
      rootRef.current?.ownerDocument.defaultView?.scrollTo(0, 0);
      settingsRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!wasOpen) return;
    const skipRestore = focusHandoffRef.current;
    focusHandoffRef.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    const savedScroll = savedScrollRef.current;
    savedScrollRef.current = null;
    if (skipRestore) return;
    if (savedScroll) {
      if (mainRef.current) mainRef.current.scrollTop = savedScroll.main;
      rootRef.current?.ownerDocument.defaultView?.scrollTo(0, savedScroll.page);
    }
    if (isVisibleFocusTarget(opener)) {
      opener.focus({ preventScroll: true });
      return;
    }
    const accountTrigger = isVisibleFocusTarget(accountButtonRef.current)
      ? accountButtonRef.current
      : rootRef.current?.querySelector<HTMLButtonElement>("[data-shell-account-action] button") ?? null;
    if (isVisibleFocusTarget(accountTrigger)) {
      accountTrigger.focus({ preventScroll: true });
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [accountOpen]);
  const headerStatus = status ? <HomeHeaderStatus status={status} onRetry={noop} onOpenAccount={openAccount} /> : null;
  const content = accountOpen ? (
    <AccountSettings
      regionId={regionId} onRegionChange={setRegionId} resolutionSource="explicit"
      preferenceMessage="" isPreferenceReady accountAddress={WALLET} accountOwnerKey="jesse.base.eth"
      showSmallBalances={showSmallBalances} onShowSmallBalancesChange={setShowSmallBalances}
      appearancePreference={appearancePreference}
      onAppearancePreferenceChange={(value) => { setAppearancePreference(value); return true; }}
      onSignOut={noop}
    />
  ) : panel === "home" ? (
    <div className="space-y-4 lg:grid lg:grid-cols-[minmax(320px,3fr)_minmax(340px,2fr)] lg:items-start lg:gap-6 lg:space-y-0 xl:gap-8">
      <div data-desktop-money-column="" className="self-start lg:[@media(min-height:640px)]:sticky lg:[@media(min-height:640px)]:top-20">
        <HomeOverview
          accountKey={WALLET}
          assetBalances={balances}
          cashRate={state === "empty" ? "Up to 4.20% APY" : "4.20% APY"}
          borrowOfferRate={state === "empty" ? "5.10% APR" : null}
          destinations={{ onOpenCash: () => requestPanel("save"), onOpenInvestments: () => navigate("invest"), onOpenBorrow: noop }}
          actions={
            <>
              <Button size="touch" className="w-full">
                <Plus className="size-4" aria-hidden="true" /> Add money
              </Button>
              <Button variant="outline" size="touch" className="w-full">Send</Button>
            </>
          }
          activity={null}
        />
      </div>
      <div data-desktop-activity-column="">
        <ActivityPanelView
          activity={activity}
          operations={regionId === "US" && (state === "funded" || state === "partial") ? [borrowOperation] : []}
          regionId={regionId} density="feed"
          header={<HomeSectionHeading id="activity-title">Activity</HomeSectionHeading>}
          emptyAction={<div className="lg:hidden"><Button variant="outline" size="touch"><Plus className="size-4" aria-hidden="true" />Add money</Button></div>}
        />
      </div>
    </div>
  ) : panel === "invest" ? (
    <InvestHub stockMarket={stockMarket} cryptoMarket={cryptoMarket} memeMarket={memeMarket} onSeeAll={noop} onOpenAsset={noop} />
  ) : (
    <SavingsExperience
      session={session} now={() => FIXTURE_NOW} availableUsdcBaseUnits="250000000"
      balancePositions={fundedPositions} balanceStatus="ready"
      prepareMoneyAction={previewOnlyMoneyAction} executeMoneyAction={previewOnlyMoneyAction}
    />
  );

  return (
    <AppChromeProvider>
      <PresentationRegionProvider regionId={regionId}>
      <PresentationQuoteProvider value={presentationQuoteForRegion(regionId, marketFx)}>
        <div ref={rootRef} className="flex h-svh max-h-svh overflow-hidden bg-muted [--shell-scrollbar-width:0px] lg:h-auto lg:max-h-none lg:min-h-dvh lg:overflow-visible">
          <DesktopRail active={active} collapsed={railCollapsed} onToggle={() => setRailCollapsed((value) => !value)} navigate={navigate} openAccount={openAccount} accountButtonRef={accountButtonRef} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:min-h-dvh lg:px-6 xl:px-10">
            <div className="contents lg:hidden">
              <ShellHeader
                isAccountSettingsOpen={accountOpen} nestedChromeTitle={panel === "save" && !accountOpen ? "Cash" : null}
                nestedChromeBackLabel="Back" onNestedChromeBack={back} routeMode="dashboard"
                activeNavigation={active} isVerified account={signedInAccount}
                onHome={back} onDashboard={back} onSignIn={noop} onSignOut={noop}
                onOpenSettings={openAccount} onCloseSettings={closeAccount} status={headerStatus}
              />
            </div>
            <main ref={mainRef} id="navigation-panel" tabIndex={-1} className={`relative order-1 min-h-0 min-w-0 flex-1 overscroll-contain overflow-x-hidden pb-4 scroll-pb-4 outline-none lg:order-none lg:overflow-visible lg:pb-0 ${shellScrollContainerClassName}`}>
              <div data-desktop-content-box="" className={`${shellContentFrameClassName} lg:px-0 ${panel === "home" && !accountOpen ? "lg:max-w-280" : "lg:max-w-160"}`}>
                <header className="sticky top-0 z-10 hidden h-14 items-center justify-between gap-4 border-b bg-muted lg:flex">
                  <div className="flex min-w-0 items-center gap-2">
                    {panel === "save" && !accountOpen ? (
                      <Button variant="ghost" size="icon" className="size-11" aria-label="Back" onClick={back}>
                        <ArrowLeft className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                    <h1 className="min-w-0 truncate text-base font-semibold">{title}</h1>
                  </div>
                  {accountOpen ? (
                    <Button variant="outline" size="touch" onClick={closeAccount}>Done</Button>
                  ) : headerStatus ? <div className="[&_[data-home-status]]:!size-11">{headerStatus}</div> : null}
                </header>
                <div ref={settingsRef} className="py-4 outline-none sm:py-6" tabIndex={accountOpen ? -1 : undefined} role={accountOpen ? "region" : undefined} aria-label={accountOpen ? "Account settings" : undefined}>{content}</div>
              </div>
            </main>
            <div className="order-2 shrink-0 lg:hidden">
              <PrimaryNavigation activeNavigation={active} onNavigate={navigate} />
            </div>
          </div>
        </div>
      </PresentationQuoteProvider>
      </PresentationRegionProvider>
    </AppChromeProvider>
  );
}

async function expectFixedShellWhileContentScrolls(canvasElement: HTMLElement) {
  const view = canvasElement.ownerDocument.defaultView!;
  const main = within(canvasElement).getByRole("main");
  const header = canvasElement.querySelector("header")!;
  const navigation = within(canvasElement).getByRole("navigation", { name: "Main navigation" });
  await expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
  main.scrollTop = main.scrollHeight;
  await waitFor(() => expect(main.scrollTop).toBeGreaterThan(0));
  const document = canvasElement.ownerDocument.scrollingElement!;
  await expect(document.scrollHeight).toBeLessThanOrEqual(document.clientHeight + 1);
  await expect(header.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  await expect(navigation.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  await expect(navigation.getBoundingClientRect().bottom).toBeLessThanOrEqual(view.innerHeight + 1);
  main.scrollTop = 0;
}

const meta = {
  id: "journeys-desktop-shell",
  title: "Journeys/Desktop Shell",
  component: DesktopShell,
  args: { initialPanel: "home", state: "funded" },
  parameters: {
    layout: "fullscreen",
    viewport: {
      viewports: {
        desktop1440: { name: "Desktop (1440 × 900)", styles: { width: "1440px", height: "900px" } },
        breakpoint1024: { name: "Desktop edge (1024 × 768)", styles: { width: "1024px", height: "768px" } },
        below1024: { name: "Mobile edge (1023 × 768)", styles: { width: "1023px", height: "768px" } },
        mobile390: { name: "Mobile (390 × 844)", styles: { width: "390px", height: "844px" } },
        shortViewport: { name: "Short desktop (1024 × 600)", styles: { width: "1024px", height: "600px" } },
      },
      defaultViewport: "desktop1440",
    },
    msw: { handlers: [
      http.get("/api/savings/vaults", () => HttpResponse.json(vaultsFixture)),
      http.get("https://api.ensideas.com/*", () => HttpResponse.json({ name: "jesse.base.eth" })),
    ] },
  },
} satisfies Meta<typeof DesktopShell>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectColumns(canvasElement: HTMLElement, minimumRightWidth = 0) {
  const canvas = within(canvasElement);
  const money = canvas.getByRole("region", { name: "Your money" }).getBoundingClientRect();
  const activity = canvas.getByRole("region", { name: "Activity" }).getBoundingClientRect();
  const right = canvasElement.querySelector("[data-desktop-activity-column]")!.getBoundingClientRect();
  await expect(activity.left).toBeGreaterThanOrEqual(money.right);
  await expect(right.width).toBeGreaterThanOrEqual(minimumRightWidth);
  return { money, activity, right };
}

async function expectCenteredContent(canvasElement: HTMLElement, maximumWidth: number) {
  const box = canvasElement.querySelector("[data-desktop-content-box]")!.getBoundingClientRect();
  const rail = canvasElement.querySelector<HTMLElement>("[data-desktop-rail]")!.getBoundingClientRect();
  const view = canvasElement.ownerDocument.defaultView!;
  await expect(box.width).toBeLessThanOrEqual(maximumWidth);
  await expect(Math.abs(box.left + box.width / 2 - (rail.right + view.innerWidth) / 2)).toBeLessThanOrEqual(2);
  return box;
}

export const HomeDesktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvas.getByRole("navigation", { name: "Main navigation" });
    await expect(rail).toBeVisible();
    const mark = within(canvasElement.querySelector("[data-desktop-rail] [data-home-mark]")!).getByRole("button", { name: "Home" });
    await expect(mark.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    await expect(mark.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(within(rail).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(within(rail).getByRole("button", { name: "Invest" })).not.toHaveAttribute("aria-current");
    await expect(canvas.getByRole("region", { name: "Your money" })).toBeVisible();
    const activity = within(canvas.getByRole("region", { name: "Activity" }));
    await expect(canvas.getByRole("region", { name: "Activity" })).toBeVisible();
    await expect(activity.getAllByRole("button", { description: /transaction details/ })).toHaveLength(15);
    await expect(activity.getByText(/^Sep 22,/)).toBeVisible();
    await expect(activity.queryByText(/^22 Sep(?:t)?,/)).not.toBeInTheDocument();
    await expect(activity.getByRole("img", { name: "+$25.00" })).toBeVisible();
    await expectColumns(canvasElement);
    await expectCenteredContent(canvasElement, 1120);
    const balanceLabel = canvas.getByText("Total balance");
    const activityHeading = activity.getByRole("heading", { name: "Activity" });
    const activityCard = activityHeading.closest("[data-slot='card']")!;
    await expect(Math.abs(activityCard.getBoundingClientRect().top - canvas.getByLabelText("Total balance").getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    await expect(Math.abs(activityHeading.getBoundingClientRect().top - balanceLabel.getBoundingClientRect().top)).toBeLessThanOrEqual(4);
    const balanceCard = canvas.getByLabelText("Total balance");
    const balanceBar = balanceCard.querySelector("[data-balance-breakdown] [data-signed-balance-bar]")!;
    await expect(balanceBar.getBoundingClientRect().width).toBeGreaterThanOrEqual(balanceCard.getBoundingClientRect().width - 48);
    const total = canvas.getByLabelText("Total balance");
    await expect(total).toHaveTextContent("$");
    await expect(total).not.toHaveTextContent("£");
    const usdTotal = Number(total.textContent?.match(/\$([\d,]+\.\d{2})/)?.[1]?.replaceAll(",", ""));
    await expect(usdTotal).toBeGreaterThan(0);
    for (const control of within(rail).getAllByRole("button")) {
      await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await userEvent.click(within(rail).getByRole("button", { name: "Invest" }));
    await expect(within(rail).getByRole("button", { name: "Invest" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByRole("heading", { level: 1, name: "Invest" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Invest" })).toBeVisible();
    await userEvent.click(within(rail).getByRole("button", { name: "Home" }));
    await expect(within(rail).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    const view = canvasElement.ownerDocument.defaultView!;
    const main = canvas.getByRole("main");
    view.scrollTo(0, 100);
    await waitFor(() => expect(view.scrollY).toBeGreaterThan(0));
    await userEvent.click(canvas.getByRole("button", { description: "Open Cash" }));
    await expect(within(rail).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByRole("heading", { level: 1, name: "Cash" })).toBeVisible();
    await waitFor(() => expect(view.scrollY).toBe(0));
    await expect(main).toHaveFocus();
    await userEvent.click(canvas.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(view.scrollY).toBe(0));
    await expect(main).toHaveFocus();
    await userEvent.click(canvas.getByRole("button", { description: "Open Invest" }));
    await expect(within(rail).getByRole("button", { name: "Invest" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(within(rail).getByRole("button", { name: "Home" }));
    const account = canvas.getByRole("button", { name: /Account jesse\.base\.eth/ });
    await expect(account).toHaveTextContent("jesse.base.eth");
    await expect(account.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    view.scrollTo(0, 100);
    await waitFor(() => expect(view.scrollY).toBe(100));
    await userEvent.click(account);
    await waitFor(() => expect(view.scrollY).toBe(0));
    await expect(canvas.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Account settings" })).toHaveFocus();
    const settingsAccount = within(canvas.getByRole("region", { name: "Account" }));
    await expect(settingsAccount.queryByText("Setup in progress")).not.toBeInTheDocument();
    await expect(settingsAccount.getByRole("button", { name: `Show full address ${formatAddress(WALLET)}` })).toBeVisible();
    await expect(await settingsAccount.findByText("jesse.base.eth")).toBeVisible();
    const country = canvas.getByRole("combobox", { name: "Country" });
    await expect(country).toHaveValue("United States");
    await userEvent.click(within(country.parentElement!).getByRole("button"));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "United Kingdom" }));
    await expect(country).toHaveValue("United Kingdom");
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await expect(canvas.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(account).toHaveFocus();
    await waitFor(() => expect(view.scrollY).toBe(100));
    const updatedActivity = within(canvas.getByRole("region", { name: "Activity" }));
    await expect(updatedActivity.getByText(/^22 Sep(?:t)?,/)).toBeVisible();
    await expect(updatedActivity.queryByText(/^Sep 22,/)).not.toBeInTheDocument();
    await expect(updatedActivity.getAllByRole("button", { description: /transaction details/ })).toHaveLength(14);
    await expect(updatedActivity.queryByText("Borrowed")).not.toBeInTheDocument();
    await expect(updatedActivity.getByRole("img", { name: "+£19.75" })).toBeVisible();
    await expect(updatedActivity.queryByRole("img", { name: "+$25.00" })).not.toBeInTheDocument();
    const updatedTotal = canvas.getByLabelText("Total balance");
    await expect(updatedTotal).toHaveTextContent("£");
    await expect(updatedTotal).not.toHaveTextContent("$");
    const gbpTotal = Number(updatedTotal.textContent?.match(/£([\d,]+\.\d{2})/)?.[1]?.replaceAll(",", ""));
    await expect(gbpTotal).toBeGreaterThan(0);
    await expect(gbpTotal).toBeLessThan(usdTotal);
    await expect(canvas.getByRole("region", { name: "Your money" })).toHaveTextContent("£");
    await userEvent.click(account);
    await expect(canvas.getByRole("region", { name: "Account settings" })).toHaveFocus();
    await userEvent.click(within(rail).getByRole("button", { name: "Invest" }));
    await expect(canvas.getByRole("heading", { level: 1, name: "Invest" })).toBeVisible();
    await expect(main).toHaveFocus();
    await expect(main).toHaveTextContent("£");
    await expect(main).not.toHaveTextContent("$");
    await userEvent.click(account);
    const countryAgain = canvas.getByRole("combobox", { name: "Country" });
    await userEvent.click(within(countryAgain.parentElement!).getByRole("button"));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "France" }));
    await expect(canvas.getByRole("combobox", { name: "Country" })).toHaveValue("France");
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await userEvent.click(within(rail).getByRole("button", { name: "Home" }));
    const unratedActivity = within(canvas.getByRole("region", { name: "Activity" }));
    await expect(unratedActivity.getAllByRole("button", { description: /transaction details/ })).toHaveLength(14);
    await expect(unratedActivity.queryAllByRole("img", { name: /[€$£]/ })).toHaveLength(0);
    await expect(canvas.getByLabelText("Total balance")).not.toHaveTextContent(/[€$£]/);
    await expect(canvas.getByRole("region", { name: "Your money" })).not.toHaveTextContent("€");
  },
};
export const HomeDesktopScrolled: Story = {
  args: { extendedActivity: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const view = canvasElement.ownerDocument.defaultView!;
    const main = canvas.getByRole("main");
    view.scrollTo(0, 600);
    await waitFor(() => expect(view.scrollY).toBe(600));
    const addMoney = within(canvasElement.querySelector("[data-desktop-money-column]")!).getByRole("button", { name: "Add money" });
    const moneyColumn = canvasElement.querySelector("[data-desktop-money-column]")!;
    await waitFor(async () => {
      await expect(moneyColumn.getBoundingClientRect().top).toBeGreaterThanOrEqual(78);
      await expect(moneyColumn.getBoundingClientRect().top).toBeLessThanOrEqual(82);
    });
    await expect(addMoney.getBoundingClientRect().top).toBeGreaterThanOrEqual(80);
    await expect(addMoney.getBoundingClientRect().bottom).toBeLessThan(view.innerHeight);
    await expect(main.scrollHeight).toBeLessThanOrEqual(main.clientHeight + 1);
  },
};
export const RailCollapse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvasElement.querySelector<HTMLElement>("[data-desktop-rail]")!;
    const toggle = canvas.getByRole("button", { name: "Sidebar" });
    const leftBefore = (await expectCenteredContent(canvasElement, 1120)).left;
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveFocus();
    await expect(rail).toHaveAttribute("data-rail-state", "collapsed");
    await waitFor(() => expect(Math.abs(rail.getBoundingClientRect().width - 64)).toBeLessThanOrEqual(1));
    const navigation = within(rail).getByRole("navigation", { name: "Main navigation" });
    await expect(within(navigation).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(within(navigation).getByRole("button", { name: "Invest" })).not.toHaveAttribute("aria-current");
    await expect(canvas.getByRole("button", { name: /Account jesse\.base\.eth/ })).toBeVisible();
    const controls = [...within(rail).getAllByRole("button"), within(rail.querySelector("[data-home-mark]")!).getByRole("button", { name: "Home" })];
    for (const control of controls) {
      await expect(control.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      await expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(rail.getBoundingClientRect().right + 1);
    }
    await expect((await expectCenteredContent(canvasElement, 1120)).left).toBeLessThan(leftBefore);
    await userEvent.click(toggle);
    await waitFor(() => expect(Math.abs(rail.getBoundingClientRect().width - 240)).toBeLessThanOrEqual(1));
    await expect(toggle).toHaveFocus();
  },
};
export const RailCollapsedDesktop: Story = {
  args: { initialRailCollapsed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvasElement.querySelector<HTMLElement>("[data-desktop-rail]")!;
    await expect(rail).toHaveAttribute("data-rail-state", "collapsed");
    await expect(Math.abs(rail.getBoundingClientRect().width - 64)).toBeLessThanOrEqual(1);
    await expect(within(rail).getByRole("button", { name: "Invest" })).toBeVisible();
    await expect(within(rail).getByRole("button", { name: /Account jesse\.base\.eth/ })).toBeVisible();
    await expectColumns(canvasElement);
    await expect(canvas.getByRole("region", { name: "Activity" })).toBeVisible();
  },
};
export const InvestDesktop: Story = {
  args: { initialPanel: "invest" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const invest = within(canvas.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" });
    await expectCenteredContent(canvasElement, 640);
    await expect(canvas.getByRole("heading", { level: 1, name: "Invest" })).toBeVisible();
    await expect(invest).toHaveAttribute("aria-current", "page");
    const account = canvas.getByRole("button", { name: /Account jesse\.base\.eth/ });
    account.focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Account settings" })).toHaveFocus();
    await expect(invest).toHaveAttribute("aria-current", "page");
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await expect(canvas.getByRole("heading", { level: 1, name: "Invest" })).toBeVisible();
    await expect(account).toHaveFocus();
    await expect(invest).toHaveAttribute("aria-current", "page");
  },
};
export const CashL2Desktop: Story = {
  args: { initialPanel: "save" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Cash" })).toBeVisible();
    await expectCenteredContent(canvasElement, 640);
    const back = canvas.getByRole("button", { name: "Back" });
    await expect(back.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(within(canvas.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    const vault = await canvas.findByRole("radio", { name: /Spark USDC Vault/ });
    await userEvent.click(vault);
    await expect(vault).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByRole("button", { name: "Deposit" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Withdraw" })).toBeEnabled();
    await userEvent.click(back);
    await expect(canvas.getByRole("region", { name: "Your money" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { description: "Open Cash" }));
  },
};
export const Breakpoint1024: Story = {
  parameters: { viewport: { defaultViewport: "breakpoint1024" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvasElement.querySelector<HTMLElement>("[data-desktop-rail]")!;
    const navigation = canvas.getByRole("navigation", { name: "Main navigation" });
    const bottomNavigation = canvas.getAllByRole("navigation", { name: "Main navigation", hidden: true })
      .find((item) => !item.closest("[data-desktop-rail]"))!;
    await expect(rail).toBeVisible();
    await expect(navigation).toBeVisible();
    await expect(navigation.closest("[data-desktop-rail]")).toBe(rail);
    await expect(bottomNavigation).not.toBeVisible();
    await expect(canvas.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(Math.abs(rail.getBoundingClientRect().width - 240)).toBeLessThanOrEqual(1);
    await expectColumns(canvasElement, 340);
    const grid = canvasElement.querySelector<HTMLElement>("[data-desktop-money-column]")!.parentElement!;
    await expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth);
    await expect(grid.clientWidth - 17).toBeGreaterThanOrEqual(320 + 24 + 340);
    await userEvent.click(canvas.getByRole("button", { name: "Sidebar" }));
    await waitFor(() => expect(Math.abs(rail.getBoundingClientRect().width - 64)).toBeLessThanOrEqual(1));
    await waitFor(() => expectColumns(canvasElement, 355));
  },
};
export const ShortViewport: Story = {
  parameters: { viewport: { defaultViewport: "shortViewport" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const view = canvasElement.ownerDocument.defaultView!;
    const money = canvas.getByRole("region", { name: "Your money" });
    const before = money.getBoundingClientRect().top;
    view.scrollTo(0, 300);
    await waitFor(() => expect(view.scrollY).toBe(300));
    await expect(Math.abs(money.getBoundingClientRect().top - (before - 300))).toBeLessThanOrEqual(2);
  },
};
export const Below1024: Story = {
  parameters: { viewport: { defaultViewport: "below1024" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvasElement.querySelector<HTMLElement>("[data-desktop-rail]")!;
    const navigation = canvas.getByRole("navigation", { name: "Main navigation" });
    await expect(rail).not.toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Sidebar" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "Activity" }).getBoundingClientRect().top).toBeGreaterThanOrEqual(canvas.getByRole("region", { name: "Your money" }).getBoundingClientRect().bottom);
    await expect(navigation).toBeVisible();
    await expect(navigation.closest("[data-desktop-rail]")).toBeNull();
    await expectFixedShellWhileContentScrolls(canvasElement);
    await expect(navigation.getBoundingClientRect().top).toBeGreaterThanOrEqual(canvas.getByRole("main").getBoundingClientRect().bottom - 1);
  },
};
export const Mobile390: Story = {
  parameters: { viewport: { defaultViewport: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const navigation = canvas.getByRole("navigation", { name: "Main navigation" });
    await expect(navigation).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Sidebar" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "Activity" }).getBoundingClientRect().top).toBeGreaterThanOrEqual(canvas.getByRole("region", { name: "Your money" }).getBoundingClientRect().bottom);
    await expect(canvas.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expectFixedShellWhileContentScrolls(canvasElement);
    const main = canvas.getByRole("main");
    await expect(navigation.getBoundingClientRect().top).toBeGreaterThanOrEqual(main.getBoundingClientRect().bottom - 1);
    main.scrollTop = main.scrollHeight;
    await waitFor(() => expect(main.scrollTop).toBeGreaterThan(0));
    await userEvent.click(within(navigation).getByRole("button", { name: "Invest" }));
    await waitFor(() => expect(main.scrollTop).toBe(0));
    await expect(main).toHaveFocus();
  },
};
export const HomeDesktopLoading: Story = {
  args: { state: "loading" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("Updating…")).toHaveAttribute("aria-busy", "true");
    await expectColumns(canvasElement);
  },
};
export const HomeDesktopEmpty: Story = {
  args: { state: "empty" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No activity yet")).toBeVisible();
    await expect(canvas.getAllByRole("button", { name: "Add money" })).toHaveLength(1);
    await expectColumns(canvasElement);
  },
};
export const HomeDesktopPartial: Story = {
  args: { state: "partial" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("region", { name: "Your money" })).toBeVisible();
    await expectColumns(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Some balances are unavailable" })).not.toBeInTheDocument();
  },
};
export const HomeDesktopBalancesError: Story = {
  args: { state: "balances-error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectColumns(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Balances are unavailable" }));
    const detail = await waitFor(() => {
      const node = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-home-status-detail]");
      if (!node) throw new Error("status detail not open");
      return node;
    });
    await expect(detail.textContent).toContain("Balances are unavailable");
    await waitFor(() => expect(within(detail).getByRole("button", { name: "Retry" })).toBeVisible());
  },
};
export const HomeDesktopActivityError: Story = {
  args: { state: "activity-error" },
  play: async ({ canvasElement }) => {
    const activity = within(within(canvasElement).getByRole("region", { name: "Activity" }));
    await expectColumns(canvasElement);
    await expect(activity.getByRole("status")).toHaveTextContent("Activity unavailable");
    retryActivity.mockClear();
    await userEvent.click(activity.getByRole("button", { name: "Reload activity" }));
    await expect(retryActivity).toHaveBeenCalledTimes(1);
  },
};

import { useRef, useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppChromeProvider } from "@/components/app-chrome";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { isChromiumEngine, type EngineBrand } from "@/client/liquid-glass/lens-gate";
import { ShellHeader } from "@/client/home/shell-chrome";
import { HomeOverview, HomeSectionHeading } from "@/client/home/home-overview";
import { BalancesPage } from "@/client/home/balances-panel";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { AccountSettings } from "@/client/account/account-settings";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";
import { InvestHub } from "@/client/invest/invest-hub";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { CashExperience } from "@/client/cash/cash-experience";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { InvestmentsExperience } from "@/client/investments/investments-experience";
import { createInvestmentsStoryWalletClient } from "@/client/investments/investments-fixtures.stories.fixture";
import { Button } from "@/components/ui/button";
import { Toaster, toast } from "@/components/ui/toast";
import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import type { ShellPanelId, NavigationId } from "@/config/navigation";
import { buildBalancesSnapshotFixture, catalogHolding, priced, pricedCash, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultsResult } from "@/shared/savings/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { shellContentFrameClassName, shellNavigationClearanceClassName, shellScrollContainerClassName } from "@/components/shell-layout";

const noop = () => undefined;
const unsupportedAction = async (): Promise<never> => { throw new Error("Money actions are unavailable in this preview."); };
const now = () => Date.parse("2026-09-10T12:04:00.000Z");
const fetchVaults = async () => vaults;
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const signedIn = { status: "verified", isSignedIn: true, ownerKey: "jesse.base.eth", session: null } as unknown as ComponentProps<typeof ShellHeader>["account"];
const session: VerifiedAccountSession = { user: { subject: "glass-navigation-preview" }, smartAccount: { address: WALLET, chainId: 8453 }, accountProvider: "cdp-embedded" };
const vaults: MorphoVaultsResult = {
  version: "v1", chainId: 8453, asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, stale: false,
  candidates: MORPHO_V1_CANDIDATE_ADDRESSES.map((vaultAddress, index) => ({
    version: "v1" as const, vaultAddress, name: ["Gauntlet USDC Prime", "Spark USDC Vault", "Steakhouse USDC"][index]!, symbol: "USDC vault", listed: true,
    chainId: 8453 as const, asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, curatorAddress: null,
    grossApy: .045, netApy: .04, feeRate: .1, totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000",
    stateAsOf: "2026-09-10T12:00:00.000Z", blockNumber: "51026404",
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
  })),
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
};
const markets = (assets: readonly { id: string }[]) => ({ status: "ready" as const, snapshots: assets.map((asset) => ({ assetId: asset.id, displayPrice: "$127.45", asOf: "Sep 23", sourceLabel: "Coinbase", changeLabel: "+1.42%" })) });
const assets = [...stockAssets, ...cryptoAssets.filter((asset) => !["eth", "cbbtc", "usdc", "eurc"].includes(asset.id))].map((asset, index) => {
  const decimals = "decimals" in asset.representation ? asset.representation.decimals : 18;
  return catalogHolding({
    address: asset.contractAddress, name: asset.displayName, symbol: asset.displaySymbol, decimals,
  }, String(BigInt(10) ** BigInt(decimals)), priced("USD", String(6000 + index * 100)));
});
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const activityPage: ActivityPage = {
  walletAddress: WALLET, chainId: 8453, currency: "USD",
  window: { from: "2026-08-23T12:00:00.000Z", to: "2026-09-23T12:00:00.000Z" },
  transfers: Array.from({ length: 14 }, (_, index): ActivityTransfer => {
    const incoming = index % 2 === 0;
    const day = 22 - index;
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    const amountBaseUnits = incoming ? "25000000" : "12000000";
    return {
      id: `8453:${USDC}:history-${index}`, logId: `history-${index}`, chainId: 8453, assetId: "usdc", tokenAddress: USDC,
      tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null, walletAddress: WALLET,
      fromAddress: incoming ? "0x2222222222222222222222222222222222222222" : WALLET,
      toAddress: incoming ? WALLET : "0x2222222222222222222222222222222222222222",
      direction: incoming ? "incoming" : "outgoing", amountBaseUnits, blockNumber: String(day),
      blockHash: `0x${"c".repeat(64)}`, transactionHash: `0x${day.toString(16).padStart(64, "0")}`,
      logIndex: "1", blockTimestamp: `${date}T12:00:00.000Z`,
      valuation: { status: "priced", currency: "USD", method: "peg", peg: "USD", close: null, fx: null,
        amount: computeActivityValuationAmount({ amountBaseUnits, tokenDecimals: 6, unitPrice: null, fxRate: null }) },
    };
  }),
  nextCursor: null,
  source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: "2026-09-23T12:00:00.000Z", executionTimeMs: 1, fetchedAt: "2026-09-23T12:00:00.000Z" },
};
const activity: UseActivityResult = {
  status: "ready", page: activityPage, loadingMore: false, loadMoreError: false, continuing: false,
  retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: noop,
};

type Props = {
  initialPanel: "home" | "invest" | "investments" | "cash" | "balances" | "account";
  homeIndicator: boolean;
  fallback: boolean;
  longLabels: boolean;
  balances: "funded" | "loading" | "empty" | "partial" | "failed";
  rtl: boolean;
  reducedMotion: boolean;
  actionToast: boolean;
};

function PreviewShell({ initialPanel, homeIndicator, fallback, longLabels, balances, rtl, reducedMotion, actionToast }: Props) {
  const [panel, setPanel] = useState<ShellPanelId>(initialPanel === "account" ? "home" : initialPanel);
  const [cashView, setCashView] = useState<"cash" | "savings">("cash");
  const [accountOpen, setAccountOpen] = useState(initialPanel === "account");
  const [country, setCountry] = useState<"US" | "FR">("US");
  const mainRef = useRef<HTMLElement>(null);
  const snapshot = buildBalancesSnapshotFixture(balances === "empty" ? {} : {
    registry: {
      usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
      eth: balances === "partial" ? { balance: unavailableBalance, value: { status: "unavailable" as const } }
        : { balance: ready("500000000000000000"), value: priced("USD", "160000") },
      cbbtc: { balance: ready("100000"), value: priced("USD", "9850") },
      eurc: { balance: ready("75000000"), value: priced("USD", "8100"), cashValue: pricedCash("EUR", "7500") },
      "morpho-steakhouse-usdc": { balance: ready("1250000000000000000000"), underlyingBalance: ready("1250000000"), value: priced("USD", "125000") },
    }, catalog: assets,
  });
  const presentation = balances === "loading" ? presentBalances({ status: "loading", snapshot: null, error: null })
    : balances === "failed" ? presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" })
      : presentBalances({ status: "ready", snapshot, error: null });
  const navigate = (id: NavigationId) => { setPanel(id); setCashView("cash"); mainRef.current?.scrollTo(0, 0); };
  const content = (
    <>
      <ShellHeader isAccountSettingsOpen={accountOpen} nestedChromeTitle={panel === "cash" ? cashView === "cash" ? "Cash" : "Savings" : panel === "investments" ? "Investments" : panel === "balances" ? "Your money" : null} nestedChromeBackLabel="Back"
        onNestedChromeBack={() => { if (panel === "cash" && cashView === "savings") setCashView("cash"); else setPanel("home"); }} routeMode="dashboard" activeNavigation={panel} isVerified account={signedIn}
        onHome={() => setPanel("home")} onDashboard={() => setPanel("home")} onSignIn={noop} onSignOut={noop}
        onOpenSettings={() => setAccountOpen(true)} onCloseSettings={() => setAccountOpen(false)} />
      <main ref={mainRef} id="navigation-panel" data-app-main-authenticated="" tabIndex={-1} className={`min-h-0 min-w-0 flex-1 overscroll-contain overflow-x-hidden outline-none ${shellScrollContainerClassName} ${shellNavigationClearanceClassName}`}>
        <div className={`${shellContentFrameClassName} py-4 sm:py-6`}>
          {accountOpen ? <AccountSettings regionId={country} onRegionChange={(value) => setCountry(value === "FR" ? "FR" : "US")}
            resolutionSource="explicit" preferenceMessage="" isPreferenceReady accountAddress={WALLET} accountOwnerKey="jesse.base.eth"
            showSmallBalances={false} onShowSmallBalancesChange={noop} appearancePreference="system" onAppearancePreferenceChange={() => true} onSignOut={noop}
            fetchAccountResource={async () => ({ version: 1, code: "abcdefghjk" })} />
            : panel === "home" ? <div className="space-y-4 lg:grid lg:grid-cols-[3fr_2fr] lg:items-start lg:gap-6 lg:space-y-0 xl:gap-8">
              <div className="self-start"><HomeOverview accountKey={WALLET} assetBalances={presentation} cashRate="4.00% APY" borrowOfferRate={null}
                destinations={{ onOpenCash: () => setPanel("cash"), onOpenInvestments: () => setPanel(presentation.summary?.investments.ownedCount === 0 && presentation.summary.investments.status === "complete" ? "invest" : "investments"), onOpenBorrow: noop }}
                actions={<><Button size="touch">Add money</Button><Button size="touch" variant="outline">Send</Button></>} activity={null} /></div>
              <div><ActivityPanelView activity={activity} regionId="US" density="feed"
                header={<HomeSectionHeading id="activity-title">Activity</HomeSectionHeading>} /></div>
            </div> : panel === "balances" ? <BalancesPage active assetBalances={presentation} showSmallBalances
              revealSmallBalances={false} onRevealSmallBalancesChange={noop} isChecking={false}
              revealedCount={presentation.rows.length} onRevealMore={noop} />
              : panel === "invest" ? <InvestHub stockMarket={markets(stockAssets)} cryptoMarket={markets(cryptoAssets)} memeMarket={markets([])} onSeeAll={noop} onOpenAsset={noop} />
                : panel === "investments" ? <AccountWalletClientProvider client={createInvestmentsStoryWalletClient(snapshot)}><InvestmentsExperience holding={null} onOpenHolding={noop} onCloseHolding={noop}
                    balances={{ status: "ready", snapshot, retry: async () => undefined }} discover={{ memeAssets: [], memeMarket: { status: "unavailable" }, assetMarkResolution: {} }} /></AccountWalletClientProvider>
                  : <CashExperience view={cashView} onOpenSavings={() => setCashView("savings")} session={session} snapshot={snapshot} balanceStatus="ready"
                    onAddMoney={noop} fetchVaults={fetchVaults} now={now} prepareMoneyAction={unsupportedAction} executeMoneyAction={unsupportedAction} />}
        </div>
      </main>
      <PrimaryNavigation activeNavigation={panel} onNavigate={navigate} labels={longLabels ? { home: "Portfolio home overview", invest: "Investments & markets" } : undefined} />
    </>
  );
  const shell = <div dir={rtl ? "rtl" : "ltr"} className="relative flex h-svh max-h-svh min-w-0 flex-col overflow-hidden bg-muted sm:h-dvh"
    style={{
      "--shell-safe-area-bottom": homeIndicator ? "34px" : "0px",
      "--shell-navigation-offset": "max(calc(var(--shell-safe-area-bottom) - 0.75rem), 0.75rem)",
      "--shell-navigation-clearance": "calc(var(--spacing-shell-mobile-navigation) + var(--shell-navigation-offset) + 1rem)",
    } as React.CSSProperties}>{content}</div>;
  return <AppChromeProvider><PresentationRegionProvider regionId="US"><MoneyMotionProvider reducedMotion={reducedMotion || undefined}>
    <div className={fallback ? "opaque-navigation-preview" : undefined}>
      {fallback ? <style>{`.opaque-navigation-preview nav > span:first-child { background: var(--popover) !important; box-shadow: inset 0 0 0 1px var(--border) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`}</style> : null}
      {shell}
      {actionToast ? <Toaster /> : null}
    </div>
  </MoneyMotionProvider></PresentationRegionProvider></AppChromeProvider>;
}

function MotionSwitchShell(props: Props) {
  const [reducedMotion, setReducedMotion] = useState(false);
  return (
    <>
      <PreviewShell {...props} reducedMotion={reducedMotion} />
      <button type="button" aria-label="Toggle reduced motion" onClick={() => setReducedMotion(!reducedMotion)} className="fixed right-4 top-4 z-50">Motion</button>
    </>
  );
}

const meta = {
  id: "journeys-mobile-navigation", title: "Journeys/Mobile navigation", component: PreviewShell,
  args: { initialPanel: "home", homeIndicator: false, fallback: false, longLabels: false,
    balances: "funded", rtl: false, reducedMotion: false, actionToast: false },
  parameters: { layout: "fullscreen", a11y: { test: "todo" }, viewport: { viewports: {
    mobile390: { name: "Mobile (390 × 844)", styles: { width: "390px", height: "844px" } },
    tablet1023: { name: "Tablet (1023 × 768)", styles: { width: "1023px", height: "768px" } },
    mobile320: { name: "Mobile (320 × 700)", styles: { width: "320px", height: "700px" } },
  }, defaultViewport: "mobile390" } },
} satisfies Meta<typeof PreviewShell>;
export default meta;
type Story = StoryObj<typeof meta>;

async function verifyNav(canvasElement: HTMLElement, selected: "Home" | "Invest") {
  const nav = within(canvasElement).getByRole("navigation", { name: "Main navigation" });
  await expect(within(nav).getByRole("button", { name: selected })).toHaveAttribute("aria-current", "page");
  return nav;
}
async function verifyLens(canvasElement: HTMLElement) {
  const nav = await verifyNav(canvasElement, "Home");
  await new Promise<void>((resolve) => { requestIdleCallback(() => resolve(), { timeout: 2_000 }); });
  const lens = await waitFor(() => {
    const element = nav.querySelector<HTMLElement>('[data-navigation-lens="ready"]');
    if (!element) throw new Error("The navigation lens has not mounted");
    return element;
  }, { timeout: 2_000 });
  await expect(lens).toHaveAttribute("aria-hidden", "true");
  await expect(lens).toHaveAttribute("inert");
  await expect(within(nav).getAllByRole("button")).toHaveLength(2);
  await expect(nav).toHaveAttribute("data-lens", "resting");
  const brands = (navigator as Navigator & { userAgentData?: { brands?: readonly EngineBrand[] } }).userAgentData?.brands;
  if (isChromiumEngine(brands)) await expect(nav).toHaveAttribute("data-glass-rim");
  else await expect(nav).not.toHaveAttribute("data-glass-rim");
  const home = within(nav).getByRole("button", { name: "Home" });
  const pointer = { bubbles: true, isPrimary: true, pointerId: 1, pointerType: "touch", button: 0 };
  home.dispatchEvent(new PointerEvent("pointerdown", pointer));
  await expect(nav).toHaveAttribute("data-lens-pressed");
  home.dispatchEvent(new PointerEvent("pointerup", pointer));
  await waitFor(() => expect(nav).not.toHaveAttribute("data-lens-pressed"));
  const swallow = (event: Event) => event.stopPropagation();
  home.addEventListener("pointerup", swallow);
  home.dispatchEvent(new PointerEvent("pointerdown", pointer));
  await expect(nav).toHaveAttribute("data-lens-pressed");
  home.dispatchEvent(new PointerEvent("pointerup", pointer));
  home.removeEventListener("pointerup", swallow);
  await waitFor(() => expect(nav).not.toHaveAttribute("data-lens-pressed"));
  home.dispatchEvent(new PointerEvent("pointerdown", pointer));
  await expect(nav).toHaveAttribute("data-lens-pressed");
  window.dispatchEvent(new Event("blur"));
  await expect(nav).not.toHaveAttribute("data-lens-pressed");
  await userEvent.click(home);
  await expect(home).toHaveAttribute("aria-current", "page");
  await waitFor(() => expect(nav).toHaveAttribute("data-lens", "resting"));
}
async function verifyNoLens(canvasElement: HTMLElement) {
  const nav = await verifyNav(canvasElement, "Home");
  await new Promise<void>((resolve) => { requestIdleCallback(() => resolve(), { timeout: 2_000 }); });
  await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  await expect(nav.querySelector("[data-navigation-lens]")).toBeNull();
  await expect(nav).not.toHaveAttribute("data-lens");
  await expect(nav).not.toHaveAttribute("data-glass-rim");
  await expect(nav.querySelector("[data-navigation-pill]")).toBeVisible();
}
function withoutBackdropFilter() {
  const supports = CSS.supports;
  CSS.supports = ((property: string, value?: string) => property.includes("backdrop-filter") ? false
    : value === undefined ? supports(property) : supports(property, value)) as typeof CSS.supports;
  return () => { CSS.supports = supports; };
}
async function verifyClearance(canvasElement: HTMLElement) {
  const main = within(canvasElement).getByRole("main");
  const nav = within(canvasElement).getByRole("navigation", { name: "Main navigation" });
  await expect(within(main).getByRole("region", { name: "Your money" })).toBeVisible();
  await expect(within(nav).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  const last = main.querySelector<HTMLElement>("[data-balance-list] li:last-child:last-of-type")!;
  await expect(last).toBeInTheDocument();
  main.scrollTop = main.scrollHeight;
  await waitFor(() => expect(main.scrollTop).toBeGreaterThan(0));
  await expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(nav.getBoundingClientRect().top);
  if (canvasElement.querySelector('[style*="34px"]')) {
    await expect(Math.abs(window.innerHeight - nav.getBoundingClientRect().bottom - 22)).toBeLessThanOrEqual(1);
  }
}
async function verifyRapidTabs(canvasElement: HTMLElement) {
  const nav = await verifyNav(canvasElement, "Home");
  for (const name of ["Invest", "Home", "Invest", "Home"] as const) {
    await userEvent.click(within(nav).getByRole("button", { name }));
    await verifyNav(canvasElement, name);
  }
}
async function openMoneySheet(canvasElement: HTMLElement) {
  const cash = within(canvasElement).getByRole("main");
  await userEvent.click(await within(cash).findByRole("button", { name: /^US dollar/ }));
  await within(cash).findByRole("button", { name: "Deposit" });
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Deposit" }));
  const body = within(canvasElement.ownerDocument.body);
  const input = await body.findByRole("textbox", { name: "Amount" });
  const dialog = body.getByRole("dialog", { name: "Deposit" });
  input.focus();
  await expect(dialog.contains(canvasElement.ownerDocument.activeElement)).toBe(true);
  const nav = canvasElement.querySelector<HTMLElement>('nav[aria-label="Main navigation"]')!;
  await expect(within(canvasElement.ownerDocument.body).queryByRole("navigation", { name: "Main navigation" })).not.toBeInTheDocument();
  await waitFor(async () => {
    const sheet = dialog.getBoundingClientRect();
    const capsule = nav.getBoundingClientRect();
    await expect(sheet.top).toBeLessThan(capsule.top);
    await expect(sheet.bottom).toBeGreaterThanOrEqual(capsule.bottom);
  });
}
async function verifyLabels(canvasElement: HTMLElement) {
  const nav = within(canvasElement).getByRole("navigation", { name: "Main navigation" });
  await expect(within(nav).getByRole("button", { name: "Portfolio home overview" })).toHaveAttribute("aria-current", "page");
  for (const button of nav.querySelectorAll<HTMLElement>("button")) await expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
  for (const label of nav.querySelectorAll<HTMLElement>("button span span")) await expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
  await expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth);
}
async function showBusyContent(canvasElement: HTMLElement) {
  const main = within(canvasElement).getByRole("main");
  const nav = await verifyNav(canvasElement, "Home");
  const row = main.querySelectorAll<HTMLElement>("[data-activity-feed] li")[4]!;
  const avatar = row.querySelector<HTMLElement>("[data-slot='item-media']")!;
  const amount = row.querySelector<HTMLElement>("[data-slot='money-ticker']")!;
  const label = within(nav).getByRole("button", { name: "Invest" }).querySelector<HTMLElement>("span span")!;
  main.scrollTop += amount.getBoundingClientRect().top - label.getBoundingClientRect().top;
  await waitFor(async () => {
    const avatarRect = avatar.getBoundingClientRect();
    const amountRect = amount.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    await expect(main.scrollTop).toBeGreaterThan(0);
    await expect(avatarRect.top).toBeLessThan(labelRect.bottom);
    await expect(amountRect.top).toBeLessThan(labelRect.bottom);
    await expect(amountRect.bottom).toBeGreaterThan(labelRect.top);
  });
}
export const HomeLight: Story = { play: async ({ canvasElement }) => { await verifyLens(canvasElement); } };
export const HomeDark: Story = { globals: { theme: "dark" }, play: async ({ canvasElement }) => { await verifyNav(canvasElement, "Home"); } };
export const Invest: Story = { args: { initialPanel: "invest" }, play: async ({ canvasElement }) => { await verifyNav(canvasElement, "Invest"); } };
export const NestedCash: Story = { args: { initialPanel: "cash" }, play: async ({ canvasElement }) => {
  await verifyNav(canvasElement, "Home");
  await expect(within(canvasElement).getByRole("heading", { name: "Cash", level: 1 })).toBeVisible();
  const savings = within(canvasElement).getByRole("region", { name: "Savings" });
  await expect(within(savings).getByRole("button", { name: /^US dollar/ })).toHaveTextContent("$1,250.00");
} };
export const NestedInvestments: Story = { play: async ({ canvasElement }) => {
  await verifyNav(canvasElement, "Home");
  const money = within(within(canvasElement).getByRole("main")).getByRole("region", { name: "Your money" });
  await userEvent.click(within(money).getByRole("button", { name: /^Investments / }));
  await verifyNav(canvasElement, "Home");
  await expect(within(canvasElement).getByRole("heading", { name: "Investments", level: 1 })).toBeVisible();
  await expect(within(canvasElement).getByRole("region", { name: "Your investments" })).toBeVisible();
} };
export const NestedYourMoney: Story = { args: { initialPanel: "balances" }, play: async ({ canvasElement }) => {
  await verifyNav(canvasElement, "Home");
  await expect(within(canvasElement).getByRole("region", { name: "Your money" })).toBeVisible();
} };
export const LastRow: Story = { args: { initialPanel: "balances" }, play: async ({ canvasElement }) => { await verifyClearance(canvasElement); } };
export const HomeIndicator: Story = { args: { initialPanel: "balances", homeIndicator: true }, play: async ({ canvasElement }) => { await verifyClearance(canvasElement); } };
export const ActivityUnderCapsule: Story = { play: async ({ canvasElement }) => { await showBusyContent(canvasElement); } };
export const ActionToast: Story = { args: { actionToast: true }, play: async ({ canvasElement }) => {
  const nav = await verifyNav(canvasElement, "Home");
  toast.add({ type: "success", title: "Deposited $25.00" });
  const visibleToast = await within(canvasElement.ownerDocument.body).findByText("Deposited $25.00");
  const toastBox = visibleToast.closest<HTMLElement>('[data-slot="toast"]')!;
  await expect(visibleToast).toHaveTextContent("Deposited $25.00");
  await waitFor(() => expect(toastBox.getBoundingClientRect().bottom).toBeLessThanOrEqual(nav.getBoundingClientRect().top));
} };
export const RapidTaps: Story = { play: async ({ canvasElement }) => { await verifyRapidTabs(canvasElement); } };
export const InterruptedMotion: Story = { render: (args) => <MotionSwitchShell {...args} />, play: async ({ canvasElement }) => {
  const nav = await verifyNav(canvasElement, "Home");
  await waitFor(() => expect(nav.querySelector('[data-navigation-lens="ready"]')).toBeInTheDocument());
  await waitFor(() => expect(nav).toHaveAttribute("data-lens", "resting"));
  const invest = within(nav).getByRole("button", { name: "Invest" });
  const toggle = within(canvasElement).getByRole("button", { name: "Toggle reduced motion" });
  const transitioning = () => nav.getAnimations().some((animation) => animation instanceof CSSTransition && animation.transitionProperty === "--lens-p" && animation.playState === "running");
  invest.click();
  await waitFor(() => expect(transitioning()).toBe(true));
  toggle.click();
  await waitFor(() => expect(transitioning()).toBe(false));
  toggle.click();
  await expect(invest).toHaveAttribute("aria-current", "page");
  await waitFor(() => expect(nav).toHaveAttribute("data-lens", "resting"));
} };
export const DepositSheet: Story = { args: { initialPanel: "cash" }, play: async ({ canvasElement }) => { await openMoneySheet(canvasElement); } };
export const AccountKeyboard: Story = { args: { initialPanel: "account" }, play: async ({ canvasElement }) => {
  const field = within(canvasElement).getByRole("combobox", { name: "Country" });
  const nav = canvasElement.querySelector<HTMLElement>('nav[aria-label="Main navigation"]')!;
  const viewport = window.visualViewport;
  if (!viewport) throw new Error("This story requires visualViewport");
  const originalHeight = Object.getOwnPropertyDescriptor(viewport, "height");
  const restoreHeight = () => {
    if (originalHeight) Object.defineProperty(viewport, "height", originalHeight);
    else Reflect.deleteProperty(viewport, "height");
    viewport.dispatchEvent(new Event("resize"));
  };
  try {
    field.focus();
    await expect(field).toHaveFocus();
    await expect(nav).toBeVisible();
    await expect(nav).not.toHaveAttribute("inert");
    await expect(nav).not.toHaveAttribute("aria-hidden");

    Object.defineProperty(viewport, "height", { configurable: true, get: () => window.innerHeight - 300 });
    viewport.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(nav).toHaveAttribute("inert"));
    await expect(nav).toHaveAttribute("aria-hidden", "true");

    restoreHeight();
    await expect(field).toHaveFocus();
    await waitFor(() => expect(nav).not.toHaveAttribute("inert"));
    await expect(nav).not.toHaveAttribute("aria-hidden");
    await expect(nav).toBeVisible();
  } finally {
    restoreHeight();
  }
} };
export const Rtl: Story = { args: { rtl: true }, play: async ({ canvasElement }) => {
  const nav = await verifyNav(canvasElement, "Home");
  const invest = within(nav).getByRole("button", { name: "Invest" });
  await userEvent.click(invest);
  const pill = nav.querySelector<HTMLElement>("[data-navigation-pill]")!;
  await waitFor(async () => {
    const target = invest.getBoundingClientRect();
    const actual = pill.getBoundingClientRect();
    await expect(Math.abs(actual.left - target.left)).toBeLessThanOrEqual(2);
    await expect(Math.abs(actual.right - target.right)).toBeLessThanOrEqual(2);
  });
} };
async function verifyReducedMotion(canvasElement: HTMLElement) {
  const nav = await verifyNav(canvasElement, "Home");
  const invest = within(nav).getByRole("button", { name: "Invest" });
  invest.click();
  await waitFor(() => expect(invest).toHaveAttribute("aria-current", "page"));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const pill = nav.querySelector<HTMLElement>("[data-navigation-pill]")!;
  const target = invest.getBoundingClientRect();
  const actual = pill.getBoundingClientRect();
  await expect(Math.abs(actual.left - target.left)).toBeLessThanOrEqual(2);
  await expect(Math.abs(actual.right - target.right)).toBeLessThanOrEqual(2);
}
export const ReducedMotion: Story = { args: { reducedMotion: true }, play: async ({ canvasElement }) => { await verifyReducedMotion(canvasElement); } };
export const LongLabels: Story = { args: { longLabels: true }, play: async ({ canvasElement }) => { await verifyLabels(canvasElement); } };
export const OpaqueFallback: Story = { args: { fallback: true }, beforeEach: withoutBackdropFilter, play: async ({ canvasElement }) => { await verifyNoLens(canvasElement); } };
export const Loading: Story = { args: { balances: "loading" } };
export const Empty: Story = { args: { balances: "empty" } };
export const Partial: Story = { args: { balances: "partial" } };
export const Failed: Story = { args: { balances: "failed" } };
export const Narrow320: Story = { parameters: { viewport: { defaultViewport: "mobile320" } }, play: async ({ canvasElement }) => {
  const nav = await verifyNav(canvasElement, "Home");
  await expect(nav.getBoundingClientRect().width).toBeLessThanOrEqual(192);
  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(320);
} };
export const Tablet1023: Story = { parameters: { viewport: { defaultViewport: "tablet1023" } }, play: async ({ canvasElement }) => {
  const nav = await verifyNav(canvasElement, "Home");
  await expect(nav).toBeVisible();
  await expect(nav.getBoundingClientRect().width).toBeLessThanOrEqual(192);
} };

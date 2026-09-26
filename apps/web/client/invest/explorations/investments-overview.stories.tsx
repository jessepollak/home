import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { HttpResponse, http } from "msw";
import { HomeMoneySummary } from "@/client/home/home-overview";
import { ShellHeader } from "@/client/home/shell-chrome";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { addFractions, exactDecimalToFraction } from "@/shared/balances/math";
import { presentBalances } from "@/shared/balances/present";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { OwnedAssetDetailExploration, InvestmentsOverviewExploration, ownedInvestmentRows } from "./investments-overview";
import { bitcoinAsset, collateralSnapshot, createInvestmentsStoryWalletClient, emptySnapshot, fundedSnapshot, investmentMarkSvg, metadataFallbackSnapshot, narrowSnapshot, notListedSnapshot, partialSnapshot, sharedPortfolioSnapshot, singleSnapshot, stockAsset, unpricedSnapshot } from "./investments-fixtures.stories.fixture";

const noop = () => undefined;
const marketNow = () => Date.parse("2026-09-13T12:02:00.000Z");
const onExplore = fn();
const onRetry = fn();
const account = { status: "verified", isSignedIn: true, ownerKey: null, session: null } as unknown as ComponentProps<typeof ShellHeader>["account"];

export type InvestmentStorySurfaceProps = { snapshot: BalancesSnapshot | null; balanceStatus?: "ready" | "loading" | "failed"; refreshFailed?: boolean; initialAsset?: string; homeParity?: boolean };
export function InvestmentStorySurface({ snapshot, balanceStatus = "ready", refreshFailed, initialAsset, homeParity = false }: InvestmentStorySurfaceProps) {
  const [assetKey, setAssetKey] = useState<string | null>(initialAsset ?? null);
  const restore = useRef<string | null>(null);
  useEffect(() => {
    if (!restore.current || !snapshot) return;
    const name = ownedInvestmentRows(snapshot).find((row) => row.key === restore.current)?.holding.name;
    const target = [...document.querySelectorAll<HTMLLIElement>('main [aria-labelledby="investments-held-heading"] li')].find((item) => item.textContent?.includes(name || ""))?.querySelector<HTMLButtonElement>("button");
    if (target) { target.focus(); restore.current = null; }
  });
  const summary = snapshot ? presentBalances({ status: "ready", snapshot, error: null }).summary : null;
  const back = () => {
    if (assetKey) { restore.current = assetKey; setAssetKey(null); }
  };
  return <AccountWalletClientProvider client={createInvestmentsStoryWalletClient()}><PresentationRegionProvider regionId="US"><MoneyMotionProvider reducedMotion><div className="min-h-svh bg-muted/50">
    <ShellHeader isAccountSettingsOpen={false} nestedChromeTitle={assetKey && snapshot ? ownedInvestmentRows(snapshot).find((row) => row.key === assetKey)?.holding.name || "Asset" : "Investments"} nestedChromeBackLabel="Back" onNestedChromeBack={back} routeMode="dashboard" activeNavigation="invest" isVerified account={account} onHome={noop} onDashboard={noop} onSignIn={noop} onSignOut={noop} onOpenSettings={noop} onCloseSettings={noop} />
    <main className={`${shellContentFrameClassName} py-4`}>
      {homeParity ? <HomeMoneySummary summary={summary} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: noop, onOpenInvestments: noop, onOpenBorrow: noop }} /> : assetKey && snapshot ? <OwnedAssetDetailExploration snapshot={snapshot} assetKey={assetKey} marketNow={marketNow} /> : <InvestmentsOverviewExploration snapshot={snapshot} balanceStatus={balanceStatus} refreshFailed={refreshFailed} onOpenAsset={(key) => setAssetKey(key)} onExplore={onExplore} onRetryBalances={onRetry} />}
    </main>
  </div></MoneyMotionProvider></PresentationRegionProvider></AccountWalletClientProvider>;
}

const handlers = [
  http.get("https://assets.example.invalid/aero.svg", () => HttpResponse.text(investmentMarkSvg, { headers: { "content-type": "image/svg+xml" } })),
  http.get("/api/market-prices", () => HttpResponse.json({ version: 1, provider: "codex", fetchedAt: "2026-09-13T12:00:00.000Z", markets: { stock: { status: "ready", snapshots: [{ assetId: stockAsset.id, displayPrice: "$225.00", asOf: "2026-09-13T12:00:00.000Z", sourceLabel: "Market", changeLabel: "+1.2%" }] }, crypto: { status: "ready", snapshots: [{ assetId: bitcoinAsset.id, displayPrice: "$70,000.00", asOf: "2026-09-13T12:00:00.000Z", sourceLabel: "Market", changeLabel: "+2.5%" }] } } })),
  http.get("/api/market-prices/history", ({ request }) => { const url = new URL(request.url); return HttpResponse.json({ version: 1, provider: "codex", assetId: url.searchParams.get("assetId"), range: url.searchParams.get("range"), currency: "USD", fetchedAt: "2026-09-13T12:00:00.000Z", status: "ready", points: [{ time: "2026-09-11T12:00:00.000Z", value: "69000" }, { time: "2026-09-12T12:00:00.000Z", value: "70000" }] }); }),
];
const meta = {
  id: "explorations-investments-l2", title: "Explorations/Investments L2", component: InvestmentStorySurface,
  args: { snapshot: fundedSnapshot },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" }, msw: { handlers } },
  beforeEach() { getHomeQueryClient().clear(); onExplore.mockClear(); onRetry.mockClear(); },
} satisfies Meta<typeof InvestmentStorySurface>;
export default meta;
type Story = StoryObj<typeof meta>;

const screen = (canvasElement: HTMLElement) => within(canvasElement.querySelector("main")!);
const hero = (canvasElement: HTMLElement) => screen(canvasElement).getByLabelText("Investments balance");
function LoadingTransitionSurface() {
  const [loading, setLoading] = useState(true);
  return <><InvestmentStorySurface snapshot={loading ? null : fundedSnapshot} balanceStatus={loading ? "loading" : "ready"} /><Button variant="outline" size="touch" onClick={() => setLoading(false)}>Show funded</Button></>;
}
function RefreshTransitionSurface() {
  const [refreshFailed, setRefreshFailed] = useState(false);
  return <><InvestmentStorySurface snapshot={fundedSnapshot} refreshFailed={refreshFailed} /><Button variant="outline" size="touch" onClick={() => setRefreshFailed(true)}>Fail refresh</Button></>;
}
async function heights(canvasElement: HTMLElement) {
  for (const button of screen(canvasElement).queryAllByRole("button", { name: /^(Explore investments|Try again|Buy|Sell)$/ })) await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
}
async function assertSnapshot(canvasElement: HTMLElement, snapshot: BalancesSnapshot) {
  const canvas = screen(canvasElement);
  const summary = presentBalances({ status: "ready", snapshot, error: null }).summary!.investments;
  const hero = canvas.getByLabelText("Investments balance");
  if (summary.value) await expect(hero.textContent).toContain(summary.value);
  const rows = ownedInvestmentRows(snapshot);
  const region = canvas.queryByRole("region", { name: "Your investments" });
  if (rows.length) {
    if (!region) throw new Error("Missing owned investments list");
    const items = within(region).getAllByRole("listitem");
    await expect(items).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      await expect(items[index]).toHaveTextContent(row.holding.name || row.holding.symbol);
      await expect(within(items[index]!).getByRole("button").getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      if (row.amount === null) {
        await expect(within(items[index]!).getByText("Value unavailable")).toBeInTheDocument();
        await expect(items[index]).not.toHaveTextContent("$0.00");
      }
    }
    if (snapshot.totals.investments.status === "complete") {
      const sum = addFractions(rows.map((row) => exactDecimalToFraction(row.amount!)));
      const total = exactDecimalToFraction(snapshot.totals.investments.value!);
      await expect(sum.numerator * total.denominator).toBe(total.numerator * sum.denominator);
    }
  }
  await heights(canvasElement);
}
export const Funded: Story = { play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, fundedSnapshot); const canvas = screen(canvasElement); await expect(canvas.getByRole("img", { name: "<$0.01" })).toBeVisible(); await expect(canvas.getByLabelText("Investments balance").querySelector('[data-tone="default"]')).toBeVisible(); await expect(canvas.queryByText("Some values are unavailable")).toBeNull(); const bitcoin = canvas.getByRole("button", { description: "Open Bitcoin" }); await expect(bitcoin).toHaveTextContent("1.3000 cbBTC"); await expect(bitcoin.querySelector('[title="1.3 cbBTC"]')).toBeInTheDocument(); await expect(bitcoin).toHaveTextContent("Includes collateral"); } };
export const FundedDesktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } }, play: Funded.play };
export const MatchingCash: Story = { args: { snapshot: sharedPortfolioSnapshot }, play: async ({ canvasElement }) => assertSnapshot(canvasElement, sharedPortfolioSnapshot) };
export const Single: Story = { args: { snapshot: singleSnapshot }, play: async ({ canvasElement }) => assertSnapshot(canvasElement, singleSnapshot) };
export const Empty: Story = { args: { snapshot: emptySnapshot }, play: async ({ canvasElement }) => { const canvas = screen(canvasElement); const hero = canvas.getByLabelText("Investments balance"); await expect(hero).toHaveTextContent("$0.00"); await expect(canvas.queryByText("No investments yet")).toBeNull(); await expect(canvas.queryByRole("region", { name: "Your investments" })).toBeNull(); const explore = canvas.getByRole("button", { name: "Explore investments" }); await expect(explore).toBeEnabled(); await expect(explore.previousElementSibling).toBe(hero); await heights(canvasElement); } };
export const Loading: Story = { args: { snapshot: null, balanceStatus: "loading" }, play: async ({ canvasElement }) => { await expect(hero(canvasElement)).toHaveAttribute("aria-busy", "true"); await expect(screen(canvasElement).getByRole("region", { name: "Your investments" })).toHaveAttribute("aria-busy", "true"); await expect(canvasElement.querySelectorAll('[data-shimmer="row"]')).toHaveLength(3); await expect(screen(canvasElement).queryByRole("button", { name: "Explore investments" })).toBeNull(); await heights(canvasElement); } };
export const LoadingToFunded: Story = { render: () => <LoadingTransitionSurface />, play: async ({ canvasElement }) => { const loadingHeight = hero(canvasElement).getBoundingClientRect().height; await userEvent.click(within(canvasElement).getByRole("button", { name: "Show funded" })); await waitFor(() => expect(hero(canvasElement)).not.toHaveAttribute("aria-busy")); await expect(Math.abs(hero(canvasElement).getBoundingClientRect().height - loadingHeight)).toBeLessThanOrEqual(2); } };
export const PartialInventory: Story = { args: { snapshot: partialSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, partialSnapshot); await expect(screen(canvasElement).getByText("Some values are unavailable")).toBeVisible(); await expect(screen(canvasElement).getByText("Balance unavailable")).toBeVisible(); } };
export const Unpriced: Story = { args: { snapshot: unpricedSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, unpricedSnapshot); await expect(screen(canvasElement).getByText("Some values are unavailable")).toBeVisible(); } };
export const MetadataFallback: Story = { args: { snapshot: metadataFallbackSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, metadataFallbackSnapshot); const row = screen(canvasElement).getByRole("button", { description: "Open FALL" }); await expect(row).toBeVisible(); await expect(row.querySelector('[data-mark="symbol"]')?.textContent).toBe("FA"); } };
export const RefreshFailed: Story = { args: { refreshFailed: true }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, fundedSnapshot); await expect(screen(canvasElement).getByText("Couldn't refresh")).toBeVisible(); await userEvent.click(screen(canvasElement).getByRole("button", { name: "Try again" })); await expect(onRetry).toHaveBeenCalledOnce(); } };
export const FundedToRefreshFailed: Story = { render: () => <RefreshTransitionSurface />, play: async ({ canvasElement }) => { const fundedHeight = hero(canvasElement).getBoundingClientRect().height; await userEvent.click(within(canvasElement).getByRole("button", { name: "Fail refresh" })); await expect(screen(canvasElement).getByText("Couldn't refresh")).toBeVisible(); await expect(hero(canvasElement).getBoundingClientRect().height - fundedHeight).toBeLessThanOrEqual(24); await expect(screen(canvasElement).getByRole("button", { name: "Try again" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44); } };
export const BalancesFailed: Story = { args: { snapshot: null, balanceStatus: "failed" }, play: async ({ canvasElement }) => { await expect(screen(canvasElement).getByText("Couldn't load your balance. Check your connection.")).toBeVisible(); await expect(screen(canvasElement).queryByRole("region", { name: "Your investments" })).toBeNull(); await userEvent.click(screen(canvasElement).getByRole("button", { name: "Try again" })); await expect(onRetry).toHaveBeenCalledOnce(); await heights(canvasElement); } };
export const Collateral: Story = { args: { snapshot: collateralSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, collateralSnapshot); const canvas = screen(canvasElement); const bitcoin = canvas.getByRole("button", { description: "Open Bitcoin" }); await expect(bitcoin).toHaveTextContent("1.3000 cbBTC"); await expect(bitcoin).toHaveTextContent("Includes collateral"); const staked = canvas.getByRole("button", { description: "Open Staked token" }); await expect(staked).toHaveTextContent("1 STK"); await expect(staked).toHaveTextContent("Collateral"); } };
export const Narrow: Story = { args: { snapshot: narrowSnapshot }, parameters: { viewport: { defaultViewport: "smallMobile" } }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, narrowSnapshot); const ticker = hero(canvasElement).querySelector<HTMLElement>('[data-slot="money-ticker"]')!; await expect(ticker.scrollWidth).toBeLessThanOrEqual(ticker.clientWidth); await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(canvasElement.ownerDocument.documentElement.clientWidth); } };
export const HomeRowParity: Story = { args: { homeParity: true }, play: async ({ canvasElement }) => { const row = screen(canvasElement).getByRole("button", { description: "Open Invest" }); await expect(row.textContent).toContain(presentBalances({ status: "ready", snapshot: fundedSnapshot, error: null }).summary!.investments.value); await heights(canvasElement); } };
async function assertDetail(canvasElement: HTMLElement, snapshot: BalancesSnapshot, key: string, catalog = true) {
  const canvas = screen(canvasElement);
  await expect(canvas.getByText("Your balance")).toBeVisible();
  const row = ownedInvestmentRows(snapshot).find((item) => item.key === key)!;
  if (row.amount) await expect(canvas.getByRole("region", { name: /details$/ })).toHaveTextContent(/\$/);
  if (catalog) { await expect(canvas.getByText("Price")).toBeVisible(); await expect(canvas.getByText("Price history")).toBeVisible(); await waitFor(() => expect(canvas.getByRole("button", { name: "Buy" })).toBeEnabled()); await expect(canvas.getByRole("button", { name: "Sell" })).toBeEnabled(); await expect(canvas.queryByText("Checking trading availability…")).toBeNull(); }
  else { await expect(canvas.queryByText("Price unavailable")).toBeNull(); await expect(canvas.getByText("Trading isn't available for this asset.")).toBeVisible(); await expect(canvas.queryByRole("button", { name: "Buy" })).toBeNull(); await expect(canvas.queryByText("Price history")).toBeNull(); }
  await heights(canvasElement);
}
export const Detail: Story = { args: { snapshot: singleSnapshot, initialAsset: ownedInvestmentRows(singleSnapshot)[0]!.key }, play: async ({ canvasElement }) => { await assertDetail(canvasElement, singleSnapshot, ownedInvestmentRows(singleSnapshot)[0]!.key); await expect(await screen(canvasElement).findByText("+2.50%")).toBeVisible(); await expect(screen(canvasElement).getByRole("img", { name: "$70,000.00" })).toBeVisible(); await expect(screen(canvasElement).queryByText("Collateral")).toBeNull(); await expect(screen(canvasElement).queryByText("Available")).toBeNull(); } };
export const DetailCollateral: Story = { args: { initialAsset: ownedInvestmentRows(fundedSnapshot).find((row) => row.holding.id === "cbbtc")!.key }, play: async ({ canvasElement }) => { await assertDetail(canvasElement, fundedSnapshot, ownedInvestmentRows(fundedSnapshot).find((row) => row.holding.id === "cbbtc")!.key); await expect(screen(canvasElement).getByText("0.5000 cbBTC")).toBeVisible(); await expect(screen(canvasElement).getByText("1.3 cbBTC")).toBeVisible(); } };
export const DetailStock: Story = { args: { initialAsset: stockHoldingKey() }, play: async ({ canvasElement }) => { await expect(await screen(canvasElement).findByText("Stocks aren't available yet.")).toBeVisible(); await expect(await screen(canvasElement).findByText("+1.20%")).toBeVisible(); await expect(screen(canvasElement).getByText("Your balance")).toBeVisible(); await heights(canvasElement); } };
export const DetailNotListed: Story = { args: { snapshot: notListedSnapshot, initialAsset: ownedInvestmentRows(notListedSnapshot)[0]!.key }, play: async ({ canvasElement }) => assertDetail(canvasElement, notListedSnapshot, ownedInvestmentRows(notListedSnapshot)[0]!.key, false) };
function stockHoldingKey() { return ownedInvestmentRows(fundedSnapshot).find((row) => row.holding.contractAddress?.toLowerCase() === stockAsset.contractAddress.toLowerCase())!.key; }

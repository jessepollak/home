import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { HttpResponse, http } from "msw";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { HomeMoneySummary } from "@/client/home/home-overview";
import { ShellHeader } from "@/client/home/shell-chrome";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { addFractions, exactDecimalToFraction } from "@/shared/balances/math";
import { selectOwnedInvestments } from "@/shared/balances/owned-investments";
import { presentBalances } from "@/shared/balances/present";
import type { AssetKey, BalancesSnapshot } from "@/shared/balances/types";
import type { InvestAsset } from "@/config/invest-assets";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { expectedMarketPriceHistorySource } from "@/shared/invest/contracts/market-price-history";
import { InvestmentsExperience } from "./investments-experience";
import { pinClock } from "@/tests/helpers/pin-clock";
import { bitcoinAsset, collateral, collateralKnownZeroSnapshot, collateralSnapshot, createInvestmentsStoryWalletClient, discoveredMemeAsset, discoveredMemeSnapshot, duplicateNamesSnapshot, emptySnapshot, fundedSnapshot, investmentMarkSvg, largeValueSnapshot, manyHoldingsSnapshot, metadataFallbackSnapshot, narrowSnapshot, notListedSnapshot, reversedTiedTokensSnapshot, sharedPortfolioSnapshot, singleSnapshot, stockAsset, tiedTokensSnapshot, unpricedSnapshot } from "./investments-fixtures.stories.fixture";

const noop = () => undefined;
const TIME = "2026-09-13T12:00:00.000Z";
const retry = fn(async () => undefined);
const chartWait = { timeout: 5000 };

type SurfaceProps = { snapshot: BalancesSnapshot | null; balanceStatus?: "ready" | "loading" | "failed"; refreshFailed?: boolean; initialAsset?: AssetKey; catalog?: readonly InvestAsset[]; memeMarket?: MarketDataState; homeParity?: boolean };
export function InvestmentStorySurface({ snapshot, balanceStatus = "ready", refreshFailed, initialAsset, catalog = [], memeMarket = { status: "unavailable" }, homeParity = false }: SurfaceProps) {
  const [assetKey, setAssetKey] = useState<AssetKey | null>(initialAsset ?? null);
  const restore = useRef<AssetKey | null>(null);
  useEffect(() => {
    if (!restore.current || !snapshot) return;
    const target = document.querySelector<HTMLElement>(`main [aria-labelledby="investments-held-heading"] [data-holding-key="${CSS.escape(restore.current)}"]`)?.closest<HTMLButtonElement>("button");
    if (target) { target.focus(); restore.current = null; }
  });
  const summary = snapshot ? presentBalances({ status: "ready", snapshot, error: null }).summary : null;
  const back = () => { if (assetKey) { restore.current = assetKey; setAssetKey(null); } };
  const account = createInvestmentsStoryWalletClient(snapshot ?? emptySnapshot);
  return <AccountWalletClientProvider client={account}><PresentationRegionProvider regionId="US"><MoneyMotionProvider reducedMotion><div className="min-h-svh bg-muted/50">
    <ShellHeader isAccountSettingsOpen={false} nestedChromeTitle={assetKey && snapshot ? selectOwnedInvestments(snapshot).find((row) => row.key === assetKey)?.holding.name || "Asset" : "Investments"} nestedChromeBackLabel="Back" onNestedChromeBack={back} routeMode="dashboard" activeNavigation="invest" isVerified account={account} onHome={noop} onDashboard={noop} onSignIn={noop} onSignOut={noop} onOpenSettings={noop} onCloseSettings={noop} />
    <main className={`${shellContentFrameClassName} py-4`}>
      {homeParity ? <HomeMoneySummary summary={summary} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: noop, onOpenInvestments: noop, onOpenBorrow: noop }} /> : <InvestmentsExperience holding={assetKey} onOpenHolding={setAssetKey} onCloseHolding={back} balances={{ status: balanceStatus === "failed" ? "error" : balanceStatus, snapshot, ...(refreshFailed ? { refreshError: true as const } : {}), retry }} discover={{ memeAssets: catalog, memeMarket, assetMarkResolution: {} }} />}
    </main>
  </div></MoneyMotionProvider></PresentationRegionProvider></AccountWalletClientProvider>;
}

export const investmentStoryHandlers = [
  http.get("https://assets.example.invalid/aero.svg", () => HttpResponse.text(investmentMarkSvg, { headers: { "content-type": "image/svg+xml" } })),
  http.get("/api/market-prices", () => HttpResponse.json({ version: 1, provider: "codex", fetchedAt: TIME, markets: { stock: { status: "ready", snapshots: [{ assetId: stockAsset.id, displayPrice: "$225.00", asOf: TIME, sourceLabel: "Market", changeLabel: "+1.2%" }] }, crypto: { status: "ready", snapshots: [{ assetId: bitcoinAsset.id, displayPrice: "$70,000.00", asOf: TIME, sourceLabel: "Market", changeLabel: "+2.5%" }] } } })),
  http.get("/api/market-prices/history", ({ request }) => {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId") ?? "";
    const source = expectedMarketPriceHistorySource(assetId);
    const stock = source?.kind === "tokenized-equity-feed";
    const values = stock ? ["222", "225"] : assetId === discoveredMemeAsset.id ? ["0.40", "0.42"] : ["69000", "70000"];
    return HttpResponse.json({ version: 2, provider: stock ? "chainlink" : "codex", source, assetId, range: url.searchParams.get("range"),
      currency: "USD", fetchedAt: "2026-09-13T12:00:00.000Z", status: "ready",
      points: [{ time: "2026-09-11T12:00:00.000Z", value: values[0] }, { time: "2026-09-12T12:00:00.000Z", value: values[1] }],
      ...(stock ? { coverage: { sampled: 2, observed: 2, gaps: [] } } : {}),
    });
  }),
];
const meta = { id: "investments-holdings", title: "Investments/Holdings", component: InvestmentStorySurface, args: { snapshot: fundedSnapshot }, parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" }, msw: { handlers: investmentStoryHandlers } }, beforeEach() { getHomeQueryClient().clear(); retry.mockClear(); return pinClock(TIME); } } satisfies Meta<typeof InvestmentStorySurface>;
export default meta;
type Story = StoryObj<typeof meta>;
const screen = (element: HTMLElement) => within(element.querySelector("main")!);
const hero = (element: HTMLElement) => screen(element).getByLabelText("Investments balance");
async function assertSnapshot(element: HTMLElement, snapshot: BalancesSnapshot) {
  const canvas = screen(element);
  const total = presentBalances({ status: "ready", snapshot, error: null }).summary!.investments.value;
  if (total) await expect(within(hero(element)).getByRole("img", { name: total })).toBeVisible();
  else await expect(hero(element).querySelector("[data-slot=money-ticker]")).toBeNull();
  const rows = selectOwnedInvestments(snapshot);
  const region = canvas.queryByRole("region", { name: "Your investments" });
  if (!rows.length) { await expect(region).toBeNull(); return; }
  const items = await waitForReady(async () => {
    const rendered = within(region!).getAllByRole("listitem");
    await expect(rendered).toHaveLength(Math.min(20, rows.length));
    return rendered;
  });
  for (const [index, row] of rows.slice(0, 20).entries()) {
    await expect(items[index]).toHaveTextContent(row.holding.name || row.holding.symbol);
    await expect(within(items[index]!).getByRole("button").getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    if (row.amount === null) {
      await expect(items[index]).toHaveTextContent(row.holding.symbol);
      await expect(items[index]).not.toHaveTextContent("$0.00");
    }
  }
  if (snapshot.totals.investments.status === "complete") {
    const sum = addFractions(rows.flatMap((row) => row.amount ? [exactDecimalToFraction(row.amount)] : []));
    const total = exactDecimalToFraction(snapshot.totals.investments.value!);
    await expect(sum.numerator * total.denominator).toBe(total.numerator * sum.denominator);
  }
}
async function revealAll(element: HTMLElement) {
  const items = () => within(screen(element).getByRole("region", { name: "Your investments" })).getAllByRole("listitem");
  await waitForReady(() => expect(items()).toHaveLength(20));
  items()[19]!.scrollIntoView({ block: "center", behavior: "instant" });
  await waitForReady(() => expect(items()).toHaveLength(40));
  items()[39]!.scrollIntoView({ block: "center", behavior: "instant" });
  await waitForReady(() => expect(items()).toHaveLength(60));
  return items();
}
function LoadingTransitionSurface() { const [loading, setLoading] = useState(true); return <><InvestmentStorySurface snapshot={loading ? null : fundedSnapshot} balanceStatus={loading ? "loading" : "ready"} /><Button variant="outline" size="touch" onClick={() => setLoading(false)}>Show funded</Button></>; }
function RefreshTransitionSurface() { const [failed, setFailed] = useState(false); return <><InvestmentStorySurface snapshot={fundedSnapshot} refreshFailed={failed} /><Button variant="outline" size="touch" onClick={() => setFailed(true)}>Fail refresh</Button></>; }
export const Funded: Story = { play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, fundedSnapshot); await expect(screen(canvasElement).getByRole("button", { description: "Open Bitcoin" })).toHaveTextContent("Includes collateral"); await expect(screen(canvasElement).getByRole("img", { name: "<$0.01" })).toBeVisible(); } };
export const FundedDesktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } }, play: Funded.play };
export const ManyHoldings: Story = { args: { snapshot: manyHoldingsSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, manyHoldingsSnapshot); const items = await revealAll(canvasElement); await expect(items.map((item) => item.querySelector("[data-holding-key]")?.getAttribute("data-holding-key"))).toEqual(selectOwnedInvestments(manyHoldingsSnapshot).map((row) => row.key)); } };
export const ManyHoldingsFocusReturn: Story = { args: { snapshot: manyHoldingsSnapshot }, play: async ({ canvasElement }) => { const items = await revealAll(canvasElement); await userEvent.click(within(items[44]!).getByRole("button")); await expect(screen(canvasElement).getByText("Your balance")).toBeVisible(); await userEvent.click(within(canvasElement).getAllByRole("button", { name: "Back" })[0]!); await waitForReady(() => expect(screen(canvasElement).getByRole("button", { description: `Open ${selectOwnedInvestments(manyHoldingsSnapshot)[44]!.holding.name}` })).toHaveFocus()); } };
export const MatchingCash: Story = { args: { snapshot: sharedPortfolioSnapshot }, play: ({ canvasElement }) => assertSnapshot(canvasElement, sharedPortfolioSnapshot) };
export const Single: Story = { args: { snapshot: singleSnapshot }, play: ({ canvasElement }) => assertSnapshot(canvasElement, singleSnapshot) };
export const Empty: Story = { args: { snapshot: emptySnapshot }, play: async ({ canvasElement }) => { await expect(hero(canvasElement)).toHaveTextContent("$0.00"); await expect(screen(canvasElement).queryByRole("region", { name: "Your investments" })).toBeNull(); } };
export const Loading: Story = { args: { snapshot: null, balanceStatus: "loading" }, play: async ({ canvasElement }) => { await expect(hero(canvasElement)).toHaveAttribute("aria-busy", "true"); await expect(canvasElement.querySelectorAll('[data-shimmer="row"]')).toHaveLength(3); } };
export const LoadingToFunded: Story = { render: () => <LoadingTransitionSurface />, play: async ({ canvasElement }) => { const height = hero(canvasElement).getBoundingClientRect().height; await userEvent.click(within(canvasElement).getByRole("button", { name: "Show funded" })); await waitForReady(() => expect(hero(canvasElement)).not.toHaveAttribute("aria-busy")); await expect(Math.abs(hero(canvasElement).getBoundingClientRect().height - height)).toBeLessThanOrEqual(2); } };
export const Unpriced: Story = { args: { snapshot: unpricedSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, unpricedSnapshot); await expect(hero(canvasElement)).toHaveTextContent("$0.00"); } };
export const MetadataFallback: Story = { args: { snapshot: metadataFallbackSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, metadataFallbackSnapshot); await expect(screen(canvasElement).getByRole("button", { description: "Open FALL" }).querySelector('[data-mark="symbol"]')?.textContent).toBe("FA"); } };
export const DuplicateNamesFocusReturn: Story = { args: { snapshot: duplicateNamesSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, duplicateNamesSnapshot); const second = screen(canvasElement).getAllByRole("button", { description: "Open Twin token" })[1]!; await userEvent.click(second); await userEvent.click(within(canvasElement).getAllByRole("button", { name: "Back" })[0]!); await waitForReady(() => expect(screen(canvasElement).getAllByRole("button", { description: "Open Twin token" })[1]).toHaveFocus()); } };
export const RefreshFailed: Story = { args: { refreshFailed: true }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, fundedSnapshot); await expect(screen(canvasElement).queryByText("Couldn't refresh")).toBeNull(); } };
export const FundedToRefreshFailed: Story = { render: () => <RefreshTransitionSurface />, play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "Fail refresh" })); await assertSnapshot(canvasElement, fundedSnapshot); await expect(screen(canvasElement).queryByText("Couldn't refresh")).toBeNull(); } };
export const Collateral: Story = { args: { snapshot: collateralSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, collateralSnapshot); await userEvent.click(screen(canvasElement).getByRole("button", { description: "Open Staked token" })); await expect(screen(canvasElement).queryByText("Trading isn't available for this asset.")).toBeNull(); await expect(screen(canvasElement).getByRole("button", { name: "Sell" })).toBeVisible(); await expect(screen(canvasElement).queryByText("0 STK")).toBeNull(); } };
export const DetailCollateralKnownZero: Story = { args: { snapshot: collateralKnownZeroSnapshot, initialAsset: collateral.collateral.key }, play: async ({ canvasElement }) => { const canvas = screen(canvasElement); await expect(canvas.getByText("0 cbBTC")).toBeVisible(); await expect(canvas.getByText("Collateral")).toBeVisible(); await waitForReady(() => expect(canvas.getByRole("button", { name: "Sell" })).toBeDisabled()); } };
export const EqualValueTies: Story = { args: { snapshot: tiedTokensSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, tiedTokensSnapshot); await expect(selectOwnedInvestments(tiedTokensSnapshot).map((row) => row.key)).toEqual(selectOwnedInvestments(reversedTiedTokensSnapshot).map((row) => row.key)); } };
export const Narrow: Story = { args: { snapshot: narrowSnapshot }, parameters: { viewport: { defaultViewport: "smallMobile" } }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, narrowSnapshot); await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(canvasElement.ownerDocument.documentElement.clientWidth); } };
export const LargeValue: Story = { args: { snapshot: largeValueSnapshot }, parameters: { viewport: { defaultViewport: "smallMobile" } }, play: async ({ canvasElement }) => {
  await assertSnapshot(canvasElement, largeValueSnapshot);
  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(canvasElement.ownerDocument.documentElement.clientWidth);
  const heroTicker = hero(canvasElement).querySelector<HTMLElement>('[data-slot="money-ticker"]')!;
  await expect(heroTicker).toHaveAccessibleName("$1,234,567,890,123.45");
  await expect(heroTicker.getBoundingClientRect().right).toBeLessThanOrEqual(hero(canvasElement).getBoundingClientRect().right);
  const row = screen(canvasElement).getByRole("button", { description: "Open Large investment" });
  const rowTicker = row.querySelector<HTMLElement>('[data-slot="money-ticker"]')!;
  await expect(rowTicker).toHaveAccessibleName("$1,234,567,890,123.45");
  await expect(rowTicker.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right);
} };
export const HomeRowParity: Story = { args: { homeParity: true }, play: async ({ canvasElement }) => { await expect(screen(canvasElement).getByRole("button", { description: "Open Investments" })).toHaveTextContent(presentBalances({ status: "ready", snapshot: fundedSnapshot, error: null }).summary!.investments.value!); } };
async function detail(element: HTMLElement, trade = true) {
  const canvas = screen(element);
  await expect(canvas.getByText("Your balance")).toBeVisible();
  if (trade) { await expect(canvas.getByRole("region", { name: "Market price history" })).toBeVisible(); await waitForReady(() => expect(canvas.getByRole("button", { name: "Sell" })).toBeEnabled()); await expect(canvas.getByRole("button", { name: "Buy" })).toBeDisabled(); }
  else { await expect(canvas.queryByText("Trading isn't available for this asset.")).toBeNull(); await expect(canvas.queryByRole("region", { name: "Market price history" })).toBeNull(); await expect(canvas.getByText("0x8888…8888 · Base")).toBeVisible(); await waitForReady(() => expect(canvas.getByRole("button", { name: "Sell" })).toBeEnabled()); }
}
export const Detail: Story = { args: { snapshot: singleSnapshot, initialAsset: selectOwnedInvestments(singleSnapshot)[0]!.key }, play: async ({ canvasElement }) => { await detail(canvasElement); await expect(await screen(canvasElement).findByText(/^\+1\.45% · /, undefined, chartWait)).toBeVisible(); await expect(screen(canvasElement).getByRole("img", { name: "$70,000.00" })).toBeVisible(); } };
export const DetailDiscovered: Story = { args: { snapshot: discoveredMemeSnapshot, initialAsset: selectOwnedInvestments(discoveredMemeSnapshot)[0]!.key, catalog: [discoveredMemeAsset], memeMarket: { status: "ready", snapshots: [{ assetId: discoveredMemeAsset.id, displayPrice: "$0.42", asOf: TIME, sourceLabel: "Market", changeLabel: "+3.5%" }] } }, play: async ({ canvasElement }) => { const canvas = screen(canvasElement); await expect(canvas.getByText("Your balance")).toBeVisible(); await expect(canvas.getByRole("region", { name: "Market price history" })).toBeVisible(); await expect(await canvas.findByText(/^\+5\.00% · /, undefined, chartWait)).toBeVisible(); await expect(canvas.getByRole("img", { name: "$0.42" })).toBeVisible(); await waitForReady(() => expect(canvas.getByRole("button", { name: "Sell" })).toBeEnabled()); await expect(canvas.getByRole("button", { name: "Buy" })).toBeDisabled(); } };
export const DetailCollateral: Story = { args: { initialAsset: collateral.collateral.key }, play: async ({ canvasElement }) => { await expect(screen(canvasElement).getByText("Your balance")).toBeVisible(); await expect(screen(canvasElement).getByText("0.5000 cbBTC")).toBeVisible(); } };
export const DetailStock: Story = { args: { initialAsset: selectOwnedInvestments(fundedSnapshot).find((row) => row.holding.contractAddress?.toLowerCase() === stockAsset.contractAddress.toLowerCase())!.key }, play: async ({ canvasElement }) => { await expect(await screen(canvasElement).findByRole("status", { name: /trading$/ })).toHaveTextContent("Stocks can't be traded in Home yet."); await expect(screen(canvasElement).getByText("Your balance")).toBeVisible(); } };
export const DetailNotListed: Story = { args: { snapshot: notListedSnapshot, initialAsset: selectOwnedInvestments(notListedSnapshot)[0]!.key }, play: ({ canvasElement }) => detail(canvasElement, false) };

export const CantLoad: Story = { args: { snapshot: null, balanceStatus: "failed" }, play: async ({ canvasElement }) => {
  const canvas = screen(canvasElement);
  await expect(canvas.getByText("Can’t load balances")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
  await expect(retry).toHaveBeenCalledOnce();
} };

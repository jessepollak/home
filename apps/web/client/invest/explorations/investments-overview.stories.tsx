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
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import { addFractions, exactDecimalToFraction } from "@/shared/balances/math";
import { presentBalances } from "@/shared/balances/present";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { InvestAsset } from "@/config/invest-assets";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { OwnedAssetDetailExploration, InvestmentsOverviewExploration, ownedInvestmentRows } from "./investments-overview";
import * as investmentFixtures from "./investments-fixtures.stories.fixture";

const { bitcoinAsset, collateral, collateralCatalogCompleteRegistryPartialSnapshot, collateralKnownZeroSnapshot, collateralMissingEntrySnapshot, collateralPartialBorrowSnapshot, collateralPartialInventorySnapshot, collateralSnapshot, collateralUnavailableSnapshot, createInvestmentsStoryWalletClient, discoveredMemeAsset, discoveredMemeSnapshot, duplicateNamesSnapshot, emptySnapshot, fundedSnapshot, investmentMarkSvg, manyHoldingsSnapshot, metadataFallbackSnapshot, narrowSnapshot, notListedSnapshot, partialBorrowNoHoldingsSnapshot, partialSnapshot, registryOutageSnapshot, reversedTiedTokensSnapshot, sharedPortfolioSnapshot, singleSnapshot, stockAsset, tiedTokensSnapshot, unpricedSnapshot, xrpAsset } = investmentFixtures;
const noop = () => undefined;
const marketNow = () => Date.parse("2026-09-13T12:02:00.000Z");
const onRetry = fn();
const account = { status: "verified", isSignedIn: true, ownerKey: null, session: null } as unknown as ComponentProps<typeof ShellHeader>["account"];

export type InvestmentStorySurfaceProps = { snapshot: BalancesSnapshot | null; balanceStatus?: "ready" | "loading" | "failed"; refreshFailed?: boolean; initialAsset?: string; catalog?: readonly InvestAsset[]; memeMarket?: MarketDataState; homeParity?: boolean };
export function InvestmentStorySurface({ snapshot, balanceStatus = "ready", refreshFailed, initialAsset, catalog, memeMarket, homeParity = false }: InvestmentStorySurfaceProps) {
  const [assetKey, setAssetKey] = useState<string | null>(initialAsset ?? null);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const restore = useRef<string | null>(null);
  useEffect(() => {
    if (!restore.current || !snapshot) return;
    const target = document.querySelector<HTMLElement>(`main [aria-labelledby="investments-held-heading"] [data-holding-key="${CSS.escape(restore.current)}"]`)?.closest<HTMLButtonElement>("button");
    if (target) { target.focus(); restore.current = null; }
  });
  const summary = snapshot ? presentBalances({ status: "ready", snapshot, error: null }).summary : null;
  const back = () => {
    if (assetKey) { restore.current = assetKey; setRevealKey(assetKey); setAssetKey(null); }
  };
  return <AccountWalletClientProvider client={createInvestmentsStoryWalletClient(snapshot)}><PresentationRegionProvider regionId="US"><MoneyMotionProvider reducedMotion><div className="min-h-svh bg-muted/50">
    <ShellHeader isAccountSettingsOpen={false} nestedChromeTitle={assetKey && snapshot ? ownedInvestmentRows(snapshot).find((row) => row.key === assetKey)?.holding.name || "Asset" : "Investments"} nestedChromeBackLabel="Back" onNestedChromeBack={back} routeMode="dashboard" activeNavigation="invest" isVerified account={account} onHome={noop} onDashboard={noop} onSignIn={noop} onSignOut={noop} onOpenSettings={noop} onCloseSettings={noop} />
    <main className={`${shellContentFrameClassName} py-4`}>
      {homeParity ? <HomeMoneySummary summary={summary} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: noop, onOpenInvestments: noop, onOpenBorrow: noop }} /> : assetKey && snapshot ? <OwnedAssetDetailExploration snapshot={snapshot} assetKey={assetKey} catalog={catalog} memeMarket={memeMarket} marketNow={marketNow} /> : <InvestmentsOverviewExploration snapshot={snapshot} balanceStatus={balanceStatus} refreshFailed={refreshFailed} onOpenAsset={(key) => setAssetKey(key)} onRetryBalances={onRetry} revealKey={revealKey} />}
    </main>
  </div></MoneyMotionProvider></PresentationRegionProvider></AccountWalletClientProvider>;
}

const handlers = [
  http.get("https://assets.example.invalid/aero.svg", () => HttpResponse.text(investmentMarkSvg, { headers: { "content-type": "image/svg+xml" } })),
  http.get("/api/market-prices", () => HttpResponse.json({ version: 1, provider: "codex", fetchedAt: "2026-09-13T12:00:00.000Z", markets: { stock: { status: "ready", snapshots: [{ assetId: stockAsset.id, displayPrice: "$225.00", asOf: "2026-09-13T12:00:00.000Z", sourceLabel: "Market", changeLabel: "+1.2%" }] }, crypto: { status: "ready", snapshots: [{ assetId: bitcoinAsset.id, displayPrice: "$70,000.00", asOf: "2026-09-13T12:00:00.000Z", sourceLabel: "Market", changeLabel: "+2.5%" }, { assetId: xrpAsset.id, displayPrice: "$5.00", asOf: "2026-09-13T12:00:00.000Z", sourceLabel: "Market", changeLabel: "+0.8%" }] } } })),
  http.get("/api/market-prices/history", ({ request }) => { const url = new URL(request.url); const assetId = url.searchParams.get("assetId"); const values = assetId === discoveredMemeAsset.id ? ["0.40", "0.42"] : assetId === xrpAsset.id ? ["4.96", "5.00"] : ["69000", "70000"]; return HttpResponse.json({ version: 1, provider: "codex", assetId, range: url.searchParams.get("range"), currency: "USD", fetchedAt: "2026-09-13T12:00:00.000Z", status: "ready", points: [{ time: "2026-09-11T12:00:00.000Z", value: values[0] }, { time: "2026-09-12T12:00:00.000Z", value: values[1] }] }); }),
];
const meta = {
  id: "explorations-investments-l2", title: "Explorations/Investments L2", component: InvestmentStorySurface,
  args: { snapshot: fundedSnapshot },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" }, msw: { handlers } },
  beforeEach() {
    getHomeQueryClient().clear();
    onRetry.mockClear();
    const invalidFixtures: string[] = [];
    for (const [name, snapshot] of Object.entries(investmentFixtures)) {
      if (!name.endsWith("Snapshot")) continue;
      const fixture = snapshot as BalancesSnapshot;
      try {
        parseBalancesSnapshot(fixture, { subject: "synthetic-investments-owner", smartAccountAddress: fixture.owner.address, chainId: fixture.owner.chainId }, fixture.region);
      } catch (error) {
        invalidFixtures.push(`${name}: ${String(error)}`);
      }
    }
    if (invalidFixtures.length) throw new Error(`Invalid investments snapshot fixtures: ${invalidFixtures.join("; ")}`);
  },
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
  for (const button of screen(canvasElement).queryAllByRole("button", { name: /^(Try again|Buy|Sell)$/ })) await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
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
export const ManyHoldings: Story = { args: { snapshot: manyHoldingsSnapshot }, play: async ({ canvasElement }) => {
  const canvas = screen(canvasElement);
  const region = canvas.getByRole("region", { name: "Your investments" });
  const items = () => within(region).getAllByRole("listitem");
  await expect(items()).toHaveLength(20);
  await expect(within(region).getByText("Showing 20 of 60 investments")).toBeInTheDocument();
  items()[19]!.scrollIntoView();
  await waitFor(() => expect(items()).toHaveLength(40));
  items()[39]!.scrollIntoView();
  await waitFor(() => expect(items()).toHaveLength(60));
  await expect(within(region).queryByText(/Showing \d+ of 60 investments/)).toBeNull();
  const rows = ownedInvestmentRows(manyHoldingsSnapshot);
  await expect(items().map((item) => item.querySelector("[data-holding-key]")?.getAttribute("data-holding-key"))).toEqual(rows.map((row) => row.key));
  const sum = addFractions(rows.map((row) => exactDecimalToFraction(row.amount!)));
  const total = exactDecimalToFraction(manyHoldingsSnapshot.totals.investments.value!);
  await expect(sum.numerator * total.denominator).toBe(total.numerator * sum.denominator);
  await expect(canvas.getByLabelText("Investments balance")).toHaveTextContent(presentBalances({ status: "ready", snapshot: manyHoldingsSnapshot, error: null }).summary!.investments.value!);
  for (const item of items()) await expect(within(item).getByRole("button").getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  canvasElement.ownerDocument.defaultView?.scrollTo(0, 0);
} };
export const MatchingCash: Story = { args: { snapshot: sharedPortfolioSnapshot }, play: async ({ canvasElement }) => assertSnapshot(canvasElement, sharedPortfolioSnapshot) };
export const Single: Story = { args: { snapshot: singleSnapshot }, play: async ({ canvasElement }) => assertSnapshot(canvasElement, singleSnapshot) };
export const Empty: Story = { args: { snapshot: emptySnapshot }, play: async ({ canvasElement }) => { const canvas = screen(canvasElement); const hero = canvas.getByLabelText("Investments balance"); await expect(hero).toHaveTextContent("$0.00"); await expect(canvas.queryByText("No investments yet")).toBeNull(); await expect(canvas.queryByRole("region", { name: "Your investments" })).toBeNull(); await heights(canvasElement); } };
export const Loading: Story = { args: { snapshot: null, balanceStatus: "loading" }, play: async ({ canvasElement }) => { await expect(hero(canvasElement)).toHaveAttribute("aria-busy", "true"); await expect(screen(canvasElement).getByRole("region", { name: "Your investments" })).toHaveAttribute("aria-busy", "true"); await expect(canvasElement.querySelectorAll('[data-shimmer="row"]')).toHaveLength(3); await heights(canvasElement); } };
export const LoadingToFunded: Story = { render: () => <LoadingTransitionSurface />, play: async ({ canvasElement }) => { const loadingHeight = hero(canvasElement).getBoundingClientRect().height; await userEvent.click(within(canvasElement).getByRole("button", { name: "Show funded" })); await waitFor(() => expect(hero(canvasElement)).not.toHaveAttribute("aria-busy")); await expect(Math.abs(hero(canvasElement).getBoundingClientRect().height - loadingHeight)).toBeLessThanOrEqual(2); } };
export const PartialInventory: Story = { args: { snapshot: partialSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, partialSnapshot); const canvas = screen(canvasElement); await expect(canvas.getByRole("button", { description: "Open Bitcoin" })).toBeVisible(); await expect(canvas.queryByRole("button", { description: "Open Ethereum" })).toBeNull(); await expect(canvas.queryByText("Balance unavailable")).toBeNull(); await expect(canvas.getByLabelText("Investments balance").querySelector('[data-tone="muted"]')).toBeVisible(); await expect(canvas.getByText("Some balances couldn't be loaded")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Try again" })); await expect(onRetry).toHaveBeenCalledOnce(); await heights(canvasElement); } };
export const CollateralWithoutAvailableEntry: Story = { args: { snapshot: collateralMissingEntrySnapshot }, play: async ({ canvasElement }) => {
  const canvas = screen(canvasElement);
  const listRow = canvas.getByRole("button", { description: "Open Coinbase Wrapped Staked ETH" });
  await expect(within(listRow).getByText("Value unavailable")).toBeInTheDocument();
  await expect(listRow).toHaveTextContent("Balance unavailable");
  await expect(within(listRow).getByText("Collateral")).toBeVisible();
  await expect(canvas.getByText("Some balances couldn't be loaded")).toBeVisible();
  await heights(canvasElement);
  await userEvent.click(listRow);
  const detail = within(canvas.getByRole("region", { name: "Coinbase Wrapped Staked ETH details" }));
  const total = detail.getByText("Your balance").nextElementSibling!;
  await expect(within(total as HTMLElement).getByText("Value unavailable")).toBeInTheDocument();
  await expect(total.nextElementSibling).toHaveTextContent("Balance unavailable");
  const [available, locked] = detail.getAllByRole("listitem");
  await expect(available).toHaveTextContent("Balance unavailable");
  await expect(within(available!).getByText("Value unavailable")).toBeInTheDocument();
  await expect(locked).toHaveTextContent("Collateral");
  await expect(locked).toHaveTextContent("1.0000 cbETH");
  await expect(within(locked!).getByRole("img", { name: "$5.00" })).toBeVisible();
} };
export const PartialBorrowCoverage: Story = { args: { snapshot: collateralPartialBorrowSnapshot }, play: async ({ canvasElement }) => {
  const canvas = screen(canvasElement);
  const eth = canvas.getByRole("button", { description: "Open Coinbase Wrapped Staked ETH" });
  await expect(within(eth).getByRole("img", { name: "$5.00" })).toBeVisible();
  await expect(eth).toHaveTextContent("1.0000 cbETH");
  await expect(within(eth).getByText("Collateral")).toBeVisible();
  await expect(eth).not.toHaveTextContent("Balance unavailable");
  await expect(canvas.getByText("Some balances couldn't be loaded")).toBeVisible();
  await expect(canvas.queryByText("Some values are unavailable")).toBeNull();
  await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
  await expect(onRetry).toHaveBeenCalledOnce();
  await heights(canvasElement);
  await userEvent.click(eth);
  const detail = within(canvas.getByRole("region", { name: "Coinbase Wrapped Staked ETH details" }));
  const [available, locked] = detail.getAllByRole("listitem");
  await expect(available).toHaveTextContent("Available");
  await expect(available).toHaveTextContent("0 cbETH");
  await expect(within(available!).getByRole("img", { name: "$0.00" })).toBeVisible();
  await expect(locked).toHaveTextContent("Collateral");
  await expect(within(locked!).getByRole("img", { name: "$5.00" })).toBeVisible();
} };
export const CollateralCatalogCompleteRegistryPartial: Story = { args: { snapshot: collateralCatalogCompleteRegistryPartialSnapshot }, play: async ({ canvasElement }) => {
  const row = ownedInvestmentRows(collateralCatalogCompleteRegistryPartialSnapshot).find((item) => item.holding.symbol === "cbETH")!;
  await expect(collateralCatalogCompleteRegistryPartialSnapshot.coverage).toEqual({ registry: "partial", catalog: "complete" });
  await expect(row.wallet).toBeNull();
  await expect(row.availableZero).toBeNull();
  const canvas = screen(canvasElement);
  const eth = canvas.getByRole("button", { description: "Open Coinbase Wrapped Staked ETH" });
  await expect(within(eth).getByRole("img", { name: "$5.00" })).toBeVisible();
  await expect(eth).toHaveTextContent("1.0000 cbETH");
  await expect(eth).not.toHaveTextContent("Balance unavailable");
  await expect(within(eth).queryByText("Value unavailable")).toBeNull();
  await expect(canvas.getByText("Some balances couldn't be loaded")).toBeVisible();
  await userEvent.click(eth);
  const detail = within(canvas.getByRole("region", { name: "Coinbase Wrapped Staked ETH details" }));
  await expect(detail.getByText("Your balance").nextElementSibling).toHaveTextContent("$5.00");
  await expect(detail.getByText("Your balance").nextElementSibling?.nextElementSibling).toHaveTextContent("1 cbETH");
  const [available, locked] = detail.getAllByRole("listitem");
  await expect(available).toHaveTextContent("Available");
  await expect(available).toHaveTextContent("0 cbETH");
  await expect(within(available!).getByRole("img", { name: "$0.00" })).toBeVisible();
  await expect(locked).toHaveTextContent("Collateral");
  await expect(within(locked!).getByRole("img", { name: "$5.00" })).toBeVisible();
} };
export const PartialBorrowNoHoldings: Story = { args: { snapshot: partialBorrowNoHoldingsSnapshot }, play: async ({ canvasElement }) => {
  const canvas = screen(canvasElement);
  const balance = canvas.getByLabelText("Investments balance");
  await expect(balance.querySelector('[data-tone="muted"]')).toBeVisible();
  await expect(within(balance).getByText("Value unavailable")).toBeInTheDocument();
  await expect(balance).not.toHaveTextContent("$0.00");
  await expect(canvas.queryByRole("region", { name: "Your investments" })).toBeNull();
  await expect(canvas.getByText("Balances aren't available right now.")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
  await expect(onRetry).toHaveBeenCalledOnce();
  await heights(canvasElement);
} };
export const PartialInventoryRefreshFailed: Story = { args: { snapshot: partialSnapshot, refreshFailed: true }, play: async ({ canvasElement }) => { const canvas = screen(canvasElement); await expect(canvas.getByText("Some balances couldn't be loaded")).toBeVisible(); await expect(canvas.getByText("Couldn't refresh")).toBeVisible(); await expect(canvas.getAllByRole("button", { name: "Try again" })).toHaveLength(1); await userEvent.click(canvas.getByRole("button", { name: "Try again" })); await expect(onRetry).toHaveBeenCalledOnce(); await heights(canvasElement); } };
export const RegistryOutage: Story = { args: { snapshot: registryOutageSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, registryOutageSnapshot); const canvas = screen(canvasElement); await expect(canvas.queryByRole("region", { name: "Your investments" })).toBeNull(); const balance = canvas.getByLabelText("Investments balance"); await expect(balance.querySelector('[data-tone="muted"]')).toBeVisible(); await expect(balance).not.toHaveTextContent("$0.00"); await expect(within(balance).getByText("Value unavailable")).toBeInTheDocument(); await expect(canvas.getByText("Balances aren't available right now.")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Try again" })); await expect(onRetry).toHaveBeenCalledOnce(); await heights(canvasElement); } };
export const Unpriced: Story = { args: { snapshot: unpricedSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, unpricedSnapshot); await expect(screen(canvasElement).getByText("Some values are unavailable")).toBeVisible(); await expect(screen(canvasElement).queryByRole("button", { name: "Try again" })).toBeNull(); } };
export const MetadataFallback: Story = { args: { snapshot: metadataFallbackSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, metadataFallbackSnapshot); const row = screen(canvasElement).getByRole("button", { description: "Open FALL" }); await expect(row).toBeVisible(); await expect(row.querySelector('[data-mark="symbol"]')?.textContent).toBe("FA"); } };
export const ManyHoldingsFocusReturn: Story = { args: { snapshot: manyHoldingsSnapshot }, play: async ({ canvasElement }) => {
  const canvas = screen(canvasElement);
  const rows = ownedInvestmentRows(manyHoldingsSnapshot);
  const region = canvas.getByRole("region", { name: "Your investments" });
  const items = () => within(region).getAllByRole("listitem");
  await expect(items()).toHaveLength(20);
  items()[19]!.scrollIntoView();
  await waitFor(() => expect(items()).toHaveLength(40));
  items()[39]!.scrollIntoView();
  await waitFor(() => expect(items()).toHaveLength(60));
  const target = within(items()[44]!).getByRole("button");
  const key = rows[44]!.key;
  await userEvent.click(target);
  await expect(canvas.getByText("Your balance")).toBeVisible();
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Back" }));
  await expect(within(canvas.getByRole("region", { name: "Your investments" })).getAllByRole("listitem").length).toBeGreaterThanOrEqual(45);
  await waitFor(() => expect(canvasElement.ownerDocument.activeElement).toBe(canvas.getByRole("button", { description: `Open ${rows[44]!.holding.name}` })));
  await expect(canvas.getByRole("region", { name: "Your investments" }).querySelector(`[data-holding-key="${CSS.escape(key)}"]`)).toBeInTheDocument();
} };
export const DuplicateNamesFocusReturn: Story = { args: { snapshot: duplicateNamesSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, duplicateNamesSnapshot); const canvas = screen(canvasElement); const second = canvas.getAllByRole("button", { description: "Open Twin token" })[1]!; await userEvent.click(second); await expect(canvas.getByText("Your balance")).toBeVisible(); await userEvent.click(within(canvasElement).getByRole("button", { name: "Back" })); await waitFor(() => expect(canvasElement.ownerDocument.activeElement).toBe(canvas.getAllByRole("button", { description: "Open Twin token" })[1])); } };
export const RefreshFailed: Story = { args: { refreshFailed: true }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, fundedSnapshot); await expect(screen(canvasElement).getByText("Couldn't refresh")).toBeVisible(); await userEvent.click(screen(canvasElement).getByRole("button", { name: "Try again" })); await expect(onRetry).toHaveBeenCalledOnce(); } };
export const FundedToRefreshFailed: Story = { render: () => <RefreshTransitionSurface />, play: async ({ canvasElement }) => { const fundedHeight = hero(canvasElement).getBoundingClientRect().height; await userEvent.click(within(canvasElement).getByRole("button", { name: "Fail refresh" })); await expect(screen(canvasElement).getByText("Couldn't refresh")).toBeVisible(); await expect(hero(canvasElement).getBoundingClientRect().height - fundedHeight).toBeLessThanOrEqual(24); await expect(screen(canvasElement).getByRole("button", { name: "Try again" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44); } };
export const BalancesFailed: Story = { args: { snapshot: null, balanceStatus: "failed" }, play: async ({ canvasElement }) => { await expect(screen(canvasElement).getByText("Couldn't load your balance. Check your connection.")).toBeVisible(); await expect(screen(canvasElement).queryByRole("region", { name: "Your investments" })).toBeNull(); await userEvent.click(screen(canvasElement).getByRole("button", { name: "Try again" })); await expect(onRetry).toHaveBeenCalledOnce(); await heights(canvasElement); } };
export const Collateral: Story = { args: { snapshot: collateralSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, collateralSnapshot); const canvas = screen(canvasElement); const bitcoin = canvas.getByRole("button", { description: "Open Bitcoin" }); await expect(bitcoin).toHaveTextContent("1.3000 cbBTC"); await expect(bitcoin).toHaveTextContent("Includes collateral"); const xrp = canvas.getByRole("button", { description: "Open Coinbase Wrapped XRP" }); await expect(xrp).toHaveTextContent("cbXRP"); await expect(xrp).toHaveTextContent("Collateral"); await userEvent.click(xrp); const available = within(canvas.getByRole("region", { name: "Coinbase Wrapped XRP details" })).getAllByRole("listitem")[0]!; await expect(available).toHaveTextContent("0 cbXRP"); await expect(within(available).getByRole("img", { name: "$0.00" })).toBeVisible(); } };
export const DetailCollateralPartialInventory: Story = { args: { snapshot: collateralPartialInventorySnapshot, initialAsset: ownedInvestmentRows(collateralPartialInventorySnapshot).find((row) => row.holding.symbol === "cbXRP")!.key }, play: async ({ canvasElement }) => {
  const canvas = screen(canvasElement);
  const row = ownedInvestmentRows(collateralPartialInventorySnapshot).find((item) => item.holding.symbol === "cbXRP")!;
  await expect(row.wallet).toBeNull();
  await expect(row.amount).toBeNull();
  const detail = within(canvas.getByRole("region", { name: "Coinbase Wrapped XRP details" }));
  const total = detail.getByText("Your balance").nextElementSibling!;
  await expect(within(total as HTMLElement).getByText("Value unavailable")).toBeInTheDocument();
  await expect(total).not.toHaveTextContent("$5.00");
  await expect(total.nextElementSibling).toHaveTextContent("Balance unavailable");
  const [available, collateral] = detail.getAllByRole("listitem");
  await expect(available).toHaveTextContent("Available");
  await expect(within(available!).getByText("Balance unavailable")).toBeVisible();
  await expect(within(available!).getByText("Value unavailable")).toBeInTheDocument();
  await expect(available).not.toHaveTextContent("$0.00");
  await expect(within(available!).queryByRole("img", { name: "$0.00" })).toBeNull();
  await expect(available!.querySelector('[data-value-tone="muted"]')).toBeInTheDocument();
  await expect(collateral).toHaveTextContent("Collateral");
  await expect(within(collateral!).getByRole("img", { name: "$5.00" })).toBeVisible();
  await waitFor(() => expect(detail.getAllByRole("img", { name: "$5.00" })).toHaveLength(2));
  await expect(await detail.findByRole("group", { name: /1 week price history/ }, { timeout: 5000 })).toBeVisible();
  await expect(detail.getByText("+0.80%")).toBeVisible();
  const trade = within(detail.getByLabelText("Trade XRP"));
  await expect(trade.getByRole("button", { name: "Buy" })).toBeDisabled();
  await expect(trade.getByRole("button", { name: "Sell" })).toBeDisabled();
  await expect(detail.getByRole("note")).toHaveTextContent("Swaps aren't available right now.");
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Back" }));
  const listRow = canvas.getByRole("button", { description: "Open Coinbase Wrapped XRP" });
  await expect(within(listRow).getByText("Value unavailable")).toBeInTheDocument();
  await expect(listRow).toHaveTextContent("Balance unavailable");
  await expect(within(listRow).getByText("Collateral")).toBeVisible();
  await expect(listRow).not.toHaveTextContent("$5.00");
  await expect(canvas.getByText("Some balances couldn't be loaded")).toBeVisible();
  await heights(canvasElement);
  await userEvent.click(listRow);
  await expect(await canvas.findByRole("region", { name: "Coinbase Wrapped XRP details" })).toBeVisible();
} };
async function settledTrade(canvasElement: HTMLElement, note: string) {
  await waitFor(() => expect(screen(canvasElement).getByRole("note")).toHaveTextContent(note));
  return within(screen(canvasElement).getByLabelText("Trade Bitcoin"));
}
export const DetailCollateralKnownZero: Story = { args: { snapshot: collateralKnownZeroSnapshot, initialAsset: collateral.collateral.key }, play: async ({ canvasElement }) => {
  const row = ownedInvestmentRows(collateralKnownZeroSnapshot).find((item) => item.key === collateral.collateral.key)!;
  await expect(row.wallet).toBeNull();
  await expect(row.amount).not.toBeNull();
  const detail = within(screen(canvasElement).getByRole("region", { name: "Bitcoin details" }));
  const [available, locked] = detail.getAllByRole("listitem");
  await expect(available).toHaveTextContent("0 cbBTC");
  await expect(within(available!).getByRole("img", { name: "$0.00" })).toBeVisible();
  await expect(within(available!).queryByText("Balance unavailable")).toBeNull();
  await expect(available!.querySelector('[data-value-tone="muted"]')).toBeNull();
  await expect(locked).toHaveTextContent("Collateral");
  await expect(within(locked!).getByRole("img", { name: "$35,000.00" })).toBeVisible();
  await expect(detail.getAllByRole("img", { name: "$35,000.00" })).toHaveLength(2);
  const trade = await settledTrade(canvasElement, "No Bitcoin available to sell.");
  await expect(trade.getByRole("button", { name: "Sell" })).toBeDisabled();
  await expect(trade.getByRole("button", { name: "Buy" })).toBeDisabled();
} };
export const DetailCollateralUnavailable: Story = { args: { snapshot: collateralUnavailableSnapshot, initialAsset: collateral.collateral.key }, play: async ({ canvasElement }) => {
  const canvas = screen(canvasElement);
  const detail = within(canvas.getByRole("region", { name: "Bitcoin details" }));
  const total = detail.getByText("Your balance").nextElementSibling!;
  await expect(within(total as HTMLElement).getByText("Value unavailable")).toBeInTheDocument();
  await expect(total).not.toHaveTextContent("$35,000.00");
  await expect(total.nextElementSibling).toHaveTextContent("Balance unavailable");
  const [available, locked] = detail.getAllByRole("listitem");
  await expect(available).toHaveTextContent("Balance unavailable");
  await expect(within(available!).getByText("Value unavailable")).toBeInTheDocument();
  await expect(within(available!).queryByRole("img", { name: "$0.00" })).toBeNull();
  await expect(locked).toHaveTextContent("Collateral");
  await expect(within(locked!).getByRole("img", { name: "$35,000.00" })).toBeVisible();
  await expect(detail.getAllByRole("img", { name: "$35,000.00" })).toHaveLength(1);
  const trade = await settledTrade(canvasElement, "No Cash available to buy Bitcoin.");
  await expect(trade.getByRole("button", { name: "Sell" })).toBeDisabled();
  await expect(trade.getByRole("button", { name: "Buy" })).toBeDisabled();
  await expect(canvas.queryByText("Balances aren't available right now.")).toBeNull();
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Back" }));
  const listRow = canvas.getByRole("button", { description: "Open Bitcoin" });
  await expect(within(listRow).getByText("Value unavailable")).toBeInTheDocument();
  await expect(listRow).toHaveTextContent("Balance unavailable");
  await expect(within(listRow).getByText("Collateral")).toBeVisible();
  await expect(listRow).not.toHaveTextContent("$35,000.00");
  await expect(canvas.getByText("Some balances couldn't be loaded")).toBeVisible();
  await heights(canvasElement);
  await userEvent.click(listRow);
  await expect(await canvas.findByRole("region", { name: "Bitcoin details" })).toBeVisible();
} };
export const EqualValueTies: Story = { args: { snapshot: tiedTokensSnapshot }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, tiedTokensSnapshot); const sortedKeys = ownedInvestmentRows(tiedTokensSnapshot).map((row) => row.key); await expect(sortedKeys).toEqual(ownedInvestmentRows(reversedTiedTokensSnapshot).map((row) => row.key)); await expect(sortedKeys).toEqual([...sortedKeys].sort()); } };
export const Narrow: Story = { args: { snapshot: narrowSnapshot }, parameters: { viewport: { defaultViewport: "smallMobile" } }, play: async ({ canvasElement }) => { await assertSnapshot(canvasElement, narrowSnapshot); const ticker = hero(canvasElement).querySelector<HTMLElement>('[data-slot="money-ticker"]')!; await expect(ticker.scrollWidth).toBeLessThanOrEqual(ticker.clientWidth); await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(canvasElement.ownerDocument.documentElement.clientWidth); } };
export const HomeRowParity: Story = { args: { homeParity: true }, play: async ({ canvasElement }) => { const row = screen(canvasElement).getByRole("button", { description: "Open Investments" }); await expect(row.textContent).toContain(presentBalances({ status: "ready", snapshot: fundedSnapshot, error: null }).summary!.investments.value); await heights(canvasElement); } };
async function assertDetail(canvasElement: HTMLElement, snapshot: BalancesSnapshot, key: string, catalog = true) {
  const canvas = screen(canvasElement);
  await expect(canvas.getByText("Your balance")).toBeVisible();
  const row = ownedInvestmentRows(snapshot).find((item) => item.key === key)!;
  if (row.amount) await expect(canvas.getByRole("region", { name: /details$/ })).toHaveTextContent(/\$/);
  if (catalog) { await expect(canvas.getByText("Price")).toBeVisible(); await expect(canvas.getByRole("region", { name: "Market price history" })).toBeVisible(); await waitFor(() => expect(canvas.getByRole("button", { name: "Buy" })).toBeEnabled()); await expect(canvas.getByRole("button", { name: "Sell" })).toBeEnabled(); await expect(canvas.queryByText("Checking trading availability…")).toBeNull(); }
  else { await expect(canvas.queryByText("Price unavailable")).toBeNull(); await expect(canvas.getByText("Trading isn't available for this asset.")).toBeVisible(); await expect(canvas.queryByRole("button", { name: "Buy" })).toBeNull(); await expect(canvas.queryByRole("region", { name: "Market price history" })).toBeNull(); }
  await heights(canvasElement);
}
export const Detail: Story = { args: { snapshot: singleSnapshot, initialAsset: ownedInvestmentRows(singleSnapshot)[0]!.key }, play: async ({ canvasElement }) => { await assertDetail(canvasElement, singleSnapshot, ownedInvestmentRows(singleSnapshot)[0]!.key); await expect(await screen(canvasElement).findByText("+2.50%")).toBeVisible(); await expect(screen(canvasElement).getByRole("img", { name: "$70,000.00" })).toBeVisible(); await expect(screen(canvasElement).queryByText("Collateral")).toBeNull(); await expect(screen(canvasElement).queryByText("Available")).toBeNull(); } };
export const DetailDiscovered: Story = { args: { snapshot: discoveredMemeSnapshot, initialAsset: ownedInvestmentRows(discoveredMemeSnapshot)[0]!.key, catalog: [discoveredMemeAsset], memeMarket: { status: "ready", snapshots: [{ assetId: discoveredMemeAsset.id, displayPrice: "$0.42", asOf: "2026-09-13T12:00:00.000Z", sourceLabel: "Market", changeLabel: "+3.5%" }] } }, play: async ({ canvasElement }) => { const canvas = screen(canvasElement); await expect(canvas.getByText("Your balance")).toBeVisible(); await expect(canvas.getByRole("region", { name: "Market price history" })).toBeVisible(); await expect(await canvas.findByRole("group", { name: /1 week price history/ }, { timeout: 5000 })).toBeVisible(); await expect(canvas.getByRole("img", { name: "$0.42" })).toBeVisible(); await expect(canvas.getByText("+3.50%")).toBeVisible(); await expect(canvas.queryByRole("button", { name: "Buy" })).toBeNull(); await expect(canvas.queryByRole("button", { name: "Sell" })).toBeNull(); await expect(canvas.queryByText("Trading isn't available for this asset.")).toBeNull(); } };
export const DetailCollateral: Story = { args: { snapshot: sharedPortfolioSnapshot, initialAsset: ownedInvestmentRows(sharedPortfolioSnapshot).find((row) => row.holding.id === "cbbtc")!.key }, play: async ({ canvasElement }) => { await assertDetail(canvasElement, sharedPortfolioSnapshot, ownedInvestmentRows(sharedPortfolioSnapshot).find((row) => row.holding.id === "cbbtc")!.key); await expect(screen(canvasElement).getByText("0.5000 cbBTC")).toBeVisible(); await expect(screen(canvasElement).getByText("1.3 cbBTC")).toBeVisible(); } };
export const DetailStock: Story = { args: { initialAsset: stockHoldingKey() }, play: async ({ canvasElement }) => { await expect(await screen(canvasElement).findByRole("status", { name: /trading$/ })).toHaveTextContent("Stocks can't be traded in Home yet."); await expect(await screen(canvasElement).findByText("+1.20%")).toBeVisible(); await expect(screen(canvasElement).getByText("Your balance")).toBeVisible(); await heights(canvasElement); } };
export const DetailNotListed: Story = { args: { snapshot: notListedSnapshot, initialAsset: ownedInvestmentRows(notListedSnapshot)[0]!.key }, play: async ({ canvasElement }) => assertDetail(canvasElement, notListedSnapshot, ownedInvestmentRows(notListedSnapshot)[0]!.key, false) };
function stockHoldingKey() { return ownedInvestmentRows(fundedSnapshot).find((row) => row.holding.contractAddress?.toLowerCase() === stockAsset.contractAddress.toLowerCase())!.key; }

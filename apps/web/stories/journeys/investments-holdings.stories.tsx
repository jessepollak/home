import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { HttpResponse, http } from "msw";
import { HomeMoneySummary } from "@/client/home/home-overview";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { ShellHeader } from "@/client/home/shell-chrome";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { InvestmentsOverviewExploration, OwnedAssetDetailExploration, ownedInvestmentRows } from "@/client/invest/explorations/investments-overview";
import { createInvestmentsStoryWalletClient, investmentMarkSvg, sharedPortfolioSnapshot } from "@/client/invest/explorations/investments-fixtures.stories.fixture";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { presentBalances } from "@/shared/balances/present";
import { addFractions, exactDecimalToFraction } from "@/shared/balances/math";

const noop = () => undefined;
const marketNow = () => Date.parse("2026-09-13T12:02:00.000Z");
const explore = fn();
const account = { status: "verified", isSignedIn: true, ownerKey: null, session: null } as unknown as ComponentProps<typeof ShellHeader>["account"];
const snapshot = sharedPortfolioSnapshot;
const total = presentBalances({ status: "ready", snapshot, error: null }).summary!.investments.value!;
function InvestmentsJourney() {
  const [view, setView] = useState<"home" | "holdings" | "detail">("home");
  const [assetKey, setAssetKey] = useState<string | null>(null);
  const restore = useRef<"home" | "asset" | null>(null);
  useEffect(() => {
    if (!restore.current) return;
    const target = restore.current === "home"
      ? document.querySelector<HTMLButtonElement>('main [data-money-summary] li:nth-child(2) button')
      : [...document.querySelectorAll<HTMLLIElement>('main [aria-labelledby="investments-held-heading"] li')].find((item) => item.textContent?.includes(ownedInvestmentRows(snapshot).find((row) => row.key === assetKey)?.holding.name || ""))?.querySelector<HTMLButtonElement>("button");
    if (target) { target.focus(); restore.current = null; }
  });
  const back = () => {
    if (view === "detail") { restore.current = "asset"; setView("holdings"); }
    else if (view === "holdings") { restore.current = "home"; setView("home"); }
  };
  return <AccountWalletClientProvider client={createInvestmentsStoryWalletClient()}><PresentationRegionProvider regionId="US"><MoneyMotionProvider reducedMotion><div className="min-h-svh bg-muted/50">
    <ShellHeader isAccountSettingsOpen={false} nestedChromeTitle={view === "home" ? null : view === "detail" ? ownedInvestmentRows(snapshot).find((row) => row.key === assetKey)?.holding.name || "Asset" : "Investments"} nestedChromeBackLabel="Back" onNestedChromeBack={back} routeMode="dashboard" activeNavigation="invest" isVerified account={account} onHome={noop} onDashboard={noop} onSignIn={noop} onSignOut={noop} onOpenSettings={noop} onCloseSettings={noop} />
    <main className={`${shellContentFrameClassName} py-4`}>
      {view === "home" ? <HomeMoneySummary summary={presentBalances({ status: "ready", snapshot, error: null }).summary} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: noop, onOpenInvestments: () => setView("holdings"), onOpenBorrow: noop }} /> : view === "holdings" ? <InvestmentsOverviewExploration snapshot={snapshot} balanceStatus="ready" onOpenAsset={(key) => { setAssetKey(key); setView("detail"); }} onExplore={explore} onRetryBalances={noop} /> : assetKey ? <OwnedAssetDetailExploration snapshot={snapshot} assetKey={assetKey} marketNow={marketNow} /> : null}
    </main>
  </div></MoneyMotionProvider></PresentationRegionProvider></AccountWalletClientProvider>;
}
const meta = {
  id: "journeys-investments-holdings", title: "Journeys/Investments Holdings", component: InvestmentsJourney,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" }, msw: { handlers: [
    http.get("https://assets.example.invalid/aero.svg", () => HttpResponse.text(investmentMarkSvg, { headers: { "content-type": "image/svg+xml" } })),
    http.get("/api/market-prices", () => HttpResponse.json({ version: 1, provider: "codex", fetchedAt: "2026-09-13T12:00:00.000Z", markets: { crypto: { status: "ready", snapshots: [{ assetId: "cbbtc", displayPrice: "$70,000.00", asOf: "2026-09-13T12:00:00.000Z", sourceLabel: "Market", changeLabel: "+2.5%" }] }, stock: { status: "unavailable" }, meme: { status: "unavailable" } } })),
    http.get("/api/market-prices/history", ({ request }) => { const url = new URL(request.url); return HttpResponse.json({ version: 1, provider: "codex", assetId: url.searchParams.get("assetId"), range: url.searchParams.get("range"), currency: "USD", fetchedAt: "2026-09-13T12:00:00.000Z", status: "empty", points: [] }); }),
  ] } },
  beforeEach() { getHomeQueryClient().clear(); explore.mockClear(); },
} satisfies Meta<typeof InvestmentsJourney>;
export default meta;
type Story = StoryObj<typeof meta>;
async function walk({ canvasElement }: { canvasElement: HTMLElement }) {
  const screen = within(canvasElement);
  const home = screen.getByRole("button", { description: "Open Invest" });
  await expect(home).toHaveTextContent(total);
  await expect(home.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await userEvent.click(home);
  const hero = screen.getByLabelText("Investments balance");
  await expect(hero).toHaveTextContent(total);
  const sum = addFractions(ownedInvestmentRows(snapshot).map((owned) => exactDecimalToFraction(owned.amount!)));
  const investments = exactDecimalToFraction(snapshot.totals.investments.value!);
  await expect(sum.numerator * investments.denominator).toBe(investments.numerator * sum.denominator);
  const row = screen.getByRole("button", { description: "Open Bitcoin" });
  await expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await userEvent.click(row);
  await expect(screen.getByText("Your balance")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Buy" })).toBeEnabled());
  await expect(screen.getByRole("button", { name: "Sell" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(screen.getByRole("button", { description: "Open Bitcoin" })).toHaveFocus());
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(screen.getByRole("button", { description: "Open Invest" })).toHaveFocus());
  await userEvent.click(screen.getByRole("button", { description: "Open Invest" }));
  await userEvent.click(screen.getByRole("button", { name: "Explore investments" }));
  await expect(explore).toHaveBeenCalledOnce();
}
export const HomeToExplore: Story = { play: walk };
export const HomeToExploreDesktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } }, play: walk };

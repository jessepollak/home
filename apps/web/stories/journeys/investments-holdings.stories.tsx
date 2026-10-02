import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { HomeMoneySummary } from "@/client/home/home-overview";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { ShellHeader } from "@/client/home/shell-chrome";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { InvestmentsExperience } from "@/client/investments/investments-experience";
import { investmentStoryHandlers } from "@/client/investments/investments-overview.stories";
import { pinClock } from "@/tests/helpers/pin-clock";
import { createInvestmentsStoryWalletClient, sharedPortfolioSnapshot } from "@/client/investments/investments-fixtures.stories.fixture";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { presentBalances } from "@/shared/balances/present";
import { selectOwnedInvestments } from "@/shared/balances/owned-investments";
import { addFractions, exactDecimalToFraction } from "@/shared/balances/math";
import type { AssetKey } from "@/shared/balances/types";

const noop = () => undefined;
const snapshot = sharedPortfolioSnapshot;
const total = presentBalances({ status: "ready", snapshot, error: null }).summary!.investments.value!;
function InvestmentsJourney() {
  const [view, setView] = useState<"home" | "holdings">("home");
  const [assetKey, setAssetKey] = useState<AssetKey | null>(null);
  const restore = useRef<{ home: true } | { key: AssetKey } | null>(null);
  useEffect(() => {
    if (!restore.current) return;
    const target = "home" in restore.current
      ? document.querySelector<HTMLButtonElement>('main [data-money-summary] li:nth-child(2) button')
      : document.querySelector<HTMLElement>(`main [aria-labelledby="investments-held-heading"] [data-holding-key="${CSS.escape(restore.current.key)}"]`)?.closest<HTMLButtonElement>("button");
    if (target) { target.focus(); restore.current = null; }
  });
  const back = () => {
    if (assetKey) { restore.current = { key: assetKey }; setAssetKey(null); }
    else if (view === "holdings") { restore.current = { home: true }; setView("home"); }
  };
  const account = createInvestmentsStoryWalletClient(snapshot);
  return <AccountWalletClientProvider client={account}><PresentationRegionProvider regionId="US"><MoneyMotionProvider reducedMotion><div className="min-h-svh bg-muted/50">
    <ShellHeader isAccountSettingsOpen={false} nestedChromeTitle={view === "home" ? null : assetKey ? selectOwnedInvestments(snapshot).find((row) => row.key === assetKey)?.holding.name || "Asset" : "Investments"} nestedChromeBackLabel="Back" onNestedChromeBack={back} routeMode="dashboard" activeNavigation="invest" isVerified account={account} onHome={noop} onDashboard={noop} onSignIn={noop} onSignOut={noop} onOpenSettings={noop} onCloseSettings={noop} />
    <main className={`${shellContentFrameClassName} py-4`}>
      {view === "home" ? <HomeMoneySummary summary={presentBalances({ status: "ready", snapshot, error: null }).summary} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: noop, onOpenInvestments: () => setView("holdings"), onOpenBorrow: noop }} /> : <InvestmentsExperience holding={assetKey} onOpenHolding={setAssetKey} onCloseHolding={back} balances={{ status: "ready", snapshot, retry: async () => undefined }} discover={{ memeAssets: [], memeMarket: { status: "unavailable" }, assetMarkResolution: {} }} />}
    </main>
  </div></MoneyMotionProvider></PresentationRegionProvider></AccountWalletClientProvider>;
}
const meta = { id: "journeys-investments-holdings", title: "Journeys/Investments Holdings", component: InvestmentsJourney, parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" }, msw: { handlers: investmentStoryHandlers } }, beforeEach() { getHomeQueryClient().clear(); return pinClock("2026-09-13T12:00:00.000Z"); } } satisfies Meta<typeof InvestmentsJourney>;
export default meta;
type Story = StoryObj<typeof meta>;
async function walk({ canvasElement }: { canvasElement: HTMLElement }) {
  const screen = within(canvasElement);
  const home = screen.getByRole("button", { description: "Open Investments" });
  await expect(home).toHaveTextContent(total);
  await expect(home.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await userEvent.click(home);
  await expect(screen.getByLabelText("Investments balance")).toHaveTextContent(total);
  const sum = addFractions(selectOwnedInvestments(snapshot).map((owned) => exactDecimalToFraction(owned.amount!)));
  const investments = exactDecimalToFraction(snapshot.totals.investments.value!);
  await expect(sum.numerator * investments.denominator).toBe(investments.numerator * sum.denominator);
  const row = await screen.findByRole("button", { description: "Open Bitcoin" }, { timeout: 5000 });
  await expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await userEvent.click(row);
  await expect(screen.getByText("Your balance")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Buy" })).toBeEnabled());
  await expect(screen.getByRole("button", { name: "Sell" })).toBeEnabled();
  await userEvent.click(within(canvasElement.querySelector("main")!).getByRole("button", { name: "Back" }));
  await waitFor(() => expect(screen.getByRole("button", { description: "Open Bitcoin" })).toHaveFocus());
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(screen.getByRole("button", { description: "Open Investments" })).toHaveFocus());
}
export const HomeToHoldings: Story = { play: walk };
export const HomeToHoldingsDesktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } }, play: walk };

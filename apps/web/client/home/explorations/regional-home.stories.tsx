import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { CSSProperties } from "react";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { expect, fn, userEvent, within } from "storybook/test";
import type { UseActivityResult } from "@/client/activity/use-activity";
import type { HomeAssetBalancesPresentation } from "@/client/home/home-types";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import { computeActivityValuationAmount, type ActivityValuationFx } from "@/shared/activity/valuation";
import { borrowPosition, buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import { presentationRegions, type FiatCurrencyCode } from "@/config/regions";
import { RegionalHomeProposal } from "./regional-home";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const other = "0x2222222222222222222222222222222222222222" as const;
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const noop = () => undefined;

type ActivityRegion = "US" | "BR" | "NG" | "ID";
const usdRates: Record<Exclude<ActivityRegion, "US">, string> = { BR: "5.45", NG: "1535", ID: "16270" };
function fxFor(regionId: ActivityRegion, day: number): ActivityValuationFx | null {
  if (regionId === "US") return null;
  const [whole, fraction = ""] = usdRates[regionId].split(".");
  return { provider: "Coinbase", base: "USD", quote: presentationRegions[regionId].currency.code as FiatCurrencyCode,
    date: `2026-09-${String(day).padStart(2, "0")}`, rate: { atoms: `${whole}${fraction}`, scale: fraction.length }, provisional: false };
}
function transfer(regionId: ActivityRegion, id: string, day: number, direction: ActivityTransfer["direction"], amountBaseUnits: string): ActivityTransfer {
  const fx = fxFor(regionId, day);
  return {
    id: `8453:${token}:${id}`, logId: id, chainId: 8453, assetId: "usdc", tokenAddress: token,
    tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null, walletAddress: wallet,
    fromAddress: direction === "incoming" ? other : wallet, toAddress: direction === "incoming" ? wallet : other,
    direction, amountBaseUnits, blockNumber: String(day), blockHash: `0x${"c".repeat(64)}`,
    transactionHash: `0x${day.toString(16).padStart(64, "0")}`, logIndex: "1",
    blockTimestamp: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    valuation: { status: "priced", currency: fx?.quote ?? "USD", method: "peg", peg: "USD", close: null, fx,
      amount: computeActivityValuationAmount({ amountBaseUnits, tokenDecimals: 6, unitPrice: null, fxRate: fx?.rate ?? null }) },
  };
}
function page(transfers: ActivityTransfer[], currency: FiatCurrencyCode = "USD"): ActivityPage {
  return {
    walletAddress: wallet, chainId: 8453, currency,
    window: { from: "2026-08-23T12:00:00.000Z", to: "2026-09-23T12:00:00.000Z" },
    transfers, nextCursor: null,
    source: { provider: "cdp-sql", cached: false, stale: false,
      executionTimestamp: "2026-09-23T12:00:00.000Z", executionTimeMs: 1, fetchedAt: "2026-09-23T12:00:00.000Z" },
  };
}
const handlers = { retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: noop };
function activityFor(regionId: ActivityRegion): UseActivityResult {
  return { status: "ready", page: page([
    transfer(regionId, "received", 22, "incoming", "25000000"), transfer(regionId, "sent", 21, "outgoing", "12000000"),
    transfer(regionId, "received-older", 14, "incoming", "60000000"),
  ], presentationRegions[regionId].currency.code as FiatCurrencyCode), loadingMore: false, loadMoreError: false, continuing: false, ...handlers };
}
const activity = activityFor("US");
const checkActivityCurrency = async (canvasElement: HTMLElement, amount: string) => {
  await expect(within(canvasElement).getByRole("region", { name: "Activity" }).textContent?.replace(/\u00a0/g, " ")).toContain(amount);
};
const emptyActivity: UseActivityResult = { status: "ready", page: page([]), loadingMore: false, loadMoreError: false, continuing: false, ...handlers };
const loadingActivity: UseActivityResult = { status: "loading", page: null, loadingMore: false, loadMoreError: false, continuing: false, ...handlers };
const retry = fn();
const failedActivity: UseActivityResult = { status: "error", page: null, loadingMore: false, loadMoreError: false,
  continuing: false, error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." }, ...handlers, retry };
function balances(regionId: "US" | "BR" | "NG" | "ID", kind: "funded" | "empty" | "partial" = "funded"): HomeAssetBalancesPresentation {
  const currency = presentationRegions[regionId].currency.code as FiatCurrencyCode;
  const amounts = {
    US: { cash: "1234", investments: "7821", borrow: "3001" },
    BR: { cash: "6725", investments: "42624", borrow: "16355" },
    NG: { cash: "1894190", investments: "12005235", borrow: "4606535" },
    ID: { cash: "20077200", investments: "127247700", borrow: "48826300" },
  }[regionId];
  const cash = { balance: ready("12340000"), value: priced(currency, amounts.cash), cashValue: pricedCash("USD", "1234") };
  const snapshot = buildBalancesSnapshotFixture({
    region: regionId,
    registry: kind === "empty" ? undefined : kind === "partial"
      ? { usdc: cash, eth: { balance: unavailableBalance, value: { status: "unavailable" } } }
      : { usdc: cash },
    borrow: kind === "empty" ? undefined : { coverage: kind === "partial" ? "partial" : "complete", positions: kind === "partial" ? [] : [borrowPosition({
      collateralBaseUnits: "100000", collateralValue: priced(currency, amounts.investments),
      debtBaseUnits: "30010000", debtValue: priced(currency, amounts.borrow),
    })] },
  });
  return presentBalances({ status: "ready", snapshot, error: null });
}
const us = balances("US");
const loading = presentBalances({ status: "loading", snapshot: null, error: null });
const pendingOperation: RecentMoneyActionOperation = {
  action: { id: "pending-cash-out", kind: "cash-out", title: "Cash out to Zelle", amounts: [{ direction: "spend", assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "25000000" }],
    metadata: { product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "sandbox",
      platform: "zelle", platformLabel: "Zelle", currency: "USD", canonicalHandle: "alex@example.com", approximateFiatAmount: "24.25",
      minConversionRate: "1000000000000000000", intentAmountRange: { min: "25000000", max: "25000000" },
      estimateAsOf: "2026-09-23T12:00:00.000Z", escrow: "0x777777779d229cdF3110e9de47943791c26300Ef" },
    warnings: [], expiresAt: "2026-09-23T12:00:00.000Z", createdAt: "2026-09-23T12:00:00.000Z" },
  status: "pending", createdAt: "2026-09-23T12:00:00.000Z", updatedAt: "2026-09-23T12:00:00.000Z",
};
const openAccount = fn();
const meta = {
  id: "explorations-regional-home", title: "Explorations/Regional Home", component: RegionalHomeProposal,
  args: { regionId: "US", assetBalances: us, activity, onOpenAccount: openAccount, onReload: fn() },
  parameters: {
    layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" },
    docs: { description: { component: "Unreviewed #638 regional and desktop proposal. Amounts, region availability and activity are fixed illustrative fixtures; nothing is connected to live money or routes. BR dates render in pt-BR while fixture labels are English (production ActivityPanelView behavior). The rail keeps Card from #636, unlike #694's Home/Invest rail, and stays pinned around an inner scroll pane. The HomeMark hit area remains below 44px until adoption gives it an owned 44px control (known #694 prerequisite). Production ActivityPanelView rows still truncate at 200% text; consuming-leaf follow-up." } },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=311-12034" },
  },
} satisfies Meta<typeof RegionalHomeProposal>;
export default meta;
type Story = StoryObj<typeof meta>;
const checkActions = async (canvasElement: HTMLElement) => {
  const buttons = within(within(canvasElement).getByLabelText("Money actions")).getAllByRole("button");
  await expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Add money", "Send", "Cash out"]);
};
export const Us: Story = { play: async ({ canvasElement }) => { await checkActions(canvasElement); } };
export const MobileNavigationStaysVisible: Story = { play: async ({ canvasElement }) => {
  const navigation = within(canvasElement).getByRole("navigation", { name: "Main navigation" });
  const scroller = within(canvasElement).getByTestId("regional-shell-scroll");
  scroller.scrollTop = 10000;
  await expect(navigation).toBeVisible();
  await expect(within(navigation).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
} };
export const MobileNavigationSafeArea: Story = {
  decorators: [(Story) => <div style={{ "--shell-safe-area-bottom": "34px" } as CSSProperties}><Story /></div>],
  play: async ({ canvasElement }) => {
    const navigation = within(canvasElement).getByRole("navigation", { name: "Main navigation" });
    const destinations = within(navigation).getAllByRole("button");
    await expect(navigation).toBeVisible();
    await expect(destinations).toHaveLength(3);
    for (const destination of destinations) await expect(destination).toBeVisible();
    const clearance = navigation.getBoundingClientRect().bottom - Math.max(...destinations.map((destination) => destination.getBoundingClientRect().bottom));
    await expect(clearance).toBeGreaterThanOrEqual(33.5);
  },
};
export const Brazil: Story = { args: { regionId: "BR", assetBalances: balances("BR"), activity: activityFor("BR") }, play: async ({ canvasElement }) => {
  await checkActivityCurrency(canvasElement, "R$ 136,25");
  await checkActions(canvasElement);
  const pricedBalances = balances("BR");
  await expect(pricedBalances.displayTotal).toBe("R$ 329,94");
  await expect([pricedBalances.summary?.cash.value, pricedBalances.summary?.investments.value, pricedBalances.summary?.borrow.kind === "position" ? pricedBalances.summary.borrow.value : null])
    .toEqual(["R$ 67,25", "R$ 426,24", "R$ 163,55"]);
  const row = within(within(canvasElement).getByRole("region", { name: "Your money" })).getByText("Cash").closest("li")!;
  await expect(row.textContent).toContain("Brazilian real and US dollars");
  await expect(row.textContent).toContain("4,20% APY on dollars");
  await expect(within(row).getByRole("button")).toBeVisible();
} };
export const Nigeria: Story = { args: { regionId: "NG", assetBalances: balances("NG"), activity: activityFor("NG") }, play: async ({ canvasElement }) => {
  await checkActivityCurrency(canvasElement, "₦38,375.00");
  await checkActions(canvasElement);
  const pricedBalances = balances("NG");
  await expect(pricedBalances.displayTotal).toBe("₦92,928.90");
  await expect([pricedBalances.summary?.cash.value, pricedBalances.summary?.investments.value, pricedBalances.summary?.borrow.kind === "position" ? pricedBalances.summary.borrow.value : null])
    .toEqual(["₦18,941.90", "₦120,052.35", "₦46,065.35"]);
  const moneyRows = within(canvasElement).getByRole("region", { name: "Your money" }).querySelectorAll("li");
  await expect(moneyRows).toHaveLength(3);
  const cashRow = within(within(canvasElement).getByRole("region", { name: "Your money" })).getByText("Cash").closest("li")!;
  await expect(cashRow.textContent).toContain("US dollars");
  await expect(cashRow.textContent).not.toContain("Nigerian naira");
  await expect(cashRow.textContent).toContain("4.20% APY");
} };
export const Indonesia: Story = { args: { regionId: "ID", assetBalances: balances("ID"), activity: activityFor("ID") }, play: async ({ canvasElement }) => {
  await checkActivityCurrency(canvasElement, "Rp 406.750,00");
  await checkActions(canvasElement);
  const pricedBalances = balances("ID");
  await expect(pricedBalances.displayTotal).toBe("Rp 984.986,00");
  await expect([pricedBalances.summary?.cash.value, pricedBalances.summary?.investments.value, pricedBalances.summary?.borrow.kind === "position" ? pricedBalances.summary.borrow.value : null])
    .toEqual(["Rp 200.772,00", "Rp 1.272.477,00", "Rp 488.263,00"]);
  const cashRow = within(within(canvasElement).getByRole("region", { name: "Your money" })).getByText("Cash").closest("li")!;
  await expect(cashRow.textContent).toContain("Rupiah and US dollars");
  await expect(cashRow.textContent).toContain("4,20% APY on dollars");
} };
export const Loading: Story = { args: { assetBalances: loading, activity: loadingActivity } };
export const Empty: Story = { args: { assetBalances: balances("US", "empty"), activity: emptyActivity }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByText("No activity yet")).toBeVisible();
  await checkActions(canvasElement);
} };
export const PartialBalances: Story = { args: { assetBalances: balances("US", "partial") }, play: async ({ canvasElement }) => {
  const partial = balances("US", "partial");
  await expect(partial.summary?.investments.assetCount).toBe(0);
  await expect(partial.summary?.investments.status).toBe("unavailable");
  await expect(partial.summary?.borrow.kind).toBe("unavailable");
  await expect(canvasElement.querySelector("[data-total-status='partial']")).not.toBeNull();
  const money = within(within(canvasElement).getByRole("region", { name: "Your money" }));
  await expect(money.queryByText("Start investing")).toBeNull();
  await expect(money.queryByText(/Borrow at/)).toBeNull();
  for (const label of ["Investments", "Borrow Cash"]) {
    const row = money.getByText(label).closest("li")!;
    await expect(within(row).getByText("Unavailable")).toBeInTheDocument();
    await expect(within(row).getByText("—")).toBeVisible();
  }
} };
export const ActivityError: Story = { args: { activity: failedActivity }, play: async ({ canvasElement }) => {
  retry.mockClear();
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Reload activity" }));
  await expect(retry).toHaveBeenCalledTimes(1);
} };
export const CashOutPending: Story = { args: { operations: [pendingOperation] }, play: async ({ canvasElement }) => {
  const activityText = within(canvasElement).getByRole("region", { name: "Activity" }).textContent;
  await expect(activityText).toContain("Pending");
  await expect(activityText).toContain("Cash out to Zelle");
} };
export const German320: Story = { args: { actionLabels: ["Geld hinzufügen", "Geld an eine andere Person senden", "Geld auf ein anderes Konto auszahlen"],
  regionId: "BR", assetBalances: balances("BR"), activity: activityFor("BR"), cashContext: "Brasilianischer Real und US-Dollar",
  moneyLabels: ["Bargeldbestand", "Investitionen und andere Anlagen", "Geld gegen Anlagen leihen"] },
  play: async ({ canvasElement }) => { await checkActivityCurrency(canvasElement, "R$ 136,25"); },
  parameters: { viewport: { defaultViewport: "smallMobile" }, docs: { description: { story: "320px long-string stress fixture; illustrative German strings, not a translation." } } } };
export const French200Text: Story = { args: { actionLabels: ["Ajouter de l’argent", "Envoyer de l’argent", "Retirer de l’argent"],
  regionId: "BR", assetBalances: balances("BR"), activity: activityFor("BR"), cashContext: "Réal brésilien et dollars américains",
  moneyLabels: ["Espèces", "Investissements", "Emprunter des fonds"] },
  play: async ({ canvasElement }) => { await checkActivityCurrency(canvasElement, "R$ 136,25"); },
  beforeEach() {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => { document.documentElement.style.fontSize = previous; };
  },
  parameters: { docs: { description: { story: "Illustrative French long-string root 200% text zoom stress fixture, not a translation. Production Activity rows (ActivityPanelView/ActivityRow) collapse at 200% text; consuming implementation must adopt the stacking row behavior shown in Your money." } } } }; 
export const Rtl: Story = { args: { rtlActivity: true, moneyLabels: ["رصيد نقدي", "استثمارات", "اقتراض نقدي"],
  cashContext: "رصيد نقدي بالدولار الأمريكي متاح للسحب والتحويل الآن" }, decorators: [(Story) => <div dir="rtl"><Story /></div>],
  play: async ({ canvasElement }) => {
    const heroTotal = within(canvasElement).getByRole("img", { name: "$60.54" });
    await expect(heroTotal).toHaveAttribute("aria-label", "$60.54");
    await expect(heroTotal.closest("bdi")).toHaveAttribute("dir", "ltr");
    const cashRow = within(within(canvasElement).getByRole("region", { name: "Your money" })).getByText("رصيد نقدي").closest("li")!;
    const descriptions = cashRow.querySelectorAll("p");
    await expect(descriptions.length).toBeGreaterThan(0);
    for (const description of descriptions) {
      const range = description.ownerDocument.createRange();
      range.selectNodeContents(description);
      const lines = Array.from(range.getClientRects());
      await expect(lines.length).toBeGreaterThan(1);
      const lastLine = lines[lines.length - 1];
      await expect(lastLine.width).toBeLessThan(lines[0].width);
      await expect(Math.abs(description.getBoundingClientRect().right - lastLine.right)).toBeLessThanOrEqual(2);
    }
  },
  parameters: { docs: { description: { story: "Illustrative RTL cash-row copy stress fixture, not a translation. Production MoneyTicker needs bidi isolation in RTL; this exploration isolates the Activity ticker at the wrapper level as a consuming-work follow-up." } } },
};
export const KeyboardFocus: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  canvas.getByRole("button", { name: "Account" }).focus();
  for (const name of ["Add money", "Send", "Cash out"]) {
    await userEvent.tab();
    await expect(within(canvas.getByLabelText("Money actions")).getByRole("button", { name })).toHaveFocus();
  }
} };
export const ReducedMotion: Story = {
  decorators: [(Story) => <MoneyMotionProvider reducedMotion><Story /></MoneyMotionProvider>],
  play: async ({ canvasElement }) => {
    for (const ticker of canvasElement.querySelectorAll("[data-slot='money-ticker']")) {
      await expect(ticker).toHaveAttribute("data-animated", "false");
    }
  },
  parameters: { docs: { description: { story: "Deterministic no-animation MoneyTicker reference. Owned components also follow prefers-reduced-motion in a real browser." } } },
};
export const Desktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const rail = canvas.getByRole("navigation", { name: "Desktop navigation" });
  await expect(rail).toBeVisible();
  await expect(within(rail).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  const money = canvas.getByRole("region", { name: "Your money" });
  const activityRegion = canvas.getByRole("region", { name: "Activity" });
  await expect(money).toBeVisible();
  await expect(activityRegion).toBeVisible();
  await expect(within(canvas.getByTestId("regional-shell-scroll")).getByRole("main")).toBeVisible();
} };
export const DesktopLoading: Story = { args: { assetBalances: loading, activity: loadingActivity }, parameters: { viewport: { defaultViewport: "desktop" } } };

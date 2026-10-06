import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { http, HttpResponse } from "msw";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { AssetDetailScreen } from "@/client/invest/asset-detail-screen";
import { DiscoverAssetRow } from "@/client/invest/discover-asset-row";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient, publicQueryKey } from "@/client/query/query-client";
import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { assetFacts } from "@/config/invest-sources/asset-context";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import { priceHistoryFixture } from "@/tests/browser/feature-map/fixtures";
import { pinClock } from "@/tests/helpers/pin-clock";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { isMarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import type { AssetCatalyst, AssetFact } from "@/shared/invest/asset-context";

function requireFixture<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing invest asset decision fixture");
  return value;
}

const TIME = "2026-09-28T12:00:00.000Z";
const stock = requireFixture(investAssets.find((asset) => asset.id === "nvdac"));
const address = "0x1111111111111111111111111111111111111111" as const;
const chartWait = { timeout: 6000 };
const dynamic: InvestAsset = { id: `base:${address}`, category: "meme", displayName: "Fixture token", displaySymbol: "FIX",
  initials: "FI", chainId: 8453, contractAddress: address, availability: "informational", descriptor: "Base token",
  representation: { tokenSymbol: "FIX", relationship: "Unverified narrative must not appear" }, contractUrl: `https://basescan.org/token/${address}` };
const fact: AssetFact = { assetId: stock.id, contractAddress: stock.contractAddress, summary: "Synthetic sourced company context for review.",
  source: { label: "Fixture company source", url: "https://example.com/company" }, checkedAt: "2026-09-28" };
const catalyst: AssetCatalyst = { assetId: stock.id, contractAddress: stock.contractAddress, title: "Fixture quarterly update",
  publisher: "Fixture publisher", url: "https://example.com/update", publishedAt: "2026-09-27", expiresAt: "2026-09-30" };
type Mode = "ready" | "loading" | "empty" | "partial" | "one-point-failure" | "one-point-refresh" | "paused" | "stale" | "retry" | "failed-balance";
type Props = { assetId: string; held: boolean; mode: Mode; context: "none" | "current" | "expired" | "mismatched" | "non-https" };
let calls = 0;
let release = () => {};
let heldRequest = Promise.resolve();
function historyHandler(mode: Mode = "ready") {
  return http.get("/api/market-prices/history", async ({ request }) => {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId") ?? stock.id;
    const range = url.searchParams.get("range") ?? "1W";
    if (!isMarketPriceRange(range)) throw new Error("Invalid history fixture range");
    calls++;
    if (mode === "loading") await heldRequest;
    const history = priceHistoryFixture(assetId, new Date(TIME), range);
    if (mode === "retry" && calls === 1) return HttpResponse.json({ ...history, status: "unavailable", unavailableReason: "overloaded", points: [], coverage: undefined }, { status: 503 });
    if (mode === "empty") return HttpResponse.json({ ...history, status: "empty", points: [], coverage: { sampled: 0, observed: 0, gaps: [] } });
    if (mode === "one-point-failure" && calls === 1 || mode === "one-point-refresh" && calls === 2) return HttpResponse.json({ ...history, points: history.points.slice(-1),
      coverage: { sampled: 24, observed: 1, gaps: [{ from: requireFixture(history.points[0]).time, to: requireFixture(history.points.at(-1)).time, reason: "read-failed" }] } });
    if (mode === "partial") {
      const points = history.points.filter((_, index) => index >= 5 && (index < 11 || index > 14));
      return HttpResponse.json({ ...history, points, coverage: { sampled: 24, observed: points.length, gaps: [
        { from: requireFixture(history.points[0]).time, to: requireFixture(points[0]).time, reason: "not-deployed" },
        { from: requireFixture(history.points[10]).time, to: requireFixture(history.points[15]).time, reason: "read-failed" },
      ] } });
    }
    return HttpResponse.json(history);
  });
}
function Journey({ assetId, held, mode, context }: Props) {
  const [selected, setSelected] = useState(false);
  const asset = assetId === "dynamic" ? dynamic : requireFixture(investAssets.find((item) => item.id === assetId));
  const session = { user: { subject: "synthetic-decision-owner" }, smartAccount: { address, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };
  const blocked = createBlockedAccountWalletClient("unconfigured");
  const client = { ...blocked, status: "verified" as const, verification: "server" as const, session,
    fetchBalances: async () => {
      if (mode === "failed-balance") throw new Error("Fixture balance failure");
      const snapshot = balancesSnapshot("US", { stocks: true });
      return { ...snapshot, holdings: snapshot.holdings.map((holding) => holding.id === asset.id ? { ...holding,
        balance: { status: "ready" as const, baseUnits: held ? "125000000" : "0" },
        value: mode === "paused" || mode === "stale" ? { status: "unpriced" as const, reason: mode === "paused" ? "price-paused" as const : "price-stale" as const }
          : { status: "priced" as const, currency: "USD" as const, amount: { atoms: "22530", scale: 2 }, asOf: "2026-09-27T22:00:00.000Z",
            reference: { kind: "tokenized-equity" as const, session: "closed" as const } },
      } : holding) };
    },
  };
  const market: MarketDataState = mode === "loading" ? { status: "loading" } : { status: "ready", snapshots: [{ assetId: asset.id,
    displayPrice: "$180.24", sourceLabel: asset.category === "stock" ? "Chainlink" : "Codex", asOf: "2026-09-27T22:00:00.000Z",
    ...(asset.category === "stock" ? { session: mode === "paused" ? "paused" as const : mode === "stale" ? "stale" as const : "closed" as const } : {}),
  }] };
  const catalysts = context === "current" ? [catalyst] : context === "expired" ? [{ ...catalyst, expiresAt: "2026-09-28" }]
    : context === "mismatched" ? [{ ...catalyst, contractAddress: address }]
      : context === "non-https" ? [{ ...catalyst, url: "http://example.com/update" }] : [];
  return <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US">
    <main className="min-h-screen bg-background">
      {selected ? <AssetDetailScreen asset={asset} market={market} onBack={() => setSelected(false)} facts={context === "current" ? [fact] : undefined} catalysts={catalysts} />
        : <section className="mx-auto max-w-2xl p-4" aria-label="Discover"><h1 className="text-xl font-semibold">Discover</h1>
          <ul><DiscoverAssetRow asset={asset} market={market} onOpen={() => setSelected(true)} /></ul></section>}
    </main>
  </PresentationRegionProvider></AccountWalletClientProvider>;
}
const meta = { title: "Journeys/Invest asset decision", component: Journey,
  args: { assetId: stock.id, held: true, mode: "ready", context: "none" },
  beforeEach: () => { getHomeQueryClient().clear(); calls = 0; heldRequest = new Promise<void>((resolve) => { release = resolve; });
    const restore = pinClock(TIME); return () => { release(); restore(); getHomeQueryClient().clear(); }; },
  parameters: { layout: "fullscreen", a11y: { test: "error" }, viewport: { defaultViewport: "mobile" }, msw: { handlers: [historyHandler(),
    http.get("/api/market-prices/stats", ({ request }) => HttpResponse.json({ version: 1, provider: "codex", assetId: new URL(request.url).searchParams.get("assetId"),
      status: "ready", currency: "USD", fetchedAt: TIME, stats: { marketCapUsd: { atoms: "2410000000000", scale: 0 }, volume24hUsd: { atoms: "38200000000", scale: 0 }, liquidityUsd: { atoms: "850000", scale: 0 } } })),
  ] } },
} satisfies Meta<typeof Journey>;
export default meta;
type Story = StoryObj<typeof meta>;
async function open(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button"));
  return canvas;
}
async function ready(canvasElement: HTMLElement) {
  const canvas = await open(canvasElement);
  await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
  return canvas;
}
export const HeldStock: Story = { play: async ({ canvasElement }) => {
  const canvas = await ready(canvasElement);
  await expect(await canvas.findByText("1.25 NVDAc")).toBeVisible();
  await expect(canvas.getByText("$225.30")).toBeVisible();
  await expect(canvas.queryByText(/DEX/)).not.toBeInTheDocument();
  await expect(canvas.queryByText("Market cap")).not.toBeInTheDocument();
  await expect(canvas.queryByText(/Partial coverage/)).not.toBeInTheDocument();
  await expect(canvas.getByText(requireFixture(assetFacts.find((entry) => entry.assetId === stock.id)).summary)).toBeVisible();
  const chart = canvas.getByRole("group", { name: /1 week price history/ });
  chart.focus(); await userEvent.keyboard("{End}");
  await expect(canvasElement.querySelector("strong[data-tone]")).toHaveTextContent("$180.24");
  await expect(canvasElement.querySelector("[data-scrub-readout]")).toBeVisible();
  await userEvent.keyboard("{Home}{ArrowRight}{ArrowLeft}{Escape}");
  await expect(canvasElement.querySelector("[data-scrub-readout]")).not.toBeInTheDocument();
  const box = chart.getBoundingClientRect();
  await fireEvent.pointerDown(chart, { pointerType: "touch", pointerId: 7, clientX: box.left + 80, clientY: box.top + 60 });
  await fireEvent.pointerMove(chart, { pointerType: "touch", pointerId: 7, clientX: box.left + 100, clientY: box.top + 60 });
  await expect(canvasElement.querySelector("[data-scrub-readout]")).toBeVisible();
  await fireEvent.pointerCancel(chart, { pointerType: "touch", pointerId: 7 });
  await expect(canvasElement.querySelector("[data-scrub-readout]")).not.toBeInTheDocument();
  await userEvent.click(canvas.getByRole("button", { name: "Back" }));
  await expect(canvas.getByRole("region", { name: "Discover" })).toBeVisible();
} };
export const UnheldStockPartial: Story = { args: { held: false, mode: "partial" }, parameters: { msw: { handlers: [historyHandler("partial")] } }, play: async ({ canvasElement }) => {
  const canvas = await ready(canvasElement);
  await expect(canvas.getByText(/^Since .*15 of 24 samples/)).toBeVisible();
  await expect(canvas.getByText("Partial coverage · 15 of 24 samples")).toBeVisible();
  await expect(canvasElement.querySelectorAll("[data-coverage-gap]")).toHaveLength(2);
} };
export const WrappedMajor: Story = { args: { assetId: "cbbtc", held: false }, play: async ({ canvasElement }) => {
  const canvas = await ready(canvasElement); await expect(await canvas.findByText("Market cap")).toBeVisible();
  await expect(canvas.getByText(requireFixture(assetFacts.find((entry) => entry.assetId === "cbbtc")).summary)).toBeVisible();
} };
export const Meme: Story = { args: { assetId: "degen", held: false }, play: async ({ canvasElement }) => {
  const canvas = await ready(canvasElement); await expect(await canvas.findByText("Liquidity")).toBeVisible();
  await expect(canvas.getByText(requireFixture(assetFacts.find((entry) => entry.assetId === "degen")).summary)).toBeVisible();
} };
export const DynamicToken: Story = { args: { assetId: "dynamic", held: false }, play: async ({ canvasElement }) => {
  const canvas = await ready(canvasElement); await expect(canvas.queryByText(/Unverified narrative/)).not.toBeInTheDocument();
  await expect(canvas.getByRole("link", { name: "View contract" })).toHaveAttribute("href", `https://basescan.org/token/${address}`);
} };
export const Loading: Story = { args: { mode: "loading" }, parameters: { msw: { handlers: [historyHandler("loading")] } }, play: async ({ canvasElement }) => {
  const canvas = await open(canvasElement); await expect(canvas.getByRole("status", { name: "Loading price history" })).toBeVisible(); release();
} };
export const Empty: Story = { args: { mode: "empty" }, parameters: { msw: { handlers: [historyHandler("empty")] } }, play: async ({ canvasElement }) => {
  const canvas = await open(canvasElement); await expect(await canvas.findByRole("status", { name: "No price history for this range." })).toBeVisible();
} };
export const Partial: Story = { ...UnheldStockPartial, args: { mode: "partial", held: true } };
export const OnePointFailureRetry: Story = { args: { mode: "one-point-failure" }, parameters: { msw: { handlers: [historyHandler("one-point-failure")] } }, play: async ({ canvasElement }) => {
  const canvas = await open(canvasElement);
  await expect(await canvas.findByRole("status", { name: "Couldn't load price history" })).toBeVisible();
  await expect(canvas.queryByText("No price history for this range.")).not.toBeInTheDocument();
  await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
  await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
} };
export const OnePointRefreshKeepsLastGood: Story = { args: { mode: "one-point-refresh" }, parameters: { msw: { handlers: [historyHandler("one-point-refresh")] } }, play: async ({ canvasElement }) => {
  const canvas = await ready(canvasElement);
  const chart = canvas.getByRole("group", { name: /1 week price history, 24 points/ });
  await expect(chart).toBeVisible();
  await getHomeQueryClient().refetchQueries({ queryKey: publicQueryKey("price-history", stock.id, "1W"), exact: true });
  await expect(await canvas.findByText(/^Couldn't refresh price history · last updated/)).toBeVisible();
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAccessibleName(/1 week price history, 24 points.*Couldn't refresh/);
  await expect(canvas.queryByRole("status", { name: "Couldn't load price history" })).not.toBeInTheDocument();
  await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
  await waitForReady(() => expect(canvas.queryByText(/^Couldn't refresh price history/)).not.toBeInTheDocument());
  await expect(canvas.getByRole("group", { name: /1 week price history, 24 points/ })).toBeVisible();
} };
export const Paused: Story = { args: { mode: "paused" }, play: async ({ canvasElement }) => { const canvas = await ready(canvasElement); await waitForReady(() => expect(canvas.getAllByText("Paused")).toHaveLength(2)); } };
export const Stale: Story = { args: { mode: "stale" }, play: async ({ canvasElement }) => { const canvas = await ready(canvasElement); await waitForReady(() => expect(canvas.getAllByText("Price delayed")).toHaveLength(2)); } };
export const UnavailableRetry: Story = { args: { mode: "retry" }, parameters: { msw: { handlers: [historyHandler("retry")] } }, play: async ({ canvasElement }) => {
  const canvas = await open(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Try again" }));
  await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
} };
export const FailedBalance: Story = { args: { mode: "failed-balance" }, play: async ({ canvasElement }) => { const canvas = await ready(canvasElement); await expect(await canvas.findByText("Balance unavailable")).toBeVisible(); } };
export const VerifiedCatalyst: Story = { args: { context: "current" }, play: async ({ canvasElement }) => {
  const canvas = await ready(canvasElement); await expect(canvas.getByRole("link", { name: "Fixture quarterly update" })).toHaveAttribute("href", catalyst.url);
  await expect(canvas.getByText(/^Context ·/)).toBeVisible();
} };
export const ExpiredCatalyst: Story = { args: { context: "expired" }, play: async ({ canvasElement }) => { const canvas = await ready(canvasElement); await expect(canvas.queryByRole("link", { name: catalyst.title })).not.toBeInTheDocument(); } };
export const MismatchedCatalyst: Story = { args: { context: "mismatched" }, play: async ({ canvasElement }) => { const canvas = await ready(canvasElement); await expect(canvas.queryByRole("link", { name: catalyst.title })).not.toBeInTheDocument(); } };
export const NonHttpsCatalyst: Story = { args: { context: "non-https" }, play: async ({ canvasElement }) => { const canvas = await ready(canvasElement); await expect(canvas.queryByRole("link", { name: catalyst.title })).not.toBeInTheDocument(); } };
export const RapidRangeSwitch: Story = { play: async ({ canvasElement }) => {
  const canvas = await ready(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "1D" }));
  await userEvent.click(canvas.getByRole("button", { name: "1Y" }));
  await userEvent.click(canvas.getByRole("button", { name: "1W" }));
  await waitForReady(() => expect(canvas.getByRole("group", { name: /1 week price history/ })).toBeVisible());
  await expect(canvasElement.querySelector('[data-layer-range="1Y"][data-layer-state="shown"]')).not.toBeInTheDocument();
} };

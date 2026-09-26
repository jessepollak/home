import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { DiscoverAssetRow } from "@/client/invest/discover-asset-row";
import {
  OptionA, type ExplorationHolding, type ProposedMarketStats,
} from "@/client/invest/explorations/asset-detail-options";
import { PresentationQuoteProvider, PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient, publicQueryKey } from "@/client/query/query-client";
import { Button } from "@/components/ui/button";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { BASE_CHAIN_ID, investAssets, type InvestAsset } from "@/config/invest-assets";
import type { MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { formatPresentationDate, formatSignedPercentChange } from "@/shared/formatting";

const chartWait = { timeout: 5000 };
const clock = Date.now() - 60000;
const staleOffsetMs = 8 * 86400000;
const crypto = investAssets.find((asset) => asset.id === "cbbtc")!;
const stock = investAssets.find((asset) => asset.id === "nvdac")!;
const configuredMeme = investAssets.find((asset) => asset.id === "degen")!;
const address = "0x1111111111111111111111111111111111111111" as const;
const dynamicMeme: InvestAsset = {
  id: `base:${address}`,
  category: "meme",
  displayName: "Micro Meme",
  displaySymbol: "MICRO",
  initials: "MI",
  chainId: BASE_CHAIN_ID,
  contractAddress: address,
  availability: "informational",
  descriptor: "Trending on Base",
  representation: { tokenSymbol: "MICRO", decimals: 18, relationship: "Base ERC-20 token." },
  contractUrl: `https://basescan.org/token/${address}`,
};
const cryptoHolding: ExplorationHolding = {
  balance: { status: "ready", baseUnits: "1234000" },
  decimals: 8,
  tokenSymbol: "cbBTC",
  value: {
    status: "priced", currency: "USD", amount: { atoms: "151030", scale: 2 },
    asOf: new Date(clock).toISOString(),
  },
  valuation: "codex", listing: "listed",
};
const stockHolding: ExplorationHolding = {
  balance: { status: "ready", baseUnits: "1250000000000000000" },
  decimals: 18,
  tokenSymbol: "NVDAc",
  value: {
    status: "priced", currency: "USD", amount: { atoms: "22450", scale: 2 },
    asOf: new Date(clock).toISOString(),
  },
  valuation: "chainlink-total-return-624-fixture", listing: "listed",
};
const priceById: Record<string, number> = {
  cbbtc: 122391.18, nvdac: 179.60, degen: 0.003812,
  [dynamicMeme.id]: 0.000004812,
};
function market(asset: InvestAsset, stale = false, bump = false, priceOverride?: string): MarketDataState {
  return stale ? { status: "error", message: "Price snapshot is stale." } : {
    status: "ready",
    snapshots: [{
      assetId: asset.id,
      displayPrice: priceOverride ?? `$${bump ? (priceById[asset.id]! * 1.01).toFixed(2)
        : priceById[asset.id]}`,
      asOf: new Date(clock - 60000 + (bump ? 60000 : 0)).toISOString(),
      sourceLabel: "Codex",
      changeLabel: (() => {
        const points = historyResponse(asset.id, "1D").points;
        const first = Number(points[0]?.value);
        const last = Number(points.at(-1)?.value);
        return formatSignedPercentChange((last - first) / first * 100) ?? undefined;
      })(),
    }],
  };
}
const periods: Record<MarketPriceRange, number> = {
  "1D": 86400000,
  "1W": 604800000,
  "1M": 2592000000,
  "3M": 7776000000,
  "1Y": 31536000000,
};
const pointCounts: Record<MarketPriceRange, number> = {
  "1D": 96, "1W": 168, "1M": 120, "3M": 90, "1Y": 365,
};
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = (value + Math.imul(value ^ value >>> 7, 61 | value)) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function historyResponse(
  assetId: string, range: MarketPriceRange, state: "ready" | "empty" | "stale" = "ready",
) {
  const base = priceById[assetId] ?? priceById.cbbtc!;
  const end = clock - (state === "stale" ? staleOffsetMs : 0);
  const count = pointCounts[range];
  const seed = Array.from(`${assetId}:${range}`).reduce(
    (value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619), 2166136261,
  );
  const random = seededRandom(seed);
  const volatility = assetId === dynamicMeme.id ? 0.022
    : assetId === "nvdac" ? 0.0028 : assetId === "degen" ? 0.0011 : 0.0016;
  const rangeShift = range === "1W" ? 0 : ((seed >>> 8) % 9 - 4) / 100;
  const startFactor = (assetId === "nvdac" ? 1.045
    : assetId === "degen" ? 0.998 : assetId === dynamicMeme.id ? 0.82 : 0.96) + rangeShift;
  const endFactor = (assetId === "nvdac" ? 0.998
    : assetId === "degen" ? 1.002 : assetId === dynamicMeme.id ? 1.08 : 1.001)
    + rangeShift * 0.1;
  let walk = 0;
  const offsets = Array.from({ length: count }, (_, index) => {
    if (index > 0) walk += (random() - 0.5) * 2 * volatility;
    return walk;
  });
  const lastOffset = offsets.at(-1) ?? 0;
  return {
    version: 1,
    provider: "codex",
    assetId,
    range,
    currency: "USD",
    fetchedAt: new Date(clock).toISOString(),
    status: state === "empty" ? "empty" : "ready",
    points: state === "empty" ? [] : offsets.map((offset, index) => {
      const progress = index / (count - 1);
      const trend = startFactor + (endFactor - startFactor) * progress;
      const bounce = assetId === "nvdac"
        ? 0.035 * Math.max(0, 1 - Math.abs(progress - 0.55) / 0.13) : 0;
      const spike = assetId === dynamicMeme.id
        ? 0.38 * Math.max(0, 1 - Math.abs(progress - 0.31) / 0.025)
          - 0.29 * Math.max(0, 1 - Math.abs(progress - 0.73) / 0.035)
        : 0;
      return {
        time: new Date(end - periods[range] * (1 - progress)).toISOString(),
        value: (base * Math.max(0.1, trend + offset - lastOffset * progress + bounce + spike))
          .toPrecision(10),
      };
    }),
  };
}
const slowCycleControl: { release: () => void; held: Promise<void> } = {
  release: () => {}, held: Promise.resolve(),
};
const historyControl: { calls: number; release: () => void; held: Promise<void> } = {
  calls: 0, release: () => {}, held: Promise.resolve(),
};
function resetHistoryControl() {
  historyControl.release();
  historyControl.calls = 0;
  historyControl.held = new Promise<void>((resolve) => { historyControl.release = resolve; });
}
function resetSlowCycleControl() {
  slowCycleControl.release();
  slowCycleControl.held = new Promise<void>((resolve) => { slowCycleControl.release = resolve; });
}
function historyHandler(mode: "ready" | "empty" | "stale" | "slow" | "slow-cycle" | "hold-year" | "retry" | "error" = "ready") {
  return http.get("/api/market-prices/history", async ({ request }) => {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId") ?? "cbbtc";
    const range = (url.searchParams.get("range") ?? "1W") as MarketPriceRange;
    historyControl.calls++;
    if (mode === "slow" || mode === "hold-year" && range === "1Y"
      || mode === "slow-cycle" && range === "1W") await historyControl.held;
    if (mode === "slow-cycle" && range === "3M") await slowCycleControl.held;
    if (mode === "error" || mode === "retry" && historyControl.calls === 1) {
      return HttpResponse.json({ error: "unavailable" }, { status: 500 });
    }
    return HttpResponse.json(historyResponse(
      assetId, range, mode === "empty" || mode === "slow-cycle" && range === "1M"
        ? "empty" : mode === "stale" ? "stale" : "ready",
    ));
  });
}
type Scene = "asset" | "hub" | "holding" | "study";
type StoryProps = {
  assetId: "cbbtc" | "nvdac" | "degen" | "dynamic";
  scene?: Scene;
  state?: "normal" | "stale" | "paused" | "removed" | "unpriced" | "long" | "held";
  localCurrency?: boolean;
  missingFx?: boolean;
  holdingOverride?: ExplorationHolding;
  snapshotPriceOverride?: string;
  presentationRegion?: "GLOBAL" | "DE";
  reducedMotion?: boolean;
  slowAfterMs?: number;
  onOpenAsset?: (assetId: StoryProps["assetId"]) => void;
  onBack?: () => void;
};
const assets: Record<StoryProps["assetId"], InvestAsset> = {
  cbbtc: crypto, nvdac: stock, degen: configuredMeme, dynamic: dynamicMeme,
};
const proposedMarketStatsFixtureCrypto: ProposedMarketStats = {
  marketCapUsd: "2410000000000", volume24hUsd: "38200000000", asOf: new Date(clock).toISOString(),
};
const proposedMarketStatsFixtureMeme: ProposedMarketStats = {
  marketCapUsd: "1200000", volume24hUsd: "382000", liquidityUsd: "850000", asOf: new Date(clock).toISOString(),
};
const motionQuery = "(prefers-reduced-motion: reduce)";
const reducedQuery: MediaQueryList = {
  matches: true, media: motionQuery, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
};
let forcedMatchMedia: typeof window.matchMedia | undefined;
function forceReducedMotion() {
  if (forcedMatchMedia && window.matchMedia === forcedMatchMedia) return () => {};
  const original = window.matchMedia;
  const forced: typeof window.matchMedia = (query) => query === motionQuery
    ? reducedQuery : original.call(window, query);
  forcedMatchMedia = forced;
  window.matchMedia = forced;
  return () => { window.matchMedia = original; forcedMatchMedia = undefined; };
}
function StoryHarness({
  assetId, scene = "asset", state = "normal", localCurrency = false, missingFx = false,
  holdingOverride, snapshotPriceOverride, presentationRegion = "GLOBAL", reducedMotion, slowAfterMs,
  onOpenAsset, onBack,
}: StoryProps) {
  const [range, setRange] = useState<MarketPriceRange>("1W");
  const [forcedMotion, setForcedMotion] = useState(reducedMotion);
  useLayoutEffect(() => {
    if (forcedMotion !== true) return;
    return forceReducedMotion();
  }, [forcedMotion]);
  const [bump, setBump] = useState(false);
  const [generation, setGeneration] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);
  const asset = assets[assetId];
  const holding = asset.id === "cbbtc" ? cryptoHolding
    : state === "paused" || state === "removed" || state === "unpriced" || state === "long" || state === "held" ? {
      ...stockHolding,
      listing: state === "paused" ? "paused-624-fixture" as const
        : state === "removed" ? "removed-624-fixture" as const : "listed" as const,
      value: state === "unpriced"
        ? { status: "unpriced" as const, reason: "price-stale" as const }
        : stockHolding.value,
    } : undefined;
  const page = (
    <OptionA key={`${generation}-${asset.id}`} asset={asset}
      market={market(asset, state === "stale", bump, snapshotPriceOverride)} range={range}
      onRangeChange={setRange} onBack={() => onBack?.()} now={clock}
      holding={holdingOverride ?? holding} reducedMotion={forcedMotion} slowAfterMs={slowAfterMs}
      marketStats={asset.category === "stock" ? undefined
        : asset.category === "meme" ? proposedMarketStatsFixtureMeme : proposedMarketStatsFixtureCrypto}
      labels={state === "long" ? {
        name: asset.id === "cbbtc"
          ? "Bitcoin Custody and Digital Assets (long label fixture)"
          : "NVIDIA International Holdings and Technologies (long label fixture)",
        state: "No historical market price points available for this selected time range.",
        chips: "Select the price history time range for the chart",
      } : undefined} />
  );
  function rapidRanges() {
    setRange("1D");
    timers.current.push(window.setTimeout(() => setRange("1Y"), 150));
    timers.current.push(window.setTimeout(() => setRange("1W"), 300));
  }
  return (
    <MoneyMotionProvider reducedMotion={forcedMotion ?? (
      typeof window !== "undefined"
        && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )}>
      <PresentationRegionProvider regionId={presentationRegion}>
        <PresentationQuoteProvider value={localCurrency ? {
          regionId: presentationRegion, valueCurrency: "EUR",
          quoteUnitsPerUsd: missingFx ? null : { atoms: "92", scale: 2 },
        } : {
          regionId: presentationRegion, valueCurrency: "USD",
          quoteUnitsPerUsd: { atoms: "1", scale: 0 },
        }}>
        <div className="min-h-screen bg-background">
          {scene === "study" ? (
            <div className="mx-auto flex max-w-6xl flex-wrap gap-2 p-4"
              role="group" aria-label="Motion controls">
              <Button size="touch" variant="outline"
                onClick={() => setGeneration((value) => value + 1)}>
                Replay first paint
              </Button>
              <Button size="touch" variant="outline" onClick={rapidRanges}>
                Rapid ranges
              </Button>
              <Button size="touch" variant="outline"
                onClick={() => setBump((value) => !value)}>
                Push price update
              </Button>
              <Button size="touch" variant="outline"
                onClick={() => setForcedMotion((value) => !value)}>
                Toggle reduced motion
              </Button>
            </div>
          ) : null}
          {scene === "asset" || scene === "study" ? page : (
            <section className="mx-auto max-w-2xl space-y-4 p-4" aria-label="Invest hub">
              <h2 className="text-xl font-semibold">
                {scene === "holding" ? "Investments" : "Discover"}
              </h2>
              <ul>
                {scene === "holding" ? (
                  <li>
                    <Item render={<Button variant="ghost" press="none" className="h-14"
                      onClick={() => onOpenAsset?.("cbbtc")} />}>
                      <ItemContent>
                        <ItemTitle>Bitcoin holding</ItemTitle>
                        <ItemDescription>0.01234 cbBTC</ItemDescription>
                      </ItemContent>
                    </Item>
                  </li>
                ) : (["cbbtc", "nvdac", "degen", "dynamic"] as const).map((key) => (
                  <DiscoverAssetRow key={key} asset={assets[key]}
                    market={market(assets[key])} onOpen={() => onOpenAsset?.(key)} />
                ))}
              </ul>
            </section>
          )}
        </div>
        </PresentationQuoteProvider>
      </PresentationRegionProvider>
    </MoneyMotionProvider>
  );
}
const meta = {
  id: "explorations-invest-asset-detail",
  title: "Explorations/Invest asset detail",
  component: StoryHarness,
  args: { assetId: "cbbtc", onOpenAsset: fn(), onBack: fn() },
  beforeEach: ({ args }) => {
    resetHistoryControl();
    resetSlowCycleControl();
    const restoreMotion = args.reducedMotion === true ? forceReducedMotion() : undefined;
    return () => { historyControl.release(); slowCycleControl.release(); restoreMotion?.(); };
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    design: {
      type: "figma",
      url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=422-4404",
    },
    msw: { handlers: [historyHandler()] },
    viewport: {
      defaultViewport: "mobile",
      viewports: {
        mobile: { name: "Phone 390", styles: { width: "390px", height: "844px" } },
        narrow: { name: "Phone 320", styles: { width: "320px", height: "700px" } },
        wide: { name: "Desktop 1440", styles: { width: "1440px", height: "900px" } },
      },
    },
  },
} satisfies Meta<typeof StoryHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OptionACrypto: Story = { args: { reducedMotion: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole("group", { name: "1 week price history, 168 points" }, chartWait)).toBeVisible();
  await expect(await canvas.findByText(/\+4\.\d+% · past week/, undefined, chartWait)).toBeVisible();
} };
export const OptionAStock: Story = { args: { assetId: "nvdac", reducedMotion: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole("group", { name: "1 week price history, 168 points" }, chartWait)).toBeVisible();
  await expect(await canvas.findByText(/−4\.\d+% · past week/, undefined, chartWait)).toBeVisible();
  await expect(canvas.queryByText("Market cap")).not.toBeInTheDocument();
} };
export const OptionAMeme: Story = { args: { assetId: "dynamic", reducedMotion: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Liquidity")).toBeVisible();
    await expect(within(canvasElement).getByText("$1.2M")).toBeVisible();
  },
};
export const OptionAStockHeld: Story = { args: { assetId: "nvdac", state: "held", reducedMotion: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("$224.50")).toBeVisible();
    await expect(canvas.getByText("1.25 NVDAc")).toBeVisible();
    await expect(canvas.getByText("Includes dividends")).toBeVisible();
    await expect(canvas.getByText("Your balance")).toBeVisible();
    await expect(canvas.getByText("Market prices in USD from Codex. Your balance uses a price that includes dividends.")).toBeVisible();
    const note = canvas.getByText("Stocks aren't available yet.");
    const footnote = canvas.getByText(/Market prices in USD from Codex/);
    await expect(note.compareDocumentPosition(footnote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};
export const OptionADesktop: Story = { args: { reducedMotion: true }, parameters: { viewport: { defaultViewport: "wide" } } };
export const OptionANarrow: Story = { args: { assetId: "cbbtc", state: "long", reducedMotion: true },
  parameters: { viewport: { defaultViewport: "narrow" } },
};
export const OptionALocalCurrency: Story = { args: { localCurrency: true, reducedMotion: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/\+4\.\d+% in USD · past week/, undefined, chartWait)).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Stats · USD" })).toBeVisible();
  },
};
export const HoldingEuroRegionalFormat: Story = { args: {
  localCurrency: true, presentationRegion: "DE", reducedMotion: true,
  holdingOverride: {
    ...cryptoHolding,
    value: { status: "priced", currency: "EUR", amount: { atoms: "151030", scale: 2 },
      asOf: new Date(clock).toISOString() },
  },
}, play: async ({ canvasElement }) => {
  const balance = within(within(canvasElement).getByText("Your balance").closest("li")!);
  await expect(balance.getByText(/1\.510,30\s*€/)).toBeVisible();
} };
export const HoldingMissingFx: Story = { args: { localCurrency: true, missingFx: true, reducedMotion: true },
  play: async ({ canvasElement }) => {
    const balance = within(within(canvasElement).getByText("Your balance").closest("li")!);
    await expect(balance.getByText("—")).toBeVisible();
    await expect(balance.queryByText("$1,510.30")).not.toBeInTheDocument();
  },
};
export const HoldingChainlinkWithCodexError: Story = { args: { assetId: "nvdac", state: "stale",
  holdingOverride: stockHolding, reducedMotion: true }, play: async ({ canvasElement }) => {
  const balance = within(within(canvasElement).getByText("Your balance").closest("li")!);
  await expect(balance.getByText("Includes dividends")).toBeVisible();
  await expect(balance.queryByText("Price delayed")).not.toBeInTheDocument();
} };
export const ConfiguredMemeUnheld: Story = { args: { assetId: "degen", reducedMotion: true } };
export const StatsProposedContract: Story = { args: { reducedMotion: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("Market cap")).toBeVisible();
  await expect(canvas.getByText("24h volume")).toBeVisible();
  await expect(canvas.getByText("$2.41T")).toBeVisible();
  await expect(canvas.getByText("$38.2B")).toBeVisible();
  const day = await canvas.findByRole("group", { name: /^Past 24h low / }, chartWait);
  const year = await canvas.findByRole("group", { name: /^Past year low / }, chartWait);
  const low = (element: HTMLElement) => Number(element.getAttribute("aria-label")!.match(/low \$([\d,.]+)/)![1]!.replaceAll(",", ""));
  const high = (element: HTMLElement) => Number(element.getAttribute("aria-label")!.match(/high \$([\d,.]+)/)![1]!.replaceAll(",", ""));
  await expect(low(year)).toBeLessThanOrEqual(low(day));
  await expect(high(year)).toBeGreaterThanOrEqual(high(day));
  await expect(year.getAttribute("aria-label")).toContain("current $");
} };
export const StatsSnapshotAboveHistory: Story = { args: { reducedMotion: true, snapshotPriceOverride: "$200000.00" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const day = await canvas.findByRole("group", { name: /^Past 24h low / }, chartWait);
    await expect(day).toHaveAttribute("aria-label", expect.stringContaining("current $200,000.00"));
    const high = Number(day.getAttribute("aria-label")!.match(/high \$([\d,.]+)/)![1]!.replaceAll(",", ""));
    await expect(high).toBeLessThan(200000);
  },
};
export const StatsMemeLiquidity: Story = { args: { assetId: "degen", reducedMotion: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Liquidity")).toBeVisible();
  },
};
export const StatsPartialHistory: Story = {
  args: { reducedMotion: true },
  parameters: { msw: { handlers: [http.get("/api/market-prices/history", ({ request }) => {
    const url = new URL(request.url);
    const range = (url.searchParams.get("range") ?? "1W") as MarketPriceRange;
    const response = historyResponse(url.searchParams.get("assetId") ?? "cbbtc", range,
      range === "1D" ? "empty" : "ready");
    if (range === "1Y") response.points = response.points.slice(110);
    return HttpResponse.json(response);
  })] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/^Since /, undefined, chartWait)).toBeVisible();
    await expect(canvas.queryByText("Past 24h")).not.toBeInTheDocument();
  },
};
export const StatsNoRows: Story = { args: { assetId: "nvdac", reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("empty")] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("status", { name: "No price history for this range." }, chartWait)).toBeVisible();
    await expect(canvas.queryByRole("region", { name: "Stats" })).not.toBeInTheDocument();
  },
};
export const StateEmpty: Story = { args: { reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("empty")] } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No price history for this range.", undefined, chartWait)).toBeVisible();
  },
};
export const StateStale: Story = { args: { state: "stale", reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("stale")] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lastPoint = Math.floor((clock - staleOffsetMs) / 1000) * 1000;
    const date = formatPresentationDate(lastPoint, { regionId: "GLOBAL", style: "chart-date" });
    await expect(await canvas.findByText(`No data since ${date}`, undefined, chartWait)).toBeVisible();
    const points = historyResponse(crypto.id, "1W", "stale").points;
    const first = points[0]!;
    const last = points.at(-1)!;
    const firstTime = formatPresentationDate(Date.parse(first.time), { regionId: "GLOBAL", style: "activity-short" });
    const lastTime = formatPresentationDate(Date.parse(last.time), { regionId: "GLOBAL", style: "activity-short" });
    const change = formatSignedPercentChange((Number(last.value) - Number(first.value)) / Number(first.value) * 100, "GLOBAL");
    await expect(await canvas.findByText(`${change} · ${firstTime} – ${lastTime}`, undefined, chartWait)).toBeVisible();
    await expect(canvas.getByText("Price snapshot is stale.")).toBeVisible();
    await expect(canvas.getByText("Price delayed")).toBeVisible();
    await expect(canvas.queryByRole("group", { name: /low .* high .* current/ })).not.toBeInTheDocument();
  },
};
const refetchedSeries = { changed: false };
export const RangeRefetchReplacesPlot: Story = { args: { reducedMotion: true },
  parameters: { msw: { handlers: [http.get("/api/market-prices/history", ({ request }) => {
    const url = new URL(request.url);
    const range = (url.searchParams.get("range") ?? "1W") as MarketPriceRange;
    const response = historyResponse(url.searchParams.get("assetId") ?? "cbbtc", range);
    if (refetchedSeries.changed && range === "1W") {
      response.points[0] = { ...response.points[0]!, value: (Number(response.points[0]!.value) * 0.8).toString() };
    }
    return HttpResponse.json(response);
  })] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    refetchedSeries.changed = false;
    const initial = await canvas.findByText(/% · past week/, undefined, chartWait);
    const before = initial.textContent;
    refetchedSeries.changed = true;
    try {
      await getHomeQueryClient().invalidateQueries({ queryKey: publicQueryKey("price-history", crypto.id, "1W") });
      await waitFor(() => expect(initial.textContent).not.toBe(before), chartWait);
      await expect(initial).toHaveTextContent(/% · past week/);
    } finally {
      refetchedSeries.changed = false;
    }
  },
};
export const RangeTerminalClearsReturn: Story = { args: { reducedMotion: true },
  parameters: { msw: { handlers: [http.get("/api/market-prices/history", ({ request }) => {
    const url = new URL(request.url);
    const range = (url.searchParams.get("range") ?? "1W") as MarketPriceRange;
    if (range === "1Y") return HttpResponse.json({ error: "unavailable" }, { status: 500 });
    return HttpResponse.json(historyResponse(url.searchParams.get("assetId") ?? "cbbtc", range,
      range === "1M" ? "empty" : "ready"));
  })] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const weekReturn = await canvas.findByText(/% · past week/, undefined, chartWait);
    await userEvent.click(canvas.getByRole("button", { name: "1M" }));
    await expect(await canvas.findByRole("status", { name: "No price history for this range." }, chartWait))
      .not.toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(weekReturn).toBeEmptyDOMElement(), chartWait);
    await expect(weekReturn).not.toHaveAttribute("aria-busy", "true");
    await userEvent.click(canvas.getByRole("button", { name: "1Y" }));
    await expect(await canvas.findByRole("status", { name: "Couldn't load price history" }, chartWait))
      .not.toHaveAttribute("aria-busy", "true");
    await expect(weekReturn).toBeEmptyDOMElement();
    await expect(weekReturn).not.toHaveAttribute("aria-busy", "true");
  },
};
const gapHistoryHandler = http.get("/api/market-prices/history", ({ request }) => {
  const url = new URL(request.url);
  const range = (url.searchParams.get("range") ?? "1W") as MarketPriceRange;
  const response = historyResponse(url.searchParams.get("assetId") ?? "cbbtc", range);
  if (range === "1D") response.points = response.points.map((point) => ({
    ...point, time: new Date(Date.parse(point.time) - 2 * 3600000).toISOString(),
  }));
  if (range === "1W") response.points = response.points.map((point) => ({
    ...point, time: new Date(Date.parse(point.time) - 3 * 86400000).toISOString(),
  }));
  return HttpResponse.json(response);
});
async function assertGapLabelInStage(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
  for (const range of ["1W", "1D"] as const) {
    if (range === "1D") await userEvent.click(canvas.getByRole("button", { name: "1D" }));
    const stage = await canvas.findByRole("group", { name: /price history/ }, chartWait);
    const label = await canvas.findByText(/^No data since /, undefined, chartWait);
    await waitFor(() => {
      const bounds = stage.getBoundingClientRect();
      const text = label.getBoundingClientRect();
      void expect(bounds.width).toBeGreaterThan(0);
      void expect(text.left).toBeGreaterThanOrEqual(bounds.left);
      void expect(text.right).toBeLessThanOrEqual(bounds.right);
      const dot = stage.parentElement?.querySelector("[data-last-point]")?.getBoundingClientRect();
      void expect(dot).toBeDefined();
      void expect(dot!.bottom < text.top || dot!.top > text.bottom).toBe(true);
    }, chartWait);
  }
}
export const GapLabelPhone320: Story = { args: { reducedMotion: true },
  parameters: { msw: { handlers: [gapHistoryHandler] }, viewport: { defaultViewport: "narrow" } },
  play: async ({ canvasElement }) => assertGapLabelInStage(canvasElement),
};
export const GapLabelPhone390: Story = { args: { reducedMotion: true },
  parameters: { msw: { handlers: [gapHistoryHandler] }, viewport: { defaultViewport: "mobile" } },
  play: async ({ canvasElement }) => assertGapLabelInStage(canvasElement),
};
export const StatePausedHolding: Story = { args: { assetId: "nvdac", state: "paused", reducedMotion: true } };
export const StateRemovedHolding: Story = { args: { assetId: "nvdac", state: "removed", reducedMotion: true } };
export const StateUnpricedHolding: Story = { args: { assetId: "nvdac", state: "unpriced", reducedMotion: true } };
export const StateLongLabels: Story = { args: { assetId: "nvdac", state: "long", reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("empty")] } },
};
async function assetInteraction(canvasElement: HTMLElement, args: StoryProps) {
  const canvas = within(canvasElement);
  const chart = await canvas.findByRole("group", { name: /price history/ }, chartWait);
  chart.focus();
  await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
  await expect(canvasElement.querySelector('[data-scrub-readout]')).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(canvas.getByRole("button", { name: "1M" }));
  await expect(canvas.getByRole("button", { name: "1M" })).toHaveAttribute("data-pressed", "");
  await expect(canvas.getByText("0.01234 cbBTC")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Back" }));
  await expect(args.onBack).toHaveBeenCalledOnce();
}
export const AssetInteractionOptionA: Story = { args: { reducedMotion: true },
  play: async ({ canvasElement, args }) => assetInteraction(canvasElement, args),
};
export const DiscoverEntry: Story = { args: { scene: "hub", reducedMotion: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Bitcoin/i }));
    await expect(args.onOpenAsset).toHaveBeenCalledWith("cbbtc");
  },
};
export const HoldingEntry: Story = { args: { scene: "holding", reducedMotion: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Bitcoin holding/ }));
    await expect(args.onOpenAsset).toHaveBeenCalledWith("cbbtc");
  },
};
export const StateSlowHistory: Story = { args: { slowAfterMs: 0, reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("slow")] } },
};
export const StateSlowHistoryResets: Story = { args: { slowAfterMs: 0, reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("slow-cycle")] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Still loading price history", undefined, chartWait)).toBeVisible();
    historyControl.release();
    await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
    resetHistoryControl();
    await userEvent.click(canvas.getByRole("button", { name: "1M" }));
    await expect(await canvas.findByText("No price history for this range.", undefined, chartWait)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "3M" }));
    await expect(await canvas.findByText("Still loading price history", undefined, chartWait)).toBeVisible();
    slowCycleControl.release();
    await expect(await canvas.findByRole("group", { name: /3 months price history/ }, chartWait)).toBeVisible();
  },
};
export const StateError: Story = { args: { reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("error")] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Try again" }, chartWait)).toBeVisible();
    await expect(canvas.getByRole("status", { name: "Couldn't load price history" })).toBeVisible();
  },
};
export const StateErrorRetry: Story = { args: { reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("retry")] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Try again" }, chartWait));
    await expect(await canvas.findByRole("group", { name: /price history/ }, chartWait)).toBeVisible();
  },
};
export const StateReducedMotion: Story = { args: { reducedMotion: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chart = await canvas.findByRole("group", { name: /price history/ }, chartWait);
    await expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    await userEvent.click(canvas.getByRole("button", { name: "1M" }));
    await expect(await canvas.findByRole("group", { name: /1 month price history/ }, chartWait)).not.toHaveAttribute("aria-busy", "true");
    await expect(chart).toBeVisible();
  },
};
export const StateKeyboardScrub: Story = { args: { reducedMotion: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chart = await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
    chart.focus();
    await userEvent.keyboard("{Home}{ArrowRight}{End}{ArrowLeft}");
    await expect(canvasElement.querySelector('[data-scrub-readout]')).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvasElement.querySelector('[data-scrub-readout]')).not.toBeInTheDocument());
  },
};
export const MotionStudy: Story = { args: { scene: "study" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("group", { name: "Motion controls" })).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Push price update" }));
  await canvas.findByRole("group", { name: /price history/ }, chartWait);
  await userEvent.click(canvas.getByRole("button", { name: "1D" }));
  await userEvent.click(canvas.getByRole("button", { name: "1Y" }));
  await userEvent.click(canvas.getByRole("button", { name: "1W" }));
  await waitFor(() => expect(canvas.getByRole("group", { name: /1 week price history/ })).not.toHaveAttribute("aria-busy", "true"), chartWait);
} };
export const TradeBarScroll: Story = { args: { reducedMotion: false },
  render: (args) => <div className="h-140 overflow-y-auto" data-scroll-viewport><StoryHarness {...args} /></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvasElement.querySelector('[data-state="shown"]')!;
    const viewport = canvasElement.querySelector<HTMLElement>("[data-scroll-viewport]")!;
    await canvas.findByRole("group", { name: /price history/ }, chartWait);
    const scrollTo = (top: number) => {
      viewport.scrollTop = top;
      viewport.dispatchEvent(new Event("scroll"));
    };
    scrollTo(120);
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "hidden"));
    viewport.dispatchEvent(new Event("scrollend"));
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "shown"));
    scrollTo(260);
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "hidden"));
    scrollTo(240);
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "shown"));
    scrollTo(300);
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "hidden"));
    await expect(Array.from(bar.querySelectorAll("button")).every((button) => button.disabled)).toBe(true);
    bar.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "shown"));
  },
};
export const TradeBarReducedMotion: Story = { args: { reducedMotion: true },
  render: (args) => <div className="h-140 overflow-y-auto" data-scroll-viewport><StoryHarness {...args} /></div>,
  play: async ({ canvasElement }) => {
    const bar = canvasElement.querySelector('[data-state="shown"]')!;
    const viewport = canvasElement.querySelector<HTMLElement>("[data-scroll-viewport]")!;
    viewport.scrollTop = 220;
    viewport.dispatchEvent(new Event("scroll"));
    await expect(bar).toHaveAttribute("data-state", "shown");
  },
};
export const RangeSwitchBack: Story = { args: { reducedMotion: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-layer-state="ready"]').length).toBe(4), chartWait);
    await userEvent.click(canvas.getByRole("button", { name: "1D" }));
    await expect(await canvas.findByRole("group", { name: /1 day price history/ }, chartWait)).not.toHaveAttribute("aria-busy", "true");
    await userEvent.click(canvas.getByRole("button", { name: "1M" }));
    await canvas.findByRole("group", { name: /1 month price history/ }, chartWait);
    await userEvent.click(canvas.getByRole("button", { name: "1W" }));
    await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).not.toHaveAttribute("aria-busy", "true");
    await expect(canvasElement.querySelector('[data-layer-range="1W"]')).toHaveAttribute("data-layer-state", "shown");
  },
};
export const RangeSwitchRapid: Story = { args: { reducedMotion: true },
  parameters: { msw: { handlers: [historyHandler("hold-year")] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
    await userEvent.click(canvas.getByRole("button", { name: "1Y" }));
    await userEvent.click(canvas.getByRole("button", { name: "1M" }));
    await expect(await canvas.findByRole("group", { name: /1 month price history/ }, chartWait)).toBeVisible();
    historyControl.release();
    await expect(canvasElement.querySelector('[data-layer-range="1Y"][data-layer-state="shown"]')).not.toBeInTheDocument();
  },
};
export const TouchScrub: Story = { args: { reducedMotion: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const chart = await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
  const box = chart.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  await fireEvent.pointerDown(chart, { pointerId: 10, pointerType: "touch", clientX: x, clientY: y });
  await expect(canvasElement.querySelector('[data-scrub-readout]')).not.toBeInTheDocument();
  await fireEvent.pointerMove(chart, { pointerId: 10, pointerType: "touch", clientX: x + 4, clientY: y });
  await expect(canvasElement.querySelector('[data-scrub-readout]')).not.toBeInTheDocument();
  await fireEvent.pointerMove(chart, { pointerId: 10, pointerType: "touch", clientX: x + 8, clientY: y });
  await expect(canvasElement.querySelector('[data-scrub-readout]')).toBeVisible();
  await fireEvent.pointerUp(chart, { pointerId: 10, pointerType: "touch", clientX: x + 8, clientY: y });
  await expect(canvasElement.querySelector('[data-scrub-readout]')).not.toBeInTheDocument();
  await fireEvent.pointerDown(chart, { pointerId: 11, pointerType: "touch", clientX: x, clientY: y });
  await fireEvent.pointerMove(chart, { pointerId: 11, pointerType: "touch", clientX: x + 2, clientY: y + 7 });
  await fireEvent.pointerMove(chart, { pointerId: 11, pointerType: "touch", clientX: x + 30, clientY: y + 7 });
  await expect(canvasElement.querySelector('[data-scrub-readout]')).not.toBeInTheDocument();
  await fireEvent.pointerUp(chart, { pointerId: 11, pointerType: "touch", clientX: x + 30, clientY: y + 7 });
} };
export const ScrubCursor: Story = { args: { reducedMotion: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chart = await canvas.findByRole("group", { name: /price history/ }, chartWait);
    chart.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    await expect(canvasElement.querySelector('[data-scrub-readout]')).toBeVisible();
    await waitFor(() => expect(canvasElement.querySelector("[data-scrub-cursor]")).toHaveStyle({ opacity: "1" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvasElement.querySelector("[data-scrub-cursor]")).toHaveStyle({ opacity: "0" }));
  },
};

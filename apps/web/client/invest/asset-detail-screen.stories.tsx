import { useLayoutEffect } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { PresentationQuoteProvider, PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { BASE_CHAIN_ID, investAssets, type InvestAsset } from "@/config/invest-assets";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import type { Holding } from "@/shared/balances/types";
import type { MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { formatPresentationDate, formatPresentationPrice, formatSignedPercentChange } from "@/shared/formatting";
import { AssetDetailScreen } from "./asset-detail-screen";

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
const priceById: Record<string, number> = {
  cbbtc: 122391.18, nvdac: 179.60, degen: 0.003812,
  [dynamicMeme.id]: 0.000004812,
};
function market(asset: InvestAsset, stale = false): MarketDataState {
  return stale ? { status: "error", message: "Price snapshot is stale." } : {
    status: "ready",
    snapshots: [{
      assetId: asset.id,
      displayPrice: `$${priceById[asset.id]}`,
      asOf: new Date(clock - 60000).toISOString(),
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
const historyControl: { calls: number; release: () => void; held: Promise<void> } = {
  calls: 0, release: () => {}, held: Promise.resolve(),
};
function resetHistoryControl() {
  historyControl.release();
  historyControl.calls = 0;
  historyControl.held = new Promise<void>((resolve) => { historyControl.release = resolve; });
}
function historyHandler(mode: "ready" | "empty" | "stale" | "slow" | "hold-year" | "retry" | "error" = "ready") {
  return http.get("/api/market-prices/history", async ({ request }) => {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId") ?? "cbbtc";
    const range = (url.searchParams.get("range") ?? "1W") as MarketPriceRange;
    historyControl.calls++;
    if (mode === "slow" || mode === "hold-year" && range === "1Y") await historyControl.held;
    if (mode === "error" || mode === "retry" && historyControl.calls === 1) {
      return HttpResponse.json({ error: "unavailable" }, { status: 500 });
    }
    return HttpResponse.json(historyResponse(
      assetId, range, mode === "empty"
        ? "empty" : mode === "stale" ? "stale" : "ready",
    ));
  });
}

type AssetKey = "cbbtc" | "nvdac" | "degen" | "dynamic";
type Position = "unheld" | "bitcoin" | "stock" | "error" | "blocked";
type StoryProps = { assetId: AssetKey; position: Position; localCurrency: boolean; staleMarket: boolean; reducedMotion: boolean };
const assets: Record<AssetKey, InvestAsset> = { cbbtc: crypto, nvdac: stock, degen: configuredMeme, dynamic: dynamicMeme };
const session = {
  user: { subject: "synthetic-asset-detail-owner" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const },
  accountProvider: "cdp-embedded" as const,
};
const motionQuery = "(prefers-reduced-motion: reduce)";
function forceReducedMotion() {
  const original = window.matchMedia;
  const forced: typeof window.matchMedia = (query) => query === motionQuery
    ? { matches: true, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true }
    : original.call(window, query);
  window.matchMedia = forced;
  return () => { window.matchMedia = original; };
}
function positionSnapshot(position: Position) {
  const snapshot = balancesSnapshot("US");
  return { ...snapshot, holdings: snapshot.holdings.map((holding): Holding => {
    if (holding.id === "cbbtc") return position === "bitcoin" ? {
      ...holding, balance: { status: "ready", baseUnits: "1234000" },
      value: { status: "priced", currency: "USD", amount: { atoms: "151030", scale: 2 }, asOf: new Date(clock).toISOString() },
    } : { ...holding, balance: { status: "ready", baseUnits: "0" } };
    if (holding.id === "nvdac") return position === "stock" ? {
      ...holding, balance: { status: "ready", baseUnits: "125000000" },
    } : { ...holding, balance: { status: "ready", baseUnits: "0" } };
    return holding;
  }) };
}
function statsHandler(mode: "ready" | "error" = "ready") {
  return http.get("/api/market-prices/stats", ({ request }) => {
    const assetId = new URL(request.url).searchParams.get("assetId") ?? "cbbtc";
    if (mode === "error") return HttpResponse.json({ error: "unavailable" }, { status: 500 });
    const meme = assetId === "degen" || assetId === dynamicMeme.id;
    return HttpResponse.json({ version: 1, provider: "codex", assetId, currency: "USD",
      fetchedAt: new Date(clock).toISOString(), status: assetId === "nvdac" ? "unavailable" : "ready",
      ...(assetId === "nvdac" ? { unavailableReason: "unsupported-asset" } : {}),
      stats: assetId === "nvdac" ? {} : {
        marketCapUsd: { atoms: meme ? "1200000" : "2410000000000", scale: 0 },
        volume24hUsd: { atoms: meme ? "382000" : "38200000000", scale: 0 },
        ...(meme ? { liquidityUsd: { atoms: "850000", scale: 0 } } : {}),
      },
    });
  });
}
function StoryHarness({ assetId, position, localCurrency, staleMarket, reducedMotion }: StoryProps) {
  useLayoutEffect(() => reducedMotion ? forceReducedMotion() : undefined, [reducedMotion]);
  const asset = assets[assetId];
  const blocked = createBlockedAccountWalletClient("unconfigured");
  const client = position === "blocked" ? blocked : { ...blocked, status: "verified" as const,
    verification: "server" as const, session,
    fetchBalances: async () => {
      if (position === "error") throw new globalThis.Error("Balances unavailable");
      return positionSnapshot(position);
    },
  };
  return <AccountWalletClientProvider client={client}>
    <PresentationRegionProvider regionId="US"><PresentationQuoteProvider value={{ regionId: "US",
      valueCurrency: localCurrency ? "EUR" : "USD",
      quoteUnitsPerUsd: localCurrency ? { atoms: "92", scale: 2 } : { atoms: "1", scale: 0 },
    }}><MoneyMotionProvider reducedMotion={reducedMotion}>
      <main className="min-h-screen bg-background"><AssetDetailScreen asset={asset}
        market={market(asset, staleMarket)} onBack={fn()} /></main>
    </MoneyMotionProvider></PresentationQuoteProvider></PresentationRegionProvider>
  </AccountWalletClientProvider>;
}
const meta = {
  id: "invest-asset-detail", title: "Invest/Asset detail", component: StoryHarness,
  args: { assetId: "cbbtc", position: "unheld", localCurrency: false, staleMarket: false, reducedMotion: true },
  beforeEach: () => {
    getHomeQueryClient().clear();
    resetHistoryControl();
    return () => { historyControl.release(); getHomeQueryClient().clear(); };
  },
  parameters: {
    layout: "fullscreen", a11y: { test: "error" },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=422-4404" },
    msw: { handlers: [historyHandler(), statsHandler()] },
    viewport: { defaultViewport: "mobile", viewports: {
      mobile: { name: "Phone 390", styles: { width: "390px", height: "844px" } },
      narrow: { name: "Phone 320", styles: { width: "320px", height: "700px" } },
      wide: { name: "Desktop 1440", styles: { width: "1440px", height: "900px" } },
    } },
  },
} satisfies Meta<typeof StoryHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Crypto: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole("group", { name: "1 week price history, 168 points" }, chartWait)).toBeVisible();
  await expect(await canvas.findByText(/\+4\.\d+% · past week/, undefined, chartWait)).toBeVisible();
  await expect(canvas.queryByText("Your balance")).not.toBeInTheDocument();
  await expect(await canvas.findByText("$2.41T")).toBeVisible();
  await expect(canvas.getByText("$38.2B")).toBeVisible();
  await expect(canvas.getByText("Market cap")).toBeVisible();
  await expect(canvas.getByText("24h volume")).toBeVisible();
} };
export const BitcoinHeld: Story = { args: { position: "bitcoin" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("$1,510.30", undefined, chartWait)).toBeVisible();
  await expect(canvas.getByText("0.01234 cbBTC")).toBeVisible();
} };
export const Stock: Story = { args: { assetId: "nvdac" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
  await expect(canvas.queryByText("Market cap")).not.toBeInTheDocument();
  await expect(canvas.getByRole("status", { name: "NVIDIA trading" })).toBeVisible();
} };
export const Meme: Story = { args: { assetId: "dynamic" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("Liquidity", undefined, chartWait)).toBeVisible();
  await expect(canvas.getByText("$1.2M")).toBeVisible();
  await expect(canvas.getByText("$850K")).toBeVisible();
} };
export const StockHeld: Story = { args: { assetId: "nvdac", position: "stock" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("1.25 NVDAc", undefined, chartWait)).toBeVisible();
  await expect(canvas.getByText("Value unavailable")).toBeVisible();
  await expect(within(canvas.getByText("Your balance").closest("li")!).getByText("—")).toBeVisible();
} };
export const Desktop: Story = { parameters: { viewport: { defaultViewport: "wide" } } };
export const Narrow: Story = { parameters: { viewport: { defaultViewport: "narrow" } }, play: async ({ canvasElement }) => {
  await expect(await within(canvasElement).findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
} };
export const LocalCurrency: Story = { args: { localCurrency: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText(/\+4\.\d+% in USD · past week/, undefined, chartWait)).toBeVisible();
  await expect(canvas.getByRole("region", { name: "Stats · USD" })).toBeVisible();
} };
export const Dark: Story = { globals: { theme: "dark" } };
export const SignedOut: Story = { args: { position: "blocked" }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).queryByText("Your balance")).not.toBeInTheDocument();
} };
export const BalanceUnavailable: Story = { args: { position: "error" }, play: async ({ canvasElement }) => {
  await expect(await within(canvasElement).findByText("Balance unavailable", undefined, chartWait)).toBeVisible();
} };
export const StatsUnavailable: Story = { parameters: { msw: { handlers: [historyHandler(), statsHandler("error")] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
    await expect(canvas.queryByText("Market cap")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Liquidity")).not.toBeInTheDocument();
    await expect(await canvas.findByRole("region", { name: "Stats" }, chartWait)).toBeVisible();
  },
};
export const Empty: Story = { parameters: { msw: { handlers: [historyHandler("empty"), statsHandler()] } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("status", { name: "No price history for this range." }, chartWait)).toBeVisible();
  },
};
export const Stale: Story = { args: { staleMarket: true },
  parameters: { msw: { handlers: [historyHandler("stale"), statsHandler()] } }, play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/^No data since /, undefined, chartWait)).toBeVisible();
    await expect(canvas.getByRole("group", { name: /no data since/i })).toBeVisible();
    await expect(canvas.getByText("Price snapshot is stale.")).toBeVisible();
  },
};
export const SlowHeld: Story = { tags: ["!test"],
  parameters: { msw: { handlers: [historyHandler("slow"), statsHandler()] } },
};
export const Slow: Story = { parameters: { msw: { handlers: [historyHandler("slow"), statsHandler()] } },
  play: async ({ canvasElement }) => {
    try { await expect(await within(canvasElement).findByText("Still loading price history", undefined, { timeout: 4000 })).toBeVisible(); }
    finally { historyControl.release(); }
    await expect(await within(canvasElement).findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
  },
};
export const Error: Story = { parameters: { msw: { handlers: [historyHandler("error"), statsHandler()] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("status", { name: "Couldn't load price history" }, chartWait)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeVisible();
  },
};
export const ErrorRetry: Story = { parameters: { msw: { handlers: [historyHandler("retry"), statsHandler()] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Try again" }, chartWait));
    await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
  },
};
export const KeyboardScrub: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const chart = await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
  await waitFor(() => expect(canvasElement.querySelectorAll('[data-layer-state="ready"]').length).toBe(4), chartWait);
  chart.focus();
  await expect(chart).toHaveFocus();
  await userEvent.keyboard("{End}");
  const point = historyResponse("cbbtc", "1W").points.at(-1)!;
  const time = formatPresentationDate(Date.parse(point.time), { regionId: "US", style: "activity-short" });
  await waitFor(() => expect(canvasElement.querySelector("[data-scrub-readout]")?.textContent).toBe(time), chartWait);
  const value = formatPresentationPrice(point.value, "USD", "US");
  await expect(canvas.getByText(value!)).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(canvasElement.querySelector("[data-scrub-readout]")).not.toBeInTheDocument());
} };
export const TouchScrub: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const chart = await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
  const box = chart.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  await fireEvent.pointerDown(chart, { pointerId: 10, pointerType: "touch", clientX: x, clientY: y });
  await fireEvent.pointerMove(chart, { pointerId: 10, pointerType: "touch", clientX: x + 8, clientY: y });
  await expect(canvasElement.querySelector("[data-scrub-readout]")).toBeVisible();
  await fireEvent.pointerUp(chart, { pointerId: 10, pointerType: "touch", clientX: x + 8, clientY: y });
  await expect(canvasElement.querySelector("[data-scrub-readout]")).not.toBeInTheDocument();
  await fireEvent.pointerMove(chart, { pointerType: "mouse", clientX: x, clientY: y });
  await expect(canvasElement.querySelector("[data-scrub-readout]")).toBeVisible();
  await fireEvent.pointerUp(chart, { pointerType: "mouse", clientX: x, clientY: y });
  await expect(canvasElement.querySelector("[data-scrub-readout]")).not.toBeInTheDocument();
} };
export const RapidRange: Story = { parameters: { msw: { handlers: [historyHandler("hold-year"), statsHandler()] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
    await userEvent.click(canvas.getByRole("button", { name: "1D" }));
    await expect(await canvas.findByText(/% · past day/, undefined, chartWait)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "1Y" }));
    await expect(canvas.queryByText(/% · past day/)).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "1W" }));
    await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
    await expect(canvas.queryByText(/% · past year/)).not.toBeInTheDocument();
    historyControl.release();
    await waitFor(() => expect(canvas.queryByText(/% · past year/)).not.toBeInTheDocument(), chartWait);
    await expect(canvasElement.querySelector('[data-layer-range="1Y"][data-layer-state="shown"]')).not.toBeInTheDocument();
  },
};
export const RangeBack: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
  await userEvent.click(canvas.getByRole("button", { name: "1D" }));
  await expect(await canvas.findByRole("group", { name: /1 day price history/ }, chartWait)).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "1W" }));
  await expect(await canvas.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
} };
export const ReducedMotion: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
  const bar = canvasElement.querySelector<HTMLElement>('[data-state="shown"]');
  await expect(bar).toBeInTheDocument();
  await expect(bar).toHaveStyle({ transition: "none" });
} };
export const TradeBarScroll: Story = { args: { reducedMotion: false },
  render: (args) => <div className="h-140 overflow-y-auto" data-scroll-viewport><StoryHarness {...args} /></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvasElement.querySelector<HTMLElement>('[data-state="shown"]')!;
    const viewport = canvasElement.querySelector<HTMLElement>("[data-scroll-viewport]")!;
    await canvas.findByRole("group", { name: /1 week price history/ }, chartWait);
    const scrollTo = (top: number) => { viewport.scrollTop = top; viewport.dispatchEvent(new Event("scroll")); };
    scrollTo(120);
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "hidden"), chartWait);
    viewport.dispatchEvent(new Event("scrollend"));
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "shown"), chartWait);
    scrollTo(260);
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "hidden"), chartWait);
    scrollTo(240);
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "shown"), chartWait);
  },
};

import { useLayoutEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within, type queries } from "storybook/test";
import { http, HttpResponse } from "msw";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { AssetDetailScreen } from "@/client/invest/asset-detail-screen";
import { DiscoverAssetRow } from "@/client/invest/discover-asset-row";
import { PresentationQuoteProvider, PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { BalanceRow } from "@/components/finance-rows";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { Input } from "@/components/ui/input";
import { pinClock } from "@/tests/helpers/pin-clock";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { AssetSheetProposal } from "./asset-sheet";
import { bitcoin, longNameBitcoin, stock, TIME, createClient, forceReducedMotion, historyControl, historyResponse, market, resetHistoryControl, type Position } from "./asset-sheet.fixtures";

function historyHandler(mode: "ready" | "empty" | "stale" | "partial" | "slow" | "error" = "ready") {
  return http.get("/api/market-prices/history", async ({ request }) => {
    const url = new URL(request.url);
    if (mode === "slow") await historyControl.held;
    if (mode === "error") return HttpResponse.json({ error: "Unavailable" }, { status: 503 });
    const range = url.searchParams.get("range") ?? "1W";
    if (range !== "1D" && range !== "1W" && range !== "1M" && range !== "3M" && range !== "1Y") {
      return HttpResponse.json({ error: "Invalid range" }, { status: 400 });
    }
    return HttpResponse.json(historyResponse(url.searchParams.get("assetId") ?? "cbbtc", range, mode === "slow" ? "ready" : mode));
  });
}
function statsHandler() {
  return http.get("/api/market-prices/stats", ({ request }) => {
    const assetId = new URL(request.url).searchParams.get("assetId") ?? "cbbtc";
    return HttpResponse.json({ version: 1, provider: "codex", assetId, currency: "USD", fetchedAt: new Date(Date.parse(TIME) - 60000).toISOString(),
      status: assetId === "nvdac" ? "unavailable" : "ready", ...(assetId === "nvdac" ? { unavailableReason: "unsupported-asset" } : {}),
      stats: assetId === "nvdac" ? {} : { marketCapUsd: { atoms: "2410000000000", scale: 0 }, volume24hUsd: { atoms: "38200000000", scale: 0 } },
    });
  });
}

type Props = {
  surface: "sheet" | "page" | "rows" | "holdings";
  position: Position;
  stale: boolean;
  loading: boolean;
  details: "body" | "header";
  assetId: "cbbtc" | "nvdac";
  stockSession: "open" | "closed";
  reducedMotion: boolean;
  largeText: boolean;
  longName: boolean;
  rtl: boolean;
};

function FocusedAssetPage(props: Parameters<typeof AssetDetailScreen>[0]) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = container.current?.ownerDocument.body;
    if (!body) return;
    let frame = 0;
    const focusWhenClosed = () => {
      if (body.querySelector('[role="dialog"]')) return;
      observer.disconnect();
      frame = requestAnimationFrame(() => container.current?.querySelector<HTMLButtonElement>('button[aria-label="Back"]')?.focus({ preventScroll: true }));
    };
    const observer = new MutationObserver(focusWhenClosed);
    observer.observe(body, { childList: true, subtree: true });
    focusWhenClosed();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <div ref={container}><AssetDetailScreen {...props} /></div>;
}

function RowJourney({ holdingPage }: { holdingPage: boolean }) {
  const [page, setPage] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const discoverList = useRef<HTMLUListElement>(null);
  const open = (element: HTMLElement, directPage = false) => {
    setOpener(element);
    if (directPage) setPage(true);
    else setSheetOpen(true);
  };
  const back = () => {
    setPage(false);
    queueMicrotask(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  };
  return <>
    <section hidden={page} className="mx-auto max-w-2xl space-y-4 p-4" aria-label="Asset rows">
      <h1 className="text-xl font-semibold">Invest</h1>
      <Input aria-label="Search assets" placeholder="Search assets" value={search} onChange={(event) => setSearch(event.target.value)} />
      <section aria-label={search ? "Search" : "Discover"}><h2 className="text-lg font-semibold">{search ? "Search" : "Discover"}</h2>
        <ul ref={discoverList}><DiscoverAssetRow asset={bitcoin} market={market()} onOpen={() => {
          const element = discoverList.current?.querySelector("button");
          if (element) open(element);
        }} /></ul>
      </section>
      <section aria-label="Holdings"><h2 className="text-lg font-semibold">Holdings</h2>
        <ul><BalanceRow icon="↗" label="Bitcoin holding" context="0.01234 cbBTC" value="$1,510.30"
          onActivate={(element) => open(element, holdingPage)} activateLabel="View Bitcoin holding" /></ul>
      </section>
    </section>
    {page ? <FocusedAssetPage asset={bitcoin} market={market()} onBack={back} /> : null}
    <AssetSheetProposal asset={bitcoin} market={market()} open={sheetOpen} opener={opener}
      onClose={() => setSheetOpen(false)} onViewDetails={() => { setSheetOpen(false); setPage(true); }} />
  </>;
}

function StoryHarness({ surface, position, stale, loading, details, assetId, stockSession, reducedMotion, largeText, longName, rtl }: Props) {
  const [open, setOpen] = useState(true);
  const [viewPage, setViewPage] = useState(surface === "page");
  useLayoutEffect(() => reducedMotion ? forceReducedMotion() : undefined, [reducedMotion]);
  useLayoutEffect(() => {
    if (!largeText) return;
    const original = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => { document.documentElement.style.fontSize = original; };
  }, [largeText]);
  useLayoutEffect(() => {
    if (!rtl) return;
    const original = document.documentElement.getAttribute("dir");
    document.documentElement.setAttribute("dir", "rtl");
    return () => {
      if (original === null) document.documentElement.removeAttribute("dir");
      else document.documentElement.setAttribute("dir", original);
    };
  }, [rtl]);
  const asset = assetId === "nvdac" ? stock : longName ? longNameBitcoin : bitcoin;
  const client = createClient(position, asset, stockSession);
  const data = loading ? { status: "loading" as const } : market(asset, stale, stockSession);
  return <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US">
    <PresentationQuoteProvider value={{ regionId: "US", valueCurrency: "USD", quoteUnitsPerUsd: { atoms: "1", scale: 0 } }}>
      <MoneyMotionProvider reducedMotion={reducedMotion}>
        <main className="min-h-screen bg-background">
          {surface === "rows" || surface === "holdings" ? <RowJourney holdingPage={surface === "holdings"} />
            : viewPage ? <FocusedAssetPage asset={asset} market={data} onBack={() => { setViewPage(false); setOpen(true); }} />
              : <AssetSheetProposal asset={asset} market={data} open={open} details={details}
                onClose={() => setOpen(false)} onViewDetails={() => { setOpen(false); setViewPage(true); }} />}
        </main>
      </MoneyMotionProvider>
    </PresentationQuoteProvider>
  </PresentationRegionProvider></AccountWalletClientProvider>;
}

const meta = {
  id: "invest-asset-sheet", title: "Invest/Explorations/Asset sheet", component: StoryHarness, tags: ["exploration"],
  args: { surface: "sheet", position: "owned", stale: false, loading: false, details: "body", assetId: "cbbtc",
    stockSession: "open", reducedMotion: false, largeText: false, longName: false, rtl: false },
  beforeEach: () => {
    getHomeQueryClient().clear();
    resetHistoryControl();
    const restoreClock = pinClock(TIME);
    return () => { historyControl.release(); getHomeQueryClient().clear(); restoreClock(); };
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" }, msw: { handlers: [historyHandler(), statsHandler()] },
    viewport: { defaultViewport: "mobile", viewports: {
      mobile: { name: "Phone 390", styles: { width: "390px", height: "844px" } },
      narrow: { name: "Phone 320", styles: { width: "320px", height: "700px" } },
      wide: { name: "Desktop 1440", styles: { width: "1440px", height: "900px" } },
    } },
  },
} satisfies Meta<typeof StoryHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
const chartWait = { timeout: 5000 };

const assertSurface: NonNullable<Story["play"]> = async ({ args, canvasElement }) => {
  const screen = within(canvasElement.ownerDocument.body);
  const asset = args.assetId === "nvdac" ? stock : args.longName ? longNameBitcoin : bitcoin;
  const content = args.surface === "page" ? within(await screen.findByRole("region", { name: asset.displayName }, chartWait))
    : within(await screen.findByRole("dialog", { name: asset.displayName }, chartWait));
  if (args.loading) {
    await expect(content.queryByText("$122,391.18")).not.toBeInTheDocument();
    await expect(await content.findByRole("status", { name: "Loading price history" }, chartWait)).toBeVisible();
  } else if (args.stale) {
    await expect(await content.findByText(/^No data since /, undefined, chartWait)).toBeVisible();
    await expect(content.getByText("Price snapshot is stale.")).toBeVisible();
  } else {
    await expect(await content.findByRole("group", { name: args.surface === "page" ? /1 week price history/ : /1 day price history/ }, chartWait)).toBeVisible();
    await expect(content.getByRole("img", { name: args.assetId === "nvdac" ? "$179.60" : "$122,391.18" })).toBeVisible();
  }
  if (args.position === "owned") {
    await expect(await content.findByText("Your balance", undefined, chartWait)).toBeVisible();
    await expect(content.getByText(args.assetId === "nvdac" ? "1.25 NVDAc" : "0.01234 cbBTC")).toBeVisible();
    await expect(content.getByText(args.assetId === "nvdac" ? "$224.50" : "$1,510.30")).toBeVisible();
  } else if (args.position === "error") {
    await expect(await content.findByText("Balance unavailable", undefined, chartWait)).toBeVisible();
  } else {
    await waitForReady(() => expect(content.queryByRole("list", { name: "Your balance" })).not.toBeInTheDocument());
    await expect(content.queryByText("Your balance")).not.toBeInTheDocument();
  }
  if (args.assetId === "nvdac") {
    await expect(content.getByRole("status", { name: "NVIDIA trading" })).toBeVisible();
    await expect(content.getAllByText(/^Last close/)).toHaveLength(2);
  } else {
    const buy = content.getByRole("button", { name: "Buy" });
    const sell = content.getByRole("button", { name: "Sell" });
    await expect(buy).toBeVisible();
    await expect(sell).toBeVisible();
    if (args.position === "blocked" || args.position === "error") await waitForReady(() => expect(buy).toBeDisabled());
    else await waitForReady(() => expect(buy).toBeEnabled());
    if (args.position === "owned") await waitForReady(() => expect(sell).toBeEnabled());
    else await expect(sell).toBeDisabled();
  }
  if (args.surface !== "page") {
    await expect(content.getByRole(args.details === "header" ? "link" : "button", { name: `View ${asset.displayName} details` })).toBeVisible();
    await expect(content.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(content.queryByText(/market price|reference price|Last observed/)).not.toBeInTheDocument();
    await expect(content.queryByText("Market cap")).not.toBeInTheDocument();
    await expect(content.queryByText("About")).not.toBeInTheDocument();
    await expect(content.queryByRole("group", { name: "Price range" })).not.toBeInTheDocument();
    await expect(content.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  }
};

const viewDetailsAndBack: NonNullable<Story["play"]> = async ({ args, canvasElement }) => {
  const screen = within(canvasElement.ownerDocument.body);
  const dialog = within(await screen.findByRole("dialog", { name: "Bitcoin" }, chartWait));
  await userEvent.click(dialog.getByRole(args.details === "header" ? "link" : "button", { name: "View Bitcoin details" }));
  await waitForReady(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const page = within(await screen.findByRole("region", { name: "Bitcoin" }, chartWait));
  const back = page.getByRole("button", { name: "Back" });
  await waitForReady(() => expect(back).toHaveFocus());
  await userEvent.click(back);
  await expect(await screen.findByRole("dialog", { name: "Bitcoin" }, chartWait)).toBeVisible();
};

export const OwnedMobile: Story = { play: async (context) => {
  await assertSurface(context);
  const dialogElement = await within(context.canvasElement.ownerDocument.body).findByRole("dialog", { name: "Bitcoin" }, chartWait);
  const dialog = within(dialogElement);
  const chart = await dialog.findByRole("group", { name: /1 day price history/ }, chartWait);
  await waitForReady(() => expect(dialogElement.querySelectorAll('[data-sparkline-state="shown"]').length).toBe(1));
  chart.focus();
  await userEvent.keyboard("{End}");
  await waitForReady(() => expect(dialogElement.querySelector("[data-scrub-readout]")).toBeVisible());
  await userEvent.tab();
  await waitForReady(() => expect(dialogElement.querySelector("[data-scrub-readout]")).not.toBeInTheDocument());
  await expect(await dialog.findByText(/% · past day/, undefined, chartWait)).toBeVisible();
  const details = dialog.getByRole("button", { name: "View Bitcoin details" }).getBoundingClientRect();
  const buy = dialog.getByRole("button", { name: "Buy" }).getBoundingClientRect();
  await expect(Math.round(buy.top - details.bottom)).toBe(16);
  await viewDetailsAndBack(context);
} };
export const OwnedDesktop: Story = { parameters: { viewport: { defaultViewport: "wide" } }, play: async (context) => {
  await assertSurface(context);
  await viewDetailsAndBack(context);
} };
export const UnownedMobile: Story = { args: { position: "unowned" }, play: assertSurface };
export const UnownedDesktop: Story = { args: { position: "unowned" }, parameters: { viewport: { defaultViewport: "wide" } }, play: assertSurface };
export const StaleMobile: Story = { args: { stale: true }, parameters: { msw: { handlers: [historyHandler("stale"), statsHandler()] } }, play: assertSurface };
export const StaleDesktop: Story = { args: { stale: true }, parameters: { msw: { handlers: [historyHandler("stale"), statsHandler()] }, viewport: { defaultViewport: "wide" } }, play: assertSurface };
export const PageOwnedMobile: Story = { args: { surface: "page" }, play: assertSurface };
export const PageOwnedDesktop: Story = { args: { surface: "page" }, parameters: { viewport: { defaultViewport: "wide" } }, play: assertSurface };
export const PageUnownedMobile: Story = { args: { surface: "page", position: "unowned" }, play: assertSurface };
export const PageUnownedDesktop: Story = { args: { surface: "page", position: "unowned" }, parameters: { viewport: { defaultViewport: "wide" } }, play: assertSurface };
export const PageStaleMobile: Story = { args: { surface: "page", stale: true }, parameters: { msw: { handlers: [historyHandler("stale"), statsHandler()] } }, play: assertSurface };
export const PageStaleDesktop: Story = { args: { surface: "page", stale: true }, parameters: { msw: { handlers: [historyHandler("stale"), statsHandler()] }, viewport: { defaultViewport: "wide" } }, play: assertSurface };
export const HeaderLinkMobile: Story = { args: { details: "header" }, play: async (context) => {
  await assertSurface(context);
  await viewDetailsAndBack(context);
} };
export const HeaderLinkDesktop: Story = { args: { details: "header" }, parameters: { viewport: { defaultViewport: "wide" } }, play: async (context) => {
  await assertSurface(context);
  await viewDetailsAndBack(context);
} };
export const Loading: Story = { args: { loading: true }, parameters: { msw: { handlers: [historyHandler("slow"), statsHandler()] } }, play: assertSurface };
export const BalanceUnavailable: Story = { args: { position: "error" }, play: assertSurface };
export const SignedOut: Story = { args: { position: "blocked" }, play: assertSurface };
export const EmptyHistory: Story = { parameters: { msw: { handlers: [historyHandler("empty"), statsHandler()] } },
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Bitcoin" }, chartWait));
    await expect(await dialog.findByRole("status", { name: "No price history for the past day." }, chartWait)).toBeVisible();
    await expect(dialog.getByRole("img", { name: "$122,391.18" })).toBeVisible();
    await expect(await dialog.findByText("Your balance", undefined, chartWait)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Buy" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Sell" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "View Bitcoin details" })).toBeVisible();
  },
};
export const HistoryFailed: Story = { parameters: { msw: { handlers: [historyHandler("error"), statsHandler()] } },
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Bitcoin" }, chartWait));
    await expect(await dialog.findByRole("status", { name: "Couldn't load price history" }, { timeout: 15000 })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(dialog.getByRole("img", { name: "$122,391.18" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Buy" })).toBeVisible();
  },
};
export const StockLastClose: Story = { args: { assetId: "nvdac", stockSession: "closed" }, play: async (context) => {
  await assertSurface(context);
  const dialog = within(await within(context.canvasElement.ownerDocument.body).findByRole("dialog", { name: stock.displayName }, chartWait));
  await expect(dialog.queryByText(/Partial coverage/)).not.toBeInTheDocument();
  await expect(context.canvasElement.ownerDocument.querySelectorAll("[data-coverage-gap]")).toHaveLength(0);
} };
export const PartialCoverage: Story = { args: { assetId: "nvdac", stockSession: "closed" },
  parameters: { msw: { handlers: [historyHandler("partial"), statsHandler()] } }, play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    const dialog = within(await within(body).findByRole("dialog", { name: stock.displayName }, chartWait));
    await expect(await dialog.findByRole("group", { name: /1 day price history/ }, chartWait)).toBeVisible();
    await expect(dialog.getByText("Partial coverage · 26 of 32 samples")).toBeVisible();
    await expect(body.querySelectorAll("[data-coverage-gap]")).toHaveLength(1);
  } };
export const SlowHistory: Story = { parameters: { msw: { handlers: [historyHandler("slow"), statsHandler()] } },
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Bitcoin" }, chartWait));
    await expect(dialog.queryByText("Still loading price history")).not.toBeInTheDocument();
    try { await expect(await dialog.findByText("Still loading price history", undefined, chartWait)).toBeVisible(); }
    finally { historyControl.release(); }
    await expect(await dialog.findByRole("group", { name: /1 day price history/ }, chartWait)).toBeVisible();
    await expect(dialog.queryByText("Still loading price history")).not.toBeInTheDocument();
  } };
export const Narrow320: Story = { parameters: { viewport: { defaultViewport: "narrow" } }, play: assertSurface };
export const LongName: Story = { args: { longName: true }, play: assertSurface };
export const LongNameHeaderLink: Story = { args: { longName: true, details: "header" }, play: assertSurface };
export const LargeText: Story = { args: { largeText: true }, play: assertSurface };
export const Rtl: Story = { args: { rtl: true }, play: assertSurface };
export const Dark: Story = { globals: { theme: "dark" }, play: assertSurface };
export const ReducedMotion: Story = { args: { reducedMotion: true }, play: assertSurface };

async function openSheetAndReturn(screen: ReturnType<typeof within<typeof queries>>, opener: HTMLElement, keyboard = false) {
  if (keyboard) { opener.focus(); await userEvent.keyboard("{Enter}"); }
  else await userEvent.click(opener);
  const dialog = within(await screen.findByRole("dialog", { name: "Bitcoin" }, chartWait));
  await expect(await dialog.findByRole("group", { name: /1 day price history/ }, chartWait)).toBeVisible();
  await expect(await dialog.findByText("0.01234 cbBTC", undefined, chartWait)).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await waitForReady(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitForReady(() => expect(opener).toHaveFocus());
  await userEvent.click(opener);
  const reopened = within(await screen.findByRole("dialog", { name: "Bitcoin" }, chartWait));
  await userEvent.click(reopened.getByRole("button", { name: "View Bitcoin details" }));
  await waitForReady(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const page = within(await screen.findByRole("region", { name: "Bitcoin" }, chartWait));
  await expect(await page.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
  const back = page.getByRole("button", { name: "Back" });
  await waitForReady(() => expect(back).toHaveFocus());
  await userEvent.click(back);
  await waitForReady(() => expect(opener).toHaveFocus());
  await userEvent.click(opener);
  const finalDialog = within(await screen.findByRole("dialog", { name: "Bitcoin" }, chartWait));
  await userEvent.click(finalDialog.getByRole("button", { name: "Close" }));
  await waitForReady(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitForReady(() => expect(opener).toHaveFocus());
}
export const RowsOpenSheet: Story = { name: "R1: every asset row opens the sheet", args: { surface: "rows", reducedMotion: true },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await openSheetAndReturn(screen, within(screen.getByRole("region", { name: "Discover" })).getByRole("button", { name: /Bitcoin/ }));
    await openSheetAndReturn(screen, within(screen.getByRole("region", { name: "Holdings" })).getByRole("button", { name: /Bitcoin holding/ }), true);
    await userEvent.type(screen.getByRole("textbox", { name: "Search assets" }), "Bitcoin");
    await openSheetAndReturn(screen, within(screen.getByRole("region", { name: "Search" })).getByRole("button", { name: /Bitcoin/ }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Search assets" }));
    await userEvent.click(within(screen.getByRole("region", { name: "Holdings" })).getByRole("button", { name: /Bitcoin holding/ }));
    await expect(await screen.findByRole("dialog", { name: "Bitcoin" }, chartWait)).toBeVisible();
  },
};
export const HoldingsOpenPage: Story = { name: "R2: Discover/search rows open the sheet, holding rows open the full page", args: { surface: "holdings", reducedMotion: true },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await openSheetAndReturn(screen, within(screen.getByRole("region", { name: "Discover" })).getByRole("button", { name: /Bitcoin/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search assets" }), "Bitcoin");
    await openSheetAndReturn(screen, within(screen.getByRole("region", { name: "Search" })).getByRole("button", { name: /Bitcoin/ }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Search assets" }));
    const holding = within(screen.getByRole("region", { name: "Holdings" })).getByRole("button", { name: /Bitcoin holding/ });
    holding.focus();
    await userEvent.keyboard("{Enter}");
    const page = within(await screen.findByRole("region", { name: "Bitcoin" }, chartWait));
    await expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(await page.findByRole("group", { name: /1 week price history/ }, chartWait)).toBeVisible();
    await expect(await page.findByText("0.01234 cbBTC", undefined, chartWait)).toBeVisible();
    const back = page.getByRole("button", { name: "Back" });
    await waitForReady(() => expect(back).toHaveFocus());
    await userEvent.click(back);
    await waitForReady(() => expect(holding).toHaveFocus());
    await userEvent.click(holding);
    await expect(await screen.findByRole("region", { name: "Bitcoin" }, chartWait)).toBeVisible();
    await expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence } from "motion/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { AssetSearch } from "@/client/invest/asset-search";
import { AssetDetailScreen } from "@/client/invest/asset-detail-screen";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { getHomeQueryClient } from "@/client/query/query-client";
import { parseInvestSearchResponse } from "@/shared/invest/contracts/search";
import { unavailableMarketData } from "@/shared/invest/invest-market";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";

function InvestSearchJourney() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const asset = parseInvestSearchResponse(searchFixture("ORB"))?.results.find(({ asset }) => asset.id === detail)?.asset;
  const openSearch = () => { flushSync(() => setOpen(true)); inputRef.current?.focus({ preventScroll: true }); };
  return <main className="min-h-dvh bg-muted">
    {asset ? <AssetDetailScreen asset={asset} market={unavailableMarketData} onBack={() => setDetail(null)} /> : null}
    <AnimatePresence key={detail ?? "search-origin"}>
      {!asset && open ? <AssetSearch key="search" initialQuery={query} onInputReady={(input) => { inputRef.current = input; }} onQueryCommit={setQuery}
        onClose={() => { flushSync(() => { setOpen(false); setQuery(""); }); document.querySelector<HTMLElement>("[data-shell-search-opener]")?.focus({ preventScroll: true }); }}
        onOpenAsset={(assetId, value, scrollTop) => { window.history.replaceState({ ...window.history.state, assetSearchScrollTop: scrollTop, assetSearchResult: assetId }, ""); setQuery(value); setDetail(assetId); }} /> : null}
    </AnimatePresence>
    {!asset && !open ? <><PrimaryNavigation layout="rail" activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} />
        <PrimaryNavigation activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} /></> : null}
  </main>;
}
const meta = {
  title: "Journeys/Invest Search", component: InvestSearchJourney,
  beforeEach: () => { window.history.replaceState(null, "", window.location.href); getHomeQueryClient().clear(); },
  parameters: { layout: "fullscreen", msw: { handlers: [
    http.get("/api/invest/search", ({ request }) => { const query = new URL(request.url).searchParams.get("q") ?? ""; return query === "unavailable" ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(searchFixture(query)); }),
    http.get("/api/market-prices/history", () => HttpResponse.json({ version: 1, provider: "codex", assetId: "base:0x1111111111111111111111111111111111111111", range: "1W", currency: "USD", fetchedAt: null, status: "empty", points: [] })),
  ] } },
} satisfies Meta<typeof InvestSearchJourney>;
export default meta;
type Story = StoryObj<typeof meta>;
async function openSearch(canvasElement: HTMLElement) {
  const screen = within(canvasElement.ownerDocument.body);
  const opener = screen.queryByRole("button", { name: "Search assets" });
  if (opener) await userEvent.click(opener);
  const input = screen.getByRole("textbox", { name: "Search assets" });
  await userEvent.clear(input);
  await userEvent.click(input);
  await expect(input).toHaveFocus();
  return { screen, input };
}
export const Journey: Story = { play: async ({ canvasElement }) => {
  const { screen, input } = await openSearch(canvasElement);
  await userEvent.type(input, "ORB");
  await userEvent.click((await screen.findAllByRole("button", { name: /Orbit/ }))[0]!);
  await expect(await screen.findByRole("heading", { name: "Orbit" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await expect(await screen.findByRole("textbox", { name: "Search assets" })).toHaveValue("ORB");
  await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await expect(screen.queryByRole("region", { name: "Search results" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close search" }));
  await expect(screen.getByRole("button", { name: "Search assets" })).toHaveFocus();
} };
export const Empty: Story = { play: async ({ canvasElement }) => { const { screen } = await openSearch(canvasElement); await expect(screen.queryByRole("region", { name: "Search results" })).not.toBeInTheDocument(); } };
export const NoResults: Story = { play: async ({ canvasElement }) => { const { screen, input } = await openSearch(canvasElement); await userEvent.type(input, "nothing-found"); await expect(await screen.findByText("No assets found for “nothing-found”.")).toBeVisible(); } };
export const Error: Story = { play: async ({ canvasElement }) => { const { screen, input } = await openSearch(canvasElement); await userEvent.type(input, "unavailable"); await expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible(); } };
export const Partial: Story = { play: async ({ canvasElement }) => { const { screen, input } = await openSearch(canvasElement); await userEvent.type(input, "partial"); await expect(await screen.findByText("Some results couldn’t load.")).toBeVisible(); } };
export const MobileKeyboard: Story = { parameters: { viewport: { defaultViewport: "mobile" } }, play: async ({ canvasElement }) => { const { screen, input } = await openSearch(canvasElement); await userEvent.type(input, "ORB"); await screen.findAllByRole("button", { name: /Orbit/ }); await expect(input).toHaveFocus(); } };

async function transitionJourney(canvasElement: HTMLElement) {
  const { screen, input } = await openSearch(canvasElement);
  await userEvent.type(input, "ORB");
  await screen.findAllByRole("button", { name: /Orbit/ });
  await userEvent.click(screen.getByRole("button", { name: "Close search" }));
  const opener = screen.getByRole("button", { name: "Search assets" });
  await expect(opener).toHaveFocus();
  await userEvent.click(opener);
  const reopened = screen.getByRole("textbox", { name: "Search assets" });
  await expect(reopened).toHaveFocus();
  await expect(reopened).toHaveValue("");
  await userEvent.type(reopened, "BTC");
  await screen.findByRole("button", { name: /Bitcoin/ });
}
export const OpenCloseReopen: Story = { play: async ({ canvasElement }) => transitionJourney(canvasElement) };
export const ReducedMotion: Story = {
  beforeEach: () => {
    const original = window.matchMedia;
    window.matchMedia = (query: string) => {
      if (query !== "(prefers-reduced-motion: reduce)") return original.call(window, query);
      const noop = () => {};
      return { matches: true, media: query, onchange: null, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop, dispatchEvent: () => false } satisfies MediaQueryList;
    };
    return () => { window.matchMedia = original; };
  },
  play: async ({ canvasElement }) => transitionJourney(canvasElement),
};

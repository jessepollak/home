import { useEffect, useRef, useState } from "react";
import { ShellSearchInert, ShellSearchProvider, ShellSearchSurfaceSlot, useShellSearch } from "@/client/home/shell-search";
import type { ShellSearchContentProps } from "@/client/home/home-types";
import { flushSync } from "react-dom";
import { AnimatePresence } from "motion/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { AssetSearch } from "@/client/invest/asset-search";
import { investSearchOptions } from "@/client/invest/use-invest-search";
import { AssetDetailScreen } from "@/client/invest/asset-detail-screen";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { getHomeQueryClient } from "@/client/query/query-client";
import { parseInvestSearchResponse } from "@/shared/invest/contracts/search";
import { unavailableMarketData } from "@/shared/invest/invest-market";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";
import { investMarketHandlers } from "./explorations/invest-market.fixtures";

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
    {!asset ? <><div className="contents" inert={open} aria-hidden={open ? true : undefined}>
        <PrimaryNavigation layout="rail" activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} />
      </div><PrimaryNavigation activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} searchOpen={open} /></> : null}
  </main>;
}
function RuntimeSearchNavigation() {
  const { open, openSearch } = useShellSearch();
  return <><ShellSearchInert><PrimaryNavigation layout="rail" activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} /></ShellSearchInert>
    <PrimaryNavigation activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} searchOpen={open} /><ShellSearchSurfaceSlot /></>;
}

const runtimeSearchContent = (props: ShellSearchContentProps) => <AssetSearch {...props} />;

function RuntimeSearchBoundary() {
  const [available, setAvailable] = useState(true);
  const [owner, setOwner] = useState("search-owner-a");
  const shellRef = useRef<HTMLDivElement>(null);
  const detailTargetRef = useRef(null);
  useEffect(() => {
    const unavailable = () => setAvailable(false);
    const ownerChanged = () => setOwner("search-owner-b");
    window.addEventListener("search-story-unavailable", unavailable);
    window.addEventListener("search-story-owner-change", ownerChanged);
    return () => {
      window.removeEventListener("search-story-unavailable", unavailable);
      window.removeEventListener("search-story-owner-change", ownerChanged);
    };
  }, []);
  return <div ref={shellRef} className="min-h-dvh bg-muted"><ShellSearchProvider content={runtimeSearchContent}
    available={available} signedOut={false} ownerKey={owner} shellRef={shellRef} detailTargetRef={detailTargetRef} onLeaveSearch={() => {}}>
    <RuntimeSearchNavigation />
  </ShellSearchProvider></div>;
}

const meta = {
  title: "Journeys/Invest Search", component: InvestSearchJourney,
  beforeEach: () => { window.history.replaceState(null, "", window.location.href); getHomeQueryClient().clear(); },
  parameters: { layout: "fullscreen", msw: { handlers: [
    http.get("/api/invest/search", ({ request }) => { const query = new URL(request.url).searchParams.get("q") ?? ""; return query === "unavailable" ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(searchFixture(query)); }),
    ...investMarketHandlers,
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
  const rail = canvasElement.ownerDocument.querySelector("#desktop-rail");
  await expect(rail).not.toBeNull();
  if (!rail) throw new globalThis.Error("Expected retained desktop rail");
  await expect(rail.closest("[inert]")).not.toBeNull();
  await expect(rail.closest('[aria-hidden="true"]')).not.toBeNull();
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

export const CachedErrorRestoration: Story = {
  parameters: { msw: { handlers: [http.get("/api/invest/search", () => new HttpResponse(null, { status: 503 }))] } },
  render: () => <AssetSearch initialQuery="ORB" initialScrollTop={70} initialResultId="base:0x0000000000000000000000000000000000000002"
    onInputReady={() => {}} onClose={() => {}} onQueryCommit={() => {}} onOpenAsset={() => {}} />,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("button", { name: /^Retry$/ })).toBeVisible();
    const client = getHomeQueryClient();
    const query = client.getQueryCache().find({ queryKey: investSearchOptions({ active: "ORB", enabled: true }).queryKey, exact: true });
    if (!query) throw new globalThis.Error("Expected settled search query");
    await expect(query.state.status).toBe("error");
    await expect(query.state.fetchStatus).toBe("idle");
    const fixture = searchFixture("ORB");
    const result = fixture.results[0];
    if (!result || result.kind !== "dynamic") throw new globalThis.Error("Invalid cached search fixture");
    fixture.results = Array.from({ length: 24 }, (_, index) => {
      const address = `0x${(index + 1).toString(16).padStart(40, "0")}` as const;
      return { ...result, asset: { ...result.asset, id: `base:${address}`, contractAddress: address, displayName: `Orbit ${index + 1}` } };
    });
    const page = parseInvestSearchResponse(fixture);
    if (!page) throw new globalThis.Error("Invalid cached search page");
    query.setState({ data: { pages: [page], pageParams: [0] } });
    const rows = await screen.findAllByRole("button", { name: /Orbit/ });
    await expect(rows).toHaveLength(24);
    const scroll = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-asset-search-scroll]");
    if (!scroll) throw new globalThis.Error("Expected search scroll container");
    await waitFor(() => expect(scroll.scrollTop).toBe(70));
    await expect(screen.getByRole("button", { name: /^Orbit 2 / })).toHaveFocus();
    await expect(query.state.status).toBe("error");
    await expect(query.state.fetchStatus).toBe("idle");
    await expect(screen.queryByRole("button", { name: /^Retry$/ })).not.toBeInTheDocument();
  },
};

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
export const AvailabilityRevoked: Story = {
  render: () => <RuntimeSearchBoundary />,
  play: async ({ canvasElement }) => {
    const { screen, input } = await openSearch(canvasElement);
    await userEvent.type(input, "ORB");
    await screen.findAllByRole("button", { name: /Orbit/ });
    canvasElement.ownerDocument.defaultView?.dispatchEvent(new Event("search-story-unavailable"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search assets" })).not.toBeInTheDocument());
    await expect(screen.queryByRole("button", { name: "Search assets" })).not.toBeInTheDocument();
    const rail = canvasElement.ownerDocument.querySelector("#desktop-rail");
    if (!rail) throw new globalThis.Error("Expected retained desktop rail");
    await expect(rail.closest("[inert]")).toBeNull();
    await expect(rail.closest('[aria-hidden="true"]')).toBeNull();
  },
};
export const OwnerChanged: Story = {
  render: () => <RuntimeSearchBoundary />,
  play: async ({ canvasElement }) => {
    const { screen, input } = await openSearch(canvasElement);
    await userEvent.type(input, "ORB");
    await screen.findAllByRole("button", { name: /Orbit/ });
    const surface = screen.getByRole("dialog", { name: "Search assets" });
    canvasElement.ownerDocument.defaultView?.dispatchEvent(new Event("search-story-owner-change"));
    await waitFor(() => expect(surface).not.toBeInTheDocument());
    await expect(await screen.findByRole("dialog", { name: "Search assets" })).toHaveFocus();
    await expect(screen.getByRole("textbox", { name: "Search assets" })).not.toHaveFocus();
  },
};
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

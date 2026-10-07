import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ShellHeader, ShellSearchHeader } from "@/client/home/shell-chrome";
import { createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { AppChromeProvider } from "@/components/app-chrome";
import { shellFrameClassName } from "@/components/shell-layout";
import { ShellSearchFrame, ShellSearchInert, ShellSearchProvider, ShellSearchSurfaceSlot, useShellSearch } from "@/client/home/shell-search";
import type { ShellSearchContentProps } from "@/client/home/home-types";
import { flushSync } from "react-dom";
import { AnimatePresence } from "motion/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
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
import { investSearchHandler } from "./explorations/invest-search.fixtures";

const noop = () => {};
const headerProps = {
  isAccountSettingsOpen: false, nestedChromeTitle: null, nestedChromeBackLabel: "Back", onNestedChromeBack: noop,
  routeMode: "dashboard", activeNavigation: "home", isVerified: true,
  account: {
    ...createBlockedAccountWalletClient("provider-unavailable"),
    status: "verified", verification: "server", isSignedIn: true, ownerKey: "search-preview", message: null,
    session: { user: { subject: "search-preview" }, smartAccount: null, accountProvider: "cdp-embedded" },
  },
  onHome: noop, onDashboard: noop, onSignIn: noop, onSignOut: noop, onOpenSettings: noop, onCloseSettings: noop,
} satisfies ComponentProps<typeof ShellHeader>;

function InvestSearchJourney() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [restoration, setRestoration] = useState<{ scrollTop: number; resultId: string | null }>({ scrollTop: 0, resultId: null });
  const asset = parseInvestSearchResponse(searchFixture("ORB"))?.results.find(({ asset }) => asset.id === detail)?.asset;
  const openSearch = () => { flushSync(() => setOpen(true)); inputRef.current?.focus({ preventScroll: true }); };
  const close = () => { flushSync(() => { setRestoration({ scrollTop: 0, resultId: null }); setOpen(false); setQuery(""); }); document.querySelector<HTMLElement>("[data-shell-search-opener]")?.focus({ preventScroll: true }); };
  return <AppChromeProvider><div className={`flex min-h-dvh flex-col bg-muted ${open && !asset ? "h-dvh overflow-hidden" : ""}`}>
    <ShellHeader {...headerProps} nestedChromeTitle={asset?.displayName ?? (open ? "Search" : null)}
      onNestedChromeBack={asset ? () => setDetail(null) : close} />
    <main className="relative flex min-h-0 flex-1 flex-col">
    {asset ? <div className={`${shellFrameClassName} py-4 sm:py-6`}><AssetDetailScreen asset={asset} market={unavailableMarketData} onBack={() => setDetail(null)} /></div> : null}
    <AnimatePresence key={detail ?? "search-origin"}>
      {!asset && open ? <AssetSearch key="search" initialQuery={query} onInputReady={(input) => { inputRef.current = input; }} onQueryCommit={setQuery}
        initialScrollTop={restoration.scrollTop} initialResultId={restoration.resultId}
        onClose={close}
        onOpenAsset={(assetId, value, scrollTop) => { setRestoration({ scrollTop, resultId: assetId }); setQuery(value); setDetail(assetId); }} /> : null}
    </AnimatePresence>
    </main>
    {!asset ? <><div className="contents" inert={open} aria-hidden={open ? true : undefined}>
        <PrimaryNavigation layout="rail" activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} />
      </div><PrimaryNavigation activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} searchOpen={open} /></> : null}
  </div></AppChromeProvider>;
}
function RuntimeSearchNavigation() {
  const { open, openSearch } = useShellSearch();
  return <><ShellSearchInert><PrimaryNavigation layout="rail" activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} /></ShellSearchInert>
    <ShellSearchHeader {...headerProps} />
    <main className="relative flex min-h-0 flex-1 flex-col"><ShellSearchSurfaceSlot /></main>
    <PrimaryNavigation activeNavigation="home" onNavigate={() => {}} onOpenSearch={openSearch} searchOpen={open} /></>;
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
  return <ShellSearchProvider content={runtimeSearchContent}
    available={available} signedOut={false} ownerKey={owner} shellRef={shellRef} detailTargetRef={detailTargetRef} onLeaveSearch={() => {}}>
    <ShellSearchFrame ref={shellRef} className="flex min-h-dvh flex-col bg-muted"><RuntimeSearchNavigation /></ShellSearchFrame>
  </ShellSearchProvider>;
}

const meta = {
  title: "Journeys/Invest Search", component: InvestSearchJourney,
  beforeEach: () => { window.history.replaceState(null, "", window.location.href); getHomeQueryClient().clear(); },
  parameters: { layout: "fullscreen", msw: { handlers: [
    investSearchHandler,
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
  await expect(screen.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(screen.getAllByRole("banner")).toHaveLength(1);
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
  render: () => <div className="flex h-dvh flex-col bg-muted"><ShellHeader {...headerProps} nestedChromeTitle="Search" />
    <main className="relative flex min-h-0 flex-1 flex-col"><AssetSearch initialQuery="ORB" initialScrollTop={70} initialResultId="base:0x0000000000000000000000000000000000000002"
      onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} /></main></div>,
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
    await waitForReady(() => expect(scroll.scrollTop).toBe(70));
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
    await waitForReady(() => expect(screen.queryByRole("region", { name: "Search" })).not.toBeInTheDocument());
    await expect(screen.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
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
    const surface = screen.getByRole("region", { name: "Search" });
    canvasElement.ownerDocument.defaultView?.dispatchEvent(new Event("search-story-owner-change"));
    await waitForReady(() => expect(surface).not.toBeInTheDocument());
    await expect(await screen.findByRole("region", { name: "Search" })).toHaveFocus();
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

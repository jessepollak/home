import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { AssetSearchResults, type AssetSearchState } from "./asset-search-results";
import { ShellSearchControl, ShellSearchField } from "@/components/shell-search-controls";
import { parseInvestSearchResponse } from "@/shared/invest/contracts/search";
import { unavailableMarketData } from "@/shared/invest/invest-market";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";
import styles from "@/components/primary-navigation.module.css";

const noop = () => {};
function searchPage() {
  const value = parseInvestSearchResponse(searchFixture("ORB"));
  if (!value) throw new globalThis.Error("Invalid search fixture");
  return value;
}
const page = searchPage();
function SearchPreview({ state, query = "ORB", long = false }: { state: Partial<AssetSearchState>; query?: string; long?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const search: AssetSearchState = { activeQuery: query, status: "ready", results: [...page.results], snapshots: [...page.snapshots], partial: false,
    nextOffset: null, loadingMore: false, loadMoreError: false, retry: noop, loadMore: noop, retryLoadMore: noop, ...state };
  if (long) search.results = Array.from({ length: 24 }, (_, index) => {
    const result = page.results[index % 3];
    if (!result) throw new globalThis.Error("Missing search fixture row");
    return { ...result, asset: { ...result.asset, id: `preview-${index}`, displayName: `Orbit ${index + 1}` } };
  });
  return <main className="fixed inset-0 flex flex-col bg-muted">
    <div className={`${styles.assetSearchResults} overflow-y-auto overscroll-contain`}><div className="mx-auto max-w-2xl px-4 py-4"><AssetSearchResults query={query} composing={false} search={search}
      markets={{ stockMarket: unavailableMarketData, cryptoMarket: unavailableMarketData, memeMarket: unavailableMarketData }} assetMarkResolution={{}} onOpenAsset={noop} /></div></div>
    <div className={`${styles.assetSearchBar} fixed flex gap-2`}><ShellSearchField inputRef={inputRef} query={query} onQueryChange={noop} onComposingChange={noop} maxLength={64} /><ShellSearchControl close onClick={noop} /></div>
  </main>;
}
const meta = { title: "Invest/Asset search", component: SearchPreview, args: { state: {} }, parameters: { layout: "fullscreen" } } satisfies Meta<typeof SearchPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { args: { query: "", state: { status: "idle", results: [] } }, play: async ({ canvasElement }) => { await expect(within(canvasElement).queryByRole("region", { name: "Search results" })).not.toBeInTheDocument(); } };
export const Loading: Story = { args: { state: { status: "loading", results: [] } }, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByLabelText("Loading search results")).toBeVisible(); } };
export const LongResults: Story = { args: { long: true } };
export const NoResults: Story = { args: { state: { results: [] } } };
export const Error: Story = { args: { state: { status: "error", results: [] } } };
export const Partial: Story = { args: { state: { partial: true } } };
export const LoadMore: Story = { args: { state: { nextOffset: 30 } }, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByRole("button", { name: "Load more" })).toBeVisible(); } };
export const Dark: Story = { globals: { theme: "dark" } };

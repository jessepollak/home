"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { marketForAsset } from "./discover";
import { DiscoverAssetRow } from "./discover-asset-row";
import { useInvestSearch } from "./use-invest-search";

export type AssetSearchState = ReturnType<typeof useInvestSearch>;

export function AssetSearchResults({
  query,
  composing,
  search,
  markets,
  assetMarkResolution,
  onOpenAsset,
}: {
  query: string;
  composing: boolean;
  search: AssetSearchState;
  markets: { stockMarket: MarketDataState; cryptoMarket: MarketDataState; memeMarket: MarketDataState };
  assetMarkResolution: AssetMarkResolution;
  onOpenAsset: (asset: InvestAsset) => void;
}) {
  const visible = query.trim().length > 0;
  const labels = new Map<string, number>();
  for (const { asset } of search.results) {
    const label = `${asset.displayName}:${asset.displaySymbol}`.toLocaleLowerCase("en-US");
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const loading = search.status === "loading" || composing;
  const summary = loading
    ? "Loading results"
    : search.status === "error" && search.results.length === 0
      ? "Search unavailable"
      : search.results.length > 0
        ? `${search.results.length} results`
        : "No results";

  return (
    <>
      {visible ? (
        <section aria-label="Search results" className="space-y-3">
          <span className="sr-only" role="status" aria-live="polite">{summary}</span>
          {loading ? (
            <div aria-label="Loading search results" className="space-y-3 py-3">
              {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 w-full" />)}
            </div>
          ) : search.status === "error" && search.results.length === 0 ? (
            <Empty>
              <EmptyHeader><EmptyTitle>Search unavailable</EmptyTitle></EmptyHeader>
              <EmptyContent><Button variant="outline" onClick={search.retry}>Retry</Button></EmptyContent>
            </Empty>
          ) : search.results.length === 0 && search.nextOffset === null ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No results</EmptyTitle>
                <EmptyDescription>No assets found for “{query.trim()}”.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {search.results.length > 0 ? (
                <Card>
                  <CardContent inset="list">
                    <ul className="m-0 list-none p-0">
                      {search.results.map(({ asset, source }) => (
                        <DiscoverAssetRow
                          key={asset.id}
                          asset={asset}
                          market={source === "configured"
                            ? marketForAsset(asset, markets)
                            : { status: "ready", snapshots: search.snapshots }}
                          discriminator={
                            (labels.get(`${asset.displayName}:${asset.displaySymbol}`.toLocaleLowerCase("en-US")) ?? 0) > 1
                              ? `${asset.contractAddress.slice(0, 6)}…${asset.contractAddress.slice(-4)}`
                              : undefined
                          }
                          assetMarkResolution={assetMarkResolution}
                          onOpen={() => onOpenAsset(asset)}
                        />
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
              {search.partial ? (
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground" role="status">
                  <span>Some results couldn’t load.</span>
                  <Button type="button" variant="ghost" onClick={search.retry}>Retry</Button>
                </div>
              ) : null}
              {search.loadMoreError ? (
                <div className="flex items-center justify-between gap-2" role="status">
                  <span className="text-sm text-muted-foreground">More results couldn’t load.</span>
                  <Button variant="outline" onClick={search.retryLoadMore}>Retry more</Button>
                </div>
              ) : search.nextOffset !== null ? (
                <Button variant="outline" disabled={search.loadingMore} onClick={search.loadMore}>
                  {search.loadingMore ? "Loading more" : "Load more"}
                </Button>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ShimmerRows } from "@/client/home/panel-shared";
import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { DiscoverAssetRow } from "./discover-asset-row";
import type { DiscoverShelfId, MemePagination, MemeShelfStatus } from "./discover";

export function CategoryScreen({
  title,
  shelfId,
  assets,
  market,
  status = "ready",
  assetMarkResolution = {},
  pagination,
  onLoadMore,
  onRetryLoadMore,
  onBack,
  onOpenAsset,
}: {
  title: string;
  shelfId: DiscoverShelfId;
  assets: readonly InvestAsset[];
  market: MarketDataState;
  status?: MemeShelfStatus;
  assetMarkResolution?: AssetMarkResolution;
  pagination?: MemePagination;
  onLoadMore?: () => void;
  onRetryLoadMore?: () => void;
  onBack: () => void;
  onOpenAsset: (asset: InvestAsset, from: DiscoverShelfId) => void;
}) {
  const hosted = Boolean(useOptionalAppChrome());
  const showPagination = Boolean(
    pagination && (assets.length > 0 || !pagination.exhausted),
  );

  return (
    <section
      className="w-full space-y-4"
      aria-label={hosted ? title : undefined}
      aria-labelledby={hosted ? undefined : "invest-category-title"}
    >
      {hosted ? null : (
        <header className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={onBack}
            aria-label="Back to Invest"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h2 id="invest-category-title" className="text-lg font-semibold">
            {title}
          </h2>
        </header>
      )}
      {assets.length > 0 ? (
        <Card>
          <CardContent inset="list">
            <ul className="m-0 list-none p-0">
              {assets.map((asset) => (
                <DiscoverAssetRow
                  key={asset.id}
                  asset={asset}
                  market={market}
                  assetMarkResolution={assetMarkResolution}
                  onOpen={() => onOpenAsset(asset, shelfId)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {status === "loading" ? "Loading assets" : "No assets available"}
            </EmptyTitle>
            <EmptyDescription>
              {status === "error" || status === "unavailable"
                ? "This category is unavailable right now."
                : status === "loading"
                  ? "Fetching the latest assets."
                  : "None are trending right now."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {showPagination && pagination ? (
        <MemePaginationFooter
          pagination={pagination}
          onLoadMore={onLoadMore}
          onRetryLoadMore={onRetryLoadMore}
        />
      ) : null}
    </section>
  );
}

function MemePaginationFooter({
  pagination,
  onLoadMore,
  onRetryLoadMore,
}: {
  pagination: MemePagination;
  onLoadMore?: () => void;
  onRetryLoadMore?: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { nextOffset, exhausted, loadingMore, loadMoreError, autoLoadPaused } =
    pagination;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !sentinel ||
      nextOffset === null ||
      exhausted ||
      loadingMore ||
      loadMoreError ||
      autoLoadPaused ||
      !onLoadMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const closestRoot = sentinel.closest(".app-main-authenticated");
    const root = closestRoot instanceof HTMLElement ? closestRoot : null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { root, rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [autoLoadPaused, exhausted, loadMoreError, loadingMore, nextOffset, onLoadMore]);

  if (exhausted) {
    return (
      <p className="text-center text-sm text-muted-foreground" role="status">
        End of trending memes
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {loadingMore ? (
        <div role="status" aria-live="polite">
          <ShimmerRows count={1} />
          <span className="sr-only">Loading more…</span>
        </div>
      ) : null}
      {loadMoreError ? (
        <Alert variant="destructive">
          <AlertDescription>
            More memes could not be loaded. Your current results are unchanged.
          </AlertDescription>
        </Alert>
      ) : null}
      {loadMoreError ? (
        <Button className="w-full" size="lg" variant="secondary" onClick={onRetryLoadMore}>
          Retry loading memes
        </Button>
      ) : null}
      {autoLoadPaused ? (
        <p className="text-sm text-muted-foreground" role="status">
          No additional memes were found.
        </p>
      ) : null}
      <div
        key={nextOffset}
        ref={sentinelRef}
        className="h-px w-full"
        data-meme-sentinel=""
        aria-hidden="true"
      />
    </div>
  );
}

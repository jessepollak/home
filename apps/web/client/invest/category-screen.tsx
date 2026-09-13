"use client";

import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOptionalAppChrome } from "@/components/app-chrome";
import type { InvestAsset } from "@/config/invest-assets";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { DiscoverAssetRow } from "./discover-asset-row";
import type { DiscoverShelfId, MemePagination, MemeShelfStatus } from "./discover";
import styles from "./invest-experience.module.css";

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
      className={styles.experience}
      aria-label={hosted ? title : undefined}
      aria-labelledby={hosted ? undefined : "invest-category-title"}
    >
      {hosted ? null : (
        <header className={styles.screenHeader}>
          <Button
            variant="ghost"
            size="icon"
            className={`${styles.back} min-h-11 min-w-11`}
            onClick={onBack}
            aria-label="Back to Invest"
          >
            <ArrowRight />
          </Button>
          <h2 id="invest-category-title" className="text-section-title font-semibold">
            {title}
          </h2>
        </header>
      )}
      {assets.length > 0 ? (
        <ul className={styles.rows}>
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
      ) : (
        <p className={`${styles.shelfStatus} text-metadata text-muted-foreground`}>
          {status === "error" || status === "unavailable"
            ? "Unavailable"
            : status === "loading"
              ? "Loading"
              : "None trending"}
        </p>
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
      <p className={`${styles.end} text-metadata text-muted-foreground`} role="status">
        End of trending memes
      </p>
    );
  }

  return (
    <div className={styles.pagination}>
      {loadingMore ? (
        <div className={styles.loadingMore} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Loading more…
        </div>
      ) : null}
      {loadMoreError ? (
        <p className={`${styles.loadMoreError} text-metadata`} role="alert">
          More memes could not be loaded. Your current results are unchanged.
        </p>
      ) : null}
      {loadMoreError ? (
        <Button
          className={styles.loadMoreButton}
          variant="secondary"
          onClick={onRetryLoadMore}
        >
          Retry loading memes
        </Button>
      ) : null}
      {autoLoadPaused ? (
        <p className={`${styles.loadMoreNotice} text-metadata text-muted-foreground`} role="status">
          No additional memes were found.
        </p>
      ) : null}
      <div
        key={nextOffset}
        ref={sentinelRef}
        className={styles.sentinel}
        data-meme-sentinel=""
        aria-hidden="true"
      />
    </div>
  );
}

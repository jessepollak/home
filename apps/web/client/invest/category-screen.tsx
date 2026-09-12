"use client";

import { useEffect, useRef } from "react";
import { Button, Heading, IconButton, Text } from "@home/ui";
import { ArrowRightIcon } from "@home/ui/icons";
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
          <IconButton
            icon={ArrowRightIcon}
            className={styles.back}
            onClick={onBack}
            aria-label="Back to Invest"
          />
          <Heading level={2} textStyle="section-title" id="invest-category-title">
            {title}
          </Heading>
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
        <Text className={styles.shelfStatus} textStyle="metadata" tone="muted">
          {status === "error" || status === "unavailable"
            ? "Unavailable"
            : status === "loading"
              ? "Loading"
              : "None trending"}
        </Text>
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
      <Text className={styles.end} textStyle="metadata" tone="muted" role="status">
        End of trending memes
      </Text>
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
        <Text className={styles.loadMoreError} textStyle="metadata" role="alert">
          More memes could not be loaded. Your current results are unchanged.
        </Text>
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
        <Text className={styles.loadMoreNotice} textStyle="metadata" tone="muted" role="status">
          No additional memes were found.
        </Text>
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

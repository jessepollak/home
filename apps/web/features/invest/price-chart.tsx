"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Liveline, type LivelinePoint } from "liveline";
import {
  MARKET_PRICE_RANGES,
  type MarketPriceHistoryPoint,
  type MarketPriceRange,
} from "@/server/market-data/codex/history-contract";
import type { PriceHistoryState } from "./use-price-history";
import styles from "./invest-experience.module.css";

const LINE_COLOR = "#0052ff";
const RANGE_SECONDS: Record<MarketPriceRange, number> = {
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1M": 30 * 86_400,
  "3M": 90 * 86_400,
  "1Y": 365 * 86_400,
};

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function PriceChart({
  range,
  history,
  onRangeChange,
}: {
  range: MarketPriceRange;
  history: PriceHistoryState;
  onRangeChange: (range: MarketPriceRange) => void;
}) {
  return (
    <div className={styles.chartBlock}>
      <div className={styles.ranges} role="group" aria-label="Price range">
        {MARKET_PRICE_RANGES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === range}
            onClick={() => onRangeChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <ChartBody history={history} range={range} />
    </div>
  );
}

function ChartBody({
  history,
  range,
}: {
  history: PriceHistoryState;
  range: MarketPriceRange;
}) {
  const reduceMotion = usePrefersReducedMotion();

  if (history.status === "loading") {
    return (
      <div className={styles.chartStage} role="status" aria-label="Loading price history">
        <AssetLiveline
          points={[]}
          range={range}
          loading
          reduceMotion={reduceMotion}
        />
      </div>
    );
  }

  if (history.status !== "ready" || history.points.length === 0) {
    return (
      <p className={styles.chartEmpty} role="status">
        {history.status === "error"
          ? "Price history unavailable."
          : "No price history for this range."}
      </p>
    );
  }

  const points = toLivelinePoints(history.points);
  if (points.length === 0) {
    return (
      <p className={styles.chartEmpty} role="status">
        No price history for this range.
      </p>
    );
  }

  return (
    <div className={styles.chartStage} role="img" aria-label={`${range} price history`}>
      <AssetLiveline points={points} range={range} reduceMotion={reduceMotion} />
    </div>
  );
}

function AssetLiveline({
  points,
  range,
  loading = false,
  reduceMotion,
}: {
  points: readonly LivelinePoint[];
  range: MarketPriceRange;
  loading?: boolean;
  reduceMotion: boolean;
}) {
  const value = points[points.length - 1]?.value ?? 0;
  const windowSecs = visibleWindowSeconds(range, points);
  const formatTime = useMemo(
    () => (time: number) => formatChartTime(time, range),
    [range],
  );

  return (
    <Liveline
      data={[...points]}
      value={value}
      window={windowSecs}
      theme="light"
      color={LINE_COLOR}
      fill
      pulse={!reduceMotion}
      momentum={!reduceMotion}
      scrub
      degen={false}
      badge={false}
      showValue={false}
      grid={false}
      loading={loading}
      lerpSpeed={reduceMotion ? 1 : 0.08}
      lineWidth={2.5}
      formatTime={formatTime}
      formatValue={formatChartValue}
      padding={{ top: 16, right: 12, bottom: 28, left: 4 }}
      style={{ height: "100%" }}
    />
  );
}

export function toLivelinePoints(
  points: readonly MarketPriceHistoryPoint[],
): LivelinePoint[] {
  const series: LivelinePoint[] = [];
  for (const point of points) {
    const time = Date.parse(point.time) / 1000;
    const value = Number(point.value);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    series.push({ time, value });
  }
  return series;
}

export function visibleWindowSeconds(
  range: MarketPriceRange,
  points: readonly LivelinePoint[],
) {
  const nominal = RANGE_SECONDS[range];
  if (points.length === 0) return nominal;
  const first = points[0]!.time;
  const last = points[points.length - 1]!.time;
  const now = Date.now() / 1000;
  return Math.max(nominal, last - first + 1, now - first + 1);
}

function formatChartTime(time: number, range: MarketPriceRange) {
  const date = new Date(time * 1000);
  if (range === "1D") {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (range === "1W") {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatChartValue(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) {
    return `${(value / 1000).toFixed(2)}k`;
  }
  if (magnitude >= 1) {
    return value.toFixed(2);
  }
  return value.toPrecision(4);
}

function subscribeReducedMotion(onStoreChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function reducedMotionSnapshot() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(reducedMotionQuery).matches
    : false;
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
}

"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Liveline, type LivelinePoint } from "liveline";
import {
  MARKET_PRICE_RANGES,
  type MarketPriceHistoryPoint,
  type MarketPriceRange,
} from "@/shared/invest/history-contract";
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

/** Pulse ring max is 21px; momentum chevrons sit ~25px to the right of the live tip. */
export const LIVELINE_PLOT_PADDING = {
  top: 32,
  right: 52,
  bottom: 36,
  left: 16,
} as const;

/** First-load shimmer fades on `--motion-tab` so Liveline's chartReveal can play. */
export const CHART_COVER_FADE_MS = 180;

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
      <div className={styles.chartCaption}>
        <span>Price history</span>
        <strong>USD</strong>
      </div>
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

type HeldLivelinePlot = {
  key: string;
  points: LivelinePoint[];
  range: MarketPriceRange;
  value: number;
  windowSecs: number;
};

function ChartBody({
  history,
  range,
}: {
  history: PriceHistoryState;
  range: MarketPriceRange;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const incoming = useMemo(
    () => toLivelinePoints(history.points),
    [history.points],
  );
  const plot = useHeldLivelinePlot(history.status, incoming, range);
  const firstCover = useFirstPaintCover(!!plot, reduceMotion);
  const coldLoad = history.status === "loading" && !plot;
  const chipLoad = history.status === "loading" && !!plot;
  const unavailable =
    history.status !== "loading" &&
    (history.status === "error" || !plot);
  const waitingFirstPaint = coldLoad || firstCover;
  const coverKind = coldLoad || firstCover ? "first" : chipLoad ? "chip" : null;
  const stageRole = waitingFirstPaint || unavailable ? "status" : "img";
  const stageLabel = waitingFirstPaint
    ? "Loading price history"
    : unavailable || !plot
      ? undefined
      : `${plot.range} price history`;

  return (
    <div
      className={styles.chartStage}
      role={stageRole}
      aria-label={stageLabel}
      aria-busy={waitingFirstPaint || chipLoad || undefined}
      data-liveline-hold={
        chipLoad ? "chip" : coldLoad ? "first" : firstCover ? "reveal" : undefined
      }
    >
      {plot ? (
        <div className={styles.plotFrame} data-plot-key={plot.key} data-plot-range={plot.range}>
          <AssetLiveline plot={plot} reduceMotion={reduceMotion} />
        </div>
      ) : null}
      {coverKind ? (
        <div
          className={
            coverKind === "first"
              ? `${styles.plotCover} shimmer`
              : `${styles.plotCover} ${styles.plotCoverChip}`
          }
          data-plot-cover={coverKind}
          data-fading={firstCover && !coldLoad ? "true" : undefined}
          aria-hidden
        />
      ) : null}
      {unavailable ? (
        <p className={styles.chartMessage} role="status">
          {history.status === "error"
            ? "Price history unavailable."
            : "No price history for this range."}
        </p>
      ) : null}
    </div>
  );
}

/** Commit a complete series only. Mid-load points/window/value stay on last-good. */
function useHeldLivelinePlot(
  status: PriceHistoryState["status"],
  incoming: LivelinePoint[],
  range: MarketPriceRange,
): HeldLivelinePlot | null {
  const [held, setHeld] = useState<HeldLivelinePlot | null>(null);

  if (status === "ready" && incoming.length > 0) {
    const next = commitLivelinePlot(incoming, range);
    if (held?.key !== next.key) {
      setHeld(next);
      return next;
    }
    return held;
  }

  if (status === "empty" || status === "error") {
    if (held) {
      setHeld(null);
      return null;
    }
    return null;
  }

  return held;
}

/** Opaque first-load shimmer fades once so the same Liveline instance can reveal. */
function useFirstPaintCover(hasPlot: boolean, reduceMotion: boolean) {
  const shouldCover = hasPlot && !reduceMotion;
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (!shouldCover) return;
    const timer = window.setTimeout(() => setFaded(true), CHART_COVER_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [shouldCover]);

  return shouldCover && !faded;
}

function commitLivelinePlot(
  points: LivelinePoint[],
  range: MarketPriceRange,
): HeldLivelinePlot {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return {
    key: `${range}:${first.time}:${last.time}:${points.length}:${last.value}`,
    points,
    range,
    value: last.value,
    windowSecs: visibleWindowSeconds(range, points),
  };
}

function AssetLiveline({
  plot,
  reduceMotion,
}: {
  plot: HeldLivelinePlot;
  reduceMotion: boolean;
}) {
  const range = plot.range;
  const formatTime = useMemo(
    () => (time: number) => formatChartTime(time, range),
    [range],
  );

  return (
    <Liveline
      data={plot.points}
      value={plot.value}
      window={plot.windowSecs}
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
      loading={false}
      lerpSpeed={reduceMotion ? 1 : 0.08}
      lineWidth={2.5}
      formatTime={formatTime}
      formatValue={formatChartValue}
      padding={LIVELINE_PLOT_PADDING}
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

export function formatChartValue(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude > 0 && magnitude < 0.001) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumSignificantDigits: 4,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: magnitude >= 1000 ? "compact" : "standard",
    minimumFractionDigits: magnitude >= 1 ? 2 : 0,
    maximumFractionDigits: magnitude >= 1 ? 2 : 6,
  }).format(value);
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

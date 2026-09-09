"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

/** Pulse ring max is 21px; momentum chevrons sit ~25px to the right of the live tip. */
export const LIVELINE_PLOT_PADDING = {
  top: 32,
  right: 52,
  bottom: 36,
  left: 16,
} as const;

/** Liveline's chartReveal (~0.09/frame) must finish before a series is uncovered. */
export const LIVELINE_SWAP_SETTLE_MS = 850;
/** Extra cover time on chip changes so last-good is not lifted mid-reveal. */
export const LIVELINE_CHIP_SETTLE_MS = 1200;

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

type HeldLivelinePlot = {
  key: string;
  points: LivelinePoint[];
  range: MarketPriceRange;
  value: number;
  windowSecs: number;
};

type PlotSlotId = "a" | "b";

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
  const { revealed, pending, liveSlot } = usePresentedLivelinePlot(
    plot,
    reduceMotion,
  );
  const blankCover = !!pending && !revealed;
  const chipHold = !!pending && !!revealed && pending.key !== revealed.key;
  const unavailable =
    history.status !== "loading" &&
    (history.status === "error" || !plot) &&
    !revealed &&
    !pending;
  const waitingFirstPaint = blankCover || (!revealed && !pending && !unavailable);
  const stageRole = waitingFirstPaint || unavailable ? "status" : "img";
  const visible = revealed ?? pending;
  const stageLabel = waitingFirstPaint
    ? "Loading price history"
    : unavailable || !visible
      ? undefined
      : `${visible.range} price history`;
  const slotA = plotForStableSlot("a", liveSlot, revealed, pending, chipHold);
  const slotB = plotForStableSlot("b", liveSlot, revealed, pending, chipHold);

  return (
    <div
      className={styles.chartStage}
      role={stageRole}
      aria-label={stageLabel}
      data-liveline-hold={chipHold ? "chip" : blankCover ? "first" : undefined}
    >
      <StablePlotSlot
        id="a"
        plot={slotA}
        live={liveSlot === "a"}
        chipHold={chipHold}
        blankCover={blankCover}
        reduceMotion={reduceMotion}
      />
      <StablePlotSlot
        id="b"
        plot={slotB}
        live={liveSlot === "b"}
        chipHold={chipHold}
        blankCover={blankCover}
        reduceMotion={reduceMotion}
      />
      {blankCover ? (
        <div className={styles.plotCover} data-plot-cover="true" aria-hidden />
      ) : null}
      {/* Incoming paints offstage; last-good stays the only onstage series. */}
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

/** Last-good stays in one slot; incoming mounts in the other. Slots never swap identity. */
function plotForStableSlot(
  id: PlotSlotId,
  liveSlot: PlotSlotId,
  revealed: HeldLivelinePlot | null,
  pending: HeldLivelinePlot | null,
  chipHold: boolean,
) {
  if (id === liveSlot) return revealed ?? pending;
  return chipHold ? pending : null;
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

/**
 * Last-good stays in a stable slot (same React instance). Incoming mounts in
 * the other slot at full opacity. On chip settle we promote that slot — never
 * remount last-good, and never opacity 0→1 (that retriggers chartReveal).
 */
function usePresentedLivelinePlot(
  plot: HeldLivelinePlot | null,
  reduceMotion: boolean,
) {
  const [revealed, setRevealed] = useState<HeldLivelinePlot | null>(null);
  const [pending, setPending] = useState<HeldLivelinePlot | null>(null);
  const [liveSlot, setLiveSlot] = useState<PlotSlotId>("a");

  let nextRevealed = revealed;
  let nextPending = pending;
  let nextLiveSlot = liveSlot;

  if (!plot) {
    nextRevealed = null;
    nextPending = null;
    nextLiveSlot = "a";
  } else if (reduceMotion || revealed?.key === plot.key) {
    nextRevealed = plot;
    nextPending = null;
  } else if (!revealed) {
    nextPending = plot;
  } else if (pending?.key !== plot.key) {
    nextPending = plot;
  }

  if (nextRevealed !== revealed) setRevealed(nextRevealed);
  if (nextPending !== pending) setPending(nextPending);
  if (nextLiveSlot !== liveSlot) setLiveSlot(nextLiveSlot);

  const pendingKey = nextPending?.key ?? null;
  const hasRevealed = !!nextRevealed;
  useEffect(() => {
    if (reduceMotion || !plot || !pendingKey || plot.key !== pendingKey) return;
    const delay = hasRevealed ? LIVELINE_CHIP_SETTLE_MS : LIVELINE_SWAP_SETTLE_MS;
    const timer = window.setTimeout(() => {
      setRevealed(plot);
      setPending(null);
      if (hasRevealed) {
        setLiveSlot((slot) => (slot === "a" ? "b" : "a"));
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [plot, pendingKey, reduceMotion, hasRevealed]);

  return { revealed: nextRevealed, pending: nextPending, liveSlot: nextLiveSlot };
}

function StablePlotSlot({
  id,
  plot,
  live,
  chipHold,
  blankCover,
  reduceMotion,
}: {
  id: PlotSlotId;
  plot: HeldLivelinePlot | null;
  live: boolean;
  chipHold: boolean;
  blankCover: boolean;
  reduceMotion: boolean;
}) {
  if (!plot) return null;
  const layer = live && chipHold ? "front" : "back";
  const slot = live ? "live" : "warm";
  return (
    <div
      className={`${styles.plotSlot} ${layer === "front" ? styles.plotFront : styles.plotBack}`}
      data-plot-id={id}
      data-plot-slot={slot}
      data-plot-layer={layer}
      data-plot-key={plot.key}
      data-plot-pending={live ? (blankCover ? "true" : "false") : undefined}
      aria-hidden={slot === "warm" ? true : undefined}
    >
      <AssetLiveline key={plot.key} plot={plot} reduceMotion={reduceMotion} />
    </div>
  );
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

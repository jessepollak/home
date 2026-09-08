import {
  MARKET_PRICE_RANGES,
  type MarketPriceHistoryPoint,
  type MarketPriceRange,
} from "@/server/market-data/codex/history-contract";
import type { PriceHistoryState } from "./use-price-history";
import styles from "./invest-experience.module.css";

const chartWidth = 320;
const chartHeight = 190;
const pad = { top: 12, right: 40, bottom: 28, left: 8 };

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
  if (history.status === "loading") {
    return <div className={styles.chartLoading} role="status" aria-label="Loading price history" />;
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

  const geometry = layoutSeries(history.points, range);
  if (!geometry) {
    return (
      <p className={styles.chartEmpty} role="status">
        No price history for this range.
      </p>
    );
  }

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      role="img"
      aria-label={`${range} price history`}
    >
      <path className={styles.area} d={geometry.area} />
      <path className={styles.line} d={geometry.line} />
      {geometry.yLabels.map((label) => (
        <text
          key={label.text}
          className={styles.axis}
          x={chartWidth - 4}
          y={label.y}
          textAnchor="end"
        >
          {label.text}
        </text>
      ))}
      {geometry.xLabels.map((label) => (
        <text
          key={label.text}
          className={styles.axis}
          x={label.x}
          y={chartHeight - 8}
          textAnchor="middle"
        >
          {label.text}
        </text>
      ))}
    </svg>
  );
}

function layoutSeries(
  points: readonly MarketPriceHistoryPoint[],
  range: MarketPriceRange,
) {
  const values = points.map((point) => Number(point.value));
  const times = points.map((point) => Date.parse(point.time));
  if (
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value)) ||
    times.some((time) => !Number.isFinite(time))
  ) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const start = times[0] ?? 0;
  const end = times[times.length - 1] ?? start;
  const valueSpan = max - min || Math.max(Math.abs(max) * 0.01, 1);
  const timeSpan = end - start || 1;
  const innerWidth = chartWidth - pad.left - pad.right;
  const innerHeight = chartHeight - pad.top - pad.bottom;

  const coords = values.map((value, index) => {
    const x = pad.left + ((times[index]! - start) / timeSpan) * innerWidth;
    const y = pad.top + ((max - value) / valueSpan) * innerHeight;
    return { x, y };
  });

  const line = coords
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
  const area = `${line} L${coords[coords.length - 1]!.x} ${pad.top + innerHeight} L${coords[0]!.x} ${pad.top + innerHeight} Z`;

  return {
    line,
    area,
    yLabels: [
      { text: compactPrice(max), y: pad.top + 10 },
      { text: compactPrice((max + min) / 2), y: pad.top + innerHeight / 2 + 4 },
      { text: compactPrice(min), y: pad.top + innerHeight },
    ],
    xLabels: xAxisLabels(times, range, pad.left, innerWidth),
  };
}

function xAxisLabels(
  times: number[],
  range: MarketPriceRange,
  left: number,
  width: number,
) {
  if (times.length === 0) return [];
  const first = times[0]!;
  const last = times[times.length - 1]!;
  const ticks = range === "1W" ? 7 : 4;
  const labels = [];
  for (let index = 0; index < ticks; index += 1) {
    const time = first + ((last - first) * index) / Math.max(ticks - 1, 1);
    labels.push({
      text: formatAxisTime(time, range),
      x: left + (width * index) / Math.max(ticks - 1, 1),
    });
  }
  return labels;
}

function formatAxisTime(time: number, range: MarketPriceRange) {
  const date = new Date(time);
  if (range === "1D") {
    return date.toLocaleTimeString("en-US", { hour: "numeric" });
  }
  if (range === "1W") {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function compactPrice(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

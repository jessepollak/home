import {
  MARKET_PRICE_RANGES,
  type MarketPriceHistoryPoint,
  type MarketPriceRange,
} from "@/server/market-data/codex/history-contract";
import type { PriceHistoryState } from "./use-price-history";
import styles from "./invest-experience.module.css";

const chartWidth = 320;
const chartHeight = 190;
const pad = { top: 12, right: 60, bottom: 28, left: 8 };

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
          key={label.id}
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
          key={label.id}
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
  const valueSpan = max - min;
  const timeSpan = end - start;
  const innerWidth = chartWidth - pad.left - pad.right;
  const innerHeight = chartHeight - pad.top - pad.bottom;

  const coords = values.map((value, index) => {
    const x =
      timeSpan === 0
        ? pad.left + innerWidth / 2
        : pad.left + ((times[index]! - start) / timeSpan) * innerWidth;
    const y =
      valueSpan === 0
        ? pad.top + innerHeight / 2
        : pad.top + ((max - value) / valueSpan) * innerHeight;
    return { x, y };
  });

  const line = coords
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
  const area = `${line} L${coords[coords.length - 1]!.x} ${pad.top + innerHeight} L${coords[0]!.x} ${pad.top + innerHeight} Z`;

  return {
    line,
    area,
    yLabels: yAxisLabels(min, max, pad.top, innerHeight),
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
  const span = last - first;
  if (span === 0) {
    return [
      {
        id: `time-${first}`,
        text: formatAxisTime(first, range, span),
        x: left + width / 2,
      },
    ];
  }

  const ticks = range === "1W" ? 7 : 4;
  const labels = [];
  for (let index = 0; index < ticks; index += 1) {
    const time = first + (span * index) / Math.max(ticks - 1, 1);
    labels.push({
      id: `time-${Math.round(time)}-${index}`,
      text: formatAxisTime(time, range, span),
      x: left + (width * index) / Math.max(ticks - 1, 1),
    });
  }
  return labels;
}

function formatAxisTime(
  time: number,
  range: MarketPriceRange,
  visibleSpan: number,
) {
  const date = new Date(time);
  if (range === "1D") {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      ...(visibleSpan < 6 * 60 * 60 * 1000 ? { minute: "2-digit" } : {}),
    });
  }
  if (range === "1W") {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function yAxisLabels(min: number, max: number, top: number, height: number) {
  const span = max - min;
  const format = priceTickFormatter(min, max);
  if (span === 0) {
    return [
      {
        id: "price-flat",
        text: format(max),
        y: top + height / 2 + 4,
      },
    ];
  }

  return [
    { id: "price-max", text: format(max), y: top + 10 },
    {
      id: "price-mid",
      text: format((max + min) / 2),
      y: top + height / 2 + 4,
    },
    { id: "price-min", text: format(min), y: top + height },
  ];
}

function priceTickFormatter(min: number, max: number) {
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  const tickStep = Math.abs(max - min) / 2;

  if (magnitude >= 1000) {
    const fractionDigits =
      tickStep === 0
        ? 2
        : Math.min(6, Math.max(0, fractionDigitsForStep(tickStep / 1000)));
    return (value: number) => `${(value / 1000).toFixed(fractionDigits)}k`;
  }

  if (magnitude >= 1) {
    const fractionDigits =
      tickStep === 0
        ? 2
        : Math.min(12, Math.max(2, fractionDigitsForStep(tickStep)));
    return (value: number) => value.toFixed(fractionDigits);
  }

  const fractionDigits =
    tickStep === 0
      ? Math.max(4, fractionDigitsForMagnitude(magnitude))
      : Math.max(4, fractionDigitsForStep(tickStep));
  if (fractionDigits > 12) {
    return (value: number) => value.toExponential(2);
  }
  return (value: number) => value.toFixed(fractionDigits);
}

function fractionDigitsForStep(step: number) {
  return Math.max(0, Math.ceil(-Math.log10(step)));
}

function fractionDigitsForMagnitude(value: number) {
  if (value === 0) return 4;
  return Math.max(0, Math.ceil(-Math.log10(value)) + 2);
}

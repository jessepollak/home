"use client";

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatPresentationDate } from "@/shared/formatting";
import { STOCK_HISTORY_MAX_POINTS, type MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import type { usePresentationRegionId } from "./presentation-quote";

export type ChartReadout = { value: string; time: string; index: number };
export const rangeSeconds: Record<MarketPriceRange, number> = {
  "1D": 86400, "1W": 604800, "1M": 2592000, "3M": 7776000, "1Y": 31536000,
};
export const rangeLabels: Record<MarketPriceRange, string> = {
  "1D": "Past day", "1W": "Past week", "1M": "Past month", "3M": "Past 3 months", "1Y": "Past year",
};
export const slowLoadDelayMs = 1500;
const motionQuery = "(prefers-reduced-motion: reduce)";

function subscribeMotion(notify: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
function motionSnapshot() {
  return typeof window !== "undefined" && !!window.matchMedia?.(motionQuery).matches;
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
}
export function useChartClock() {
  const [start] = useState(() => Date.now());
  const anchor = useRef<{ start: number; wall: number } | null>(null);
  const [value, setValue] = useState(start);
  const read = useCallback(() => {
    const current = anchor.current;
    return current ? current.start + Date.now() - current.wall : start;
  }, [start]);
  const refresh = useCallback(() => setValue(read()), [read]);
  useLayoutEffect(() => {
    anchor.current = { start, wall: Date.now() };
    const interval = window.setInterval(refresh, 30000);
    return () => window.clearInterval(interval);
  }, [start, refresh]);
  return { value, read, refresh };
}
export type ChartClock = ReturnType<typeof useChartClock>;
export function scrubTime(time: number, range: MarketPriceRange, regionId: ReturnType<typeof usePresentationRegionId>) {
  return formatPresentationDate(time * 1000, { regionId, style: range === "1D" || range === "1W" ? "activity-short" : "chart-date" });
}
function crossesYear(start: number, end: number) {
  return new Date(start * 1000).getFullYear() !== new Date(end * 1000).getFullYear();
}
export function scrubSpan(start: number, end: number, range: MarketPriceRange, regionId: ReturnType<typeof usePresentationRegionId>) {
  if (!crossesYear(start, end)) return `${scrubTime(start, range, regionId)} – ${scrubTime(end, range, regionId)}`;
  const style = range === "1D" || range === "1W" ? "activity-full" : "chart-date-year";
  return `${formatPresentationDate(start * 1000, { regionId, style })} – ${formatPresentationDate(end * 1000, { regionId, style })}`;
}
export function gapSince(start: number, end: number, range: MarketPriceRange, regionId: ReturnType<typeof usePresentationRegionId>) {
  return crossesYear(start, end) ? formatPresentationDate(end * 1000, { regionId, style: "chart-date-year" }) : scrubTime(end, range, regionId);
}
const barSeconds: Record<MarketPriceRange, number> = {
  "1D": 900, "1W": 3600, "1M": 14400, "3M": 86400, "1Y": 86400,
};
export function endsEarly(lastTime: number, range: MarketPriceRange, now: number, sampled = false) {
  const interval = sampled ? rangeSeconds[range] / (STOCK_HISTORY_MAX_POINTS - 1) : barSeconds[range];
  return lastTime < now / 1000 - Math.min(rangeSeconds[range] * 0.04, interval * 2);
}

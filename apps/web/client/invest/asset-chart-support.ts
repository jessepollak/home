"use client";

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatPresentationDate } from "@/shared/formatting";
import type { MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import type { usePresentationRegionId } from "./presentation-quote";

export type ChartReadout = { value: string; time: string; index: number };
export const rangeSeconds: Record<MarketPriceRange, number> = {
  "1D": 86400, "1W": 604800, "1M": 2592000, "3M": 7776000, "1Y": 31536000,
};
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
export function endsEarly(lastTime: number, range: MarketPriceRange, now: number) {
  return lastTime < now / 1000 - rangeSeconds[range] * 0.04;
}

"use client";

import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode,
} from "react";
import { Liveline, type LivelinePoint } from "liveline";
import { useAppearance } from "@/client/appearance/use-appearance";
import { getHomeQueryClient, publicQueryKey } from "@/client/query/query-client";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MARKET_PRICE_RANGES, type MarketPriceHistoryPoint, type MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import { formatChartPrice, formatPresentationDate, formatPresentationPrice, formatSignedPercentChange } from "@/shared/formatting";
import { usePresentationRegionId } from "./presentation-quote";
import { usePriceHistory, type PriceHistoryState } from "./use-price-history";

export type ChartReadout = { value: string; time: string; index: number };
type Plot = { id: number; range: MarketPriceRange; points: LivelinePoint[]; value: number; windowSecs: number };
const rangeSeconds: Record<MarketPriceRange, number> = {
  "1D": 86400, "1W": 604800, "1M": 2592000, "3M": 7776000, "1Y": 31536000,
};
const rangeLabels: Record<MarketPriceRange, string> = {
  "1D": "past day", "1W": "past week", "1M": "past month", "3M": "past 3 months", "1Y": "past year",
};
const plotPadding = { top: 20, right: 18, bottom: 20, left: 16 };
const motionQuery = "(prefers-reduced-motion: reduce)";
let plotId = 0;

function samePlot(a: Plot | undefined, b: Plot) {
  return a?.range === b.range && a.points.length === b.points.length
    && a.points.every((point, index) => point.time === b.points[index]?.time && point.value === b.points[index]?.value);
}
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
function pointX(time: number, plot: Plot, width: number, now: number) {
  const chartWidth = width - plotPadding.left - plotPadding.right;
  const rightEdge = now / 1000 + plot.windowSecs * 0.015;
  return plotPadding.left + (time - rightEdge + plot.windowSecs) / plot.windowSecs * chartWidth;
}
function pointY(value: number, plot: Plot, height: number, now: number) {
  const rightEdge = now / 1000 + plot.windowSecs * 0.015;
  const leftEdge = rightEdge - plot.windowSecs;
  const visible = plot.points.filter((point) => point.time >= leftEdge - 2 && point.time <= rightEdge);
  if (visible.length < 2) return null;
  const values = visible.map((point) => point.value);
  const minimum = Math.min(plot.value, ...values);
  const maximum = Math.max(plot.value, ...values);
  const span = maximum - minimum;
  const minRange = span * 0.1 || 0.4;
  const lower = span < minRange ? (minimum + maximum - minRange) / 2 : minimum - span * 0.12;
  const upper = span < minRange ? lower + minRange : maximum + span * 0.12;
  return plotPadding.top + (1 - (value - lower) / (upper - lower)) * (height - plotPadding.top - plotPadding.bottom);
}
export function endsEarly(lastTime: number, range: MarketPriceRange, now: number) {
  return lastTime < now / 1000 - rangeSeconds[range] * 0.04;
}
function plotChange(plot: Plot, regionId: ReturnType<typeof usePresentationRegionId>, now: number) {
  const first = plot.points[0];
  const last = plot.points.at(-1);
  if (!first || !last || plot.points.length < 2 || first.value <= 0) return null;
  const span = rangeSeconds[plot.range];
  const nominalStart = now / 1000 - span;
  const tolerance = span * 0.1;
  const startsLate = first.time > nominalStart + tolerance;
  const period = endsEarly(last.time, plot.range, now)
    ? `${scrubTime(first.time, plot.range, regionId)} – ${scrubTime(last.time, plot.range, regionId)}`
    : startsLate ? `since ${scrubTime(first.time, plot.range, regionId)}` : rangeLabels[plot.range];
  return `${formatSignedPercentChange((last.value - first.value) / first.value * 100, regionId)} · ${period}`;
}
function plotColor(plot: Plot) {
  const first = plot.points[0]?.value;
  const last = plot.points.at(-1)?.value;
  const token = first === undefined || last === undefined || first === last
    ? "--primary" : last > first ? "--market-gain" : "--market-loss";
  if (typeof document === "undefined") return "#0a7c4a";
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#0a7c4a";
}
function LivelineLayer({ children }: { children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const contexts = new Map<CanvasRenderingContext2D, {
      setLineDash: CanvasRenderingContext2D["setLineDash"];
      stroke: CanvasRenderingContext2D["stroke"];
    }>();
    const patchCanvases = () => {
      for (const canvas of element.querySelectorAll("canvas")) {
        const context = canvas.getContext("2d");
        if (!context || contexts.has(context)) continue;
        const setLineDash = context.setLineDash.bind(context);
        const stroke = context.stroke.bind(context);
        let dashed = context.getLineDash().length > 0;
        context.setLineDash = (segments) => { dashed = Array.from(segments).length > 0; setLineDash(segments); };
        context.stroke = (path?: Path2D) => {
          if (dashed) return;
          if (path) stroke(path);
          else stroke();
        };
        contexts.set(context, { setLineDash, stroke });
      }
    };
    patchCanvases();
    const observer = new MutationObserver(patchCanvases);
    observer.observe(element, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const [context, methods] of contexts) {
        context.setLineDash = methods.setLineDash;
        context.stroke = methods.stroke;
      }
    };
  }, []);
  return <div ref={layer} className="absolute inset-0">{children}</div>;
}
export function toLivelinePoints(points: readonly MarketPriceHistoryPoint[]): LivelinePoint[] {
  const series: LivelinePoint[] = [];
  for (const point of points) {
    const time = Date.parse(point.time) / 1000;
    const value = Number(point.value);
    if (Number.isFinite(time) && Number.isFinite(value)) series.push({ time, value });
  }
  return series;
}
export function visibleWindowSeconds(range: MarketPriceRange, points: readonly LivelinePoint[]) {
  const nominal = rangeSeconds[range];
  if (points.length === 0) return nominal;
  const first = points[0]!.time;
  const last = points[points.length - 1]!.time;
  const now = Date.now() / 1000;
  return Math.max(nominal, last - first + 1, now - first + 1);
}
function historyPlot(history: PriceHistoryState, range: MarketPriceRange): Plot | null {
  if (history.status !== "ready") return null;
  const points = toLivelinePoints(history.points);
  return points.length < 2 ? null : {
    id: ++plotId, range, points, value: points.at(-1)!.value, windowSecs: visibleWindowSeconds(range, points),
  };
}
function PrefetchedRange({ assetId, range, onPlot }: { assetId: string; range: MarketPriceRange; onPlot: (plot: Plot) => void }) {
  const { points, status } = usePriceHistory(assetId, range, { speculative: true });
  const plot = useMemo(() => historyPlot({ points, status }, range), [points, status, range]);
  useEffect(() => { if (plot) onPlot(plot); }, [plot, onPlot]);
  return null;
}
export function AssetChart({ assetId, range, onRangeChange, clock, onReadout, onResting }: {
  assetId: string;
  range: MarketPriceRange;
  onRangeChange: (range: MarketPriceRange) => void;
  clock: ChartClock;
  onReadout: (readout: ChartReadout | null) => void;
  onResting: (change: string | null, pending: boolean) => void;
}) {
  const { refresh: refreshClock } = clock;
  const history = usePriceHistory(assetId, range);
  const regionId = usePresentationRegionId();
  const { resolvedAppearance } = useAppearance();
  const reduced = useReducedMotion();
  const { points: historyPoints, status: historyStatus } = history;
  const next = useMemo(() => historyPlot({ points: historyPoints, status: historyStatus }, range),
    [historyPoints, historyStatus, range]);
  const [plots, setPlots] = useState<Partial<Record<MarketPriceRange, Plot>>>({});
  const [prefetchAssetId, setPrefetchAssetId] = useState<string | null>(null);
  const [visible, setVisible] = useState<MarketPriceRange | null>(null);
  const [resting, setResting] = useState<Partial<Record<MarketPriceRange, Plot>>>({});
  const [dimmedRange, setDimmedRange] = useState<MarketPriceRange | null>(null);
  const dimmed = dimmedRange === range && visible !== range;
  const gesture = useRef<{ id: number; x: number; y: number; direction: "pending" | "horizontal" | "vertical" } | null>(null);
  const [slow, setSlow] = useState(false);
  const [scrub, setScrub] = useState<ChartReadout | null>(null);
  const scrubIndex = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [scrubPosition, setScrubPosition] = useState<{ x: number; y: number } | null>(null);
  const missing = history.status === "error" || history.status === "empty" || history.status === "ready" && !next;
  const targetReady = !!next && !!plots[range] && resting[range]?.id === plots[range].id;
  const pending = !missing && !targetReady;
  const drawn = visible ? resting[visible] ?? null : null;
  const active = visible === range && !missing && !pending ? drawn : null;
  const coldLoad = history.status === "loading" && pending;
  useEffect(() => {
    if (prefetchAssetId === assetId || !targetReady || visible !== range || missing) return;
    if (window.requestIdleCallback) {
      const idle = window.requestIdleCallback(() => setPrefetchAssetId(assetId));
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(() => setPrefetchAssetId(assetId), 0);
    return () => window.clearTimeout(timer);
  }, [assetId, prefetchAssetId, targetReady, visible, range, missing]);
  const registerPlot = useCallback((plot: Plot) => {
    setPlots((old) => samePlot(old[plot.range], plot) ? old : { ...old, [plot.range]: plot });
  }, []);
  if (next && !samePlot(plots[range], next)) setPlots({ ...plots, [range]: next });
  const settling = useRef(new Map<MarketPriceRange, { id: number; timer: number }>());
  useEffect(() => {
    for (const value of MARKET_PRICE_RANGES) {
      const plot = plots[value];
      const current = settling.current.get(value);
      if (!plot || plot.id === resting[value]?.id) {
        if (current) window.clearTimeout(current.timer);
        settling.current.delete(value);
        continue;
      }
      if (current?.id === plot.id) continue;
      if (current) window.clearTimeout(current.timer);
      settling.current.set(value, { id: plot.id, timer: window.setTimeout(() => {
        settling.current.delete(value);
        setResting((old) => old[value]?.id === plot.id ? old : { ...old, [value]: plot });
      }, reduced ? 0 : 850) });
    }
  }, [plots, resting, reduced]);
  useEffect(() => {
    const timers = settling.current;
    return () => { timers.forEach(({ timer }) => window.clearTimeout(timer)); timers.clear(); };
  }, []);
  useEffect(() => {
    if (!targetReady || missing) return;
    const timer = window.setTimeout(() => {
      setVisible(range);
      setScrub(null);
      setScrubPosition(null);
      scrubIndex.current = null;
      onReadout(null);
    }, reduced ? 0 : visible === null ? 0 : 60);
    return () => window.clearTimeout(timer);
  }, [range, targetReady, missing, reduced, visible, onReadout]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setDimmedRange(range), 150);
    return () => window.clearTimeout(timer);
  }, [pending, range]);
  useEffect(() => {
    if (!coldLoad) return;
    const timer = window.setTimeout(() => setSlow(true), 1500);
    return () => { window.clearTimeout(timer); setSlow(false); };
  }, [coldLoad, range]);
  useEffect(() => {
    const element = stage.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      setStageSize({ width: box.width, height: box.height });
      refreshClock();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [refreshClock]);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(scrub ? `${scrub.value} USD, ${scrub.time}` : ""), 250);
    return () => window.clearTimeout(timer);
  }, [scrub]);
  const currentPlot = missing ? null : drawn;
  const change = currentPlot ? plotChange(currentPlot, regionId, clock.value) : null;
  useEffect(() => { onResting(change, !missing && (pending || visible !== range)); }, [change, missing, pending, visible, range, onResting]);
  function updateScrub(index: number | null) {
    if (scrubIndex.current === index) return;
    scrubIndex.current = index;
    const point = index === null ? null : active?.points[index];
    const box = stage.current?.getBoundingClientRect();
    const time = clock.read();
    const y = point && active && box ? pointY(point.value, active, box.height, time) : null;
    setScrubPosition(point && active && box ? {
      x: Math.max(plotPadding.left, Math.min(box.width - plotPadding.right, pointX(point.time, active, box.width, time))),
      y: y ?? box.height / 2,
    } : null);
    const readout = point && active ? {
      value: formatPresentationPrice(point.value.toString(), "USD", regionId) ?? formatChartPrice(point.value, { regionId }),
      time: scrubTime(point.time, active.range, regionId), index: index!,
    } : null;
    setScrub(readout);
    onReadout(readout);
  }
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!active) return;
    const end = active.points.length - 1;
    const time = clock.read();
    let index: number | null;
    if (event.key === "Escape") index = null;
    else if (event.key === "Home") index = Math.max(0, active.points.findIndex((point) =>
      pointX(point.time, active, stage.current?.getBoundingClientRect().width ?? 390, time) >= plotPadding.left));
    else if (event.key === "End") index = end;
    else if (event.key === "ArrowRight") index = Math.min(end, (scrub?.index ?? Math.max(-1,
      active.points.findIndex((point) => pointX(point.time, active,
        stage.current?.getBoundingClientRect().width ?? 390, time) >= plotPadding.left) - 1)) + 1);
    else if (event.key === "ArrowLeft") index = Math.max(0, (scrub?.index ?? end + 1) - 1);
    else return;
    event.preventDefault();
    updateScrub(index);
  }
  function handlePointer(event: PointerEvent<HTMLDivElement>) {
    if (!active) return;
    if (event.pointerType !== "mouse") {
      if (event.type === "pointerdown") {
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, direction: "pending" };
        return;
      }
      if (event.type === "pointerleave" || event.type === "pointercancel" || event.type === "pointerup") {
        gesture.current = null;
        updateScrub(null);
        return;
      }
      const touch = gesture.current;
      if (!touch || touch.id !== event.pointerId || touch.direction === "vertical") return;
      if (touch.direction === "pending") {
        const dx = Math.abs(event.clientX - touch.x);
        const dy = Math.abs(event.clientY - touch.y);
        if (dy > dx) { touch.direction = "vertical"; return; }
        if (dx < 6) return;
        touch.direction = "horizontal";
        if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
      }
    } else if (event.type === "pointerleave" || event.type === "pointercancel" || event.type === "pointerup") {
      updateScrub(null);
      return;
    }
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - box.left;
    if (x < plotPadding.left || x > box.width - plotPadding.right) { updateScrub(null); return; }
    const chartWidth = box.width - plotPadding.left - plotPadding.right;
    const time = clock.read() / 1000 + active.windowSecs * 0.015 - active.windowSecs
      + (x - plotPadding.left) / chartWidth * active.windowSecs;
    const index = active.points.reduce((closest, point, at) =>
      Math.abs(point.time - time) < Math.abs(active.points[closest]!.time - time) ? at : closest, 0);
    updateScrub(index);
  }
  const lastPoint = drawn?.points.at(-1);
  const lastX = lastPoint && drawn && stageSize.width ? pointX(lastPoint.time, drawn, stageSize.width, clock.value) : null;
  const visibleGap = !!drawn && !!lastPoint && endsEarly(lastPoint.time, drawn.range, clock.value);
  const gapWarning = active && endsEarly(active.points.at(-1)!.time, active.range, clock.value)
    ? `, no data since ${scrubTime(active.points.at(-1)!.time, active.range, regionId)}` : "";
  const lastY = visibleGap && lastPoint && drawn && stageSize.height ? pointY(lastPoint.value, drawn, stageSize.height, clock.value) : null;
  return (
    <section className="min-w-0" aria-label="Market price history">
      {prefetchAssetId === assetId ? MARKET_PRICE_RANGES.filter((value) => value !== range).map((value) =>
        <PrefetchedRange key={value} assetId={assetId} range={value} onPlot={registerPlot} />) : null}
      <div ref={stage} role={active ? "group" : "status"} aria-roledescription={active ? "chart" : undefined}
        aria-label={active ? `${{ "1D": "1 day", "1W": "1 week", "1M": "1 month", "3M": "3 months", "1Y": "1 year" }[range]} price history, ${active.points.length} points${gapWarning}`
          : missing ? history.status === "error" ? "Couldn't load price history" : "No price history for this range." : "Loading price history"}
        aria-describedby={active ? hintId : undefined}
        aria-busy={pending && dimmed || undefined}
        tabIndex={active ? 0 : undefined}
        onKeyDown={handleKey} onBlur={() => updateScrub(null)}
        onPointerDown={handlePointer} onPointerMove={handlePointer}
        onPointerLeave={handlePointer} onPointerUp={handlePointer} onPointerCancel={handlePointer}
        dir="ltr" className="relative -mx-4 h-64 min-w-0 overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-muted-foreground/20"
          style={{ opacity: drawn ? 0 : 1, transition: `opacity ${reduced ? 120 : 180}ms` }} />
        {MARKET_PRICE_RANGES.flatMap((value) => {
          const latest = plots[value];
          const previous = resting[value];
          return [latest, previous && previous.id !== latest?.id ? previous : null].filter((plot): plot is Plot => !!plot);
        }).map((data) => {
          const value = data.range;
          const isResting = resting[value]?.id === data.id;
          const shown = isResting && value === visible && !missing;
          const last = data.points.at(-1)!;
          const edge = stageSize.width ? pointX(last.time, data, stageSize.width, clock.value) : null;
          return <div key={data.id} aria-hidden="true" data-layer-range={value}
            data-layer-state={shown ? "shown" : isResting ? "ready" : "settling"}
            className="pointer-events-none absolute inset-0"
            style={{ opacity: shown ? visible !== range && dimmed ? 0.4 : 1 : 0,
              transition: `opacity ${reduced ? 120 : shown ? 180 : 120}ms ${shown ? "cubic-bezier(0.2,0,0,1) 60ms" : "cubic-bezier(0.4,0,0.2,1)"}` }}>
            <LivelineLayer>
              <Liveline data={data.points} value={data.value} window={data.windowSecs}
                theme={resolvedAppearance} color={plotColor(data)} fill pulse={false} momentum={false}
                paused={isResting && !shown}
                scrub={false} degen={false} badge={false} showValue={false} grid={false}
                tooltipY={-1000} tooltipOutline={false} lerpSpeed={0.8} lineWidth={2.5}
                formatTime={() => ""} formatValue={(number) => formatChartPrice(number, { regionId })}
                padding={plotPadding} style={{ height: "100%" }} />
            </LivelineLayer>
            {edge !== null ? <div className="absolute top-0 bottom-0 end-0 bg-(--asset-surface,var(--color-background))" style={{ insetInlineStart: edge + 1 }} /> : null}
            <div className="absolute inset-x-0 bottom-0 bg-(--asset-surface,var(--color-background))" style={{ height: plotPadding.bottom }} />
          </div>;
        })}
        {slow && coldLoad ? <span className="absolute inset-x-0 bottom-4 text-center text-sm">Still loading price history</span> : null}
        {missing ? <div className="absolute inset-0 bg-(--asset-surface,var(--color-background))"><Empty><EmptyHeader><EmptyTitle>
          {history.status === "error" ? "Couldn't load price history" : "No price history for this range."}
        </EmptyTitle></EmptyHeader>{history.status === "error" ? <Button variant="outline" size="touch"
          onClick={() => { void getHomeQueryClient().invalidateQueries({ queryKey: publicQueryKey("price-history", assetId, range) }); }}>
          Try again
        </Button> : null}</Empty></div> : null}
        {visibleGap && lastX !== null && lastPoint && !missing ? <div aria-hidden="true"
          className="pointer-events-none absolute top-5 bottom-5 end-0 z-1 bg-(--asset-surface,var(--color-background))" style={{ insetInlineStart: lastX + 1 }}>
          {lastY !== null && !pending ? <span data-last-point className="absolute size-2 rounded-full"
            style={{ insetInlineStart: -5, top: lastY - plotPadding.top - 4, backgroundColor: plotColor(drawn!) }} /> : null}
        </div> : null}
        {visibleGap && lastPoint && !missing ? <span aria-hidden="true"
          className={`pointer-events-none absolute end-2 z-2 rounded-sm bg-(--asset-surface,var(--color-background)) px-1 text-xs text-muted-foreground whitespace-nowrap ${lastY !== null && lastY < stageSize.height / 2 ? "bottom-8" : "top-8"}`}>
          No data since {scrubTime(lastPoint.time, drawn!.range, regionId)}
        </span> : null}
        {active ? <div aria-hidden="true" className="absolute inset-0 touch-pan-y" /> : null}
        <div aria-hidden="true" data-scrub-cursor className="pointer-events-none absolute top-5 bottom-5 w-px bg-border"
          style={{ insetInlineStart: scrubPosition?.x ?? 0, opacity: scrub && scrubPosition && active ? 1 : 0, transition: "opacity 80ms" }}>
          <span className="absolute -translate-x-1/2 size-2 rounded-full border-2 border-background"
            style={{ top: (scrubPosition?.y ?? 0) - plotPadding.top - 4, backgroundColor: active ? plotColor(active) : "var(--primary)" }} />
        </div>
      </div>
      <span id={hintId} className="sr-only">Use the left and right arrow keys to move between points. Home and End jump to the first and last point. Escape stops.</span>
      <span className="sr-only" aria-live="polite">{announcement}</span>
      <ToggleGroup value={[range]} onValueChange={(values) => {
        if (values[0]) onRangeChange(values[0] as MarketPriceRange);
      }} aria-label="Price range" spacing={1} className="mt-2 w-full">
        {MARKET_PRICE_RANGES.map((value) => <ToggleGroupItem key={value} value={value} className="h-11 min-w-0 flex-1">{value}</ToggleGroupItem>)}
      </ToggleGroup>
    </section>
  );
}

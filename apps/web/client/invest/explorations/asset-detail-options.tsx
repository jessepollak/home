"use client";

import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent,
} from "react";
import { ArrowLeft } from "lucide-react";
import { Liveline, type LivelinePoint } from "liveline";
import { AssetIcon } from "@/client/invest/asset-icon";
import { presentInvestAssetMark } from "@/client/asset-mark/presentation";
import { useMarketDisplay } from "@/client/invest/use-market-display";
import { usePriceHistory, type PriceHistoryState } from "@/client/invest/use-price-history";
import { toLivelinePoints, visibleWindowSeconds } from "@/client/invest/price-chart";
import { usePresentationQuote, usePresentationRegionId } from "@/client/invest/presentation-quote";
import { getHomeQueryClient, publicQueryKey } from "@/client/query/query-client";
import { TradeActions } from "@/client/trading/trade-actions";
import { BalanceRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { InvestAsset } from "@/config/invest-assets";
import type { HoldingBalance, HoldingValue } from "@/shared/balances/types";
import { MARKET_PRICE_RANGES, type MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { getTradeAssetStatus } from "@/shared/trading/assets";
import {
  formatChartPrice, formatExactPresentationTokenAmount, formatFiatAmount, formatPresentationDate,
  formatPresentationPrice, formatSignedPercentChange, moneyChangeTone,
} from "@/shared/formatting";

export type ExplorationHolding = {
  balance: HoldingBalance;
  decimals: number;
  tokenSymbol: string;
  value: HoldingValue;
  valuation: "codex" | "chainlink-total-return-624-fixture";
  listing: "listed" | "paused-624-fixture" | "removed-624-fixture";
};
export type ProposedMarketStats = {
  marketCapUsd?: string;
  volume24hUsd?: string;
  liquidityUsd?: string;
  asOf: string;
};
export type AssetOptionProps = {
  asset: InvestAsset;
  market: MarketDataState;
  holding?: ExplorationHolding;
  marketStats?: ProposedMarketStats;
  range: MarketPriceRange;
  onRangeChange: (range: MarketPriceRange) => void;
  onBack: () => void;
  now?: number;
  reducedMotion?: boolean;
  slowAfterMs?: number;
  labels?: { name?: string; state?: string; chips?: string };
};
type Plot = { range: MarketPriceRange; points: LivelinePoint[]; value: number; windowSecs: number };
type Readout = { value: string; time: string; index: number };
const rangeSeconds: Record<MarketPriceRange, number> = {
  "1D": 86400, "1W": 604800, "1M": 2592000, "3M": 7776000, "1Y": 31536000,
};
const rangeLabels: Record<MarketPriceRange, string> = {
  "1D": "past day", "1W": "past week", "1M": "past month", "3M": "past 3 months", "1Y": "past year",
};
const motionQuery = "(prefers-reduced-motion: reduce)";
const defaultNow = Date.now();
const plotPadding = { top: 20, right: 18, bottom: 20, left: 16 };
function subscribeMotion(notify: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
function motionSnapshot() { return typeof window !== "undefined" && !!window.matchMedia?.(motionQuery).matches; }
function useReducedMotion(override?: boolean) {
  const preference = useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
  return override ?? preference;
}
function scrubTime(time: number, range: MarketPriceRange, regionId: ReturnType<typeof usePresentationRegionId>) {
  return formatPresentationDate(time * 1000, { regionId, style: range === "1D" || range === "1W"
    ? "activity-short" : "chart-date" });
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
  return plotPadding.top + (1 - (value - lower) / (upper - lower))
    * (height - plotPadding.top - plotPadding.bottom);
}
function plotChange(plot: Plot, regionId: ReturnType<typeof usePresentationRegionId>, now: number) {
  const first = plot.points[0];
  const last = plot.points.at(-1);
  if (!first || !last || plot.points.length < 2 || first.value <= 0) return null;
  const span = rangeSeconds[plot.range];
  const nominalStart = now / 1000 - span;
  const tolerance = span * 0.1;
  const startsLate = first.time > nominalStart + tolerance;
  const endsEarly = last.time < now / 1000 - tolerance;
  const period = endsEarly
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

function LivelineLayer({ children }: { children: React.ReactNode }) {
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
        context.setLineDash = (segments) => {
          dashed = Array.from(segments).length > 0;
          setLineDash(segments);
        };
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

function historyPlot(history: PriceHistoryState, range: MarketPriceRange): Plot | null {
  if (history.status !== "ready") return null;
  const points = toLivelinePoints(history.points);
  return points.length < 2 ? null : {
    range, points, value: points.at(-1)!.value, windowSecs: visibleWindowSeconds(range, points),
  };
}
function PrefetchedRange({ assetId, range, onPlot }: {
  assetId: string; range: MarketPriceRange; onPlot: (plot: Plot) => void;
}) {
  const { points, status } = usePriceHistory(assetId, range);
  const plot = useMemo(() => historyPlot({ points, status }, range), [points, status, range]);
  useEffect(() => { if (plot) onPlot(plot); }, [plot, onPlot]);
  return null;
}

export function ExplorationChart({
  assetId, range, onRangeChange, now = defaultNow, reducedMotion, slowAfterMs = 1500,
  onReadout, onResting, stateLabel, chipLabel,
}: {
  assetId: string;
  range: MarketPriceRange;
  onRangeChange: (range: MarketPriceRange) => void;
  now?: number;
  reducedMotion?: boolean;
  slowAfterMs?: number;
  onReadout?: (readout: Readout | null) => void;
  onResting?: (change: string | null, pending: boolean) => void;
  stateLabel?: string;
  chipLabel?: string;
}) {
  const history = usePriceHistory(assetId, range);
  const { points, status } = history;
  const regionId = usePresentationRegionId();
  const reduced = useReducedMotion(reducedMotion);
  const next = useMemo(() => historyPlot({ points, status }, range), [points, status, range]);
  const [firstRange] = useState(range);
  const [plots, setPlots] = useState<Partial<Record<MarketPriceRange, Plot>>>({});
  const [visible, setVisible] = useState<MarketPriceRange | null>(null);
  const [settled, setSettled] = useState<MarketPriceRange[]>([]);
  const [dimmedRange, setDimmedRange] = useState<MarketPriceRange | null>(null);
  const dimmed = dimmedRange === range && visible !== range;
  const gesture = useRef<{ id: number; x: number; y: number; direction: "pending" | "horizontal" | "vertical" } | null>(null);
  const [slow, setSlow] = useState(false);
  const [scrub, setScrub] = useState<Readout | null>(null);
  const scrubIndex = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [stageSize, setStageSize] = useState({ width: 0, height: 0, clock: now });
  const [scrubPosition, setScrubPosition] = useState<{ x: number; y: number } | null>(null);
  const missing = history.status === "error" || history.status === "empty";
  const targetReady = !!next && !!plots[range] && settled.includes(range);
  const pending = !missing && !targetReady;
  const drawn = visible ? plots[visible] ?? null : null;
  const active = !pending && visible === range && !missing ? drawn : null;
  const coldLoad = history.status === "loading" && pending;
  const registerPlot = useCallback((plot: Plot) => {
    setPlots((old) => old[plot.range] === plot ? old : { ...old, [plot.range]: plot });
  }, []);
  if (next && (plots[range]?.points.length !== next.points.length
    || plots[range]?.points.some((point, index) => point.time !== next.points[index]?.time
      || point.value !== next.points[index]?.value))) setPlots({ ...plots, [range]: next });
  useEffect(() => {
    const timers = MARKET_PRICE_RANGES.filter((value) => plots[value] && !settled.includes(value))
      .map((value) => window.setTimeout(() => setSettled((old) => old.includes(value) ? old : [...old, value]),
        reduced ? 0 : 850));
    return () => timers.forEach(window.clearTimeout);
  }, [plots, settled, reduced]);
  useEffect(() => {
    if (!targetReady || missing) return;
    const timer = window.setTimeout(() => {
      setVisible(range);
      setScrub(null);
      setScrubPosition(null);
      scrubIndex.current = null;
      onReadout?.(null);
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
    const timer = window.setTimeout(() => setSlow(true), slowAfterMs);
    return () => { window.clearTimeout(timer); setSlow(false); };
  }, [coldLoad, slowAfterMs, range]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      setStageSize({ width: box.width, height: box.height, clock: Date.now() });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(scrub ? `${scrub.value} USD, ${scrub.time}` : ""), 250);
    return () => window.clearTimeout(timer);
  }, [scrub]);
  const currentPlot = missing ? null : plots[range];
  const change = currentPlot ? plotChange(currentPlot, regionId, now) : null;
  useEffect(() => { onResting?.(change, !missing && (pending || visible !== range)); }, [change, missing, pending, visible, range, onResting]);
  function updateScrub(index: number | null) {
    if (scrubIndex.current === index) return;
    scrubIndex.current = index;
    const point = index === null ? null : active?.points[index];
    const box = stage.current?.getBoundingClientRect();
    const y = point && active && box ? pointY(point.value, active, box.height, Date.now()) : null;
    setScrubPosition(point && active && box ? {
      x: Math.max(plotPadding.left, Math.min(box.width - plotPadding.right,
        pointX(point.time, active, box.width, Date.now()))),
      y: y ?? box.height / 2,
    } : null);
    const readout = point && active ? {
      value: formatPresentationPrice(point.value.toString(), "USD", regionId)
        ?? formatChartPrice(point.value),
      time: scrubTime(point.time, active.range, regionId), index: index!,
    } : null;
    setScrub(readout);
    onReadout?.(readout);
  }
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!active) return;
    const end = active.points.length - 1;
    let index: number | null;
    if (event.key === "Escape") index = null;
    else if (event.key === "Home") index = Math.max(0, active.points.findIndex((point) =>
      pointX(point.time, active, stage.current?.getBoundingClientRect().width ?? 390, Date.now()) >= plotPadding.left));
    else if (event.key === "End") index = end;
    else if (event.key === "ArrowRight") index = Math.min(end, (scrub?.index ?? Math.max(-1,
      active.points.findIndex((point) => pointX(point.time, active,
        stage.current?.getBoundingClientRect().width ?? 390, Date.now()) >= plotPadding.left) - 1)) + 1);
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
    if (x < plotPadding.left || x > box.width - plotPadding.right) {
      updateScrub(null);
      return;
    }
    const chartWidth = box.width - plotPadding.left - plotPadding.right;
    const time = Date.now() / 1000 + active.windowSecs * 0.015 - active.windowSecs
      + (x - plotPadding.left) / chartWidth * active.windowSecs;
    const index = active.points.reduce((closest, point, at) =>
      Math.abs(point.time - time) < Math.abs(active.points[closest]!.time - time) ? at : closest, 0);
    updateScrub(index);
  }
  const lastPoint = drawn?.points.at(-1);
  const lastX = lastPoint && drawn && stageSize.width
    ? pointX(lastPoint.time, drawn, stageSize.width, stageSize.clock) : null;
  const visibleGap = lastX !== null && lastX < stageSize.width - plotPadding.right
    - (stageSize.width - plotPadding.left - plotPadding.right) * 0.04;
  const lastY = visibleGap && lastPoint && drawn && stageSize.height
    ? pointY(lastPoint.value, drawn, stageSize.height, stageSize.clock) : null;
  return (
    <section className="min-w-0" aria-label="Market price history">
      {plots[firstRange] ? MARKET_PRICE_RANGES.filter((value) => value !== firstRange).map((value) =>
        <PrefetchedRange key={value} assetId={assetId} range={value} onPlot={registerPlot} />) : null}
      <div ref={stage} role={active ? "group" : "status"} aria-roledescription={active ? "chart" : undefined}
        aria-label={active ? `${{ "1D": "1 day", "1W": "1 week", "1M": "1 month", "3M": "3 months", "1Y": "1 year" }[range]} price history, ${active.points.length} points`
          : missing ? stateLabel ?? (history.status === "error" ? "Couldn't load price history"
            : "No price history for this range.") : "Loading price history"}
        aria-describedby={active ? hintId : undefined}
        aria-busy={pending && dimmed || undefined}
        tabIndex={active ? 0 : undefined}
        onKeyDown={handleKey} onBlur={() => updateScrub(null)}
        onPointerDown={handlePointer} onPointerMove={handlePointer}
        onPointerLeave={handlePointer} onPointerUp={handlePointer} onPointerCancel={handlePointer}
        dir="ltr" className="relative -mx-4 h-64 min-w-0 overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-muted-foreground/20"
          style={{ opacity: drawn ? 0 : 1, transition: `opacity ${reduced ? 120 : 180}ms` }} />
        {MARKET_PRICE_RANGES.map((value) => {
          const data = plots[value];
          if (!data) return null;
          const shown = value === visible && !missing;
          const last = data.points.at(-1)!;
          const edge = stageSize.width ? pointX(last.time, data, stageSize.width, stageSize.clock) : null;
          return <div key={value} aria-hidden="true" data-layer-range={value}
            data-layer-state={shown ? "shown" : settled.includes(value) ? "ready" : "settling"}
            className="pointer-events-none absolute inset-0"
            style={{ opacity: shown ? visible !== range && dimmed ? 0.4 : 1 : 0,
              transition: `opacity ${reduced ? 120 : shown ? 180 : 120}ms ${shown ? "cubic-bezier(0.2,0,0,1) 60ms" : "cubic-bezier(0.4,0,0.2,1)"}` }}>
            <LivelineLayer>
              <Liveline data={data.points} value={data.value} window={data.windowSecs}
                theme="light" color={plotColor(data)} fill pulse={false} momentum={false}
                paused={settled.includes(value) && value !== visible}
                scrub={false} degen={false} badge={false} showValue={false} grid={false}
                tooltipY={-1000} tooltipOutline={false} lerpSpeed={0.8} lineWidth={2.5}
                formatTime={() => ""} formatValue={(number) => formatChartPrice(number)}
                padding={plotPadding} style={{ height: "100%" }} />
            </LivelineLayer>
            {edge !== null ? <div className="absolute top-0 bottom-0 end-0 bg-background"
              style={{ insetInlineStart: edge + 1 }} /> : null}
            <div className="absolute inset-x-0 bottom-0 bg-background" style={{ height: plotPadding.bottom }} />
          </div>;
        })}
        {slow && coldLoad ? <span className="absolute inset-x-0 bottom-4 text-center text-sm">Still loading price history</span> : null}
        {missing ? <div className="absolute inset-0 bg-background"><Empty><EmptyHeader><EmptyTitle>
          {history.status === "error" ? stateLabel ?? "Couldn't load price history"
            : stateLabel ?? "No price history for this range."}
        </EmptyTitle></EmptyHeader>{history.status === "error" ? <Button variant="outline" size="touch"
          onClick={() => { void getHomeQueryClient().invalidateQueries({ queryKey: publicQueryKey("price-history", assetId, range) }); }}>
          Try again
        </Button> : null}</Empty></div> : null}
        {visibleGap && lastX !== null && lastPoint && !missing ? <div aria-hidden="true"
          className="pointer-events-none absolute top-5 bottom-5 end-0 z-1 bg-background"
          style={{ insetInlineStart: lastX + 1 }}>
          {lastY !== null && !pending ? <span data-last-point className="absolute size-2 rounded-full"
            style={{ insetInlineStart: -5, top: lastY - plotPadding.top - 4, backgroundColor: plotColor(drawn!) }} /> : null}
        </div> : null}
        {visibleGap && lastPoint && !missing ? <span aria-hidden="true"
          className={`pointer-events-none absolute end-2 z-2 rounded-sm bg-background px-1 text-xs text-muted-foreground whitespace-nowrap ${
            lastY !== null && lastY < stageSize.height / 2 ? "bottom-8" : "top-8"}`}>
          No data since {formatPresentationDate(lastPoint.time * 1000, { regionId, style: "chart-date" })}
        </span> : null}
        {active ? <div aria-hidden="true" className="absolute inset-0 touch-pan-y" /> : null}
        <div aria-hidden="true" data-scrub-cursor className="pointer-events-none absolute top-5 bottom-5 w-px bg-border"
          style={{ insetInlineStart: scrubPosition?.x ?? 0, opacity: scrub && scrubPosition && active ? 1 : 0,
            transition: "opacity 80ms" }}>
          <span className="absolute -translate-x-1/2 size-2 rounded-full border-2 border-background"
            style={{ top: (scrubPosition?.y ?? 0) - plotPadding.top - 4,
              backgroundColor: active ? plotColor(active) : "var(--primary)" }} />
        </div>
      </div>
      <span id={hintId} className="sr-only">Use the left and right arrow keys to move between points. Home and End jump to the first and last point. Escape stops.</span>
      <span className="sr-only" aria-live="polite">{announcement}</span>
      <ToggleGroup value={[range]} onValueChange={(values) => {
        if (values[0]) onRangeChange(values[0] as MarketPriceRange);
      }} aria-label="Price range" spacing={1} className="mt-2 w-full">
        {MARKET_PRICE_RANGES.map((value) => <ToggleGroupItem key={value} value={value}
          className="h-11 min-w-0 flex-1" aria-label={chipLabel ? `${chipLabel} ${value}` : undefined}>
          {value}
        </ToggleGroupItem>)}
      </ToggleGroup>
    </section>
  );
}

function HoldingRow({ asset, holding, market }: { asset: InvestAsset; holding: ExplorationHolding; market: MarketDataState }) {
  const quote = usePresentationQuote();
  const regionId = usePresentationRegionId();
  const quantity = holding.balance.status === "ready"
    ? formatExactPresentationTokenAmount(holding.balance.baseUnits, holding.decimals, holding.tokenSymbol)
    : "Balance unavailable";
  const value = holding.listing === "listed" && holding.value.status === "priced"
    ? holding.value.currency === "USD" && quote.valueCurrency && quote.valueCurrency !== "USD"
      ? quote.quoteUnitsPerUsd
        ? formatFiatAmount(BigInt(holding.value.amount.atoms) * BigInt(quote.quoteUnitsPerUsd.atoms),
          holding.value.amount.scale + quote.quoteUnitsPerUsd.scale, quote.valueCurrency, { regionId })
        : "—"
      : formatFiatAmount(BigInt(holding.value.amount.atoms), holding.value.amount.scale, holding.value.currency, { regionId })
    : "—";
  const context = holding.listing === "paused-624-fixture" ? "Valuation paused"
    : holding.listing === "removed-624-fixture" ? "No longer listed in Invest"
    : holding.value.status === "unpriced" ? "Price delayed"
    : holding.valuation === "chainlink-total-return-624-fixture" ? "Includes dividends"
    : market.status === "error" ? "Price delayed" : undefined;
  return <BalanceRow icon={<AssetIcon mark={presentInvestAssetMark(asset)} />} iconTone="mark"
    label="Your balance" context={quantity} value={value} valueContext={context} chevron={false} />;
}
function RangeStat({ history, day, range, now, snapshotPrice }: {
  history: PriceHistoryState; day: PriceHistoryState; range: "1D" | "1Y";
  now: number; snapshotPrice: number | null;
}) {
  const regionId = usePresentationRegionId();
  if (history.status !== "ready" || history.points.length < 2) return null;
  const last = history.points.at(-1)!;
  if (Date.parse(last.time) < now - (range === "1D" ? 86400000 : 7 * 86400000)) return null;
  const closes = [...history.points, ...(range === "1Y" && day.status === "ready" ? day.points : [])]
    .map((point) => Number(point.value));
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const current = snapshotPrice ?? Number(last.value);
  const first = history.points[0]!;
  const label = range === "1D" ? "Past 24h"
    : Date.parse(first.time) > now - rangeSeconds["1Y"] * 1000 * 0.9
      ? `Since ${formatPresentationDate(Date.parse(first.time), { regionId, style: "chart-date" })}` : "Past year";
  const formattedLow = formatPresentationPrice(low.toString(), "USD", regionId);
  const formattedHigh = formatPresentationPrice(high.toString(), "USD", regionId);
  const formattedCurrent = formatPresentationPrice(current.toString(), "USD", regionId);
  return <div role="group" aria-label={`${label} low ${formattedLow}, high ${formattedHigh}, current ${formattedCurrent}`}
    className="space-y-2 py-2">
    <p className="text-sm font-medium">{label}</p>
    <div className="flex items-center gap-3 text-xs tabular-nums">
      <span className="shrink-0">{formattedLow}</span>
      <div aria-hidden="true" className="relative h-1 min-w-0 flex-1 rounded-full bg-muted">
        <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground"
          style={{ insetInlineStart: `${high === low ? 50 : Math.max(0, Math.min(100, (current - low) / (high - low) * 100))}%` }} />
      </div>
      <span className="shrink-0">{formattedHigh}</span>
    </div>
  </div>;
}
function formatStatUsd(value: string) {
  return formatChartPrice(Number(value).toPrecision(3))
    .replace(/(\.\d*?)0+([A-Z]+)$/, "$1$2")
    .replace(/\.(?=[A-Z]+$)/, "");
}
function AssetStats({ asset, market, marketStats, now }: {
  asset: InvestAsset; market: MarketDataState; marketStats?: ProposedMarketStats; now: number;
}) {
  const day = usePriceHistory(asset.id, "1D");
  const year = usePriceHistory(asset.id, "1Y");
  const quote = usePresentationQuote();
  const snapshot = market.status === "ready" ? market.snapshots.find((item) => item.assetId === asset.id) : undefined;
  const parsedPrice = snapshot ? Number(snapshot.displayPrice.replace(/[$,]/g, "")) : NaN;
  const snapshotPrice = Number.isFinite(parsedPrice) ? parsedPrice : null;
  const hasRow = (history: PriceHistoryState, maxAge: number) => history.status === "ready"
    && history.points.length >= 2 && Date.parse(history.points.at(-1)!.time) >= now - maxAge;
  const tiles = asset.category === "stock" || !marketStats ? [] : [
    ["Market cap", marketStats.marketCapUsd], ["24h volume", marketStats.volume24hUsd],
    ...(asset.category === "meme" ? [["Liquidity", marketStats.liquidityUsd]] : []),
  ].filter((item): item is string[] => !!item[1]);
  if (!tiles.length && !hasRow(day, 86400000) && !hasRow(year, 7 * 86400000)) return null;
  const heading = quote.valueCurrency && quote.valueCurrency !== "USD" ? "Stats · USD" : "Stats";
  return <section aria-label={heading} className="space-y-2">
    <h3 className="text-sm font-semibold">{heading}</h3>
    <div className="divide-y"><RangeStat history={day} day={day} range="1D" now={now} snapshotPrice={snapshotPrice} />
      <RangeStat history={year} day={day} range="1Y" now={now} snapshotPrice={snapshotPrice} /></div>
    {tiles.length ? <div className="grid grid-cols-2 gap-2 max-[22rem]:grid-cols-1">
      {tiles.map(([label, value]) => <Item key={label} size="sm" variant="muted">
        <ItemContent><ItemDescription>{label}</ItemDescription>
          <ItemTitle numeric>{formatStatUsd(value!)}</ItemTitle></ItemContent>
      </Item>)}
    </div> : null}
  </section>;
}
function PinnedTradeBar({ asset, reducedMotion }: { asset: InvestAsset; reducedMotion?: boolean }) {
  const reduced = useReducedMotion(reducedMotion);
  const [desktop, setDesktop] = useState(false);
  const [shown, setShown] = useState(true);
  const bar = useRef<HTMLDivElement>(null);
  const status = getTradeAssetStatus(asset.id);
  const tradeStatus = status?.status;
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (reduced || desktop || !tradeStatus || tradeStatus === "eligibility-required") return;
    const element = bar.current;
    if (!element) return;
    let source: HTMLElement | Window = window;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
        source = node;
        break;
      }
    }
    let previous = source === window ? window.scrollY : (source as HTMLElement).scrollTop;
    let distance = 0;
    let direction = 0;
    let timer: number | undefined;
    const show = () => { setShown(true); distance = 0; };
    const scroll = () => {
      const top = source === window ? window.scrollY : (source as HTMLElement).scrollTop;
      const height = source === window ? window.innerHeight : (source as HTMLElement).clientHeight;
      const total = source === window ? document.documentElement.scrollHeight : (source as HTMLElement).scrollHeight;
      const delta = top - previous;
      previous = top;
      if (delta && Math.sign(delta) !== direction) { distance = 0; direction = Math.sign(delta); }
      distance += Math.abs(delta);
      if (total - top - height <= 8) show();
      else if (delta < 0 && distance >= 8) show();
      else if (delta > 0 && top > 64 && distance >= 24 && !element.contains(document.activeElement)) {
        setShown(false); distance = 0;
      }
      if (!("onscrollend" in source)) {
        window.clearTimeout(timer);
        timer = window.setTimeout(show, 400);
      }
    };
    source.addEventListener("scroll", scroll, { passive: true });
    source.addEventListener("scrollend", show);
    element.addEventListener("focusin", show);
    return () => {
      source.removeEventListener("scroll", scroll);
      source.removeEventListener("scrollend", show);
      element.removeEventListener("focusin", show);
      window.clearTimeout(timer);
    };
  }, [asset.id, reduced, desktop, tradeStatus]);
  if (!status) return null;
  if (status.status === "eligibility-required") return <TradeActions asset={asset} layout="sticky" />;
  return <div ref={bar} data-state={shown || reduced || desktop ? "shown" : "hidden"}
    className="sticky bottom-0 z-2 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    style={{ transform: shown || reduced || desktop ? "translateY(0)" : "translateY(100%)",
      pointerEvents: shown || reduced || desktop ? undefined : "none",
      transition: reduced ? "none" : `transform ${shown ? 180 : 160}ms cubic-bezier(${shown ? "0.2,0,0,1" : "0.4,0,0.2,1"})` }}>
    <TradeActions asset={asset} layout="sticky" />
  </div>;
}
export function OptionA({
  asset, market, holding, marketStats, range, onRangeChange, onBack,
  now = defaultNow, reducedMotion, slowAfterMs, labels,
}: AssetOptionProps) {
  const price = useMarketDisplay(asset.id, market);
  const quote = usePresentationQuote();
  const [scrub, setScrub] = useState<Readout | null>(null);
  const [resting, setResting] = useState<{ change: string | null; pending: boolean }>({ change: null, pending: true });
  const rangeChange = resting.change
    ? quote.valueCurrency === "USD" ? resting.change : resting.change.replace(" · ", " in USD · ") : null;
  const change = rangeChange;
  return <section aria-label="Asset detail"
    className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-4 overflow-x-clip px-4 py-4 sm:px-0">
    <div className="flex min-w-0 items-center gap-2">
      <Button variant="ghost" size="icon" className="size-11" onClick={onBack} aria-label="Back">
        <ArrowLeft aria-hidden="true" />
      </Button>
      <AssetIcon mark={presentInvestAssetMark(asset)} />
      <h2 className="truncate text-lg font-semibold">{labels?.name ?? asset.displayName}</h2>
    </div>
    <div className="min-w-0 space-y-1">
      <strong className={`block min-h-12 truncate text-3xl font-semibold tabular-nums sm:min-h-14 sm:text-4xl ${price.tone === "ready" ? "" : "text-muted-foreground"}`}
        data-tone={price.tone}>
        {scrub && !resting.pending ? `${scrub.value}${quote.valueCurrency !== "USD" ? " USD" : ""}`
          : price.tone === "ready" ? <MoneyTicker value={price.value} align="start" />
            : market.status === "loading" ? <Skeleton className="h-9 w-36" /> : "—"}
      </strong>
      {price.tone !== "ready" && market.status !== "loading" ? <p className="text-sm text-muted-foreground">{price.detail}</p> : null}
      {scrub && !resting.pending ? <p className="min-h-5 text-sm" data-scrub-readout>{scrub.time}</p>
        : <p aria-busy={resting.pending || undefined}
          className={`min-h-5 text-sm ${resting.pending || !change ? "text-muted-foreground"
            : moneyChangeTone(change) === "positive" ? "text-market-gain"
              : moneyChangeTone(change) === "negative" ? "text-market-loss" : "text-muted-foreground"}`}>
          {change}
        </p>}
    </div>
    <ExplorationChart assetId={asset.id} range={range} onRangeChange={onRangeChange}
      now={now} reducedMotion={reducedMotion} slowAfterMs={slowAfterMs}
      stateLabel={labels?.state} chipLabel={labels?.chips} onReadout={setScrub}
      onResting={(value, pending) => setResting((old) => old.change === value && old.pending === pending
        ? old : { change: value, pending })} />
    {holding ? <ul><HoldingRow asset={asset} holding={holding} market={market} /></ul> : null}
    <AssetStats asset={asset} market={market} marketStats={marketStats} now={now} />
    {asset.category === "stock" ? <TradeActions asset={asset} layout="sticky" /> : null}
    <p className="text-xs text-muted-foreground">Market prices in USD from Codex.{holding?.valuation === "chainlink-total-return-624-fixture" && asset.category === "stock" ? " Your balance uses a price that includes dividends." : ""}</p>
    {asset.category !== "stock" ? <PinnedTradeBar asset={asset} reducedMotion={reducedMotion} /> : null}
  </section>;
}

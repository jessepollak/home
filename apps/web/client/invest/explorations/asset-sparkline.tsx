"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Liveline, type LivelinePoint } from "liveline";
import { useAppearance } from "@/client/appearance/use-appearance";
import { getHomeQueryClient, publicQueryKey } from "@/client/query/query-client";
import { Button } from "@/components/ui/button";
import { formatChartPrice, formatPresentationDate, formatPresentationPrice, formatSignedPercentChange } from "@/shared/formatting";
import { toLivelinePoints, visibleWindowSeconds } from "../asset-chart";
import { endsEarly, rangeLabels, rangeSeconds, scrubTime, useReducedMotion, type ChartClock, type ChartReadout } from "../asset-chart-support";
import { usePresentationRegionId } from "../presentation-quote";
import { usePriceHistory } from "../use-price-history";

const plotPadding = { top: 8, right: 16, bottom: 8, left: 16 };

function pointX(time: number, windowSecs: number, width: number, now: number) {
  const rightEdge = now / 1000 + windowSecs * 0.015;
  return plotPadding.left + (time - rightEdge + windowSecs) / windowSecs * (width - plotPadding.left - plotPadding.right);
}

function pointY(value: number, points: LivelinePoint[], windowSecs: number, height: number, now: number) {
  const rightEdge = now / 1000 + windowSecs * 0.015;
  const visible = points.filter((point) => point.time >= rightEdge - windowSecs - 2 && point.time <= rightEdge);
  if (visible.length < 2) return null;
  const values = visible.map((point) => point.value);
  const minimum = Math.min(points.at(-1)!.value, ...values);
  const maximum = Math.max(points.at(-1)!.value, ...values);
  const span = maximum - minimum;
  const minRange = span * 0.1 || 0.4;
  const lower = span < minRange ? (minimum + maximum - minRange) / 2 : minimum - span * 0.12;
  const upper = span < minRange ? lower + minRange : maximum + span * 0.12;
  return plotPadding.top + (1 - (value - lower) / (upper - lower)) * (height - plotPadding.top - plotPadding.bottom);
}

function plotColor(points: LivelinePoint[]) {
  const first = points[0]?.value;
  const last = points.at(-1)?.value;
  const token = first === undefined || last === undefined || first === last
    ? "--primary" : last > first ? "--market-gain" : "--market-loss";
  if (typeof document === "undefined") return "#0a7c4a";
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#0a7c4a";
}

export function AssetSparkline({ assetId, clock, onReadout, onResting }: {
  assetId: string;
  clock: ChartClock;
  onReadout: (readout: ChartReadout | null) => void;
  onResting: (change: string | null, pending: boolean) => void;
}) {
  const history = usePriceHistory(assetId, "1D");
  const regionId = usePresentationRegionId();
  const { resolvedAppearance } = useAppearance();
  const reduced = useReducedMotion();
  const historyPoints = history.status === "ready" || history.status === "stale" ? history.points : null;
  const points = useMemo(() => toLivelinePoints(historyPoints ?? []), [historyPoints]);
  const windowSecs = useMemo(() => visibleWindowSeconds("1D", points), [points]);
  const ready = (history.status === "ready" || history.status === "stale") && points.length >= 2;
  const coverage = history.status === "ready" || history.status === "stale" ? history.coverage : undefined;
  const failed = history.status === "error" || !ready && !!coverage?.gaps.some((gap) => gap.reason === "read-failed" || gap.reason === "incomplete");
  const pending = history.status === "loading";
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [scrub, setScrub] = useState<ChartReadout | null>(null);
  const scrubIndex = useRef<number | null>(null);
  const [scrubPosition, setScrubPosition] = useState<{ x: number; y: number } | null>(null);
  const [scrubPoints, setScrubPoints] = useState(points);
  if (scrubPoints !== points) {
    setScrubPoints(points);
    setScrub(null);
    setScrubPosition(null);
  }
  const gesture = useRef<{ id: number; x: number; y: number; direction: "pending" | "horizontal" | "vertical" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const { refresh: refreshClock } = clock;
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
  }, [ready]);
  useEffect(() => {
    scrubIndex.current = null;
    gesture.current = null;
    onReadout(null);
  }, [assetId, points, onReadout]);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(scrub ? `${scrub.value} USD, ${scrub.time}` : ""), 250);
    return () => window.clearTimeout(timer);
  }, [scrub]);
  const first = points[0];
  const last = points.at(-1);
  const early = ready && endsEarly(last!.time, "1D", clock.value);
  const startsLate = first && first.time > clock.value / 1000 - rangeSeconds["1D"] * 0.9;
  const period = early ? `${scrubTime(first!.time, "1D", regionId)} – ${scrubTime(last!.time, "1D", regionId)}`
    : startsLate ? `since ${scrubTime(first!.time, "1D", regionId)}` : rangeLabels["1D"].toLowerCase();
  const change = ready && first && last && first.value > 0
    ? `${formatSignedPercentChange((last.value - first.value) / first.value * 100, regionId)} · ${period}` : null;
  useEffect(() => { onResting(change, pending); }, [change, pending, onResting]);
  function updateScrub(index: number | null) {
    if (scrubIndex.current === index) return;
    scrubIndex.current = index;
    const point = index === null || !ready ? null : points[index];
    const box = stage.current?.getBoundingClientRect();
    const time = clock.read();
    setScrubPosition(point && box ? {
      x: Math.max(plotPadding.left, Math.min(box.width - plotPadding.right, pointX(point.time, windowSecs, box.width, time))),
      y: pointY(point.value, points, windowSecs, box.height, time) ?? box.height / 2,
    } : null);
    const readout = point ? {
      value: formatPresentationPrice(point.value.toString(), "USD", regionId) ?? formatChartPrice(point.value, { regionId }),
      time: scrubTime(point.time, "1D", regionId), index: index!,
    } : null;
    setScrub(readout);
    onReadout(readout);
  }
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!ready) return;
    const end = points.length - 1;
    let index: number | null;
    if (event.key === "Escape") index = null;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = end;
    else if (event.key === "ArrowRight") index = Math.min(end, (scrub?.index ?? -1) + 1);
    else if (event.key === "ArrowLeft") index = Math.max(0, (scrub?.index ?? end + 1) - 1);
    else return;
    event.preventDefault();
    updateScrub(index);
  }
  function handlePointer(event: PointerEvent<HTMLDivElement>) {
    if (!ready) return;
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
    const time = clock.read() / 1000 + windowSecs * 0.015 - windowSecs
      + (x - plotPadding.left) / (box.width - plotPadding.left - plotPadding.right) * windowSecs;
    const index = points.reduce((closest, point, at) =>
      Math.abs(point.time - time) < Math.abs(points[closest]!.time - time) ? at : closest, 0);
    updateScrub(index);
  }
  const edge = ready && last && stageSize.width ? pointX(last.time, windowSecs, stageSize.width, clock.value) : null;
  const lastY = early && last && stageSize.height ? pointY(last.value, points, windowSecs, stageSize.height, clock.value) : null;
  const color = plotColor(points);
  const label = failed ? "Couldn't load price history" : pending ? "Loading price history" : "No price history for the past day.";
  const retry = () => { void getHomeQueryClient().invalidateQueries({ queryKey: publicQueryKey("price-history", assetId, "1D") }); };
  const staleNotice = history.status === "stale"
    ? `Couldn't refresh price history · last updated ${formatPresentationDate(history.asOf, { regionId, style: "date-time-zone" })}` : null;
  return <section className="min-w-0" aria-label="Market price history">
    <div ref={stage} role={ready ? "group" : "status"} aria-roledescription={ready ? "chart" : undefined}
      aria-label={ready ? `1 day price history, ${points.length} points${early ? `, no data since ${scrubTime(last!.time, "1D", regionId)}` : ""}${staleNotice ? `, ${staleNotice}` : ""}` : label}
      aria-describedby={ready ? hintId : undefined} aria-busy={pending || undefined} tabIndex={ready ? 0 : undefined}
      onKeyDown={handleKey} onBlur={() => updateScrub(null)} onPointerDown={handlePointer} onPointerMove={handlePointer}
      onPointerLeave={handlePointer} onPointerUp={handlePointer} onPointerCancel={handlePointer}
      dir="ltr" className="relative -mx-4 h-20 touch-pan-y min-w-0 overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring">
      {ready ? <div ref={layer} aria-hidden="true" data-sparkline-state="shown" className="pointer-events-none absolute inset-0">
        <Liveline data={points} value={last!.value} window={windowSecs} theme={resolvedAppearance} color={color}
          fill pulse={false} momentum={false} scrub={false} degen={false} badge={false} showValue={false} grid={false}
          tooltipY={-1000} tooltipOutline={false} lerpSpeed={reduced ? 1 : 0.8} lineWidth={2}
          formatTime={() => ""} formatValue={(number) => formatChartPrice(number, { regionId })}
          padding={plotPadding} style={{ height: "100%" }} />
        {coverage?.gaps.map((gap) => {
          const from = pointX(Date.parse(gap.from) / 1000, windowSecs, stageSize.width, clock.value);
          const to = pointX(Date.parse(gap.to) / 1000, windowSecs, stageSize.width, clock.value);
          return <div key={`${gap.from}:${gap.to}:${gap.reason}`} data-coverage-gap={gap.reason}
            className="absolute inset-y-0 bg-(--asset-surface,var(--color-background))"
            style={{ insetInlineStart: Math.max(0, from), width: Math.max(0, Math.min(stageSize.width, to) - Math.max(0, from)) }} />;
        })}
        {edge !== null ? <div className="absolute top-0 bottom-0 end-0 bg-(--asset-surface,var(--color-background))" style={{ insetInlineStart: edge + 1 }} /> : null}
        <div className="absolute inset-x-0 bottom-0 bg-(--asset-surface,var(--color-background))" style={{ height: plotPadding.bottom }} />
        {early && edge !== null && lastY !== null ? <span data-last-point className="absolute size-2 rounded-full"
          style={{ insetInlineStart: edge - 4, top: lastY - 4, backgroundColor: color }} /> : null}
      </div> : pending ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-muted-foreground/20" />
        : <div className="flex h-full items-center justify-between gap-3 px-4 text-sm text-muted-foreground">
          <span>{label}</span>{failed ? <Button variant="outline" size="touch" onClick={retry}>Try again</Button> : null}
        </div>}
      {early ? <span aria-hidden="true" className="pointer-events-none absolute end-2 bottom-0 z-2 rounded-sm bg-(--asset-surface,var(--color-background)) px-1 text-xs text-muted-foreground whitespace-nowrap">
        No data since {scrubTime(last!.time, "1D", regionId)}
      </span> : null}
      {ready ? <div aria-hidden="true" className="absolute inset-0 touch-pan-y" /> : null}
      <div aria-hidden="true" data-scrub-cursor className="pointer-events-none absolute w-px bg-border"
        style={{ top: plotPadding.top, bottom: plotPadding.bottom, insetInlineStart: scrubPosition?.x ?? 0,
          opacity: scrub && scrubPosition && ready ? 1 : 0, transition: reduced ? "none" : "opacity 80ms" }}>
        <span className="absolute -translate-x-1/2 size-2 rounded-full border-2 border-background"
          style={{ top: (scrubPosition?.y ?? 0) - plotPadding.top - 4, backgroundColor: color }} />
      </div>
    </div>
    <span id={hintId} className="sr-only">Use the left and right arrow keys to move between points. Home and End jump to the first and last point. Escape stops.</span>
    <span className="sr-only" aria-live="polite">{announcement}</span>
    {staleNotice ? <div role="alert" className="flex items-center justify-between gap-3 py-2 text-sm text-muted-foreground">
      <span>{staleNotice}</span><Button variant="outline" size="touch" onClick={retry}>Try again</Button>
    </div> : null}
  </section>;
}

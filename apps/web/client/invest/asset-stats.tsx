"use client";

import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import type { InvestAsset } from "@/config/invest-assets";
import type { ExactDecimal } from "@/shared/balances/types";
import { formatChartPrice, formatPresentationDate, formatPresentationPrice, formatTrimmedChartPrice } from "@/shared/formatting";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { endsEarly, scrubTime, type ChartClock } from "./asset-chart-support";
import { usePresentationQuote, usePresentationRegionId } from "./presentation-quote";
import { usePriceHistory, type PriceHistoryState } from "./use-price-history";
import { useMarketStats } from "./use-market-stats";

function RangeStat({ history, day, range, now, snapshotPrice }: {
  history: PriceHistoryState;
  day: PriceHistoryState;
  range: "1D" | "1Y";
  now: number;
  snapshotPrice: number | null;
}) {
  const regionId = usePresentationRegionId();
  if ((history.status !== "ready" && history.status !== "stale") || history.points.length < 2) return null;
  const last = history.points.at(-1)!;
  if (Date.parse(last.time) < now - (range === "1D" ? 86400000 : 7 * 86400000)) return null;
  const dayContributes = range === "1Y" && (day.status === "ready" || day.status === "stale") && day.points.length > 0;
  const series = [...history.points, ...(dayContributes ? day.points : [])];
  const closes = series.map((point) => Number(point.value));
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const first = history.points[0]!;
  const mergedLast = series.reduce((latest, point) => Date.parse(point.time) > Date.parse(latest.time) ? point : latest);
  const current = snapshotPrice ?? Number(mergedLast.value);
  const start = scrubTime(Date.parse(first.time) / 1000, range, regionId);
  const end = scrubTime(Date.parse(mergedLast.time) / 1000, range, regionId);
  const span: Record<"1D" | "1Y", number> = { "1D": 86400, "1Y": 31536000 };
  const label = endsEarly(Date.parse(mergedLast.time) / 1000, range, now) ? `${start} – ${end}`
    : Date.parse(first.time) > now - span[range] * 1000 * 0.9 ? `Since ${start}`
      : range === "1D" ? "Past 24h" : "Past year";
  const formattedLow = formatPresentationPrice(low.toString(), "USD", regionId);
  const formattedHigh = formatPresentationPrice(high.toString(), "USD", regionId);
  const formattedCurrent = formatPresentationPrice(current.toString(), "USD", regionId);
  const failedAsOf = [history.status === "stale" ? history.asOf : null, dayContributes && day.status === "stale" ? day.asOf : null]
    .filter((value): value is number => value !== null);
  const staleAsOf = failedAsOf.length ? Math.min(...failedAsOf) : null;
  return <div role="group" aria-label={`${label} closing-price low ${formattedLow}, high ${formattedHigh}, current ${formattedCurrent}`} className="space-y-2 py-2">
    <p className="text-sm font-medium">{label} <span className="font-normal text-muted-foreground">· Closing prices</span></p>
    {staleAsOf !== null ? <p role="status" className="text-xs text-muted-foreground">
      Couldn&apos;t refresh history · last updated {formatPresentationDate(staleAsOf, { regionId, style: "date-time-zone" })}
    </p> : null}
    <div className="flex items-center gap-3 text-xs tabular-nums">
      <span className="shrink-0">{formattedLow}</span>
      <div aria-hidden="true" className="relative h-1 min-w-0 flex-1 rounded-full bg-border">
        <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground"
          style={{ insetInlineStart: `${high === low ? 50 : Math.max(0, Math.min(100, (current - low) / (high - low) * 100))}%` }} />
      </div>
      <span className="shrink-0">{formattedHigh}</span>
    </div>
  </div>;
}

export function formatStatUsd(value: ExactDecimal, regionId: ReturnType<typeof usePresentationRegionId> = "GLOBAL") {
  const digits = value.atoms.replace(/^0+/, "") || "0";
  if (digits === "0") return formatChartPrice("0", { regionId });
  const significant = digits.length > 3
    ? (BigInt(digits.slice(0, 4)) + BigInt(5)) / BigInt(10)
    : BigInt(digits);
  const exponent = digits.length > 3 ? digits.length - 3 - value.scale : -value.scale;
  return formatTrimmedChartPrice(`${significant}e${exponent}`, { regionId });
}

export function AssetStats({ asset, market, clock }: { asset: InvestAsset; market: MarketDataState; clock: ChartClock }) {
  const day = usePriceHistory(asset.id, "1D", { speculative: true });
  const year = usePriceHistory(asset.id, "1Y", { speculative: true });
  const stats = useMarketStats(asset.id, asset.category !== "stock");
  const quote = usePresentationQuote();
  const regionId = usePresentationRegionId();
  const snapshot = market.status === "ready" ? market.snapshots.find((item) => item.assetId === asset.id) : undefined;
  const parsedPrice = snapshot ? Number(snapshot.displayPrice.replace(/[$,]/g, "")) : NaN;
  const snapshotPrice = Number.isFinite(parsedPrice) ? parsedPrice : null;
  const hasRow = (history: PriceHistoryState, maxAge: number) => (history.status === "ready" || history.status === "stale")
    && history.points.length >= 2 && Date.parse(history.points.at(-1)!.time) >= clock.value - maxAge;
  const tiles: Array<[string, ExactDecimal]> = asset.category === "stock" || !stats ? [] : [
    ...(stats.marketCapUsd ? [["Market cap", stats.marketCapUsd] as [string, ExactDecimal]] : []),
    ...(stats.volume24hUsd ? [["24h volume", stats.volume24hUsd] as [string, ExactDecimal]] : []),
    ...(asset.category === "meme" && stats.liquidityUsd ? [["Liquidity", stats.liquidityUsd] as [string, ExactDecimal]] : []),
  ];
  if (!tiles.length && !hasRow(day, 86400000) && !hasRow(year, 7 * 86400000)) return null;
  const heading = quote.valueCurrency && quote.valueCurrency !== "USD" ? "Stats · USD" : "Stats";
  return <section aria-label={heading} className="space-y-2">
    <h3 className="text-sm font-semibold">{heading}</h3>
    <div className="divide-y"><RangeStat history={day} day={day} range="1D" now={clock.value} snapshotPrice={snapshotPrice} />
      <RangeStat history={year} day={day} range="1Y" now={clock.value} snapshotPrice={snapshotPrice} /></div>
    {tiles.length ? <div className="grid grid-cols-2 gap-2 max-[22rem]:grid-cols-1">
      {tiles.map(([label, value]) => <Item key={label} size="sm" variant="muted">
        <ItemContent><ItemDescription>{label}</ItemDescription><ItemTitle numeric>{formatStatUsd(value, regionId)}</ItemTitle></ItemContent>
      </Item>)}
    </div> : null}
  </section>;
}

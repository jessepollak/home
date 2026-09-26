import { useState, type RefObject } from "react";
import { ArrowLeft } from "lucide-react";
import { AssetIcon } from "@/client/invest/asset-icon";
import { PriceChart } from "@/client/invest/price-chart";
import type { MarketPriceRange } from "@/shared/invest/contracts/market-price-history";
import { Button } from "@/components/ui/button";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { TradeEntry, type TradeAvailability } from "./trade-entry";
import { fixtureChartEnd, fixtureHolding } from "./trade-fixtures";

const chartEnd = Date.parse(fixtureChartEnd);
let chartSeed = 935;
let walk = 0;
const variations = Array.from({ length: 168 }, (_, index) => {
  if (index > 0) {
    chartSeed = (Math.imul(chartSeed, 1664525) + 1013904223) >>> 0;
    walk += (chartSeed / 4294967296 - 0.5) * 135;
  }
  return walk;
});
const history = {
  status: "ready" as const,
  points: variations.map((variation, index) => {
    const fraction = index / 167;
    return {
      time: new Date(chartEnd - (167 - index) * 3_600_000).toISOString(),
      value: index === 0 ? "108342.66" : index === 167 ? "109589.04" : String(108342.66 + 1246.38 * fraction + variation - fraction * variations[167]!),
    };
  }),
};

const stockHistory = {
  status: "ready" as const,
  points: Array.from({ length: 168 }, (_, index) => ({
    time: new Date(chartEnd - (167 - index) * 3_600_000).toISOString(),
    value: String(index === 167 ? 237.49 : 235.31 + 2.18 * index / 167 + Math.sin(index * 0.17) * Math.sin(Math.PI * index / 167) * 0.8),
  })),
};

export function TradeDetail({ availability = "available", onBuy, onSell, buyButtonRef, sellButtonRef, stock = false }: {
  availability?: TradeAvailability;
  onBuy?: () => void;
  onSell?: () => void;
  buyButtonRef?: RefObject<HTMLButtonElement | null>;
  sellButtonRef?: RefObject<HTMLButtonElement | null>;
  stock?: boolean;
}) {
  const [range, setRange] = useState<MarketPriceRange>("1W");
  return (
    <main className="min-h-svh bg-muted/20">
      <div className={`${shellContentFrameClassName} py-4`}>
        <section className="flex w-full flex-col gap-4 overflow-x-clip" aria-labelledby="fixture-invest-title">
          <header className="flex items-center gap-2">
            <Button variant="ghost" size="icon-lg" aria-label="Back" onClick={() => undefined}><ArrowLeft className="size-4" aria-hidden="true" /></Button>
            <span className="flex min-w-0 items-center gap-2"><AssetIcon mark={{ assetKey: "fixture-cbbtc", name: stock ? "Apple" : "Bitcoin", symbol: stock ? "AAPL" : "BTC", imageUrl: null, pending: false, currency: null }} /><h1 id="fixture-invest-title" className="text-lg font-semibold">{stock ? "Apple" : "Bitcoin"}</h1></span>
          </header>
          <div className="space-y-1">
            <strong className="block whitespace-nowrap text-4xl font-semibold tabular-nums">{stock ? "$237.49" : "$109,589.04"}</strong>
            <p className="text-sm text-market-gain">{stock ? "+$2.18 (0.93%)" : "+$1,246.38 (1.15%)"}</p>
            <p className="text-sm text-muted-foreground">{stock ? "AAPL · Stock" : "cbBTC · Base"}</p>
          </div>
          <PriceChart range={range} history={stock ? stockHistory : history} onRangeChange={setRange} />
          <TradeEntry availability={availability} holding={fixtureHolding} onBuy={onBuy} onSell={onSell} buyButtonRef={buyButtonRef} sellButtonRef={sellButtonRef} />
        </section>
      </div>
    </main>
  );
}

"use client";

import type { InvestAsset } from "@/config/invest-assets";
import { assetFacts, assetCatalysts } from "@/config/invest-sources/asset-context";
import { selectAssetContext, type AssetFact, type AssetCatalyst } from "@/shared/invest/asset-context";
import { formatPresentationDate } from "@/shared/formatting";
import { usePresentationRegionId } from "./presentation-quote";

export function AssetAbout({ asset, facts = assetFacts, catalysts = assetCatalysts, now }: {
  asset: InvestAsset;
  facts?: readonly AssetFact[];
  catalysts?: readonly AssetCatalyst[];
  now: number;
}) {
  const regionId = usePresentationRegionId();
  const context = selectAssetContext(asset, facts, catalysts, now);
  const address = `${asset.contractAddress.slice(0, 6)}…${asset.contractAddress.slice(-4)}`;
  return <section aria-label="About" className="space-y-2">
    <h3 className="text-sm font-semibold">About</h3>
    {context.fact ? <p className="text-sm">{context.fact.summary}</p> : null}
    <p className="text-sm text-muted-foreground">{asset.representation.tokenSymbol} · {address} · Base</p>
    <a className="font-medium text-primary" href={`https://basescan.org/token/${asset.contractAddress}`} target="_blank" rel="noreferrer">
      View contract
    </a>
    {context.catalysts.map((entry) => <div key={entry.url} className="space-y-1 text-sm" aria-label="Recent context">
      <p className="text-xs text-muted-foreground">Context · {formatPresentationDate(Date.parse(entry.publishedAt), { regionId, style: "chart-date" })}</p>
      <a className="font-medium text-primary" href={entry.url} target="_blank" rel="noreferrer">{entry.title}</a>
      <p className="text-xs text-muted-foreground">{entry.publisher}</p>
    </div>)}
  </section>;
}

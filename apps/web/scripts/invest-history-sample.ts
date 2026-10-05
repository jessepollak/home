import { parseArgs } from "node:util";
import { createTokenizedEquityHistoryReader } from "../server/market-data/tokenized-equity/history";
import { expectedMarketPriceHistorySource, isMarketPriceRange, type MarketPriceHistoryResponse } from "../shared/invest/contracts/market-price-history";

const { values } = parseArgs({ args: process.argv.slice(2).filter((arg) => arg !== "--"), options: {
  asset: { type: "string" }, range: { type: "string" }, concurrent: { type: "string" },
}, strict: true });
const assetId = values.asset ?? "nvdac";
const range = values.range ?? "1W";
const concurrent = Number(values.concurrent ?? "1");
if (!isMarketPriceRange(range) || expectedMarketPriceHistorySource(assetId)?.kind !== "tokenized-equity-feed") throw new Error("Choose a configured stock asset and history range.");
if (!Number.isSafeInteger(concurrent) || concurrent < 1) throw new Error("Choose a positive concurrent read count.");
const stats: unknown[] = [];
const read = createTokenizedEquityHistoryReader({ onFill: (value) => stats.push(value) });
const summarize = (value: MarketPriceHistoryResponse) => ({
  source: value.source?.kind === "tokenized-equity-feed" ? {
    kind: value.source.kind, chainId: value.source.chainId, feedProxy: value.source.feedProxy, label: value.source.label,
  } : null,
  status: value.status, coverage: value.coverage,
  firstObserved: value.points[0]?.time ?? null, lastObserved: value.points.at(-1)?.time ?? null,
});
const cold = await Promise.all(Array.from({ length: concurrent }, () => read(assetId, range)));
const warm = await read(assetId, range);
console.log(JSON.stringify({ assetId, range, concurrent, stats, cold: cold.map(summarize), warm: summarize(warm) }));

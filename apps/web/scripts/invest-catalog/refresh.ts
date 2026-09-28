import stocks from "../../config/invest-sources/base-stocks.json";
import wrapped from "../../config/invest-sources/coinbase-wrapped.json";
import {
  catalogExitCode, diffCatalog, parseBaseStockRoster, parseBaseIntegrationDoc,
  parseChainlinkFeedDirectory, parseCoinbaseWrappedIssuerPage,
  type ParsedSources,
} from "./catalog";
import { checkOnchain } from "./onchain";

const maxBytes = 2 * 1024 * 1024;
async function fetchSource(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > maxBytes) {
      await response.body?.cancel();
      return null;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (!reader) return null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return null; }
}

async function main() {
  const [roster, integration, directory, issuer] = await Promise.all([
    fetchSource(stocks.sources.roster), fetchSource(stocks.sources.integration),
    fetchSource(stocks.sources.feedDirectory), fetchSource(wrapped.source),
  ]);
  const parsed: ParsedSources = {
    roster: roster === null ? null : parseBaseStockRoster(roster),
    integration: integration === null ? null : parseBaseIntegrationDoc(integration),
    feedDirectory: directory === null ? null : parseChainlinkFeedDirectory(directory),
    issuer: issuer === null ? null : parseCoinbaseWrappedIssuerPage(issuer),
  };
  const today = new Date().toISOString().slice(0, 10);
  const report = diffCatalog(stocks, wrapped, parsed, today);
  if (process.argv.includes("--onchain")) report.onchain = await checkOnchain(process.env.BASE_RPC_URL || "https://mainnet.base.org");
  console.log(JSON.stringify({ date: today, sources: {
    roster: { url: stocks.sources.roster, ...report.sources.roster },
    integration: { url: stocks.sources.integration, ...report.sources.integration },
    feedDirectory: { url: stocks.sources.feedDirectory, ...report.sources.feedDirectory },
    issuer: { url: wrapped.source, ...report.sources.issuer },
  }, feedWithoutRosterAsset: report.feedWithoutRosterAsset, knownFeedWithoutRosterAsset: report.knownFeedWithoutRosterAsset, calendar: report.calendar, ...(report.onchain ? { onchain: report.onchain } : {}) }));
  process.exitCode = catalogExitCode(report);
}

await main();

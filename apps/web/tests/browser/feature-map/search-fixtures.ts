import type { InvestSearchResponse, InvestSearchWireResult } from "../../../shared/invest/contracts/search";

export const nonTrendingAddress = "0x1111111111111111111111111111111111111111";
const twinAddress = "0x2222222222222222222222222222222222222222";
const extraAddress = "0x3333333333333333333333333333333333333333";

function dynamic(address: string, name: string, symbol: string): InvestSearchWireResult {
  return { kind: "dynamic", match: "exact", source: "indexed", asset: {
    id: `base:${address}`,
    category: "meme",
    displayName: name,
    displaySymbol: symbol,
    initials: symbol.slice(0, 2),
    chainId: 8453,
    contractAddress: address as `0x${string}`,
    availability: "informational",
    descriptor: "On Base",
    representation: { tokenSymbol: symbol, decimals: 18, relationship: "Base ERC-20 token." },
    contractUrl: `https://basescan.org/token/${address}`,
  } };
}

const nonTrending = dynamic(nonTrendingAddress, "Orbit", "ORB");
const twin = dynamic(twinAddress, "Orbit", "ORB");
const extra = dynamic(extraAddress, "Orbit", "ORB");

export function searchFixture(query: string): InvestSearchResponse {
  const normalized = query.trim();
  const lower = normalized.toLowerCase();
  const results: InvestSearchWireResult[] = lower === "btc" || lower === "bitcoin" || lower === "cbbtc"
    ? [{ kind: "configured", assetId: "cbbtc", match: "exact" }]
    : lower === "aapl" || lower === "apple" || lower === "aaplc"
      ? [{ kind: "configured", assetId: "aaplc", match: "exact" }]
      : lower === nonTrendingAddress ? [{ ...nonTrending, match: "contract" }]
        : lower === "orb" || lower === "orbit" ? [nonTrending, twin, extra]
          : lower === "partial" ? [nonTrending]
            : [];
  return {
    version: 1, query: normalized, offset: 0, results,
    snapshots: results.some((result) => result.kind === "dynamic" && result.asset.id === `base:${nonTrendingAddress}`)
      ? [{ assetId: `base:${nonTrendingAddress}`, displayPrice: "$1.25", changeLabel: "+2.4", asOf: "2026-09-26T12:00:00.000Z", sourceLabel: "Market data" }]
      : [],
    provider: lower === "partial" ? "error" : "ok",
    coverage: lower === "partial" ? "partial" : "complete",
    nextOffset: null,
  };
}

export function assetResolutionFixture(assetId: string) {
  const result = [nonTrending, twin, extra].find((result) => result.kind === "dynamic" && result.asset.id === assetId);
  return {
    version: 1, assetId, provider: "ok",
    asset: result?.kind === "dynamic" ? result.asset : null,
    source: result ? "indexed" : null,
    snapshot: searchFixture(nonTrendingAddress).snapshots.find((snapshot) => snapshot.assetId === assetId) ?? null,
  };
}

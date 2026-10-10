import type { Page } from "@playwright/test";
import type { MarketStatsResponse, TokenRiskSignals } from "../../../shared/invest/contracts/market-stats";
import { resolveMarketPriceAssetIdentity, isMarketPriceRange } from "../../../shared/invest/contracts/market-price-history";
import { catalogHolding, priced } from "../../../shared/balances/fixtures";
import { marketPricesFixture, priceHistoryFixture, syntheticDegen } from "../feature-map/fixtures";
import { balancesSnapshot } from "./balances";
import { json } from "./api";
import { FIXED_NOW } from "./fixed-time";

export function tokenRiskStatsFixture(assetId: string, flags: Partial<TokenRiskSignals> = {}, status: "ready" | "unavailable" = "ready"): MarketStatsResponse {
  const identity = resolveMarketPriceAssetIdentity(assetId);
  if (!identity) throw new Error(`Unknown risk fixture asset: ${assetId}`);
  return {
    version: 1, provider: "codex", assetId: identity.assetId, currency: "USD",
    fetchedAt: new Date(FIXED_NOW).toISOString(), status,
    stats: status === "ready" ? { marketCapUsd: { atoms: "125000000", scale: 0 }, volume24hUsd: { atoms: "2500000", scale: 0 } } : {},
    ...(status === "unavailable" ? { unavailableReason: "unknown-asset" as const } : {}),
    risk: {
      source: "goplus", chainId: 8453, contractAddress: identity.contractAddress.toLowerCase(),
      status: "ready", checkedAt: new Date(FIXED_NOW).toISOString(),
      signals: {
        honeypot: "absent", cannotSellAll: "absent", transferPausable: "absent", blacklist: "absent",
        taxModifiable: "absent", personalTaxModifiable: "absent",
        buyTax: { state: "absent" }, sellTax: { state: "absent" }, transferTax: { state: "unknown" },
        ...flags,
      },
    },
  };
}

export async function installRiskMarketFixtures(page: Page) {
  await page.route("**/api/market-prices", (route) => json(route, marketPricesFixture()));
  await page.route("**/api/market-prices/history?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const range = params.get("range");
    if (!range || !isMarketPriceRange(range)) throw new Error("Invalid risk history fixture range");
    return json(route, priceHistoryFixture(params.get("assetId") ?? "", undefined, range));
  });
  await page.route("**/api/market-prices/stats?*", (route) => json(route,
    tokenRiskStatsFixture(new URL(route.request().url()).searchParams.get("assetId") ?? "")));
}

export function heldRiskSnapshot() {
  const snapshot = balancesSnapshot();
  const holding = catalogHolding({ address: syntheticDegen, name: "DEGEN", symbol: "DEGEN", decimals: 18 },
    "123000000000000000000", priced("USD", "1820"));
  return { ...snapshot, holdings: snapshot.holdings.map((entry) => entry.name === "Recognized Coin" ? holding : entry) };
}

import { presentationRegions } from "@/config/regions";
import {
  presentPortfolioAssetMark,
  type AssetMarkPresentation,
  type AssetMarkResolution,
} from "@/client/asset-mark/presentation";
import { presentationCurrencySymbol } from "@/shared/portfolio/valuation-format";
import type { HomeAssetBalanceItem } from "@/shared/portfolio/present-home-balances";

export type HomeBalanceRowPresentation = {
  visualBalance: string;
  accessibleBalance?: string;
  tone?: "default" | "muted" | "error";
};

export type HomeBalanceMarkPresentation = AssetMarkPresentation;

const cashTokenAmountPattern =
  /^((?:<)?(?:0|[1-9]\d{0,2}(?:,\d{3})*)(?:\.\d+)?)\s+(\S+)$/;

/**
 * Keeps an unpriced cash token's unit in the presentation DTO and accessible
 * label while showing only the numeric quantity in Home's primary value slot.
 * The shape check also repairs legacy cached rows that stored the same value
 * with a muted tone.
 */
export function presentHomeBalanceRow(
  item: HomeAssetBalanceItem,
): HomeBalanceRowPresentation {
  if (item.group !== "cash" || item.tone === "error") {
    return {
      visualBalance: item.displayBalance,
      tone: item.tone,
    };
  }

  const tokenAmount = cashTokenAmountPattern.exec(item.displayBalance);
  if (!tokenAmount) {
    return {
      visualBalance: item.displayBalance,
      tone: item.tone,
    };
  }

  return {
    visualBalance: tokenAmount[1],
    accessibleBalance: item.displayBalance,
    tone: "default",
  };
}

function isPresentationCashCurrency(code: string | null): boolean {
  if (!code) return false;
  return Object.values(presentationRegions).some(
    (region) => region.currency.code === code,
  );
}

/**
 * Cash / fiat rows may carry a presentation currency for the flag map.
 * Crypto, stock, and meme asset rows never get a country flag — only a
 * token symbol (or an empty gray disc) in the shared 32px slot. Native
 * ETH still ships as `{ currency: null, symbol: "ETH" }`; CurrencyMark
 * paints the dedicated diamond from that ticker.
 */
export function presentHomeBalanceMark(
  item: HomeAssetBalanceItem,
  resolution: AssetMarkResolution = {},
): HomeBalanceMarkPresentation {
  const itemCurrency = item.currencyCode ?? null;
  const currency =
    item.group === "asset" && !isPresentationCashCurrency(itemCurrency)
      ? null
      : itemCurrency;
  return presentPortfolioAssetMark(
    {
      assetKey: item.assetKey ?? item.id,
      name: item.name,
      symbol: currency
        ? presentationCurrencySymbol(currency)
        : item.detail ?? item.name,
      currency,
    },
    resolution,
  );
}

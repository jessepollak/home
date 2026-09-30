import { canonicalUsdcAsset, verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { requireAddress } from "@/shared/chain/hex";
import type { TradeDirection, TradeMoneyActionMetadata } from "./contract";

const assets = [canonicalUsdcAsset, ...Object.values(verifiedLocalCashAssets)] as const;
const verifiedQuoteRouteCurrencies = ["USD", "EUR", "IDR"] as const;

/** @public Accurate unavailable reason for a currency without a verified quote route */
export const CASH_CONVERSION_UNAVAILABLE_REASON = "Conversion for this currency isn't available yet.";

/** @public Cash conversion inventory for embedding the trade flow */
export const cashConversionCurrencies = assets.map((asset) => {
  const address = requireAddress(asset.contractAddress);
  return {
    code: asset.cashCurrency,
    convertOffered: verifiedQuoteRouteCurrencies.some((code) => code === asset.cashCurrency),
    name: asset.name,
    symbol: asset.symbol,
    decimals: asset.decimals,
    address,
    portfolioAssetId: asset.id,
    tradeAssetId: asset.cashCurrency === "USD" ? "usdc" : `base:${address}`,
  };
});

export type CashConversionCurrency = (typeof cashConversionCurrencies)[number];
export type CashConversionCurrencyCode = CashConversionCurrency["code"];


/** @public Resolves a Cash conversion currency, rejecting a code outside the maintained inventory */
export function cashConversionCurrency(code: CashConversionCurrencyCode): CashConversionCurrency {
  const currency = cashConversionCurrencies.find((candidate) => candidate.code === code);
  if (!currency) throw new Error(`Unsupported Cash conversion currency: ${code}`);
  return currency;
}
/** @public Destinations offered by the Cash Convert entry point */
export function cashConversionDestinations(source: CashConversionCurrencyCode): CashConversionCurrency[] {
  const from = cashConversionCurrencies.find((currency) => currency.code === source);
  if (!from || (source !== "USD" && !from.convertOffered)) return [];
  return cashConversionCurrencies.filter((currency) => currency.code !== source && (source === "USD" || currency.code === "USD"));
}

/** @public Maps a Cash conversion onto the existing USDC trade route */
export function cashConversionTrade(from: CashConversionCurrencyCode, to: CashConversionCurrencyCode): { assetId: string; direction: TradeDirection } | null {
  const source = cashConversionCurrencies.find((currency) => currency.code === from);
  const destination = cashConversionDestinations(from).find((currency) => currency.code === to);
  if (!source?.convertOffered || !destination?.convertOffered) return null;
  const local = from === "USD" ? destination : source;
  return { assetId: local.tradeAssetId, direction: from === "USD" ? "buy" : "sell" };
}

/** @public Classifies verified cash-to-cash trade metadata for Activity */
export function cashConversionPair(metadata: TradeMoneyActionMetadata): { from: CashConversionCurrency; to: CashConversionCurrency } | null {
  if (metadata.network.chainId !== 8453 || metadata.network.name !== "Base") return null;
  const match = (asset: TradeMoneyActionMetadata["fromAsset"]) => cashConversionCurrencies.find((currency) =>
    currency.address === asset.address && currency.decimals === asset.decimals);
  const from = match(metadata.fromAsset);
  const to = match(metadata.toAsset);
  const trade = from && to ? cashConversionTrade(from.code, to.code) : null;
  return trade && metadata.direction === trade.direction && metadata.assetId === trade.assetId && from && to ? { from, to } : null;
}

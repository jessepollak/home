import { canonicalUsdcAsset, verifiedLocalCashAssets } from "@/config/portfolio-assets";
import type { TradeDirection, TradeMoneyActionMetadata } from "./contract";

const assets = [canonicalUsdcAsset, ...Object.values(verifiedLocalCashAssets)] as const;

/** @public Cash conversion inventory for embedding the trade flow */
export const cashConversionCurrencies = assets.map((asset) => ({
  code: asset.cashCurrency,
  name: asset.name,
  symbol: asset.symbol,
  decimals: asset.decimals,
  address: asset.contractAddress,
  portfolioAssetId: asset.id,
  tradeAssetId: asset.cashCurrency === "USD" ? "usdc" : `base:${asset.contractAddress.toLowerCase()}`,
}));

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
  if (!cashConversionCurrencies.some((currency) => currency.code === source)) return [];
  return cashConversionCurrencies.filter((currency) => currency.code !== source && (source === "USD" || currency.code === "USD"));
}

/** @public Maps a Cash conversion onto the existing USDC trade route */
export function cashConversionTrade(from: CashConversionCurrencyCode, to: CashConversionCurrencyCode): { assetId: string; direction: TradeDirection } | null {
  if (!cashConversionDestinations(from).some((currency) => currency.code === to)) return null;
  const local = cashConversionCurrencies.find((currency) => currency.code === (from === "USD" ? to : from));
  return local ? { assetId: local.tradeAssetId, direction: from === "USD" ? "buy" : "sell" } : null;
}

/** @public Classifies verified cash-to-cash trade metadata for Activity */
export function cashConversionPair(metadata: TradeMoneyActionMetadata): { from: CashConversionCurrency; to: CashConversionCurrency } | null {
  if (metadata.network.chainId !== 8453 || metadata.network.name !== "Base") return null;
  const match = (asset: TradeMoneyActionMetadata["fromAsset"]) => cashConversionCurrencies.find((currency) =>
    currency.address.toLowerCase() === asset.address.toLowerCase() && currency.decimals === asset.decimals);
  const from = match(metadata.fromAsset);
  const to = match(metadata.toAsset);
  const trade = from && to ? cashConversionTrade(from.code, to.code) : null;
  return trade && metadata.direction === trade.direction && metadata.assetId === trade.assetId && from && to ? { from, to } : null;
}

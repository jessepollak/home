import { canonicalUsdcAsset, verifiedLocalCashAssets, type PortfolioCashAsset } from "@/config/portfolio-assets";
import type { FiatCurrencyCode } from "@/config/regions";
import { parseAddress, requireAddress, type Address } from "@/shared/chain/hex";
import { CONVERT_PAIRS, convertCurrencyListed, type ConvertAdmissionData } from "@/shared/currencies/convert";
import { CURRENCY_REGISTRY, currencyRecordForContract, nonDeferredCurrencyRecords } from "@/shared/currencies/registry";
import { CONVERT_QUOTE_ASSET_ID, type CurrencyRepresentation } from "@/shared/currencies/types";
import type { TradeDirection, TradeMoneyActionMetadata } from "./contract";


const assets: readonly PortfolioCashAsset[] = [canonicalUsdcAsset, ...Object.values(verifiedLocalCashAssets)].filter(
  (asset): asset is PortfolioCashAsset => asset.cashCurrency !== null,
);

/** @public Accurate unavailable reason for a currency without a verified quote route */
export const CASH_CONVERSION_UNAVAILABLE_REASON = "Conversion for this currency isn't available yet.";

function conversionAdmitted(address: string, data: ConvertAdmissionData): boolean {
  const record = currencyRecordForContract(address);
  return record !== null && convertCurrencyListed(record.id, data);
}

/** @public Cash conversion inventory for embedding the trade flow; the registry pair admission decides every offer flag. */
export function cashConversionInventory(data: ConvertAdmissionData = {}): CashConversionCurrency[] {
  const entries = assets.map((asset) => ({ asset, address: requireAddress(asset.contractAddress) }));
  const localAdmitted = entries.some(({ asset, address }) =>
    asset.cashCurrency !== "USD" && conversionAdmitted(address, data));
  return entries.map(({ asset, address }) => ({
    code: asset.cashCurrency,
    convertOffered: asset.cashCurrency === "USD" ? localAdmitted : conversionAdmitted(address, data),
    name: asset.name,
    symbol: asset.symbol,
    decimals: asset.decimals,
    address,
    portfolioAssetId: asset.id,
    tradeAssetId: asset.cashCurrency === "USD" ? "usdc" : `base:${address}`,
  }));
}

export type CashConversionCurrency = {
  code: FiatCurrencyCode;
  convertOffered: boolean;
  name: string;
  symbol: string;
  decimals: number;
  address: Address;
  portfolioAssetId: string;
  tradeAssetId: string;
};

export type CashConversionCurrencyCode = CashConversionCurrency["code"];

export const cashConversionCurrencies = cashConversionInventory();


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

function conversionDirection(from: CashConversionCurrency, to: CashConversionCurrency): { assetId: string; direction: TradeDirection } | null {
  if (from.code === to.code || (from.code !== "USD" && to.code !== "USD")) return null;
  const local = from.code === "USD" ? to : from;
  return { assetId: local.tradeAssetId, direction: from.code === "USD" ? "buy" : "sell" };
}

function conversionCurrencyForRecord(record: CurrencyRepresentation): CashConversionCurrency | null {
  const address = parseAddress(record.contractAddress);
  if (!address) return null;
  return {
    code: record.displayCurrency,
    convertOffered: false,
    name: record.name,
    symbol: record.symbol,
    decimals: record.decimals,
    address,
    portfolioAssetId: record.id.replace(/^base:/, ""),
    tradeAssetId: record.id === CONVERT_QUOTE_ASSET_ID ? "usdc" : `base:${address}`,
  };
}

function conversionIdentities(data: ConvertAdmissionData) {
  return nonDeferredCurrencyRecords(data.records ?? CURRENCY_REGISTRY).flatMap((record) => {
    const active = cashConversionCurrencies.find((currency) => currency.address === record.contractAddress.toLowerCase());
    if (active) return [{ record, currency: active }];
    const currency = conversionCurrencyForRecord(record);
    return currency ? [{ record, currency }] : [];
  });
}

export function cashConversionTrade(from: CashConversionCurrencyCode, to: CashConversionCurrencyCode, data: ConvertAdmissionData = {}): { assetId: string; direction: TradeDirection } | null {
  const inventory = cashConversionInventory(data);
  const source = inventory.find((currency) => currency.code === from);
  const destination = inventory.find((currency) => currency.code === to);
  if (!source?.convertOffered || !destination?.convertOffered) return null;
  return conversionDirection(source, destination);
}

/** @public Classifies verified cash-to-cash trade metadata for Activity */
export function cashConversionPair(metadata: TradeMoneyActionMetadata, data: ConvertAdmissionData = {}): { from: CashConversionCurrency; to: CashConversionCurrency } | null {
  if (metadata.network.chainId !== 8453 || metadata.network.name !== "Base") return null;
  const identities = conversionIdentities(data);
  const match = (asset: TradeMoneyActionMetadata["fromAsset"]) => identities.find(({ currency }) =>
    currency.address === asset.address && currency.decimals === asset.decimals);
  const from = match(metadata.fromAsset);
  const to = match(metadata.toAsset);
  if (!from || !to || !(data.pairs ?? CONVERT_PAIRS).some((pair) => pair.from === from.record.id && pair.to === to.record.id)) return null;
  const trade = conversionDirection(from.currency, to.currency);
  return trade && metadata.direction === trade.direction && metadata.assetId === trade.assetId
    ? { from: from.currency, to: to.currency } : null;
}

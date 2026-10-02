import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { BASE_USDC } from "@/shared/assets/base";
import { resolveConvertPair } from "@/shared/currencies/convert";
import { currencyRecordById, currencyRecordForContract } from "@/shared/currencies/registry";
import { CONVERT_QUOTE_ASSET_ID } from "@/shared/currencies/types";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { parseAddress, type Address } from "@/shared/chain/hex";
import type { TradeDirection, TradeMoneyActionMetadata } from "./contract";

export type TradeAssetResolution =
  | { status: "tradeable"; assetId: string; address: Address; configured: InvestAsset | null }
  | { status: "eligibility-required"; asset: InvestAsset };

const configuredById = new Map<string, InvestAsset>(investAssets.map((asset) => [asset.id, asset]));
const usdcAddress = parseAddress(BASE_USDC.address);

export function buyRouteForToken({ chainId, address }: { chainId: number; address: string }): string | null {
  if (chainId !== 8453) return null;
  const normalized = parseAddress(address);
  if (!normalized) return null;
  const configured = investAssets.find((asset) => parseAddress(asset.contractAddress) === normalized);
  const resolution = resolveTradeAsset(configured?.id ?? `base:${normalized}`);
  if (resolution?.status !== "tradeable" || resolution.address !== normalized) return null;
  const currencyRecord = currencyRecordForContract(normalized);
  return currencyRecord && !convertDirectionAdmitted(currencyRecord.id, "buy") ? null : resolution.assetId;
}

export function convertDirectionAdmitted(
  recordId: string,
  direction: TradeDirection,
  deps: { convertPair?: typeof resolveConvertPair } = {},
): boolean {
  const from = direction === "sell" ? recordId : CONVERT_QUOTE_ASSET_ID;
  const to = direction === "sell" ? CONVERT_QUOTE_ASSET_ID : recordId;
  return (deps.convertPair ?? resolveConvertPair)({ from, to }).status === "eligible";
}

export function convertCurrencyTradeable(
  recordId: string,
  deps: { convertPair?: typeof resolveConvertPair } = {},
): boolean {
  return convertDirectionAdmitted(recordId, "buy", deps) && convertDirectionAdmitted(recordId, "sell", deps);
}

export function tradeMetadataTradeable(
  metadata: Pick<TradeMoneyActionMetadata, "direction" | "fromAsset" | "toAsset"> & { currencyRecordId?: unknown },
  deps: { convertPair?: typeof resolveConvertPair } = {},
): boolean {
  const asset = metadata.direction === "buy" ? metadata.toAsset : metadata.fromAsset;
  const normalized = parseAddress(asset?.address);
  if (!normalized) return false;
  if (metadata.currencyRecordId !== undefined) {
    const record = typeof metadata.currencyRecordId === "string" ? currencyRecordById(metadata.currencyRecordId) : null;
    return record !== null && record.contractAddress.toLowerCase() === normalized &&
      convertCurrencyTradeable(record.id, deps);
  }
  const record = currencyRecordForContract(normalized);
  return record === null || convertCurrencyTradeable(record.id, deps);
}

export function resolveTradeAsset(
  assetId: string,
  deps: { convertPair?: typeof resolveConvertPair } = {},
): TradeAssetResolution | null {
  const identity = resolveMarketPriceAssetIdentity(assetId);
  if (!identity) return null;
  const configured = configuredById.get(identity.assetId) ?? null;
  if (configured?.category === "stock") return { status: "eligibility-required", asset: configured };
  const address = parseAddress(identity.contractAddress);
  if (!address) return null;
  if (address === usdcAddress) return null;
  const currencyRecord = currencyRecordForContract(address);
  if (currencyRecord && !convertCurrencyTradeable(currencyRecord.id, deps)) return null;
  return { status: "tradeable", assetId: identity.assetId, address, configured };
}

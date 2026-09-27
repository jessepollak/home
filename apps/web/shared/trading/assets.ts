import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { BASE_USDC } from "@/shared/assets/base";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import type { Address } from "./server-types";

export type TradeAssetResolution =
  | { status: "tradeable"; assetId: string; address: Address; configured: InvestAsset | null }
  | { status: "eligibility-required"; asset: InvestAsset };

const configuredById = new Map<string, InvestAsset>(investAssets.map((asset) => [asset.id, asset]));
const usdcAddress = BASE_USDC.address.toLowerCase();

export function buyRouteForToken({ chainId, address }: { chainId: number; address: string }): string | null {
  if (chainId !== 8453 || !/^0x[0-9a-f]{40}$/i.test(address)) return null;
  const normalized = address.toLowerCase();
  const configured = investAssets.find((asset) => asset.contractAddress.toLowerCase() === normalized);
  const resolution = resolveTradeAsset(configured?.id ?? `base:${normalized}`);
  return resolution?.status === "tradeable" && resolution.address === normalized ? resolution.assetId : null;
}

export function resolveTradeAsset(assetId: string): TradeAssetResolution | null {
  const identity = resolveMarketPriceAssetIdentity(assetId);
  if (!identity) return null;
  const configured = configuredById.get(identity.assetId) ?? null;
  if (configured?.category === "stock") return { status: "eligibility-required", asset: configured };
  const address = identity.contractAddress.toLowerCase() as Address;
  if (address === usdcAddress) return null;
  return { status: "tradeable", assetId: identity.assetId, address, configured };
}

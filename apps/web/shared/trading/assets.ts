import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { BASE_USDC } from "@/shared/assets/base";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { parseAddress, type Address } from "@/shared/chain/hex";

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
  return resolution?.status === "tradeable" && resolution.address === normalized ? resolution.assetId : null;
}

export function resolveTradeAsset(assetId: string): TradeAssetResolution | null {
  const identity = resolveMarketPriceAssetIdentity(assetId);
  if (!identity) return null;
  const configured = configuredById.get(identity.assetId) ?? null;
  if (configured?.category === "stock") return { status: "eligibility-required", asset: configured };
  const address = parseAddress(identity.contractAddress);
  if (!address) return null;
  if (address === usdcAddress) return null;
  return { status: "tradeable", assetId: identity.assetId, address, configured };
}

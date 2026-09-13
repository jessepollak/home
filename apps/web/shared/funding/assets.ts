import {
  BASE_CHAIN_ID,
  BASE_FUNDING_ASSETS,
  type BaseFundingAsset,
  type FundingAssetId,
} from "@/shared/assets/base";

export const FUNDING_CHAIN_ID = BASE_CHAIN_ID;
export type { FundingAssetId } from "@/shared/assets/base";
export type FundingAsset = BaseFundingAsset;
export const fundingAssets = BASE_FUNDING_ASSETS;

export function getFundingAsset(id: string): FundingAsset | undefined {
  return Object.prototype.hasOwnProperty.call(fundingAssets, id)
    ? fundingAssets[id as FundingAssetId]
    : undefined;
}

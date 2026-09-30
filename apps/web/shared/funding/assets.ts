import {
  BASE_FUNDING_ASSETS,
  type BaseFundingAsset,
  type FundingAssetId,
} from "@/shared/assets/base";
import type { FiatCurrencyCode } from "@/config/regions";

export type FundingAsset = BaseFundingAsset;
export const fundingAssets = BASE_FUNDING_ASSETS;

/** @public Receive currencies admitted for the Base receive card. */
export const receiveSupportedCashCurrencies = ["EUR", "IDR"] as const satisfies readonly FiatCurrencyCode[];

export function getFundingAsset(id: string): FundingAsset | undefined {
  return Object.prototype.hasOwnProperty.call(fundingAssets, id)
    ? fundingAssets[id as FundingAssetId]
    : undefined;
}

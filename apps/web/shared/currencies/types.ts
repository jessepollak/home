import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import type { FundingAssetId } from "@/shared/assets/base";

export const CONVERT_PROVIDER = "cdp-swaps" as const;
export const CONVERT_QUOTE_ASSET_ID = "base:usdc" as const;
export const CONVERT_PAIR_MAX_AGE_DAYS = 180 as const;

export type CurrencyLifecycle = "active" | "paused" | "withdrawn";
export type CapabilityState = "approved" | "deferred" | "paused" | "withdrawn";
export type CapabilityCheck = {
  state: CapabilityState;
  verifiedAt?: string;
  evidence?: string;
  reason?: string;
  reference?: string;
};
export type CurrencyRepresentation = {
  id: string;
  chainId: 8453;
  contractAddress: `0x${string}`;
  decimals: number;
  symbol: string;
  name: string;
  displayCurrency: FiatCurrencyCode;
  fundingId: FundingAssetId | null;
  issuer: { name: string; docsUrl: string };
  provenance: { source: string; verifiedAt: string };
  lifecycle: CurrencyLifecycle;
  aliases: readonly string[];
  cash: CapabilityCheck;
  send: CapabilityCheck;
  valuation: CapabilityCheck;
};
export type ConvertPairRecord = {
  id: string;
  from: string;
  to: string;
  provider: typeof CONVERT_PROVIDER;
  regions: "all" | readonly RegionId[];
  status: "verified" | "paused" | "withdrawn";
  verifiedAt: string;
  evidence: string;
  reason?: string;
  reference?: string;
};
export type ConvertUnavailableReason =
  | "same-asset" | "asset-unknown" | "asset-not-cash-approved" | "asset-inactive"
  | "pair-missing" | "pair-paused" | "pair-withdrawn" | "pair-stale" | "region-ineligible";
export type ConvertPairResolution =
  | { status: "eligible"; pair: ConvertPairRecord; from: CurrencyRepresentation; to: CurrencyRepresentation }
  | { status: "unavailable"; reason: ConvertUnavailableReason };

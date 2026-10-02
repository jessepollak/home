import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import { approvedCashCurrencies, marketPriceAssetIdFor, CURRENCY_REGISTRY } from "./registry";
import { CONVERT_PAIR_MAX_AGE_DAYS, CONVERT_PROVIDER, CONVERT_QUOTE_ASSET_ID, type ConvertPairRecord, type ConvertPairResolution, type ConvertUnavailableReason, type CurrencyRepresentation } from "./types";
import { isRegistryVerificationDate } from "./verification-date";

export type ConvertAdmissionData = { records?: readonly CurrencyRepresentation[]; pairs?: readonly ConvertPairRecord[] };

const SHIPPED_CONVERT_VERIFIED_AT = "2026-09-29";
const SHIPPED_CONVERT_EVIDENCE = "Cash Convert shipped route on the Cash tab; docs/currency-registry.md";

function shippedPair(id: string, from: string, to: string): ConvertPairRecord {
  return Object.freeze({
    id, from, to, provider: CONVERT_PROVIDER, regions: "all", status: "verified",
    verifiedAt: SHIPPED_CONVERT_VERIFIED_AT, evidence: SHIPPED_CONVERT_EVIDENCE,
  });
}

/** @public Published Convert pair inventory; exercised by convert.test.ts and drift.test.ts. */
export const CONVERT_PAIRS: readonly ConvertPairRecord[] = Object.freeze([
  shippedPair("usdc-eurc", CONVERT_QUOTE_ASSET_ID, "base:eurc"),
  shippedPair("eurc-usdc", "base:eurc", CONVERT_QUOTE_ASSET_ID),
  shippedPair("usdc-idrx", CONVERT_QUOTE_ASSET_ID, "base:idrx"),
  shippedPair("idrx-usdc", "base:idrx", CONVERT_QUOTE_ASSET_ID),
]);

type ConvertQuery = { from: string; to: string; regionId?: RegionId; now?: Date };
type ListedPair = { status: "listed"; pair: ConvertPairRecord; from: CurrencyRepresentation; to: CurrencyRepresentation };

function listedPair(input: ConvertQuery, data: ConvertAdmissionData): ListedPair | { status: "unavailable"; reason: ConvertUnavailableReason } {
  if (input.from === input.to) return { status: "unavailable", reason: "same-asset" };
  const records = data.records ?? CURRENCY_REGISTRY;
  const from = records.find((record) => record.id === input.from);
  const to = records.find((record) => record.id === input.to);
  if (!from || !to) return { status: "unavailable", reason: "asset-unknown" };
  if (from.cash.state !== "approved" || to.cash.state !== "approved") return { status: "unavailable", reason: "asset-not-cash-approved" };
  if (from.lifecycle !== "active" || to.lifecycle !== "active") return { status: "unavailable", reason: "asset-inactive" };
  const pair = (data.pairs ?? CONVERT_PAIRS).find((record) => record.from === from.id && record.to === to.id);
  if (!pair) return { status: "unavailable", reason: "pair-missing" };
  if (pair.status === "withdrawn") return { status: "unavailable", reason: "pair-withdrawn" };
  if (pair.status === "paused") return { status: "unavailable", reason: "pair-paused" };
  if (pair.regions !== "all" && (!input.regionId || !pair.regions.includes(input.regionId))) {
    return { status: "unavailable", reason: "region-ineligible" };
  }
  return { status: "listed", pair, from, to };
}

/** @public Admitting resolution: identity, status and the dated re-verification rule against the caller's clock. */
export function resolveConvertPair(input: ConvertQuery, data: ConvertAdmissionData = {}): ConvertPairResolution {
  const listed = listedPair(input, data);
  if (listed.status !== "listed") return listed;
  const now = input.now ?? new Date();
  if (!isRegistryVerificationDate(listed.pair.verifiedAt, now) ||
    now.getTime() - Date.parse(`${listed.pair.verifiedAt}T00:00:00Z`) > CONVERT_PAIR_MAX_AGE_DAYS * 86_400_000) {
    return { status: "unavailable", reason: "pair-stale" };
  }
  return { status: "eligible", pair: listed.pair, from: listed.from, to: listed.to };
}

/** @public Presentation listing: identity and status only, never the device clock. */
export function convertPairListed(input: { from: string; to: string; regionId?: RegionId }, data: ConvertAdmissionData = {}): boolean {
  return listedPair(input, data).status === "listed";
}

export function convertCurrencyListed(id: string, data: ConvertAdmissionData = {}, regionId?: RegionId): boolean {
  return convertPairListed({ from: id, to: CONVERT_QUOTE_ASSET_ID, regionId }, data) &&
    convertPairListed({ from: CONVERT_QUOTE_ASSET_ID, to: id, regionId }, data);
}


/** @public Convert picker capability source, exercised by convert.test.ts. */
export function convertPickerEntries(
  options: { regionId?: RegionId } = {},
  data: ConvertAdmissionData = {},
): readonly { id: string; name: string; symbol: string; displayCurrency: FiatCurrencyCode; marketPriceAssetId: string }[] {
  const records = data.records ?? CURRENCY_REGISTRY;
  return approvedCashCurrencies(records).filter((record) => convertCurrencyListed(record.id, data, options.regionId))
    .map((record) => ({
      id: record.id,
      name: record.name,
      symbol: record.symbol,
      displayCurrency: record.displayCurrency,
      marketPriceAssetId: marketPriceAssetIdFor(record),
    }));
}

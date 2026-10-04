import { presentationRegions } from "@/config/regions";
import { BASE_FUNDING_ASSETS } from "@/shared/assets/base";
import { parseAddress } from "@/shared/chain/hex";
import { CONVERT_PAIR_MAX_AGE_DAYS, type CapabilityCheck, type ConvertPairRecord, type CurrencyRepresentation } from "./types";
import { isRegistryVerificationDate } from "./verification-date";

type CurrencyRegistryFinding = { code: string; message: string; recordId?: string; pairId?: string };

export function currencyRegistryDrift(input: {
  records: readonly CurrencyRepresentation[];
  pairs: readonly ConvertPairRecord[];
  asOf?: Date;
}): readonly CurrencyRegistryFinding[] {
  const { records, pairs } = input;
  const findings: CurrencyRegistryFinding[] = [];
  const addRecord = (code: string, message: string, recordId: string) => findings.push({ code, message, recordId });
  const addPair = (code: string, message: string, pairId: string) => findings.push({ code, message, pairId });
  const funding = new Map(Object.entries(BASE_FUNDING_ASSETS));
  const ids = new Set<string>();
  const addresses = new Set<string>();
  const aliases = new Set<string>();
  const approvedCurrencies = new Set<string>();
  const asOf = input.asOf ?? new Date();
  const fiatCodes = new Set<string>([
    ...records.map((record) => record.displayCurrency),
    ...Object.values(presentationRegions).flatMap((region) => region.currency.code ? [region.currency.code] : []),
  ]);

  for (const key of Object.keys(BASE_FUNDING_ASSETS)) {
    if (!records.some((record) => record.fundingId === key)) addRecord("missing-funding-record", `Funding asset ${key} has no disposition`, key);
  }
  for (const record of records) {
    if (record.fundingId) {
      const source = funding.get(record.fundingId);
      if (!source || record.id !== source.id || record.chainId !== source.chainId ||
        record.contractAddress.toLowerCase() !== source.address.toLowerCase() ||
        record.decimals !== source.decimals || record.symbol !== source.symbol ||
        record.displayCurrency !== source.fiatCurrency) {
        addRecord("unknown-funding-id", `Funding identity differs for ${record.id}`, record.id);
      }
    }
    const address = record.contractAddress.toLowerCase();
    if (ids.has(record.id) || addresses.has(address)) addRecord("duplicate-identity", `Repeated identity for ${record.id}`, record.id);
    if (!parseAddress(record.contractAddress)) addRecord("invalid-identity", `Contract address is invalid for ${record.id}`, record.id);
    if (!Number.isSafeInteger(record.decimals) || record.decimals < 0 || record.decimals > 255) {
      addRecord("invalid-decimals", `Decimal scale is invalid for ${record.id}`, record.id);
    }
    ids.add(record.id);
    addresses.add(address);
    const cashApproved = record.cash.state === "approved";
    if (cashApproved) {
      if (approvedCurrencies.has(record.displayCurrency)) addRecord("duplicate-alias", `Multiple Cash records for ${record.displayCurrency}`, record.id);
      approvedCurrencies.add(record.displayCurrency);
    }
    for (const alias of record.aliases) {
      const normalized = alias.toUpperCase();
      if (aliases.has(normalized) ||
        (fiatCodes.has(normalized) && (!cashApproved || normalized !== record.displayCurrency))) {
        addRecord("duplicate-alias", `Alias ${alias} conflicts with Cash identity`, record.id);
      }
      aliases.add(normalized);
    }
    const capabilities: readonly CapabilityCheck[] = [record.cash, record.send, record.valuation];
    if (capabilities.some((capability) =>
      capability.state !== "approved" && (!capability.reason || (capability.state === "deferred" && !capability.reference)))) {
      addRecord("undispositioned-record", `Capability disposition is incomplete for ${record.id}`, record.id);
    }
    if (!record.provenance.source.trim() || !isRegistryVerificationDate(record.provenance.verifiedAt, asOf) ||
      (record.fundingId === null && !/^(?:docs\/\S+|https?:\/\/\S+)$/.test(record.provenance.source))) {
      addRecord("invalid-provenance", `Provenance is incomplete for ${record.id}`, record.id);
    }
    if (capabilities.some((capability) => capability.state === "approved" &&
      (!capability.verifiedAt || !isRegistryVerificationDate(capability.verifiedAt, asOf) || !capability.evidence))) {
      addRecord("missing-capability-evidence", `Approval is unverified for ${record.id}`, record.id);
    }
    if (record.lifecycle !== "active" && record.cash.state === "approved") {
      addRecord("lifecycle-conflict", `Inactive record ${record.id} has approved Cash`, record.id);
    }
    if (record.cash.state !== "deferred" && record.valuation.state !== "approved") {
      addRecord("missing-valuation", `Inventory record ${record.id} has no approved valuation`, record.id);
    }
    if (record.cash.state !== "deferred" && record.send.state !== "approved") {
      addRecord("missing-exit-capability", `Inventory record ${record.id} has no approved Send exit`, record.id);
    }
  }
  const pairKeys = new Set<string>();
  for (const pair of pairs) {
    const from = records.find((record) => record.id === pair.from);
    const to = records.find((record) => record.id === pair.to);
    if (!from || !to) addPair("unknown-pair-asset", `Pair ${pair.id} references an unknown asset`, pair.id);
    const key = JSON.stringify([pair.from, pair.to]);
    if (pair.from === pair.to || pairKeys.has(key) || (pair.status === "verified" &&
      (!pair.evidence || !isRegistryVerificationDate(pair.verifiedAt, asOf)))) {
      addPair("invalid-pair", `Pair ${pair.id} is invalid or duplicated`, pair.id);
    }
    pairKeys.add(key);
    if (pair.status !== "verified" && !pair.reason?.trim()) {
      addPair("undispositioned-pair", `Pair ${pair.id} is ${pair.status} without a reason`, pair.id);
    }
    if (pair.status === "verified") {
      if (isRegistryVerificationDate(pair.verifiedAt, asOf) &&
        asOf.getTime() - Date.parse(`${pair.verifiedAt}T00:00:00Z`) > CONVERT_PAIR_MAX_AGE_DAYS * 86_400_000) {
        addPair("stale-pair", `Pair ${pair.id} has stale verification`, pair.id);
      }
      if (!pairs.some((reverse) => reverse.from === pair.to && reverse.to === pair.from && reverse.status === "verified")) {
        addPair("pair-incomplete", `Pair ${pair.id} has no verified reverse`, pair.id);
      }
      if (pair.regions !== "all") {
        addPair("region-scoped-pair", `Pair ${pair.id} requires a trusted execution region`, pair.id);
      }
      if ((from && (from.lifecycle !== "active" || from.cash.state !== "approved")) ||
        (to && (to.lifecycle !== "active" || to.cash.state !== "approved"))) {
        addPair("missing-capability-evidence", `Pair ${pair.id} includes an asset without approved Cash`, pair.id);
      }
    }
  }
  return findings;
}

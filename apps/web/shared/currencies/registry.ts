import type { FiatCurrencyCode } from "@/config/regions";
import { BASE_FUNDING_ASSETS, type FundingAssetId } from "@/shared/assets/base";
import { parseAddress } from "@/shared/chain/hex";
import type { CapabilityCheck, CurrencyRepresentation } from "./types";

const fundingProvenance = { source: "docs/currency-defaults.md + docs/regional-money.md", verifiedAt: "2026-09-12" };
const displayApproval: CapabilityCheck = { state: "approved", verifiedAt: "2026-09-08", evidence: "docs/regional-money.md" };
const sendApproval: CapabilityCheck = { state: "approved", verifiedAt: "2026-09-08", evidence: "docs/regional-money.md" };
const valuationApproval: CapabilityCheck = { state: "approved", verifiedAt: "2026-09-08", evidence: "docs/codex-prices.md" };
const promotionApproval: CapabilityCheck = { state: "approved", verifiedAt: "2026-09-30", evidence: "docs/regional-money.md" };

function fundingRecord(
  fundingId: FundingAssetId,
  issuerName: string,
  capabilities: { cash: CapabilityCheck; send: CapabilityCheck; valuation: CapabilityCheck },
  aliases: readonly string[],
  options: { name?: string; provenance?: CurrencyRepresentation["provenance"] } = {},
): CurrencyRepresentation {
  const asset = BASE_FUNDING_ASSETS[fundingId];
  return {
    id: asset.id,
    chainId: asset.chainId,
    contractAddress: asset.address,
    decimals: asset.decimals,
    symbol: asset.symbol,
    name: options.name ?? asset.name,
    displayCurrency: asset.fiatCurrency,
    fundingId,
    issuer: { name: issuerName, docsUrl: asset.issuerDocsUrl },
    provenance: options.provenance ?? fundingProvenance,
    lifecycle: "active",
    aliases,
    ...capabilities,
  };
}

export const CURRENCY_REGISTRY: readonly CurrencyRepresentation[] = Object.freeze([
  fundingRecord("base:usdc", "Circle", { cash: displayApproval, send: sendApproval, valuation: valuationApproval }, ["USDC", "USD"]),
  {
    id: "base:eurc",
    chainId: 8453,
    contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
    decimals: 6,
    symbol: "EURC",
    name: "Euro",
    displayCurrency: "EUR",
    fundingId: null,
    issuer: { name: "Circle", docsUrl: "https://www.circle.com/eurc" },
    provenance: { source: "docs/currency-defaults.md", verifiedAt: "2026-09-07" },
    lifecycle: "active",
    aliases: ["EURC", "EUR"],
    cash: displayApproval,
    send: sendApproval,
    valuation: valuationApproval,
  } satisfies CurrencyRepresentation,
  fundingRecord("base:idrx", "IDRX", { cash: displayApproval, send: sendApproval, valuation: valuationApproval }, ["IDRX", "IDR"]),
  fundingRecord("base:wars", "Ripio", { cash: promotionApproval, send: promotionApproval, valuation: promotionApproval }, ["wARS"], { name: "Argentine peso" }),
  fundingRecord("base:wbrl", "Ripio", { cash: promotionApproval, send: promotionApproval, valuation: promotionApproval }, ["wBRL"], {
    name: "Brazilian real",
    provenance: {
      source: "docs/currency-defaults.md",
      verifiedAt: "2026-09-15",
    },
  }),
  fundingRecord("base:wcop", "Ripio", { cash: promotionApproval, send: promotionApproval, valuation: promotionApproval }, ["wCOP"], { name: "Colombian peso" }),
].map((record) => Object.freeze(record)));

export function currencyRecordById(id: string): CurrencyRepresentation | null {
  return CURRENCY_REGISTRY.find((record) => record.id === id) ?? null;
}

export function currencyRecordForContract(address: string | null | undefined): CurrencyRepresentation | null {
  const normalized = parseAddress(address);
  if (!normalized) return null;
  return CURRENCY_REGISTRY.find((record) => record.contractAddress.toLowerCase() === normalized) ?? null;
}

export function cashCurrencyForContract(address: string | null | undefined): FiatCurrencyCode | null {
  const record = currencyRecordForContract(address);
  return record && record.lifecycle === "active" && record.cash.state === "approved" ? record.displayCurrency : null;
}

/** @public Identities whose Cash status is known: approved, paused or withdrawn, for historical matching; never-promoted (deferred) records are excluded. */
export function nonDeferredCurrencyRecords(records: readonly CurrencyRepresentation[] = CURRENCY_REGISTRY): readonly CurrencyRepresentation[] {
  return records.filter((record) => record.cash.state !== "deferred");
}

export function pegCurrencyForContract(
  address: string | null | undefined,
  records: readonly CurrencyRepresentation[] = CURRENCY_REGISTRY,
): FiatCurrencyCode | null {
  const normalized = parseAddress(address);
  if (!normalized) return null;
  const record = nonDeferredCurrencyRecords(records).find((candidate) => candidate.contractAddress.toLowerCase() === normalized);
  return record?.displayCurrency ?? null;
}

export function approvedCashCurrencies(records: readonly CurrencyRepresentation[] = CURRENCY_REGISTRY): readonly CurrencyRepresentation[] {
  return records.filter((record) => record.lifecycle === "active" && record.cash.state === "approved");
}

export function approvedCashRecordForCurrency(currency: FiatCurrencyCode): CurrencyRepresentation | null {
  return approvedCashCurrencies().find((record) => record.displayCurrency === currency) ?? null;
}

export function recordsWithPreservedHoldings(records: readonly CurrencyRepresentation[] = CURRENCY_REGISTRY): readonly CurrencyRepresentation[] {
  return records.filter((record) =>
    record.cash.state === "paused" || record.cash.state === "withdrawn" ||
    (record.cash.state === "approved" && record.lifecycle !== "active")
  );
}

export function marketPriceAssetIdFor(record: CurrencyRepresentation): `base:${string}` {
  return `base:${record.contractAddress.toLowerCase()}`;
}

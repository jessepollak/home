import countrySnapshotJson from "./coverage-countries-2026.json";
import gdpSnapshotJson from "./coverage-gdp-2024.json";
import {
  countryRegionIds,
  presentationRegions,
  type CountryCode,
} from "./regions";
import type { FundingAssetId } from "@/shared/assets/base";

export const COVERAGE_REGISTRY_CHECKED_AT = "2026-09-15" as const;

export const COVERAGE_RESEARCH_SOURCE = {
  name: "Home issuer-first local-rail research",
  checkedAt: "2026-09-08",
  url: "https://github.com/jessepollak/home/issues/15#issuecomment-5588844294",
} as const;

export const coverageIssuerStatuses = ["documented", "conditional", "not-found", "not-researched"] as const;
export type CoverageIssuerStatus = (typeof coverageIssuerStatuses)[number];
export const coverageHomeStatuses = ["none", "planned", "in-build", "sandbox", "live"] as const;
export type CoverageHomeStatus = (typeof coverageHomeStatuses)[number];
export type CoverageProviderId = "coinbase" | "idrx" | "ripio";

export type CoverageEvidence = { url: string; checkedAt: string; note: string };
export type HomeRouteEvidence = { environment: "hosted-production"; proofRef: string; checkedAt: string };
export type CoverageRecord = {
  countryCode: string;
  countryName: string;
  currencyCodes: readonly string[];
  configuredInHome: boolean;
  issuerRoute: { status: CoverageIssuerStatus; rail: string; audience: string; evidence: CoverageEvidence | null };
  homeRoute: { status: CoverageHomeStatus; providerId: CoverageProviderId | null; assetId: FundingAssetId | null; paymentMethodIds: readonly string[]; evidence: HomeRouteEvidence | null };
  quoteObservation: null | { quotedAt: string; spreadBps: number | null; feeSummary: string; sourceUrl: string };
};

type Research = readonly [CoverageIssuerStatus, string, string];

// Issue #15 research is assigned only to countries explicitly named in its matrix.
// In particular, its currency-level "Euro area" row is not inherited by EUR countries.
const countryResearch: Partial<Record<CountryCode, Research>> = {
  AR: ["conditional", "CVU / Mercado Pago", "Consumer wallet and B2B ramps"],
  AU: ["conditional", "Bank virtual account", "Distributors and institutions"],
  BR: ["documented", "Pix", "Consumer miniapp and API"],
  CA: ["conditional", "Bank transfer / wire", "Institutional participants"],
  CH: ["conditional", "CHF bank transfer", "Institutional KYB"],
  CL: ["conditional", "Bank transfer", "Wallet and B2B; exact route unclear"],
  CO: ["conditional", "PSE / real-time payments / Bre-B", "Wallet and B2B"],
  GB: ["conditional", "Faster Payments / CHAPS", "Institutions"],
  ID: ["documented", "Bank virtual account / QRIS", "API and consumer flows"],
  MX: ["documented", "SPEI (CLABE)", "Business Mint and API"],
  MY: ["documented", "FPX / DuitNow / bank deposit", "Consumer app"],
  NG: ["conditional", "Designated bank deposit", "Verified users; bridge to Base"],
  NZ: ["conditional", "Bank funding", "Wholesale; retail through exchange"],
  PE: ["conditional", "Bank transfer", "Wallet and B2B; exact route unclear"],
  SG: ["documented", "FAST (Mint VAN)", "Verified personal and business users"],
  TR: ["documented", "Bank transfer (IBAN; FAST/EFT)", "Consumer"],
  US: ["conditional", "Fedwire / RTP / ACH-style wires", "Institutional Circle Mint"],
  ZA: ["conditional", "Partner bank transfer", "Partners and exchanges"],
};

const homeRoutes: Partial<Record<CountryCode, CoverageRecord["homeRoute"]>> = {
  AR: { status: "in-build", providerId: "ripio", assetId: "base:wars", paymentMethodIds: ["bank_transfer"], evidence: null },
  BR: { status: "in-build", providerId: "ripio", assetId: "base:wbrl", paymentMethodIds: ["pix"], evidence: null },
  CO: { status: "in-build", providerId: "ripio", assetId: "base:wcop", paymentMethodIds: ["bank_transfer", "breb", "r2p_bancolombia", "r2p_nequi"], evidence: null },
  ID: { status: "in-build", providerId: "idrx", assetId: "base:idrx", paymentMethodIds: ["bank-va-mandiri", "bank-va-bri", "qris"], evidence: null },
  US: { status: "sandbox", providerId: "coinbase", assetId: "base:usdc", paymentMethodIds: ["apple-pay"], evidence: null },
};

export const coverageCountrySnapshot = countrySnapshotJson;
const configuredCountryCodes = new Set<string>(countryRegionIds);

export const coverageRegistry: readonly CoverageRecord[] = countrySnapshotJson.rows.map((country) => {
  const configured = configuredCountryCodes.has(country.countryCode);
  const countryCode = country.countryCode as CountryCode;
  const research = configured ? countryResearch[countryCode] : undefined;
  return {
    ...country,
    configuredInHome: configured,
    issuerRoute: research ? {
      status: research[0], rail: research[1], audience: research[2],
      evidence: {
        url: countryCode === "AR" ? "https://github.com/jessepollak/home/issues/15" : COVERAGE_RESEARCH_SOURCE.url,
        checkedAt: countryCode === "AR" ? "2026-09-10" : COVERAGE_RESEARCH_SOURCE.checkedAt,
        note: "Country-explicit issuer-first desk research; documentation is not Home production proof.",
      },
    } : { status: "not-researched", rail: "Not researched", audience: "Not researched", evidence: null },
    homeRoute: configured ? homeRoutes[countryCode] ?? { status: "none", providerId: null, assetId: null, paymentMethodIds: [], evidence: null } : { status: "none", providerId: null, assetId: null, paymentMethodIds: [], evidence: null },
    quoteObservation: null,
  };
});

export const coverageGdpSnapshot = gdpSnapshotJson as {
  indicator: "NY.GDP.MKTP.CD"; indicatorName: string; year: 2024; downloadedAt: string; sourceUrl: string;
  selectionNote: string; completeness: { universeCount: number; valueCount: number; percent: number; comparison: Record<string, number>; sufficientlyCompleteRule: string };
  rows: Record<string, number | null>;
};

export type CoverageSort = "gdp" | "alphabetical";
export function sortCoverage(records: readonly CoverageRecord[], sort: CoverageSort) {
  return [...records].sort((a, b) => {
    if (sort === "alphabetical") return a.countryName.localeCompare(b.countryName, "en") || a.countryCode.localeCompare(b.countryCode, "en");
    const aGdp = coverageGdpSnapshot.rows[a.countryCode] ?? null;
    const bGdp = coverageGdpSnapshot.rows[b.countryCode] ?? null;
    if (aGdp === null && bGdp === null) return a.countryCode.localeCompare(b.countryCode, "en");
    if (aGdp === null) return 1;
    if (bGdp === null) return -1;
    return bGdp - aGdp || a.countryCode.localeCompare(b.countryCode, "en");
  });
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function coverageCsv(records: readonly CoverageRecord[] = coverageRegistry) {
  const header = ["country_code", "country", "currencies", "configured_in_home", "candidate_asset", "candidate_issuer", "issuer_route_status", "issuer_rail", "issuer_evidence_checked_at", "issuer_evidence_url", "home_route_status", "home_provider_id", "home_asset_id", "home_payment_method_ids", "home_live_checked_at", "quote_observed_at", "quote_spread_bps", "quote_fee_summary", "quote_source_url", "gdp_current_usd", "gdp_year"];
  const rows = sortCoverage(records, "alphabetical").map((record) => {
    const region = record.configuredInHome ? presentationRegions[record.countryCode as CountryCode] : null;
    return [record.countryCode, record.countryName, record.currencyCodes.join("|"), record.configuredInHome ? "true" : "false", region?.candidateAsset?.symbol ?? "", region?.candidateAsset?.issuer ?? "", record.issuerRoute.status, record.issuerRoute.rail, record.issuerRoute.evidence?.checkedAt ?? "", record.issuerRoute.evidence?.url ?? "", record.homeRoute.status, record.homeRoute.providerId ?? "", record.homeRoute.assetId ?? "", record.homeRoute.paymentMethodIds.join("|"), record.homeRoute.evidence?.checkedAt ?? "", record.quoteObservation?.quotedAt ?? "", record.quoteObservation?.spreadBps ?? null, record.quoteObservation?.feeSummary ?? "", record.quoteObservation?.sourceUrl ?? "", coverageGdpSnapshot.rows[record.countryCode] ?? null, coverageGdpSnapshot.year].map(csvCell).join(",");
  });
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

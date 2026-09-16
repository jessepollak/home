import countrySnapshotJson from "./coverage-countries-2026.json";
import gdpSnapshotJson from "./coverage-gdp-2024.json";
import {
  countryRegionIds,
  presentationRegions,
  type CountryCode,
} from "./regions";
import type { FundingAssetId } from "@/shared/assets/base";

export const COVERAGE_REGISTRY_CHECKED_AT = "2026-09-16" as const;

export const COVERAGE_RESEARCH_SOURCE = {
  name: "Home top-100 issuer-first local-stablecoin research (#539 final findings)",
  checkedAt: "2026-09-16",
  url: "https://github.com/jessepollak/home/issues/539",
} as const;

const PRIOR_ISSUER_RESEARCH_SOURCE = {
  checkedAt: "2026-09-08",
  url: "https://github.com/jessepollak/home/issues/15#issuecomment-5588844294",
} as const;

export const coverageIssuerStatuses = ["documented", "conditional", "not-found", "not-researched"] as const;
export type CoverageIssuerStatus = (typeof coverageIssuerStatuses)[number];
export const coverageHomeStatuses = ["none", "planned", "in-build", "sandbox", "live"] as const;
export type CoverageHomeStatus = (typeof coverageHomeStatuses)[number];
export const coveragePortfolioStatuses = ["priority", "deferred", "not-scoped"] as const;
export type CoveragePortfolioStatus = (typeof coveragePortfolioStatuses)[number];
export const coverageWorkstreamStages = ["planned", "in-build", "blocked"] as const;
export type CoverageWorkstreamStage = (typeof coverageWorkstreamStages)[number];
export type CoverageProviderId = "coinbase" | "idrx" | "ripio";

export type CoverageEvidence = { url: string; checkedAt: string; note: string };
export type HomeRouteEvidence = { environment: "hosted-production"; proofRef: string; checkedAt: string };
export type CoveragePortfolioWorkstream = {
  routeId: string;
  currencyCode: string;
  assetSymbol: string;
  provider: string;
  issueNumber: number;
  issueUrl: string;
  stage: CoverageWorkstreamStage;
  note: string;
};
export type CoverageRecord = {
  countryCode: string;
  countryName: string;
  currencyCodes: readonly string[];
  configuredInHome: boolean;
  issuerRoute: { status: CoverageIssuerStatus; rail: string; audience: string; evidence: CoverageEvidence | null };
  portfolio: { status: CoveragePortfolioStatus; workstreams: readonly CoveragePortfolioWorkstream[] };
  homeRoute: { status: CoverageHomeStatus; providerId: CoverageProviderId | null; assetId: FundingAssetId | null; paymentMethodIds: readonly string[]; evidence: HomeRouteEvidence | null };
  quoteObservation: null | { quotedAt: string; spreadBps: number | null; feeSummary: string; sourceUrl: string };
};

type Research = readonly [CoverageIssuerStatus, string, string];

// Locked non-USD top-100 ordering from #539. Every code in this list receives
// country-explicit research; no result is inherited by another country that
// happens to use the same tender.
export const top100ResearchedCountryCodes = [
  "CN", "DE", "JP", "IN", "GB", "FR", "IT", "CA", "RU", "BR", "KR", "MX", "AU", "ES", "ID", "TR", "SA", "NL", "CH", "PL",
  "BE", "AR", "IE", "SE", "SG", "AE", "IL", "AT", "TH", "NO", "VN", "IR", "PH", "BD", "DK", "MY", "CO", "HK", "ZA", "EG",
  "RO", "PK", "CZ", "CL", "PT", "FI", "PE", "KZ", "IQ", "DZ", "NZ", "GR", "NG", "HU", "QA", "UA", "KW", "MA", "ET", "SK",
  "DO", "UZ", "VE", "KE", "BG", "GT", "OM", "AO", "LK", "CR", "LU", "HR", "RS", "CI", "LT", "GH", "UY", "TZ", "BY", "CD",
  "AZ", "MM", "SI", "JO", "BO", "UG", "CM", "TN", "SD", "MO", "LY", "BH", "KH", "PY", "TM", "LV", "NP", "EE", "CY", "HN",
] as const;

const documentedCountryCodes = new Set<string>([
  "DE", "JP", "FR", "IT", "CA", "BR", "KR", "MX", "AU", "ES", "ID", "TR", "NL", "BE", "AR", "IE", "SG", "AE", "IL", "AT",
  "PH", "CO", "ZA", "PT", "FI", "NZ", "GR", "NG", "KE", "BG", "LU", "HR", "LT", "GH", "SI", "SK", "LV", "EE", "CY",
]);
const conditionalCountryCodes = new Set<string>(["GB", "CH", "PL", "MY", "HK", "UA", "CL", "PE", "CI", "TZ", "UG"]);
const blockedCountryCodes = new Set<string>(["CN", "RU", "TH", "VN", "IR", "BD", "PK", "EG", "IQ", "DZ", "QA", "KW", "ET", "LK", "MM", "NP"]);
const top100CountryCodes = new Set<string>(top100ResearchedCountryCodes);
const euroResearchCountryCodes = new Set<string>([
  "DE", "FR", "IT", "ES", "NL", "BE", "IE", "AT", "PT", "FI", "GR", "SK", "BG", "LU", "HR", "LT", "SI", "LV", "EE", "CY",
]);
const euroPriorityCountryCodes = new Set<string>(
  countryRegionIds.filter((countryCode) => presentationRegions[countryCode].currency.code === "EUR"),
);

const researchDetails: Record<string, readonly [string, string]> = {
  JP: ["JPY bank transfer through JPYC EX; refund to registered bank", "KYC retail and business users"],
  CA: ["Institutional CAD transfer, mint and redemption for CADD", "Institution-only CADD route"],
  BR: ["Ripio local BRL bank/partner on/off-ramp", "Retail wallet and approved B2B integrations"],
  KR: ["Institutionally arranged KRW issuance and redemption", "Selected KYC/AML institutions"],
  MX: ["MXNB SPEI/CLABE mint and bank payout; Ripio approved-partner local ramp", "Business and approved-partner routes"],
  AU: ["AUD bank/payment rails through AUDD Mint", "Approved retail and wholesale Australian clients"],
  ID: ["Same-name IDR virtual-account mint; bank/e-wallet redemption", "Personal and business KYC users"],
  TR: ["TRY transfer to issuer IBAN; 1:1 TRY redemption", "KYC BiLira users"],
  AR: ["Ripio local ARS on/off-ramp", "Retail wallet and approved B2B integrations"],
  SG: ["SGD account deposit/withdrawal and XSGD blockchain withdrawal", "Approved personal and business users"],
  AE: ["AED deposit through authorized agent; redemption to local bank", "Registered/KYC agent customers"],
  IL: ["ILS bank transfer and BILS/ILS conversion", "KYC private and business users"],
  PH: ["Coins.ph PHP balance to PHPC and sell back to PHP", "Verified retail users"],
  CO: ["Ripio approved-partner COP on/off-ramp and mint/redeem model", "Approved B2B/partner integrations; consumer access unproven"],
  ZA: ["Same-name ZAR partner bank transfer, mint/burn and bank payout", "Approved institutional partners"],
  NZ: ["Direct NZD mint/redeem with NZD 100,000 minimum", "Accredited/wholesale customers only"],
  NG: ["NGN virtual-account mint; burn pays Nigerian bank", "KYB businesses"],
  KE: ["M-PESA KES buy/sell for synthetic KESm on Celo", "Retail/KYC synthetic route; not fiat-backed"],
  GH: ["Mobile-money GHS buy/sell for synthetic GHSm on Celo", "Retail/KYC synthetic route; not fiat-backed"],
  GB: ["GBPe/GBPQ assets identified, but no public GBP bank-in mint workflow", "Issuer eligibility unresolved for a qualifying route"],
  CH: ["XCHF normal issuance/redemption discontinued; no verified successor route", "No current qualifying audience"],
  PL: ["PLNQ asset identified; no public PLN mint/redemption workflow", "Eligible audience and subscription route unresolved"],
  MY: ["RMJDT sandbox asset; no documented live two-way MYR rail", "Cross-border-trade sandbox"],
  HK: ["HKDAP is pre-launch with no official contract or live rail", "Planned professional/corporate, then retail audience"],
  UA: ["UAHg lacks enforceable redemption and a UAH bank mint", "No qualifying holder route"],
  CL: ["wCLP native Base asset; country-specific CLP bank acquisition/redemption unproven", "Potential Ripio wallet/B2B audience; route unresolved"],
  PE: ["wPEN native Base asset; country-specific PEN bank acquisition/redemption unproven", "Potential Ripio wallet/B2B audience; route unresolved"],
  CI: ["Synthetic XOFm asset exists; exact XOF to XOFm buy/sell route unproven", "Potential retail/KYC audience; route unresolved"],
  TZ: ["nTZS Base candidate; issuer, reserves and TZS rail unresolved", "No qualifying audience established"],
  UG: ["UGXC Base proxy; issuer, reserves and UGX rail unresolved", "No qualifying audience established"],
};

function researchForCountry(countryCode: string): Research | undefined {
  if (countryCode === "US") {
    return ["conditional", "Fedwire / RTP / ACH-style wires", "Institutional Circle Mint"];
  }
  if (!top100CountryCodes.has(countryCode)) return undefined;
  if (euroResearchCountryCodes.has(countryCode)) {
    return [
      "documented",
      "EURe SEPA/Web3-IBAN mint and burn architecture on Base",
      "EU/EEA individuals and companies; country-specific operational eligibility remains unproven",
    ];
  }
  const detail = researchDetails[countryCode];
  if (documentedCountryCodes.has(countryCode)) {
    return ["documented", detail?.[0] ?? "Documented same-fiat acquisition and redemption route", detail?.[1] ?? "See country-explicit #539 evidence"];
  }
  if (conditionalCountryCodes.has(countryCode)) {
    return ["conditional", detail?.[0] ?? "Local asset or architecture identified; qualifying route unresolved", detail?.[1] ?? "No qualifying audience established"];
  }
  return blockedCountryCodes.has(countryCode)
    ? ["not-found", "No qualifying current route; blocked by legal, regulatory, issuer, or program constraints", "No eligible audience established"]
    : ["not-found", "No qualifying matching-tender asset and same-fiat route established", "No eligible audience established"];
}

function issueUrl(issueNumber: number) {
  return `https://github.com/jessepollak/home/issues/${issueNumber}`;
}

function workstream(
  countryCode: string,
  currencyCode: string,
  assetSymbol: string,
  provider: string,
  issueNumber: number,
  stage: CoverageWorkstreamStage,
  note: string,
): CoveragePortfolioWorkstream {
  return {
    routeId: `coverage:${countryCode.toLowerCase()}:${assetSymbol.toLowerCase()}:${provider.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
    currencyCode,
    assetSymbol,
    provider,
    issueNumber,
    issueUrl: issueUrl(issueNumber),
    stage,
    note,
  };
}

function priorityWorkstreams(countryCode: string): readonly CoveragePortfolioWorkstream[] {
  if (euroPriorityCountryCodes.has(countryCode)) return [workstream(
    countryCode,
    "EUR",
    "EURC",
    "Coinbase",
    294,
    "planned",
    "Coinbase country eligibility, EUR rails, economics, and direct Base delivery remain pending; the announcement does not promote issuer-route evidence.",
  )];
  switch (countryCode) {
    case "CA": return [workstream("CA", "CAD", "CADD", "Tetra Trust", 551, "blocked", "Institution-only; blocked on commercial/API access and eligibility proof.")];
    case "MX": return [
      workstream("MX", "MXN", "MXNB", "Juno / Bitso", 552, "planned", "Business route; API credentials and live Base support remain to be confirmed."),
      workstream("MX", "MXN", "wMXN", "Ripio", 512, "planned", "Approved-partner audience must be confirmed independently."),
    ];
    case "AR": return [workstream("AR", "ARS", "wARS", "Ripio", 512, "in-build", "Existing inert Ripio binding; no live route claim.")];
    case "BR": return [workstream("BR", "BRL", "wBRL", "Ripio", 512, "in-build", "Existing inert Ripio binding; no live route claim.")];
    case "CO": return [workstream("CO", "COP", "wCOP", "Ripio", 512, "in-build", "Existing inert Ripio binding; B2B/partner audience only.")];
    case "CL": return [workstream("CL", "CLP", "wCLP", "Ripio", 512, "blocked", "Blocked on country-specific CLP acquisition and redemption rail evidence.")];
    case "PE": return [workstream("PE", "PEN", "wPEN", "Ripio", 512, "blocked", "Blocked on country-specific PEN acquisition and redemption rail evidence.")];
    case "NG": return [workstream("NG", "NGN", "cNGN", "Africa Stablecoin Consortium", 553, "blocked", "Blocked on KYB API access and live Base enablement.")];
    case "ZA": return [workstream("ZA", "ZAR", "ZARP", "ZARP", 554, "blocked", "Blocked on approved-partner eligibility and operational contract.")];
    case "ID": return [workstream("ID", "IDR", "IDRX", "IDRX", 555, "in-build", "Existing inert adapter; production acceptance remains gated.")];
    case "AU": return [workstream("AU", "AUD", "AUDD", "AUDD Mint", 556, "blocked", "Blocked on integration access and Base-delivery confirmation.")];
    case "SG": return [workstream("SG", "SGD", "XSGD", "StraitsX", 557, "planned", "API credentials and enabled local rail remain to be confirmed.")];
    default: return [];
  }
}

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
  const research = researchForCountry(country.countryCode);
  const workstreams = priorityWorkstreams(country.countryCode);
  return {
    ...country,
    configuredInHome: configured,
    issuerRoute: research ? {
      status: research[0], rail: research[1], audience: research[2],
      evidence: {
        url: country.countryCode === "US" ? PRIOR_ISSUER_RESEARCH_SOURCE.url : COVERAGE_RESEARCH_SOURCE.url,
        checkedAt: country.countryCode === "US" ? PRIOR_ISSUER_RESEARCH_SOURCE.checkedAt : COVERAGE_RESEARCH_SOURCE.checkedAt,
        note: country.countryCode === "US"
          ? "Prior country-explicit issuer research retained outside the non-USD #539 pass; documentation is not Home production proof."
          : "Country-explicit #539 issuer-first desk research; documentation is not Home production proof.",
      },
    } : { status: "not-researched", rail: "Not researched", audience: "Not researched", evidence: null },
    portfolio: {
      status: workstreams.length > 0 ? "priority" : top100CountryCodes.has(country.countryCode) ? "deferred" : "not-scoped",
      workstreams,
    },
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
  const header = ["country_code", "country", "currencies", "configured_in_home", "candidate_asset", "candidate_issuer", "issuer_route_status", "issuer_rail", "issuer_evidence_checked_at", "issuer_evidence_url", "portfolio_status", "portfolio_route_ids", "portfolio_route_currencies", "portfolio_route_assets", "portfolio_route_providers", "portfolio_route_issue_numbers", "portfolio_route_issue_urls", "portfolio_route_stages", "home_route_status", "home_provider_id", "home_asset_id", "home_payment_method_ids", "home_live_checked_at", "quote_observed_at", "quote_spread_bps", "quote_fee_summary", "quote_source_url", "gdp_current_usd", "gdp_year"];
  const rows = sortCoverage(records, "alphabetical").map((record) => {
    const region = record.configuredInHome ? presentationRegions[record.countryCode as CountryCode] : null;
    const routes = record.portfolio.workstreams;
    return [record.countryCode, record.countryName, record.currencyCodes.join("|"), record.configuredInHome ? "true" : "false", region?.candidateAsset?.symbol ?? "", region?.candidateAsset?.issuer ?? "", record.issuerRoute.status, record.issuerRoute.rail, record.issuerRoute.evidence?.checkedAt ?? "", record.issuerRoute.evidence?.url ?? "", record.portfolio.status, routes.map((route) => route.routeId).join("|"), routes.map((route) => route.currencyCode).join("|"), routes.map((route) => route.assetSymbol).join("|"), routes.map((route) => route.provider).join("|"), routes.map((route) => route.issueNumber).join("|"), routes.map((route) => route.issueUrl).join("|"), routes.map((route) => route.stage).join("|"), record.homeRoute.status, record.homeRoute.providerId ?? "", record.homeRoute.assetId ?? "", record.homeRoute.paymentMethodIds.join("|"), record.homeRoute.evidence?.checkedAt ?? "", record.quoteObservation?.quotedAt ?? "", record.quoteObservation?.spreadBps ?? null, record.quoteObservation?.feeSummary ?? "", record.quoteObservation?.sourceUrl ?? "", coverageGdpSnapshot.rows[record.countryCode] ?? null, coverageGdpSnapshot.year].map(csvCell).join(",");
  });
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

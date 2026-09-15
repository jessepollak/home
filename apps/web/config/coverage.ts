import gdpSnapshotJson from "./coverage-gdp-2023.json";
import {
  countryRegionIds,
  presentationRegions,
  type CountryCode,
  type FiatCurrencyCode,
} from "./regions";
import type { FundingAssetId } from "@/shared/assets/base";

export const COVERAGE_REGISTRY_CHECKED_AT = "2026-09-15" as const;

export const COVERAGE_RESEARCH_SOURCE = {
  name: "Home issuer-first local-rail research",
  checkedAt: "2026-09-08",
  url: "https://github.com/jessepollak/home/issues/15#issuecomment-5588844294",
} as const;

export const coverageIssuerStatuses = [
  "documented",
  "conditional",
  "not-found",
  "not-researched",
] as const;
export type CoverageIssuerStatus = (typeof coverageIssuerStatuses)[number];

export const coverageHomeStatuses = [
  "none",
  "planned",
  "in-build",
  "sandbox",
  "live",
] as const;
export type CoverageHomeStatus = (typeof coverageHomeStatuses)[number];
export type CoverageProviderId = "coinbase" | "idrx" | "ripio";

export type CoverageEvidence = {
  url: string;
  checkedAt: string;
  note: string;
};

export type HomeRouteEvidence = {
  environment: "hosted-production";
  proofRef: string;
  checkedAt: string;
};

export type CoverageRecord = {
  countryCode: CountryCode;
  currencyCode: FiatCurrencyCode;
  issuerRoute: {
    status: CoverageIssuerStatus;
    rail: string;
    audience: string;
    evidence: CoverageEvidence | null;
  };
  homeRoute: {
    status: CoverageHomeStatus;
    providerId: CoverageProviderId | null;
    assetId: FundingAssetId | null;
    paymentMethodIds: readonly string[];
    evidence: HomeRouteEvidence | null;
  };
  quoteObservation: null | {
    quotedAt: string;
    spreadBps: number | null;
    feeSummary: string;
    sourceUrl: string;
  };
};

const routeResearch = {
  ARS: ["conditional", "CVU / Mercado Pago", "Consumer wallet and B2B ramps"],
  AUD: ["conditional", "Bank virtual account", "Distributors and institutions"],
  BRL: ["documented", "Pix", "Consumer miniapp and API"],
  CAD: ["conditional", "Bank transfer / wire", "Institutional participants"],
  CHF: ["conditional", "CHF bank transfer", "Institutional KYB"],
  CLP: ["conditional", "Bank transfer", "Wallet and B2B; exact route unclear"],
  COP: ["conditional", "PSE / real-time payments / Bre-B", "Wallet and B2B"],
  EUR: ["conditional", "SEPA / SEPA Instant", "Institutional Circle Mint"],
  GBP: ["conditional", "Faster Payments / CHAPS", "Institutions"],
  IDR: ["documented", "Bank virtual account / QRIS", "API and consumer flows"],
  MXN: ["documented", "SPEI (CLABE)", "Business Mint and API"],
  MYR: ["documented", "FPX / DuitNow / bank deposit", "Consumer app"],
  NGN: ["conditional", "Designated bank deposit", "Verified users; bridge to Base"],
  NZD: ["conditional", "Bank funding", "Wholesale; retail through exchange"],
  PEN: ["conditional", "Bank transfer", "Wallet and B2B; exact route unclear"],
  SGD: ["documented", "FAST (Mint VAN)", "Verified personal and business users"],
  TRY: ["documented", "Bank transfer (IBAN; FAST/EFT)", "Consumer"],
  USD: ["conditional", "Fedwire / RTP / ACH-style wires", "Institutional Circle Mint"],
  ZAR: ["conditional", "Partner bank transfer", "Partners and exchanges"],
} as const satisfies Record<FiatCurrencyCode, readonly [CoverageIssuerStatus, string, string]>;

const homeRoutes: Partial<Record<CountryCode, CoverageRecord["homeRoute"]>> = {
  AR: { status: "in-build", providerId: "ripio", assetId: "base:wars", paymentMethodIds: ["bank_transfer"], evidence: null },
  CO: { status: "in-build", providerId: "ripio", assetId: "base:wcop", paymentMethodIds: ["bank_transfer", "breb", "r2p_bancolombia", "r2p_nequi"], evidence: null },
  ID: { status: "in-build", providerId: "idrx", assetId: "base:idrx", paymentMethodIds: ["bank-va-mandiri", "bank-va-bri", "qris"], evidence: null },
  US: { status: "sandbox", providerId: "coinbase", assetId: "base:usdc", paymentMethodIds: ["apple-pay"], evidence: null },
};

export const coverageRegistry: readonly CoverageRecord[] = countryRegionIds.map((countryCode) => {
  const region = presentationRegions[countryCode];
  const currencyCode = region.currency.code;
  if (!currencyCode) throw new Error(`Coverage region ${countryCode} has no currency`);
  const research = routeResearch[currencyCode];
  const correctedArgentina = countryCode === "AR";
  return {
    countryCode,
    currencyCode,
    issuerRoute: {
      status: research[0],
      rail: research[1],
      audience: research[2],
      evidence: {
        url: correctedArgentina
          ? "https://github.com/jessepollak/home/issues/15"
          : COVERAGE_RESEARCH_SOURCE.url,
        checkedAt: correctedArgentina ? "2026-09-10" : COVERAGE_RESEARCH_SOURCE.checkedAt,
        note: correctedArgentina
          ? "Research corrected to conditional after authenticated route requirements were identified."
          : "Issuer-first desk research; documentation is not Home production proof.",
      },
    },
    homeRoute: homeRoutes[countryCode] ?? {
      status: "none",
      providerId: null,
      assetId: null,
      paymentMethodIds: [],
      evidence: null,
    },
    quoteObservation: null,
  };
});

export const coverageGdpSnapshot = gdpSnapshotJson as {
  indicator: "NY.GDP.MKTP.CD";
  indicatorName: string;
  year: 2023;
  downloadedAt: string;
  sourceUrl: string;
  rows: Record<CountryCode, number | null>;
};

export type CoverageSort = "gdp" | "alphabetical";

export function sortCoverage(records: readonly CoverageRecord[], sort: CoverageSort) {
  return [...records].sort((a, b) => {
    if (sort === "alphabetical") {
      return presentationRegions[a.countryCode].countryName.localeCompare(
        presentationRegions[b.countryCode].countryName,
      );
    }
    const aGdp = coverageGdpSnapshot.rows[a.countryCode];
    const bGdp = coverageGdpSnapshot.rows[b.countryCode];
    if (aGdp === null && bGdp === null) return a.countryCode.localeCompare(b.countryCode);
    if (aGdp === null) return 1;
    if (bGdp === null) return -1;
    return bGdp - aGdp || a.countryCode.localeCompare(b.countryCode);
  });
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function coverageCsv(records: readonly CoverageRecord[] = coverageRegistry) {
  const header = ["country_code", "country", "currency", "candidate_asset", "candidate_issuer", "issuer_route_status", "issuer_rail", "issuer_evidence_checked_at", "issuer_evidence_url", "home_route_status", "home_provider_id", "home_asset_id", "home_payment_method_ids", "home_live_checked_at", "gdp_current_usd", "gdp_year"];
  const rows = sortCoverage(records, "alphabetical").map((record) => {
    const region = presentationRegions[record.countryCode];
    return [record.countryCode, region.countryName, record.currencyCode, region.candidateAsset?.symbol ?? "", region.candidateAsset?.issuer ?? "", record.issuerRoute.status, record.issuerRoute.rail, record.issuerRoute.evidence?.checkedAt ?? "", record.issuerRoute.evidence?.url ?? "", record.homeRoute.status, record.homeRoute.providerId ?? "", record.homeRoute.assetId ?? "", record.homeRoute.paymentMethodIds.join("|"), record.homeRoute.evidence?.checkedAt ?? "", coverageGdpSnapshot.rows[record.countryCode], coverageGdpSnapshot.year].map(csvCell).join(",");
  });
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

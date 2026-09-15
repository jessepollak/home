import type { Metadata } from "next";
import { CoverageFilters } from "@/client/coverage/coverage-filters";
import { SupportedGlobeDynamic } from "@/client/landing/supported-globe-dynamic";
import { countryFlag, locateCountries, type GlobeCountry, type GlobeMarkerTone } from "@/client/landing/globe-geometry";
import {
  COVERAGE_REGISTRY_CHECKED_AT,
  coverageHomeStatuses,
  coverageIssuerStatuses,
  coverageRegistry,
  sortCoverage,
  type CoverageHomeStatus,
  type CoverageIssuerStatus,
  type CoverageSort,
} from "@/config/coverage";
import { presentationRegions, type CountryCode } from "@/config/regions";
import { HomeMark } from "@/components/home-mark";
import { publicHeaderFrameClassName } from "@/components/shell-layout";
import { CoverageTable, type CoverageTableRow } from "@/components/ui/coverage-table";

export const metadata: Metadata = {
  title: "Local money coverage | Home",
  description: "Documented local-money routes and their separate Home implementation status.",
};

const issuerLabels: Record<CoverageIssuerStatus, string> = {
  documented: "Documented",
  conditional: "Conditional",
  "not-found": "Not found",
  "not-researched": "Not researched",
};
const homeLabels: Record<CoverageHomeStatus, string> = {
  none: "No Home route",
  planned: "Planned",
  "in-build": "In build",
  sandbox: "Sandbox",
  live: "Live",
};
const issuerTones: Record<CoverageIssuerStatus, GlobeMarkerTone> = {
  documented: "positive",
  conditional: "caution",
  "not-found": "negative",
  "not-researched": "neutral",
};

const coverageGlobeCountries: readonly GlobeCountry[] = coverageRegistry.map((record) => ({
  countryCode: record.countryCode,
  countryName: record.countryName,
  currency: {
    code: record.currencyCodes.join(", ") || null,
    name: record.currencyCodes.join(", ") || "No current tender currency",
  },
  markerTone: issuerTones[record.issuerRoute.status],
  detail: `${issuerLabels[record.issuerRoute.status]} issuer route; ${homeLabels[record.homeRoute.status]}`,
}));
const coverageGlobePointCount = locateCountries(coverageGlobeCountries).length;

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function isIssuerStatus(value: string): value is CoverageIssuerStatus {
  return coverageIssuerStatuses.includes(value as CoverageIssuerStatus);
}
function isHomeStatus(value: string): value is CoverageHomeStatus {
  return coverageHomeStatuses.includes(value as CoverageHomeStatus);
}

export default async function CoveragePage({ searchParams }: PageProps<"/coverage">) {
  const query = await searchParams;
  const search = queryValue(query.q).trim().toLocaleLowerCase();
  const issuerValue = queryValue(query.issuer);
  const homeValue = queryValue(query.home);
  const sort: CoverageSort = queryValue(query.sort) === "alphabetical" ? "alphabetical" : "gdp";
  const issuer = isIssuerStatus(issuerValue) ? issuerValue : null;
  const home = isHomeStatus(homeValue) ? homeValue : null;
  const records = sortCoverage(coverageRegistry.filter((record) => {
    const region = record.configuredInHome ? presentationRegions[record.countryCode as CountryCode] : null;
    const searchable = `${record.countryName} ${record.countryCode} ${record.currencyCodes.join(" ")} ${region?.currency.name ?? ""} ${region?.candidateAsset?.symbol ?? ""} ${region?.candidateAsset?.issuer ?? ""}`.toLocaleLowerCase();
    return (!search || searchable.includes(search)) && (!issuer || record.issuerRoute.status === issuer) && (!home || record.homeRoute.status === home);
  }), sort);
  const tableRows: CoverageTableRow[] = records.map((record) => {
    const region = record.configuredInHome ? presentationRegions[record.countryCode as CountryCode] : null;
    return {
      countryCode: record.countryCode,
      countryName: record.countryName,
      flag: countryFlag(record.countryCode),
      currencies: record.currencyCodes.join(", ") || "No current tender currency",
      asset: region?.candidateAsset?.symbol ?? (record.configuredInHome ? "No candidate" : "Not configured"),
      issuerName: region?.candidateAsset?.issuer ?? (record.configuredInHome ? "No candidate" : "Not configured"),
      issuer: {
        status: record.issuerRoute.status,
        rail: record.issuerRoute.rail,
        audience: record.issuerRoute.audience,
        evidence: record.issuerRoute.evidence ? {
          url: record.issuerRoute.evidence.url,
          checkedAt: record.issuerRoute.evidence.checkedAt,
        } : null,
      },
      home: {
        status: record.homeRoute.status,
        provider: record.homeRoute.providerId,
        asset: record.homeRoute.assetId,
        paymentMethods: record.homeRoute.paymentMethodIds,
        evidence: record.homeRoute.evidence,
      },
      quote: record.quoteObservation,
      registryCheckedAt: COVERAGE_REGISTRY_CHECKED_AT,
    };
  });

  return (
    <>
      <header className="w-full bg-background">
        <nav
          aria-label="Coverage navigation"
          className={`${publicHeaderFrameClassName} flex min-h-14 items-center justify-between gap-4 border-b py-2`}
          data-public-header-frame=""
        >
          <HomeMark href="/" />
          <a href="/coverage.csv" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Download CSV</a>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="w-full max-w-xl">
          <SupportedGlobeDynamic
            countries={coverageGlobeCountries}
            showRoutes={false}
            ariaLabel="Interactive globe of local-money coverage research"
            description={`${coverageGlobePointCount} sourced inventory points. Marker tones describe issuer-route research, not eligibility.`}
            interactiveMarkerTones={["positive", "caution", "negative"]}
          />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Local money coverage</h1>
      </header>

      <section aria-label="Countries and territories" className="mx-auto w-full max-w-5xl space-y-4">
        <CoverageFilters
          values={{ q: queryValue(query.q), issuer: issuer ?? "", home: home ?? "", sort }}
          issuerOptions={coverageIssuerStatuses.map((status) => ({ value: status, label: issuerLabels[status] }))}
          homeOptions={coverageHomeStatuses.map((status) => ({ value: status, label: homeLabels[status] }))}
        />
        <p aria-live="polite" className="text-sm text-muted-foreground">Showing {records.length} of {coverageRegistry.length} countries and territories.</p>
        <div id="coverage-table" className="rounded-lg border">
          <CoverageTable rows={tableRows} />
        </div>
      </section>
      </main>
    </>
  );
}

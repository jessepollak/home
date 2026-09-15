import type { Metadata } from "next";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
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
    const searchable = `${record.countryName} ${record.countryCode} ${record.currencyCodes.join(" ")} ${region?.currency.name ?? ""} ${region?.candidateAsset?.symbol ?? ""}`.toLocaleLowerCase();
    return (!search || searchable.includes(search)) && (!issuer || record.issuerRoute.status === issuer) && (!home || record.homeRoute.status === home);
  }), sort);
  const tableRows: CoverageTableRow[] = records.map((record) => {
    const region = record.configuredInHome ? presentationRegions[record.countryCode as CountryCode] : null;
    return {
      countryCode: record.countryCode,
      countryName: record.countryName,
      flag: countryFlag(record.countryCode),
      currencies: record.currencyCodes.join(", ") || "No current tender currency",
      candidateAsset: region?.candidateAsset ? { symbol: region.candidateAsset.symbol, issuer: region.candidateAsset.issuer } : null,
      candidateFallback: record.configuredInHome ? "No candidate asset" : "Not configured in Home",
      issuer: record.issuerRoute,
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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <nav aria-label="Coverage navigation" className="flex items-center justify-between gap-4">
        <Link href="/" className="font-semibold">Home</Link>
        <a href="/coverage.csv" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Download CSV</a>
      </nav>

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

      <section aria-labelledby="countries-heading" className="space-y-4">
        <h2 id="countries-heading" className="text-2xl font-semibold">Countries and territories</h2>
        <form method="get" action="/coverage" className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium">Search<input name="q" defaultValue={queryValue(query.q)} placeholder="Country, code, currency, or asset" className="h-8 rounded-md border bg-background px-2 text-sm font-normal" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">Issuer route<select name="issuer" defaultValue={issuerValue} className="h-8 rounded-md border bg-background px-2 text-sm font-normal"><option value="">All</option>{coverageIssuerStatuses.map((status) => <option key={status} value={status}>{issuerLabels[status]}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-xs font-medium">Home route<select name="home" defaultValue={homeValue} className="h-8 rounded-md border bg-background px-2 text-sm font-normal"><option value="">All</option>{coverageHomeStatuses.map((status) => <option key={status} value={status}>{homeLabels[status]}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-xs font-medium">Sort<select name="sort" defaultValue={sort} className="h-8 rounded-md border bg-background px-2 text-sm font-normal"><option value="gdp">GDP, highest first</option><option value="alphabetical">Alphabetical</option></select></label>
          <Button type="submit">Apply</Button>
          <Button variant="outline" render={<Link href="/coverage" />}>Reset</Button>
        </form>
        <p aria-live="polite" className="text-sm text-muted-foreground">Showing {records.length} of {coverageRegistry.length} countries and territories.</p>
        <div id="coverage-table" className="rounded-lg border">
          <CoverageTable rows={tableRows} />
        </div>
      </section>
    </main>
  );
}

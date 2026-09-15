import type { Metadata } from "next";
import Link from "next/link";
import { SupportedGlobeDynamic } from "@/client/landing/supported-globe-dynamic";
import { countryFlag, type GlobeCountry, type GlobeMarkerTone } from "@/client/landing/globe-geometry";
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
import styles from "./page.module.css";

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
const homeTones: Record<CoverageHomeStatus, GlobeMarkerTone> = {
  live: "positive",
  planned: "caution",
  "in-build": "caution",
  sandbox: "caution",
  none: "negative",
};

const coverageGlobeCountries: readonly GlobeCountry[] = coverageRegistry.map((record) => ({
  countryCode: record.countryCode,
  countryName: record.countryName,
  currency: {
    code: record.currencyCodes.join(", ") || null,
    name: record.currencyCodes.length ? "Tender currency" : "No current tender currency",
  },
  markerTone: issuerTones[record.issuerRoute.status],
  detail: `${issuerLabels[record.issuerRoute.status]} issuer route; ${homeLabels[record.homeRoute.status]}`,
}));

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function isIssuerStatus(value: string): value is CoverageIssuerStatus {
  return coverageIssuerStatuses.includes(value as CoverageIssuerStatus);
}
function isHomeStatus(value: string): value is CoverageHomeStatus {
  return coverageHomeStatuses.includes(value as CoverageHomeStatus);
}

function StatusSignal({ label, tone }: { label: string; tone: GlobeMarkerTone }) {
  return <span className={styles.status} data-tone={tone}>{label}</span>;
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
            description="239 sourced inventory points. Marker tones describe issuer-route research, not eligibility."
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
        <div id="coverage-table" className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-4xl border-collapse text-left text-sm">
            <caption className="sr-only">Country local-money issuer routes and separate Home routes</caption>
            <thead className="bg-muted/50"><tr><th scope="col" className="p-3">Country</th><th scope="col" className="p-3">Currency</th><th scope="col" className="p-3">Candidate asset</th><th scope="col" className="p-3">Issuer route</th><th scope="col" className="p-3">Home route</th></tr></thead>
            <tbody>{records.map((record) => {
              const region = record.configuredInHome ? presentationRegions[record.countryCode as CountryCode] : null;
              const evidence = record.issuerRoute.evidence;
              return <tr key={record.countryCode} id={`country-${record.countryCode}`} className="border-t align-top">
                <th scope="row" className="p-3"><details><summary className="font-semibold"><span className={styles.flag} aria-hidden="true">{countryFlag(record.countryCode)}</span>{record.countryName} <span className="font-normal text-muted-foreground">{record.countryCode}</span></summary><dl className="mt-3 space-y-1 font-normal"><div><dt className="inline font-medium">Local rail: </dt><dd className="inline">{record.issuerRoute.rail}</dd></div><div><dt className="inline font-medium">Audience: </dt><dd className="inline">{record.issuerRoute.audience}</dd></div><div><dt className="inline font-medium">Provider identity: </dt><dd className="inline">{record.homeRoute.providerId ?? "None"}</dd></div><div><dt className="inline font-medium">Payment method identities: </dt><dd className="inline">{record.homeRoute.paymentMethodIds.join(", ") || "None"}</dd></div><div><dt className="inline font-medium">Quote observation: </dt><dd className="inline">{record.quoteObservation ? <><a href={record.quoteObservation.sourceUrl} className="underline">Observed {record.quoteObservation.quotedAt}</a>; spread {record.quoteObservation.spreadBps === null ? "not recorded" : `${record.quoteObservation.spreadBps} bps`}; fees: {record.quoteObservation.feeSummary}</> : "None recorded"}</dd></div></dl></details></th>
                <td className="p-3">{record.currencyCodes.join(", ") || "No current tender currency"}</td>
                <td className="p-3">{region?.candidateAsset ? <>{region.candidateAsset.symbol}<br /><span className="text-muted-foreground">{region.candidateAsset.issuer}</span></> : record.configuredInHome ? "No candidate asset" : "Not configured in Home"}</td>
                <td className="p-3"><StatusSignal label={issuerLabels[record.issuerRoute.status]} tone={issuerTones[record.issuerRoute.status]} /><br />{evidence ? <a href={evidence.url} className="text-muted-foreground underline">Evidence checked {evidence.checkedAt}</a> : <span className="text-muted-foreground">No evidence recorded</span>}</td>
                <td className="p-3"><StatusSignal label={homeLabels[record.homeRoute.status]} tone={homeTones[record.homeRoute.status]} />{record.homeRoute.assetId ? <><br /><span className="text-muted-foreground">{record.homeRoute.assetId}</span></> : null}<br /><span className="text-muted-foreground">Registry checked {record.homeRoute.evidence?.checkedAt ?? COVERAGE_REGISTRY_CHECKED_AT}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

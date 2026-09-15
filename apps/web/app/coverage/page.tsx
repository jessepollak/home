import type { Metadata } from "next";
import Link from "next/link";
import {
  COVERAGE_REGISTRY_CHECKED_AT,
  COVERAGE_RESEARCH_SOURCE,
  coverageGdpSnapshot,
  coverageHomeStatuses,
  coverageIssuerStatuses,
  coverageRegistry,
  sortCoverage,
  type CoverageHomeStatus,
  type CoverageIssuerStatus,
  type CoverageSort,
} from "@/config/coverage";
import { presentationRegions, type CountryCode } from "@/config/regions";
import coordinatesJson from "@/client/landing/globe-country-coordinates.json";
import { Button } from "@/components/ui/button";
import { formatUsdPrice } from "@/shared/formatting";

export const metadata: Metadata = {
  title: "Local money coverage | Home",
  description: "Documented local-money routes and their separate Home implementation status.",
};

const issuerLabels: Record<CoverageIssuerStatus, string> = {
  documented: "Documented route",
  conditional: "Conditional route",
  "not-found": "No route found",
  "not-researched": "Not researched",
};
const homeLabels: Record<CoverageHomeStatus, string> = {
  none: "Not planned",
  planned: "Planned",
  "in-build": "In build",
  sandbox: "Sandbox",
  live: "Production-proven live",
};
const issuerColors: Record<CoverageIssuerStatus, string> = {
  documented: "#137333",
  conditional: "#9a6700",
  "not-found": "#b42318",
  "not-researched": "#737373",
};

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function isIssuerStatus(value: string): value is CoverageIssuerStatus {
  return coverageIssuerStatuses.includes(value as CoverageIssuerStatus);
}
function isHomeStatus(value: string): value is CoverageHomeStatus {
  return coverageHomeStatuses.includes(value as CoverageHomeStatus);
}
function formatGdp(value: number | null) {
  if (value === null) return "No World Bank figure";
  return formatUsdPrice(value) ?? "No World Bank figure";
}

function CoverageMap() {
  const coordinates = coordinatesJson as unknown as Record<string, readonly [number, number]>;
  const inventory = new Map(coverageRegistry.map((record) => [record.countryCode, record]));
  return (
    <figure className="overflow-hidden rounded-lg border bg-muted/30 p-3">
      <svg viewBox="0 0 720 360" role="img" aria-labelledby="coverage-map-title coverage-map-description" className="h-auto w-full">
        <title id="coverage-map-title">Local-money route research by country</title>
        <desc id="coverage-map-description">Dots link to country details. Grey dots are not researched; green and amber dots show documented and conditional issuer-route research. Map position is not eligibility.</desc>
        <rect width="720" height="360" rx="8" fill="currentColor" opacity="0.04" />
        {Object.entries(coordinates).map(([code, [longitude, latitude]]) => {
          const record = inventory.get(code);
          const x = ((longitude + 180) / 360) * 720;
          const y = ((90 - latitude) / 180) * 360;
          const researched = record && record.issuerRoute.status !== "not-researched";
          const dot = <circle cx={x} cy={y} r={researched ? 4.5 : 2} fill={record ? issuerColors[record.issuerRoute.status] : "#a3a3a3"} opacity={researched ? 1 : 0.55} />;
          return record ? <a key={code} href={`#country-${code}`} aria-label={`${record.countryName}: ${issuerLabels[record.issuerRoute.status]}`}>{dot}</a> : <g key={code} aria-hidden="true">{dot}</g>;
        })}
      </svg>
      <figcaption className="mt-2 text-sm text-muted-foreground">Natural Earth v5.1.2 provides 239 linked label points. Eleven small territories in the inventory have no source point. Neutral dots are not researched and do not inherit status from a shared currency.</figcaption>
    </figure>
  );
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
  const documentedCount = coverageRegistry.filter((record) => record.issuerRoute.status === "documented").length;
  const liveCount = coverageRegistry.filter((record) => record.homeRoute.status === "live").length;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4">
        <nav aria-label="Coverage navigation" className="flex items-center justify-between gap-4"><Link href="/" className="font-semibold">Home</Link><a href="/coverage.csv" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Download CSV</a></nav>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Local money coverage</h1>
          <p className="text-lg text-muted-foreground">Issuer-route research and Home route status are tracked separately. Documentation does not establish eligibility, a current quote, or production availability.</p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-4"><dt className="text-sm text-muted-foreground">Documented issuer routes</dt><dd className="text-3xl font-semibold">{documentedCount}</dd><p className="text-xs text-muted-foreground">Issue #15 research · checked {COVERAGE_RESEARCH_SOURCE.checkedAt}</p></div>
          <div className="rounded-lg border p-4"><dt className="text-sm text-muted-foreground">Home routes live</dt><dd className="text-3xl font-semibold">{liveCount}</dd><p className="text-xs text-muted-foreground">Coverage registry · checked {COVERAGE_REGISTRY_CHECKED_AT}</p></div>
          <div className="rounded-lg border p-4"><dt className="text-sm text-muted-foreground">Country / territory inventory</dt><dd className="text-3xl font-semibold">{coverageRegistry.length}</dd><p className="text-xs text-muted-foreground">ISO 3166-1 + XK; 39 configured in Home</p></div>
        </dl>
      </header>

      <section aria-labelledby="map-heading" className="space-y-3"><h2 id="map-heading" className="text-2xl font-semibold">Map</h2><CoverageMap /></section>

      <section aria-labelledby="legend-heading" className="space-y-3">
        <h2 id="legend-heading" className="text-2xl font-semibold">How to read status</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4"><h3 className="font-semibold">Issuer / local rail evidence</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{coverageIssuerStatuses.map((status) => <li key={status}><strong className="text-foreground">{issuerLabels[status]}:</strong> {status === "documented" ? "issuer or partner materials describe the selected token, Base, and a local rail" : status === "conditional" ? "a route exists but has an audience, chain, token, or verification limitation" : status === "not-found" ? "research found no documented route" : "no completed research"}</li>)}</ul></div>
          <div className="rounded-lg border p-4"><h3 className="font-semibold">Home implementation</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{coverageHomeStatuses.map((status) => <li key={status}><strong className="text-foreground">{homeLabels[status]}:</strong> {status === "live" ? "requires dated hosted-production evidence" : status === "sandbox" ? "tested or configured only outside production" : status === "in-build" ? "a provider binding exists without production proof" : status === "planned" ? "planned without a provider binding" : "no Home route"}</li>)}</ul></div>
        </div>
      </section>

      <section aria-labelledby="countries-heading" className="space-y-4">
        <div><h2 id="countries-heading" className="text-2xl font-semibold">Countries and territories</h2><p className="text-sm text-muted-foreground">The 250-entry universe is all 249 ISO 3166-1 assignments plus CLDR XK (Kosovo). Exceptional reservations, user-assigned, deprecated, and macroregion codes are excluded. GDP is {coverageGdpSnapshot.indicatorName}, indicator {coverageGdpSnapshot.indicator}, reference year {coverageGdpSnapshot.year}. Missing figures remain listed and sort last.</p></div>
        <form method="get" action="/coverage" className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-sm font-medium lg:col-span-2">Search<input name="q" defaultValue={queryValue(query.q)} placeholder="Country, code, currency, or asset" className="h-10 rounded-md border bg-background px-3 font-normal" /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Issuer evidence<select name="issuer" defaultValue={issuerValue} className="h-10 rounded-md border bg-background px-2 font-normal"><option value="">All</option>{coverageIssuerStatuses.map((status) => <option key={status} value={status}>{issuerLabels[status]}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Home status<select name="home" defaultValue={homeValue} className="h-10 rounded-md border bg-background px-2 font-normal"><option value="">All</option>{coverageHomeStatuses.map((status) => <option key={status} value={status}>{homeLabels[status]}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Sort<select name="sort" defaultValue={sort} className="h-10 rounded-md border bg-background px-2 font-normal"><option value="gdp">GDP, highest first</option><option value="alphabetical">Alphabetical</option></select></label>
          <div className="flex gap-3 sm:col-span-2 lg:col-span-5"><Button type="submit">Apply</Button><Link href="/coverage" className="flex h-10 items-center rounded-md border px-4 text-sm font-medium">Reset</Link></div>
        </form>
        <p aria-live="polite" className="text-sm text-muted-foreground">Showing {records.length} of {coverageRegistry.length} countries and territories.</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-3xl border-collapse text-left text-sm">
            <caption className="sr-only">Country local-money issuer evidence and separate Home implementation status</caption>
            <thead className="bg-muted/50"><tr><th scope="col" className="p-3">Country</th><th scope="col" className="p-3">Currency / candidate</th><th scope="col" className="p-3">Issuer evidence</th><th scope="col" className="p-3">Home status</th><th scope="col" className="p-3">GDP ({coverageGdpSnapshot.year})</th></tr></thead>
            <tbody>{records.map((record) => {
              const region = record.configuredInHome ? presentationRegions[record.countryCode as CountryCode] : null;
              const evidence = record.issuerRoute.evidence;
              return <tr key={record.countryCode} id={`country-${record.countryCode}`} className="border-t align-top">
                <th scope="row" className="p-3"><details><summary className="font-semibold">{record.countryName} <span className="font-normal text-muted-foreground">{record.countryCode}</span></summary><dl className="mt-3 space-y-1 font-normal"><div><dt className="inline font-medium">Local rail: </dt><dd className="inline">{record.issuerRoute.rail}</dd></div><div><dt className="inline font-medium">Audience: </dt><dd className="inline">{record.issuerRoute.audience}</dd></div><div><dt className="inline font-medium">Provider identity: </dt><dd className="inline">{record.homeRoute.providerId ?? "None"}</dd></div><div><dt className="inline font-medium">Payment method identities: </dt><dd className="inline">{record.homeRoute.paymentMethodIds.join(", ") || "None"}</dd></div><div><dt className="inline font-medium">Quote observation: </dt><dd className="inline">None recorded</dd></div></dl></details></th>
                <td className="p-3">{record.currencyCodes.join(", ") || "No current tender currency"}<br /><span className="text-muted-foreground">{region?.candidateAsset ? `${region.candidateAsset.symbol} · ${region.candidateAsset.issuer}` : record.configuredInHome ? "No candidate asset" : "Not configured in Home"}</span></td>
                <td className="p-3"><span className="font-medium">{issuerLabels[record.issuerRoute.status]}</span><br />{evidence ? <a href={evidence.url} className="text-muted-foreground underline">Evidence checked {evidence.checkedAt}</a> : <span className="text-muted-foreground">No evidence recorded</span>}</td>
                <td className="p-3"><span className="font-medium">{homeLabels[record.homeRoute.status]}</span>{record.homeRoute.assetId ? <><br /><span className="text-muted-foreground">{record.homeRoute.assetId}</span></> : null}<br /><span className="text-muted-foreground">Registry checked {record.homeRoute.evidence?.checkedAt ?? COVERAGE_REGISTRY_CHECKED_AT}</span></td>
                <td className="p-3 tabular-nums">{formatGdp(coverageGdpSnapshot.rows[record.countryCode])}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <footer className="border-t pt-6 text-sm text-muted-foreground"><p>Countries, names, and tender currencies: Unicode CLDR 48, currencies validated against SIX ISO 4217 List One published 2026-01-01. Issuer evidence: <a className="underline" href={COVERAGE_RESEARCH_SOURCE.url}>{COVERAGE_RESEARCH_SOURCE.name}</a>, checked {COVERAGE_RESEARCH_SOURCE.checkedAt}. GDP: <a className="underline" href={coverageGdpSnapshot.sourceUrl}>World Bank</a>, {coverageGdpSnapshot.year}, snapshot downloaded {coverageGdpSnapshot.downloadedAt}; {coverageGdpSnapshot.completeness.valueCount} of {coverageGdpSnapshot.completeness.universeCount} entries have a figure. Map: Natural Earth v5.1.2 public-domain label points.</p></footer>
    </main>
  );
}

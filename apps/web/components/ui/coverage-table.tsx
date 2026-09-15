"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CoverageStatusPreview } from "@/components/ui/coverage-status-preview";
import { DataTable } from "@/components/ui/data-table";
import styles from "./coverage-table.module.css";

export type CoverageTableRow = {
  countryCode: string;
  countryName: string;
  flag: string;
  currencies: string;
  asset: string;
  issuerName: string;
  stablecoin: { candidate: { symbol: string; issuer: string; verification: string } | null };
  issuer: { status: "documented" | "conditional" | "not-found" | "not-researched"; rail: string; audience: string; evidence: { url: string; checkedAt: string } | null };
  home: { status: "none" | "planned" | "in-build" | "sandbox" | "live"; provider: string | null; asset: string | null; paymentMethods: readonly string[]; evidence: { proofRef: string; checkedAt: string } | null };
  quote: { quotedAt: string; spreadBps: number | null; feeSummary: string; sourceUrl: string } | null;
  registryCheckedAt: string;
};

const stablecoinTraffic = { identified: "Yellow", "not-identified": "Red" } as const;
const stablecoinLabels = { identified: "Identified", "not-identified": "Not identified" } as const;
const issuerLabels = { documented: "Documented", conditional: "Conditional", "not-found": "Not found", "not-researched": "Not researched" } as const;
const issuerTraffic = { documented: "Green", conditional: "Yellow", "not-found": "Red", "not-researched": "Yellow" } as const;
const integratedLabels = { none: "Not integrated", planned: "Planned", "in-build": "In build", sandbox: "Sandbox", live: "Live" } as const;
const integratedTraffic = { live: "Green", planned: "Yellow", "in-build": "Yellow", sandbox: "Yellow", none: "Red" } as const;

const columns: ColumnDef<CoverageTableRow>[] = [
  { accessorKey: "countryName", header: "Country", cell: ({ row }) => <><span aria-hidden="true" className={styles.flag}>{row.original.flag}</span>{row.original.countryName} <span className={styles.secondary}>{row.original.countryCode}</span></> },
  { accessorKey: "currencies", header: "Currency" },
  { accessorKey: "asset", header: "Asset" },
  { accessorKey: "issuerName", header: "Issuer" },
  { id: "stablecoin", header: () => <span className={styles.statusColumn}>Stablecoin</span>, cell: ({ row }) => {
    const value = row.original;
    const candidate = value.stablecoin.candidate;
    const status = candidate ? "identified" as const : "not-identified" as const;
    return <div className={styles.statusColumn}><CoverageStatusPreview status={stablecoinTraffic[status]} accessibleName={`${stablecoinTraffic[status]} — ${candidate ? "Stablecoin candidate identified" : "No stablecoin candidate identified"}`} heading={`${value.countryName} stablecoin candidate`} details={[
      { label: "Status", value: stablecoinLabels[status] },
      { label: "Candidate asset", value: candidate?.symbol ?? "Not identified" },
      ...(candidate ? [
        { label: "Issuer", value: candidate.issuer },
        { label: "Verification", value: candidate.verification },
        { label: "Funding", value: "Disabled" },
      ] : []),
    ]} /></div>;
  } },
  { id: "issuer", header: () => <span className={styles.statusColumn}>1:1 onramp</span>, cell: ({ row }) => {
    const value = row.original;
    const status = value.issuer.status;
    return <div className={styles.statusColumn}><CoverageStatusPreview status={issuerTraffic[status]} indicatorVariant={status === "not-researched" ? "hollow" : "solid"} accessibleName={`${issuerTraffic[status]} — ${issuerLabels[status]} 1:1 onramp`} heading={`${value.countryName} 1:1 onramp`} details={[
      { label: "Status", value: issuerLabels[status] },
      { label: "Rail", value: value.issuer.rail },
      { label: "Audience", value: value.issuer.audience },
      value.issuer.evidence ? { label: "Evidence", value: `Checked ${value.issuer.evidence.checkedAt}`, href: value.issuer.evidence.url } : { label: "Evidence", value: "No evidence recorded" },
      value.quote ? { label: "Quote observation", value: `Observed ${value.quote.quotedAt}; spread ${value.quote.spreadBps === null ? "not recorded" : `${value.quote.spreadBps} bps`}; fees: ${value.quote.feeSummary}`, href: value.quote.sourceUrl } : { label: "Quote observation", value: "None recorded" },
    ]} /></div>;
  } },
  { id: "home", header: () => <span className={styles.statusColumn}>Integrated</span>, cell: ({ row }) => {
    const value = row.original;
    const status = value.home.status;
    return <div className={styles.statusColumn}><CoverageStatusPreview status={integratedTraffic[status]} accessibleName={`${integratedTraffic[status]} — ${status === "none" ? "Not integrated" : `${integratedLabels[status]} integration`}`} heading={`${value.countryName} integration status`} details={[
      { label: "Status", value: integratedLabels[status] },
      { label: "Provider", value: value.home.provider ?? "None" },
      { label: "Asset", value: value.home.asset ?? "None" },
      { label: "Payment methods", value: value.home.paymentMethods.join(", ") || "None" },
      value.home.evidence ? { label: "Hosted production", value: `${value.home.evidence.proofRef}; checked ${value.home.evidence.checkedAt}` } : { label: "Hosted production", value: `No evidence recorded; registry checked ${value.registryCheckedAt}` },
    ]} /></div>;
  } },
];

export function CoverageTable({ rows }: { rows: CoverageTableRow[] }) {
  return <DataTable columns={columns} data={rows} caption="Country stablecoin candidates, 1:1 onramp research, and integration status" density="compact" />;
}

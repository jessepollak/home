import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleAlertIcon, SearchX } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CoverageStatusPreview } from "@/components/ui/coverage-status-preview";
import { CoverageTable, type CoverageTableRow } from "@/components/ui/coverage-table";
import { DataTable } from "@/components/ui/data-table";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const CHECKED = "2026-09-10";

type Seed = {
  code: string;
  name: string;
  flag: string;
  currency: string;
  candidate: { symbol: string; issuer: string } | null;
  issuer: CoverageTableRow["issuer"]["status"];
  portfolio: CoverageTableRow["portfolio"]["status"];
  home: CoverageTableRow["home"]["status"];
  route?: { provider: string; issue: number; stage: "planned" | "in-build" | "blocked" };
};

const SEEDS: readonly Seed[] = [
  { code: "US", name: "United States", flag: "🇺🇸", currency: "USD", candidate: { symbol: "USDC", issuer: "Circle" }, issuer: "documented", portfolio: "priority", home: "live", route: { provider: "Coinbase", issue: 42, stage: "in-build" } },
  { code: "BR", name: "Brazil", flag: "🇧🇷", currency: "BRL", candidate: { symbol: "BRZ", issuer: "Transfero" }, issuer: "documented", portfolio: "priority", home: "in-build", route: { provider: "Ripio", issue: 311, stage: "in-build" } },
  { code: "MX", name: "Mexico", flag: "🇲🇽", currency: "MXN", candidate: { symbol: "MXNB", issuer: "Juno" }, issuer: "conditional", portfolio: "priority", home: "planned", route: { provider: "Bitso", issue: 318, stage: "planned" } },
  { code: "AR", name: "Argentina", flag: "🇦🇷", currency: "ARS", candidate: { symbol: "wARS", issuer: "Ripio" }, issuer: "documented", portfolio: "priority", home: "sandbox", route: { provider: "Ripio", issue: 296, stage: "blocked" } },
  { code: "DE", name: "Germany", flag: "🇩🇪", currency: "EUR", candidate: { symbol: "EURC", issuer: "Circle" }, issuer: "conditional", portfolio: "deferred", home: "none" },
  { code: "JP", name: "Japan", flag: "🇯🇵", currency: "JPY", candidate: { symbol: "JPYC", issuer: "JPYC Inc." }, issuer: "not-found", portfolio: "deferred", home: "none" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬", currency: "NGN", candidate: { symbol: "cNGN", issuer: "Convexity" }, issuer: "not-researched", portfolio: "not-scoped", home: "none" },
  { code: "VU", name: "Vanuatu", flag: "🇻🇺", currency: "VUV", candidate: null, issuer: "not-researched", portfolio: "not-scoped", home: "none" },
];

const STAGES = { planned: "Planned", "in-build": "In build", blocked: "Blocked" } as const;
const ISSUER_OPTIONS = [["documented", "Documented"], ["conditional", "Conditional"], ["not-found", "Not found"], ["not-researched", "Not researched"]] as const;
const PRIORITY_OPTIONS = [["priority", "Priority"], ["deferred", "Deferred"], ["not-scoped", "Not scoped"]] as const;
const HOME_OPTIONS = [["live", "Live"], ["sandbox", "Sandbox"], ["in-build", "In build"], ["planned", "Planned"], ["none", "Not integrated"]] as const;

function toRow(seed: Seed): CoverageTableRow {
  const configured = seed.candidate !== null;
  return {
    countryCode: seed.code,
    countryName: seed.name,
    flag: seed.flag,
    currencies: seed.currency,
    asset: seed.candidate?.symbol ?? "Not configured",
    issuerName: seed.candidate?.issuer ?? "Not configured",
    stablecoin: { candidate: seed.candidate ? { ...seed.candidate, verification: "Verified" } : null },
    portfolio: {
      status: seed.portfolio,
      workstreams: seed.route ? [{ currencyCode: seed.currency, assetSymbol: seed.candidate?.symbol ?? seed.currency, provider: seed.route.provider, issueNumber: seed.route.issue, issueUrl: `#issue-${seed.route.issue}`, stage: seed.route.stage, note: "Gate: funding route evidence" }] : [],
    },
    issuer: {
      status: seed.issuer,
      rail: seed.issuer === "not-researched" ? "Not recorded" : "Bank transfer",
      audience: seed.issuer === "not-researched" ? "Not researched" : "Residents",
      evidence: seed.issuer === "documented" || seed.issuer === "conditional" ? { url: `#evidence-${seed.code}`, checkedAt: CHECKED } : null,
    },
    home: {
      status: seed.home,
      provider: seed.home === "none" ? null : seed.route?.provider ?? null,
      asset: seed.home === "none" || !configured ? null : seed.candidate?.symbol ?? null,
      paymentMethods: seed.home === "live" ? ["ACH"] : [],
      evidence: seed.home === "live" ? { proofRef: `hosted-production-${CHECKED}`, checkedAt: CHECKED } : null,
    },
    quote: seed.issuer === "documented" ? { quotedAt: `${CHECKED}T12:00:00.000Z`, spreadBps: 10, feeSummary: "No Home fee recorded", sourceUrl: `#quote-${seed.code}` } : null,
    registryCheckedAt: CHECKED,
  };
}

const ROWS = SEEDS.map(toRow);

type QuoteState = "loaded" | "loading" | "error";
type RouteRow = { id: string; route: string; provider: string; stage: NonNullable<Seed["route"]>["stage"]; stageLabel: string; issue: number; quote: QuoteState; spread: string };

function routeRows(quotes: Record<string, QuoteState>): RouteRow[] {
  return SEEDS.flatMap((seed) => seed.route ? [{
    id: seed.code,
    route: `${seed.flag} ${seed.currency} → ${seed.candidate?.symbol ?? seed.currency}`,
    provider: seed.route.provider,
    stage: seed.route.stage,
    stageLabel: STAGES[seed.route.stage],
    issue: seed.route.issue,
    quote: quotes[seed.code] ?? "loaded",
    spread: seed.issuer === "documented" ? "10 bps" : "Not recorded",
  }] : []);
}

function routeColumns(retry: (id: string) => void): ColumnDef<RouteRow>[] {
  return [
    { accessorKey: "route", header: "Route" },
    { accessorKey: "provider", header: "Provider" },
    { id: "stage", header: "Stage", cell: ({ row }) => <span className="inline-flex items-center gap-2">
      <CoverageStatusPreview status={row.original.stage === "blocked" ? "Red" : "Yellow"} indicatorVariant={row.original.stage === "planned" ? "hollow" : "solid"}
        accessibleName={`${row.original.stageLabel} — ${row.original.route}`} heading={`${row.original.route} stage`}
        details={[{ label: "Stage", value: row.original.stageLabel }, { label: "Provider", value: row.original.provider }, { label: "Issue", value: `#${row.original.issue}`, href: `#issue-${row.original.issue}` }]} />
      {row.original.stageLabel}
    </span> },
    { id: "quote", header: "Quote observation", cell: ({ row }) => row.original.quote === "loading"
      ? <span aria-busy="true" className="inline-flex items-center"><Skeleton className="h-4 w-24" /><span className="sr-only">Loading quote for {row.original.route}</span></span>
      : row.original.quote === "error"
        ? <span className="inline-flex items-center gap-2 text-destructive">Couldn&apos;t load quote<Button variant="outline" size="sm" onClick={() => retry(row.original.id)} aria-label={`Retry quote for ${row.original.route}`}>Retry</Button></span>
        : <span className="tabular-nums">{row.original.spread}</span> },
    { id: "issue", header: "Issue", cell: ({ row }) => <a className="font-medium text-primary underline-offset-4 hover:underline" href={`#issue-${row.original.issue}`}>#{row.original.issue}</a> },
  ];
}

function Legend() {
  const entries = [["bg-status-positive", "Green", "Documented or live"], ["bg-status-caution", "Yellow", "Candidate, conditional or in progress"], ["bg-status-negative", "Red", "Not found or not integrated"]] as const;
  return <Popover>
    <PopoverTrigger render={<Button variant="ghost" size="sm" />}>Legend</PopoverTrigger>
    <PopoverContent aria-label="Status legend" align="end">
      <PopoverDescription>Hover or focus a dot for its evidence.</PopoverDescription>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {entries.map(([tone, label, meaning]) => <li key={label} className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-3 shrink-0 rounded-full ${tone}`} />
          <span><span className="font-medium">{label}</span> · {meaning}</span>
        </li>)}
      </ul>
    </PopoverContent>
  </Popover>;
}

function CoverageComposition() {
  const [query, setQuery] = useState("");
  const [issuer, setIssuer] = useState("");
  const [priority, setPriority] = useState("");
  const [home, setHome] = useState("");
  const [sort, setSort] = useState("gdp");
  const [quotes, setQuotes] = useState<Record<string, QuoteState>>({ MX: "loading", AR: "error" });
  const [retrying, setRetrying] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(true);
  useEffect(() => {
    if (!retrying) return;
    let live = true;
    void Promise.resolve().then(() => {
      if (!live) return;
      setQuotes((current) => ({ ...current, [retrying]: "loaded" }));
      setRetrying(null);
    });
    return () => { live = false; };
  }, [retrying]);
  const search = query.trim().toLocaleLowerCase();
  const filtered = ROWS.filter((row) => {
    const text = `${row.countryName} ${row.countryCode} ${row.currencies} ${row.asset} ${row.issuerName}`.toLocaleLowerCase();
    return (!search || text.includes(search)) && (!issuer || row.issuer.status === issuer) && (!priority || row.portfolio.status === priority) && (!home || row.home.status === home);
  });
  const rows = sort === "alphabetical" ? [...filtered].sort((a, b) => a.countryName.localeCompare(b.countryName)) : filtered;
  const clear = () => { setQuery(""); setIssuer(""); setPriority(""); setHome(""); };
  const retry = (id: string) => { setQuotes((current) => ({ ...current, [id]: "loading" })); setRetrying(id); };
  return <div className="flex min-h-svh flex-col bg-background">
    <header className="w-full bg-background">
      <nav aria-label="Coverage navigation" className="mx-auto flex min-h-14 w-full max-w-7xl items-center justify-between gap-4 border-b px-8 py-2">
        <a href="#home" className="text-base font-semibold">Home</a>
        <a href="#coverage-csv" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Download CSV</a>
      </nav>
    </header>
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-8 py-8">
      <h1 className="text-center text-5xl font-semibold tracking-tight">Local money coverage</h1>
      <section aria-label="Countries and territories" className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3" role="search" aria-label="Filter coverage">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium">
            Search
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Country, code, currency, asset, or issuer" />
          </label>
          {([["1:1 onramp", issuer, setIssuer, ISSUER_OPTIONS], ["Portfolio", priority, setPriority, PRIORITY_OPTIONS], ["Integrated", home, setHome, HOME_OPTIONS]] as const).map(([label, value, set, options]) =>
            <label key={label} className="flex w-44 flex-col gap-1 text-xs font-medium">
              {label}
              <NativeSelect value={value} onChange={(event) => set(event.target.value)}>
                <option value="">All</option>
                {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
              </NativeSelect>
            </label>)}
          <label className="flex w-44 flex-col gap-1 text-xs font-medium">
            Sort
            <NativeSelect value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="gdp">GDP, highest first</option>
              <option value="alphabetical">Alphabetical</option>
            </NativeSelect>
          </label>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p aria-live="polite" className="text-sm text-muted-foreground">Showing {rows.length} of {ROWS.length} countries and territories.</p>
          <Legend />
        </div>
        {rows.length > 0 ? <div className="rounded-lg border"><CoverageTable rows={rows} /></div> : <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>No countries match</EmptyTitle>
            <EmptyDescription>Try another search or clear the filters.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button variant="outline" onClick={clear}>Clear filters</Button></EmptyContent>
        </Empty>}
      </section>
      <section aria-labelledby="composition-coverage-routes" className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <h2 id="composition-coverage-routes" className="text-lg font-semibold">Priority routes</h2>
        {refreshFailed ? <Alert>
          <AlertIcon><CircleAlertIcon /></AlertIcon>
          <AlertTitle>Quote observations may be out of date</AlertTitle>
          <AlertDescription>Registry checked {CHECKED}.</AlertDescription>
          <AlertAction><Button variant="outline" onClick={() => setRefreshFailed(false)}>Dismiss</Button></AlertAction>
        </Alert> : null}
        <div className="rounded-lg border">
          <DataTable columns={routeColumns(retry)} data={routeRows(quotes)} caption="Priority local-money routes with provider, stage, and latest quote observation" getRowId={(row) => row.id} />
        </div>
      </section>
    </main>
  </div>;
}

const meta = {
  title: "Compositions/Coverage",
  component: CoverageComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 8 },
    viewport: { viewports: { desktop1280: { name: "1280 × 800", styles: { width: "1280px", height: "800px" } } }, defaultViewport: "desktop1280" },
    a11y: { test: "error", context: { include: ["body"], exclude: ["[data-base-ui-focus-guard]"] } },
  },
} satisfies Meta<typeof CoverageComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Coverage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.hover(canvas.getByRole("button", { name: "Red — No stablecoin candidate identified" }));
    await waitFor(() => expect(body.getByRole("heading", { name: "Vanuatu stablecoin candidate" })).toBeVisible());
    await userEvent.unhover(canvas.getByRole("button", { name: "Red — No stablecoin candidate identified" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Search" }), "atlantis");
    await expect(canvas.getByText("No countries match")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }));
    await expect(canvas.getByText("Showing 8 of 8 countries and territories.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Retry quote for 🇦🇷 ARS → wARS" })).toBeVisible();
    await expect(canvas.getByText("Loading quote for 🇲🇽 MXN → MXNB")).toBeInTheDocument();
  },
};

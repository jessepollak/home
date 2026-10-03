import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ChartNoAxesCombined, CircleAlertIcon, CreditCard, House, SearchX } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from "@/components/ui/popover";
import { RailNavItem } from "@/components/ui/rail-nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";

type Status = "action" | "pending" | "complete" | "failed";
type Direction = "in" | "out";
type Row = {
  id: string;
  title: string;
  date: string;
  status: Status;
  direction: Direction;
  amount: string;
  facts: readonly (readonly [string, string])[];
} | { id: "loading" };

const STATUS = {
  action: { label: "Action needed", variant: "warning" },
  pending: { label: "Pending", variant: "secondary" },
  complete: { label: "Completed", variant: "ghost" },
  failed: { label: "Didn't go through", variant: "outline" },
} as const;

const LEDGER: readonly Row[] = [
  { id: "funding", title: "Add money", date: "Today · 12:00 PM", status: "action", direction: "in", amount: "+$50.00",
    facts: [["Provider", "Coinbase"], ["Payment", "Bank transfer"], ["Next", "Pay $50.00 by 5:00 PM"]] },
  { id: "send-alex", title: "Sent to alex.base.eth", date: "Today · 11:50 AM", status: "pending", direction: "out", amount: "−$25.00",
    facts: [["To", "alex.base.eth"], ["Network", "Base"], ["Asset", "USDC"]] },
  { id: "received-1", title: "Received USDC", date: "Sep 24", status: "complete", direction: "in", amount: "+$100.00",
    facts: [["From", "0x2222…2222"], ["Network", "Base"], ["Asset", "USDC"]] },
  { id: "received-2", title: "Received USDC", date: "Sep 23", status: "complete", direction: "in", amount: "+$200.00",
    facts: [["From", "0x2222…2222"], ["Network", "Base"], ["Asset", "USDC"]] },
  { id: "btc", title: "Received cbBTC", date: "Sep 20", status: "complete", direction: "in", amount: "+0.002 cbBTC",
    facts: [["From", "0x2222…2222"], ["Network", "Base"], ["Value", "$120.00 at receipt"]] },
  { id: "send-sam", title: "Sent to sam.base.eth", date: "Sep 19", status: "failed", direction: "out", amount: "−$10.00",
    facts: [["To", "sam.base.eth"], ["Network", "Base"], ["Result", "Returned to your balance"]] },
  { id: "loading" },
];

const RUNS = [
  { id: "usdc-4", label: "Received USDC", count: 4, total: "+$1,000.00", dates: "Sep 21 – 24" },
  { id: "usdc-2", label: "Received USDC", count: 2, total: "+$50.00", dates: "Sep 18 – 19" },
  { id: "btc-3", label: "Received cbBTC", count: 3, total: "+0.006 cbBTC", dates: "Sep 14 – 16" },
] as const;

const KINDS = [
  { value: "all", label: "All activity" },
  { value: "in", label: "Money in" },
  { value: "out", label: "Money out" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

function isKind(value: unknown): value is Kind {
  return KINDS.some((kind) => kind.value === value);
}

function RowDetails({ row }: { row: Extract<Row, { title: string }> }) {
  return <Popover>
    <PopoverTrigger render={<Button variant="ghost" size="sm" aria-label={`Details for ${row.title}, ${row.date}`} />}>Details</PopoverTrigger>
    <PopoverContent align="end" aria-label={`${row.title} details`}>
      <p className="font-medium">{row.title}</p>
      <PopoverDescription>{row.date} · {STATUS[row.status].label}</PopoverDescription>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {row.facts.map(([term, value]) => <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="text-end">{value}</dd>
        </div>)}
      </dl>
    </PopoverContent>
  </Popover>;
}

const COLUMNS: ColumnDef<Row>[] = [
  { id: "activity", header: "Activity", cell: ({ row }) => "title" in row.original
    ? <span className="flex flex-col py-1.5"><span>{row.original.title}</span><span className="text-xs font-normal text-muted-foreground">{row.original.date}</span></span>
    : <span className="flex flex-col gap-1 py-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-16" /><span className="sr-only">Loading earlier activity</span></span> },
  { id: "status", header: "Status", cell: ({ row }) => "title" in row.original
    ? <Badge variant={STATUS[row.original.status].variant}>{STATUS[row.original.status].label}</Badge>
    : <Skeleton className="h-5 w-20" /> },
  { id: "amount", header: () => <span className="block text-end">Amount</span>, cell: ({ row }) => "title" in row.original
    ? <span className="block text-end font-medium tabular-nums">{row.original.amount}</span>
    : <Skeleton className="ms-auto h-4 w-16" /> },
  { id: "details", header: () => <span className="sr-only">Details</span>, cell: ({ row }) => "title" in row.original
    ? <span className="flex justify-end"><RowDetails row={row.original} /></span>
    : null },
];

function NoResults({ label, onClear }: { label: string; onClear?: () => void }) {
  return <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon" aria-hidden="true"><SearchX /></EmptyMedia>
      <EmptyTitle>No {label}</EmptyTitle>
      <EmptyDescription>Nothing matches these filters.</EmptyDescription>
    </EmptyHeader>
    {onClear ? <EmptyContent><Button variant="outline" onClick={onClear}>Clear filters</Button></EmptyContent> : null}
  </Empty>;
}

function Rail() {
  return <aside className="flex w-52 shrink-0 flex-col gap-4 border-e bg-background py-4">
    <p className="px-4 text-base font-semibold">Home</p>
    <nav aria-label="Main navigation" className="flex flex-col">
      <RailNavItem href="#home" label="Home" icon={House} current />
      <RailNavItem href="#card" label="Card" icon={CreditCard} />
      <RailNavItem href="#invest" label="Invest" icon={ChartNoAxesCombined} />
    </nav>
  </aside>;
}

function ActivityComposition() {
  const [kind, setKind] = useState<Kind>("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [latestFailed, setLatestFailed] = useState(true);
  const clear = () => { setKind("all"); setPendingOnly(false); };
  const rows = LEDGER.filter((row) => !("title" in row)
    ? kind === "all" && !pendingOnly
    : (kind === "all" || row.direction === kind) && (!pendingOnly || row.status === "pending"));
  const filterLabel = `${pendingOnly ? "pending " : ""}${kind === "in" ? "money in" : kind === "out" ? "money out" : "activity"}`;
  return <div className="flex h-svh bg-muted">
    <Rail />
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto" aria-labelledby="composition-activity-title">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
        <div className="flex items-center justify-between gap-4">
          <h1 id="composition-activity-title" className="text-xl font-semibold">Activity</h1>
          <div className="flex items-center gap-2" role="group" aria-label="Filter activity">
            <Toggle variant="outline" pressed={pendingOnly} onPressedChange={setPendingOnly}>Pending</Toggle>
            <Select items={KINDS} value={kind} onValueChange={(next) => { if (isKind(next)) setKind(next); }}>
              <SelectTrigger aria-label="Activity type" className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {latestFailed ? <Alert>
          <AlertIcon><CircleAlertIcon /></AlertIcon>
          <AlertTitle>Latest activity didn&apos;t load</AlertTitle>
          <AlertDescription>Earlier activity is still shown.</AlertDescription>
          <AlertAction><Button variant="outline" onClick={() => setLatestFailed(false)}>Retry latest activity</Button></AlertAction>
        </Alert> : null}
        <div className="grid grid-cols-[minmax(0,1fr)_18rem] items-start gap-4">
          <section aria-labelledby="composition-activity-ledger">
            <Card className="gap-2">
              <CardHeader><CardTitle><h2 id="composition-activity-ledger">Ledger</h2></CardTitle></CardHeader>
              <CardContent inset="list">
                {rows.length > 0
                  ? <DataTable columns={COLUMNS} data={rows} caption="Activity ledger" density="compact" getRowId={(row) => row.id} />
                  : <NoResults label={filterLabel} onClear={clear} />}
              </CardContent>
            </Card>
          </section>
          <div className="flex flex-col gap-4">
            <section aria-labelledby="composition-activity-runs">
              <Card className="gap-2">
                <CardHeader><CardTitle><h2 id="composition-activity-runs">Transfer runs</h2></CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <caption className="sr-only">Repeated transfers grouped into runs</caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Run</TableHead>
                        <TableHead scope="col" className="text-end">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {RUNS.map((run) => <TableRow key={run.id}>
                        <TableCell>
                          <span className="flex flex-col">
                            <span className="font-medium">{run.label} ×{run.count}</span>
                            <span className="text-xs text-muted-foreground">{run.dates}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{run.total}</TableCell>
                      </TableRow>)}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>
            <section aria-label="Pending money in">
              <Card variant="flush"><NoResults label="pending money in" /></Card>
            </section>
          </div>
        </div>
      </div>
    </main>
  </div>;
}

const meta = {
  title: "Compositions/Activity",
  component: ActivityComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 4 },
    viewport: { viewports: { desktop1280: { name: "1280 × 800", styles: { width: "1280px", height: "800px" } } }, defaultViewport: "desktop1280" },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof ActivityComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Activity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const ledger = canvas.getByRole("table", { name: "Activity ledger" });
    await expect(within(ledger).getByText("Action needed")).toBeVisible();
    await expect(body.queryByRole("dialog")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Details for Add money, Today · 12:00 PM" }));
    const details = await body.findByRole("dialog", { name: "Add money details" });
    await waitFor(() => expect(details).toBeVisible());
    await expect(details).toHaveTextContent("Pay $50.00 by 5:00 PM");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    await userEvent.click(canvas.getByRole("button", { name: "Pending" }));
    await expect(canvas.getByRole("button", { name: "Pending" })).toHaveAttribute("aria-pressed", "true");
    await expect(within(canvas.getByRole("table", { name: "Activity ledger" })).queryByText("Received USDC")).toBeNull();
    await userEvent.click(canvas.getByRole("combobox", { name: "Activity type" }));
    await userEvent.click(await body.findByRole("option", { name: "Money in" }));
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Activity type" })).toHaveTextContent("Money in"));
    const ledgerRegion = canvas.getByRole("region", { name: "Ledger" });
    await expect(ledgerRegion).toHaveTextContent("No pending money in");
    await userEvent.click(within(ledgerRegion).getByRole("button", { name: "Clear filters" }));
    await expect(within(ledgerRegion).getByRole("table", { name: "Activity ledger" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Pending" })).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByText("Latest activity didn't load")).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Pending money in" })).toHaveTextContent("No pending money in");
  },
};

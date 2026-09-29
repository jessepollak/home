import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { condensedTransactionHash, transactionExplorerLink } from "@/components/transaction-explorer";
import type { OperatorFeeActionType } from "@/shared/fees/operator-fee";
import type { OperatorFeeResult, OperatorRevenueDay, OperatorRevenueSummary } from "@/shared/fees/revenue";
import { formatPresentationDate, formatUsdStablecoinAmount } from "@/shared/formatting";
import { formatBasisPoints } from "@/shared/formatting/money";

const actionLabels: Record<OperatorFeeActionType, string> = { trade: "Swap" };

const resultBadges: Record<OperatorFeeResult, { label: string; variant: "outline" | "secondary" | "warning" }> = {
  succeeded: { label: "Succeeded", variant: "outline" },
  reverted: { label: "Reverted", variant: "secondary" },
  not_submitted: { label: "Not submitted", variant: "secondary" },
  unresolved: { label: "Unresolved", variant: "warning" },
};

function dayLabel(date: string): string {
  return formatPresentationDate(`${date}T00:00:00.000Z`, { style: "chart-date", timeZone: "UTC" });
}

function DailyRevenue({ days }: { days: OperatorRevenueDay[] }) {
  const amounts = days.map((day) => BigInt(day.collectedBaseUnits));
  const peak = amounts.reduce((max, amount) => (amount > max ? amount : max), BigInt(0));
  const first = days[0];
  const last = days.at(-1);
  return (
    <div className="grid gap-2">
      <ol aria-label="Daily fee revenue" className="flex h-24 items-end gap-0.5 border-b">
        {days.map((day, index) => {
          const amount = amounts[index];
          const share = peak > BigInt(0) ? Number((amount * BigInt(1000)) / peak) / 10 : 0;
          const label = `${dayLabel(day.date)}: ${formatUsdStablecoinAmount(day.collectedBaseUnits)}`;
          return (
            <li key={day.date} title={label} className="flex h-full min-w-0 flex-1 items-end">
              <span aria-hidden="true" className="w-full rounded-t-sm bg-primary" style={{ blockSize: amount > BigInt(0) ? `max(${share}%, 2px)` : "0" }} />
              <span className="sr-only">{label}</span>
            </li>
          );
        })}
      </ol>
      {first && last ? (
        <div aria-hidden="true" className="flex justify-between text-xs text-muted-foreground">
          <span>{dayLabel(first.date)}</span>
          <span>{dayLabel(last.date)}</span>
        </div>
      ) : null}
    </div>
  );
}

function RevenueSection({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="operator-revenue-title" className="grid gap-4">
      <h2 id="operator-revenue-title" className="text-lg font-semibold">Fee revenue</h2>
      {children}
    </section>
  );
}

export function OperatorRevenue({ summary }: { summary: OperatorRevenueSummary }) {
  if (summary.entries.length === 0 && BigInt(summary.collectedBaseUnits) === BigInt(0)) {
    return (
      <RevenueSection>
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No fees yet</EmptyTitle>
                <EmptyDescription>Fees appear here after the first swap that charges one.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      </RevenueSection>
    );
  }

  const lastThirtyDays = summary.days.reduce((sum, day) => sum + BigInt(day.collectedBaseUnits), BigInt(0));

  return (
    <RevenueSection>
      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="grid content-start gap-1">
            <h3 className="text-sm text-muted-foreground">Expected fees</h3>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{formatUsdStablecoinAmount(summary.collectedBaseUnits)}</p>
          </div>
          <div className="grid content-start gap-3">
            <div className="grid gap-1">
              <h3 className="text-sm text-muted-foreground">Expected fees, last 30 days</h3>
              <p className="text-xl font-semibold tabular-nums">{formatUsdStablecoinAmount(lastThirtyDays)}</p>
            </div>
            <DailyRevenue days={summary.days} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle><h3>Recent fees</h3></CardTitle>
        </CardHeader>
        <CardContent>
          {summary.entries.length === 0 ? (
            <p className="text-muted-foreground">No recent fees.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">Date</TableHead>
                  <TableHead className="text-start">Action</TableHead>
                  <TableHead className="text-end">Amount</TableHead>
                  <TableHead className="text-end">Rate</TableHead>
                  <TableHead className="text-start">Result</TableHead>
                  <TableHead className="text-start">Transaction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.entries.map((entry) => {
                  const result = resultBadges[entry.result];
                  const explorer = transactionExplorerLink(entry.transactionHash);
                  return (
                    <TableRow key={entry.actionId}>
                      <TableCell>{formatPresentationDate(entry.recordedAt, { style: "date-time-zone", timeZone: "UTC" })}</TableCell>
                      <TableCell>{actionLabels[entry.actionKind]}</TableCell>
                      <TableCell className="text-end"><span className="tabular-nums">{formatUsdStablecoinAmount(entry.amountBaseUnits, entry.decimals)}</span></TableCell>
                      <TableCell className="text-end"><span className="tabular-nums">{formatBasisPoints(BigInt(entry.bps))}</span></TableCell>
                      <TableCell><Badge variant={result.variant}>{result.label}</Badge></TableCell>
                      <TableCell>
                        {explorer && entry.transactionHash ? (
                          <a
                            className="font-mono text-xs text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            href={explorer.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={explorer.title}
                          >
                            {condensedTransactionHash(entry.transactionHash)}<span className="sr-only"> (opens BaseScan)</span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground"><span aria-hidden="true">—</span><span className="sr-only">None</span></span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </RevenueSection>
  );
}

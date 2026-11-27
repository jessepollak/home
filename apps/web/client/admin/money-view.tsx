"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { AddressText } from "@/components/address-text";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupSegment } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { condensedTransactionHash, transactionExplorerLink } from "@/components/transaction-explorer";
import { useHydrated } from "@/client/operator/use-hydrated";
import { DeploymentExpiredError, deploymentHeaders, throwIfDeploymentExpired } from "@/client/query/deployment-headers";
import {
  ADMIN_MONEY_CONTRACT_VERSION,
  moneyExportFilename,
  parseAdminMoneyErrorResponse,
  parseMoneyExportRequest,
  type AdminMoneyErrorCode,
  type AdminMoneyPageData,
  type MoneyExportRequest,
  type MoneyMovement,
  type MoneyMovementCategory,
  type MoneyMovementStatus,
  type OperatorAccountBalance,
} from "@/shared/admin-money/contract";
import { formatAddress, formatBasisPoints, formatPresentationDate, formatUsdStablecoinAmount } from "@/shared/formatting";
import { readJson } from "@/shared/http/read-json";
import { formatDecimalAmount } from "@/shared/amounts/decimal";

const categoryLabels: Record<MoneyMovementCategory, string> = { fee: "Swap fee" };

const statusBadges: Record<MoneyMovementStatus, { label: string; variant: "outline" | "secondary" | "warning" }> = {
  succeeded: { label: "Succeeded", variant: "outline" },
  reverted: { label: "Reverted", variant: "secondary" },
  not_submitted: { label: "Not submitted", variant: "secondary" },
  unresolved: { label: "Unresolved", variant: "warning" },
};

const exportErrors: Record<AdminMoneyErrorCode, string> = {
  UNAUTHENTICATED: "Session ended. Sign in again.",
  AUTH_UNAVAILABLE: "Sign-in is unavailable. Try again shortly.",
  OPERATOR_FORBIDDEN: "This account is not an administrator.",
  INVALID_REQUEST: "Check the dates. The start must be on or before the end.",
  CROSS_ORIGIN: "Reload this page before exporting.",
  MONEY_NOT_CONFIGURED: "Exports need a database.",
  MONEY_UNAVAILABLE: "Export is unavailable. Try again shortly.",
  EXPORT_TOO_LARGE: "More than 25,000 movements. Export a shorter range.",
};

function AccountCard({ title, account, unsetHint }: { title: string; account: OperatorAccountBalance; unsetHint: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle><h3>{title}</h3></CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        {account.kind === "unavailable" ? (
          <p className="text-muted-foreground">Unavailable. Try again later.</p>
        ) : account.kind === "unset" ? (
          <p className="text-muted-foreground">{unsetHint}</p>
        ) : (
          <>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {account.usdcBaseUnits === null ? <span className="text-base font-normal text-muted-foreground">Balance unavailable</span> : `${formatDecimalAmount(BigInt(account.usdcBaseUnits), 6)} USDC`}
            </p>
            <div className="justify-self-start"><AddressText address={account.address} /></div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

async function exportMovements(request: MoneyExportRequest): Promise<void> {
  const headers = { "Content-Type": "application/json", ...deploymentHeaders() };
  const response = await fetch("/api/admin/money/export", { method: "POST", credentials: "same-origin", headers, body: JSON.stringify(request) });
  if (!response.ok) {
    const failure = parseAdminMoneyErrorResponse(await readJson(response).catch(() => null));
    throwIfDeploymentExpired(response, headers, failure?.error.code ?? null);
    throw new Error(failure ? exportErrors[failure.error.code] : "Export is unavailable. Try again shortly.");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = moneyExportFilename(request);
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function ExportForm() {
  const id = useId();
  const hydrated = useHydrated();
  const [scope, setScope] = useState<"all" | "range">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = parseMoneyExportRequest({
    version: ADMIN_MONEY_CONTRACT_VERSION,
    from: scope === "range" && from ? from : null,
    to: scope === "range" && to ? to : null,
  });
  const rangeError = scope === "range" && from && to && !request ? "The start must be on or before the end." : null;
  const incomplete = scope === "range" && !from && !to;

  async function submit() {
    if (!request || incomplete) return;
    setPending(true);
    setError(null);
    try {
      await exportMovements(request);
    } catch (cause) {
      setError(cause instanceof DeploymentExpiredError ? cause.message : cause instanceof Error ? cause.message : "Export is unavailable. Try again shortly.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="grid gap-4" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="sr-only">Export to CSV</h3>
      <FieldGroup>
        <RadioGroup
          variant="segmented"
          className="sm:w-80"
          aria-label="Dates to export"
          value={scope}
          disabled={!hydrated || pending}
          onValueChange={(value) => setScope(value === "range" ? "range" : "all")}
        >
          <RadioGroupSegment value="all">All dates</RadioGroupSegment>
          <RadioGroupSegment value="range">Date range</RadioGroupSegment>
        </RadioGroup>
        {scope === "range" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={rangeError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-from`}>From (UTC)</FieldLabel>
              <Input id={`${id}-from`} type="date" variant="touch" className="h-11" value={from} max={to || undefined} disabled={pending} aria-invalid={rangeError ? true : undefined} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field data-invalid={rangeError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-to`}>To (UTC)</FieldLabel>
              <Input id={`${id}-to`} type="date" variant="touch" className="h-11" value={to} min={from || undefined} disabled={pending} aria-invalid={rangeError ? true : undefined} aria-describedby={rangeError ? `${id}-range-error` : undefined} onChange={(event) => setTo(event.target.value)} />
              {rangeError ? <FieldError id={`${id}-range-error`}>{rangeError}</FieldError> : null}
            </Field>
          </div>
        )}
      </FieldGroup>
      <div>
        <Button type="submit" size="touch" disabled={!hydrated || pending || !request || incomplete}>{pending ? "Exporting…" : "Export CSV"}</Button>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </form>
  );
}

function MovementRow({ movement }: { movement: MoneyMovement }) {
  const status = statusBadges[movement.status];
  const explorer = transactionExplorerLink(movement.transactionHash);
  return (
    <TableRow>
      <TableCell><time dateTime={movement.occurredAt}>{formatPresentationDate(movement.occurredAt, { style: "date-time-zone", timeZone: "UTC" })}</time></TableCell>
      <TableCell>{categoryLabels[movement.category]}</TableCell>
      <TableCell className="text-end"><span className="tabular-nums">{formatUsdStablecoinAmount(movement.amountBaseUnits, movement.decimals)}</span></TableCell>
      <TableCell className="text-end">
        {movement.bps === null ? <span className="text-muted-foreground"><span aria-hidden="true">—</span><span className="sr-only">None</span></span> : <span className="tabular-nums">{formatBasisPoints(BigInt(movement.bps))}</span>}
      </TableCell>
      <TableCell>
        {movement.customerId ? (
          <Link href={`/admin/customers/${movement.customerId}`} title={movement.customerId} className="font-mono text-xs text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {movement.customerId.slice(0, 8)}<span className="sr-only">{movement.customerId.slice(8)}</span>
          </Link>
        ) : <span className="text-muted-foreground"><span aria-hidden="true">—</span><span className="sr-only">None</span></span>}
      </TableCell>
      <TableCell>
        {movement.payoutAddress ? <span className="font-mono text-xs" title={movement.payoutAddress}>{formatAddress(movement.payoutAddress)}</span> : <span className="text-muted-foreground"><span aria-hidden="true">—</span><span className="sr-only">None</span></span>}
      </TableCell>
      <TableCell>
        {explorer && movement.transactionHash ? (
          <a className="font-mono text-xs text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" href={explorer.href} target="_blank" rel="noopener noreferrer" title={explorer.title}>
            {condensedTransactionHash(movement.transactionHash)}<span className="sr-only"> (opens BaseScan)</span>
          </a>
        ) : <span className="text-muted-foreground"><span aria-hidden="true">—</span><span className="sr-only">None</span></span>}
      </TableCell>
      <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
    </TableRow>
  );
}

export function MoneyView({ data }: { data: AdminMoneyPageData }) {
  const { movements } = data;
  return (
    <div className="grid gap-8">
      <section aria-labelledby="money-accounts-title" className="grid gap-4">
        <h2 id="money-accounts-title" className="text-lg font-semibold">Accounts</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <AccountCard title="Revenue destination" account={data.revenueDestination} unsetHint={<>Not set. Choose one in <Link href="/admin/settings" className="text-primary underline underline-offset-4">Settings</Link>.</>} />
          <AccountCard title="Payout account" account={data.payoutAccount} unsetHint={<>Not set. Choose one in <Link href="/admin/growth" className="text-primary underline underline-offset-4">Growth</Link>.</>} />
        </div>
      </section>
      <section aria-labelledby="money-movements-title" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="money-movements-title" className="text-lg font-semibold">Movements</h2>
          <p className="text-sm text-muted-foreground">Only movements Home authored. Top-ups and outside transfers don’t appear.</p>
        </div>
        <Card>
          <CardContent className="grid gap-6">
            <ExportForm />
            {movements === null ? (
              <Alert><AlertDescription>Movements are unavailable. Try again later.</AlertDescription></Alert>
            ) : movements.rows.length === 0 && movements.before === null ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No movements yet</EmptyTitle>
                  <EmptyDescription>Fees appear here after the first swap that charges one.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid gap-2">
                <Table aria-label="Money movements, newest first">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">Date</TableHead>
                      <TableHead className="text-start">Category</TableHead>
                      <TableHead className="text-end">Amount</TableHead>
                      <TableHead className="text-end">Rate</TableHead>
                      <TableHead className="text-start">Customer</TableHead>
                      <TableHead className="text-start">Payout address</TableHead>
                      <TableHead className="text-start">Transaction</TableHead>
                      <TableHead className="text-start">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.rows.map((movement) => <MovementRow key={movement.id} movement={movement} />)}
                  </TableBody>
                </Table>
                {movements.rows.length === 0 && <p className="text-sm text-muted-foreground">No older movements.</p>}
                {(movements.before || movements.next) && (
                  <div className="flex flex-wrap gap-2">
                    {movements.before && <Link className={buttonVariants({ variant: "outline", size: "touch" })} href="/admin/money">Newest</Link>}
                    {movements.next && <Link className={buttonVariants({ variant: "outline", size: "touch" })} href={`/admin/money?before=${movements.next}`}>Older</Link>}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ownerQuery } from "@/client/query/query-options";
import { useHomeQuery } from "@/client/query/query-client";
import { formatAddress } from "@/shared/formatting";
import {
  customerSearchString,
  parseCustomerSearchQuery,
  type CustomerSearchFilters,
  type CustomerSearchMatch,
  type CustomerSearchRow,
} from "@/shared/admin-customers/contract";
import { CustomerReadError, fetchCustomerSearch } from "./api";
import { pushLocationFragment, useDocumentVisible, useLocationFragment, usePurgeCustomersOnAccessLoss } from "./location-state";
import { CustomerAccessLost, emailSourceLabel, formatDay, signInLabel, statusLabel } from "./presentation";

const statusOptions = [["any", "Any status"], ["active", "Active"], ["restricted", "Restricted"], ["closed", "Closed"]] as const;
const signInOptions = [["any", "Any sign-in"], ["cdp-embedded", "Email"], ["base-account", "Base Account"]] as const;
const fundedOptions = [["any", "Funded or not"], ["funded", "Funded"], ["not-funded", "Not funded"]] as const;
const matchLabels: Record<CustomerSearchMatch, string> = {
  all: "All customers, newest first",
  id: "Matched by customer or funding order ID",
  "transaction-hash": "Matched by transaction hash",
  address: "Matched by wallet address",
  "address-prefix": "Matched by wallet address prefix",
  "email-or-order": "Matched by email prefix or provider order ID",
};

function FilterSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  const current = options.find(([option]) => option === value)?.[1] ?? label;
  return (
    <Select value={value} onValueChange={(next) => {
      const match = options.find(([option]) => option === next);
      if (match) onChange(match[0]);
    }}>
      <SelectTrigger aria-label={label} className="min-h-11 w-full sm:w-auto"><SelectValue>{current}</SelectValue></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map(([option, text]) => <SelectItem key={option} value={option}>{text}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ResultRow({ row, from }: { row: CustomerSearchRow; from: string }) {
  const email = row.emails[0];
  const wallet = row.wallets[0];
  const title = email?.address ?? (wallet ? formatAddress(wallet) : "No email or wallet");
  return (
    <Item variant="outline" render={<Link href={`/admin/customers/${row.customerId}${from ? `#${from}` : ""}`} />}>
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription lines="wrap">
          {email ? `${emailSourceLabel(email.source)} email` : "No stored email"}
          {row.emails.length > 1 ? ` · ${row.emails.length - 1} more email${row.emails.length > 2 ? "s" : ""}` : ""}
          {" · "}{row.walletCount === 0 ? "No wallet" : `${row.walletCount} wallet${row.walletCount === 1 ? "" : "s"}${email && wallet ? ` (${formatAddress(wallet)})` : ""}`}
          {" · "}{row.signIn.length ? row.signIn.map(signInLabel).join(", ") : "No sign-in method"}
          {" · "}First seen {formatDay(row.firstSeenAt)}{row.firstSeenSource === "backfill" ? " (approximate)" : ""}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <span className="flex flex-wrap justify-end gap-1">
          {row.status !== "active" ? <Badge variant="warning">{statusLabel(row.status)}</Badge> : null}
          {row.merged ? <Badge variant="outline">Merged</Badge> : null}
          <Badge variant={row.funded ? "secondary" : "outline"}>{row.funded ? "Funded" : "Not funded"}</Badge>
        </span>
      </ItemActions>
    </Item>
  );
}

export function CustomerSearch({ operator }: { operator: `0x${string}` }) {
  const fragment = useLocationFragment();
  if (fragment === null) return <div className="grid gap-2" aria-busy="true" aria-label="Loading customers"><Skeleton className="h-16 w-full" /></div>;
  return <CustomerSearchView key={fragment} operator={operator} search={fragment} />;
}

function CustomerSearchView({ operator, search }: { operator: `0x${string}`; search: string }) {
  const query = parseCustomerSearchQuery(new URLSearchParams(search));
  const filters: CustomerSearchFilters = query?.filters ?? { status: "any", signIn: "any", funded: "any" };
  const q = query?.q ?? new URLSearchParams(search).get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const results = useHomeQuery(ownerQuery({
    owner: query ? operator : null,
    scope: "admin-customer-search",
    key: [search],
    queryFn: ({ signal }) => {
      if (!query) throw new CustomerReadError("invalid");
      return fetchCustomerSearch(query, signal);
    },
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  }));

  const go = (next: { q?: string; filters?: Partial<CustomerSearchFilters>; after?: string | null }) => {
    pushLocationFragment("/admin/customers", customerSearchString({ q: next.q ?? q, ...filters, ...next.filters, after: next.after ?? null }));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    go({ q: draft });
  };
  const failure = results.error instanceof CustomerReadError ? results.error.reason : results.error ? "unavailable" : null;
  usePurgeCustomersOnAccessLoss(operator, failure);
  const invalid = !query || failure === "invalid";
  const visible = useDocumentVisible();
  const data = visible && results.isFetchedAfterMount && !results.isRefetching ? results.data : undefined;

  return (
    <div className="grid gap-6">
      <form role="search" aria-label="Customers" onSubmit={submit} className="grid gap-3">
        <Field>
          <FieldLabel htmlFor="customer-search">Search customers</FieldLabel>
          <div className="flex gap-2">
            <Input id="customer-search" type="search" name="q" autoComplete="off" spellCheck={false} value={draft} maxLength={320}
              aria-describedby="customer-search-help" onChange={(event) => setDraft(event.target.value)} className="min-h-11 min-w-0 flex-1" />
            <Button type="submit" size="touch">Search</Button>
          </div>
          <FieldDescription id="customer-search-help">Email, wallet address, customer ID, transaction hash or funding order ID</FieldDescription>
        </Field>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <FilterSelect label="Status" value={filters.status} options={statusOptions} onChange={(status) => go({ filters: { status } })} />
          <FilterSelect label="Sign-in method" value={filters.signIn} options={signInOptions} onChange={(signIn) => go({ filters: { signIn } })} />
          <FilterSelect label="Funding" value={filters.funded} options={fundedOptions} onChange={(funded) => go({ filters: { funded } })} />
        </div>
      </form>

      <section aria-labelledby="customer-results" className="grid gap-3">
        <h2 id="customer-results" className="sr-only">Results</h2>
        {invalid ? (
          <div role="alert" className="grid gap-2">
            <p>That search isn&apos;t valid. Enter at least 3 characters of an email, at least 6 hex characters after 0x for a wallet, or a full ID or hash.</p>
            <Button variant="outline" size="touch" className="w-fit" onClick={() => { setDraft(""); go({ q: "", filters: { status: "any", signIn: "any", funded: "any" } }); }}>Clear search</Button>
          </div>
        ) : failure === "signed-out" || failure === "forbidden" ? (
          <CustomerAccessLost reason={failure} />
        ) : failure === "not-configured" ? (
          <p role="status">Customer search needs a database.</p>
        ) : failure ? (
          <div role="alert" className="grid gap-2">
            <p>Customers couldn&apos;t load. Try again.</p>
            <Button variant="outline" size="touch" className="w-fit" loading={results.isFetching} onClick={() => void results.refetch()}>Try again</Button>
          </div>
        ) : !data ? (
          <div className="grid gap-2" aria-busy="true" aria-label="Loading customers"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : data.customers.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription role="status">{query.q || query.after || filters.status !== "any" || filters.signIn !== "any" || filters.funded !== "any"
                ? query.after ? "No more customers." : "No customers match this search."
                : "No customers yet."}</EmptyDescription>
            </EmptyHeader>
            {query.q || filters.status !== "any" || filters.signIn !== "any" || filters.funded !== "any"
              ? <Button variant="outline" size="touch" onClick={() => { setDraft(""); go({ q: "", filters: { status: "any", signIn: "any", funded: "any" } }); }}>Clear search</Button>
              : null}
          </Empty>
        ) : (
          <>
            <p role="status" className="text-sm text-muted-foreground">{matchLabels[data.match]} · {data.customers.length} shown</p>
            <div className="grid gap-2">
              {data.customers.map((row) => <ResultRow key={row.customerId} row={row} from={search} />)}
            </div>
          </>
        )}
        {query && data && (query.after || data.nextCursor) ? (
          <nav aria-label="Customer pages" className="flex flex-wrap gap-2">
            {query.after ? <Button variant="outline" size="touch" onClick={() => go({ after: null })}>First page</Button> : null}
            {data.nextCursor ? <Button variant="outline" size="touch" onClick={() => go({ after: data.nextCursor })}>Next page</Button> : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}

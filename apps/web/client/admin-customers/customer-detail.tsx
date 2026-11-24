"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { ownerQuery } from "@/client/query/query-options";
import { useHomeQuery } from "@/client/query/query-client";
import { formatAddress } from "@/shared/formatting";
import type { CustomerAction, CustomerDetailResponse, CustomerFundingOrder, CustomerSection, CustomerWalletBalance } from "@/shared/admin-customers/contract";
import { CustomerReadError, fetchCustomerDetail } from "./api";
import { useDocumentVisible, useLocationFragment, usePurgeCustomersOnAccessLoss } from "./location-state";
import { customerListHref } from "@/shared/admin-customers/contract";
import { CustomerAccessLost, emailSourceLabel, formatMoment, formatUsd, signInLabel, statusLabel } from "./presentation";

type Detail = CustomerDetailResponse;
const outcomeLabels: Record<NonNullable<CustomerAction["outcome"]>, string> = { succeeded: "Succeeded", reverted: "Reverted", not_submitted: "Not submitted" };
const observedLabels: Record<CustomerAction["status"], string> = { confirmed: "Receipt seen, not final", failed: "Reverted receipt, not final", pending: "Pending", unknown: "Result unknown" };

function actionResult(action: CustomerAction): { label: string; settled: boolean } {
  return action.outcome ? { label: outcomeLabels[action.outcome], settled: action.outcome === "succeeded" } : { label: observedLabels[action.status], settled: false };
}
const firstSeenLabels: Record<Detail["profile"]["firstSeenSource"], string> = { sign_in: "at sign-in", activity: "from activity", backfill: "approximate, backfilled from earliest activity" };

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid gap-3 text-sm wrap-anywhere sm:grid-cols-2">{children}</dl>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-0.5"><dt className="text-muted-foreground">{label}</dt><dd>{children}</dd></div>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle role="heading" aria-level={2}>{title}</CardTitle></CardHeader>
      <CardContent className="grid gap-3">{children}</CardContent>
    </Card>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Section<T>({ value, unavailable, children }: { value: CustomerSection<T>; unavailable: string; children: (value: T) => ReactNode }) {
  return value.status === "available" ? <>{children(value.value)}</> : <p role="status" className="text-sm">{unavailable}</p>;
}

function Profile({ profile }: { profile: Detail["profile"] }) {
  return (
    <Panel title="Profile">
      <Facts>
        <Fact label="Status">{statusLabel(profile.status)}{profile.deletionPending ? " · deletion pending" : ""}</Fact>
        <Fact label="Customer ID"><code>{profile.customerId}</code></Fact>
        <Fact label="First seen">{formatMoment(profile.firstSeenAt)} ({firstSeenLabels[profile.firstSeenSource]})</Fact>
        <Fact label="Last seen">{formatMoment(profile.lastSeenAt)}</Fact>
        <Fact label="Request country">{profile.country ?? "Not recorded"}</Fact>
        {profile.mergedInto ? <Fact label="Merged into"><Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/customers/${profile.mergedInto}`}>{profile.mergedInto}</Link></Fact> : null}
      </Facts>
      <h3 className="font-medium">Sign-in methods</h3>
      {profile.credentials.length === 0 ? <Note>No sign-in method recorded.</Note> : (
        <ul className="grid gap-2 text-sm">
          {profile.credentials.map((credential) => (
            <li key={`${credential.signIn}:${credential.firstSeenAt}`} className="grid gap-0.5 wrap-anywhere">
              <span className="font-medium">{signInLabel(credential.signIn)}</span>
              <span>{credential.email ? `${credential.email.address} · ${emailSourceLabel(credential.email.source)}` : "No stored email"}</span>
              <span className="text-muted-foreground">First seen {formatMoment(credential.firstSeenAt)} · last seen {formatMoment(credential.lastSeenAt)}{credential.linkedVia === "link" ? " · linked" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-medium">Wallets</h3>
      {profile.wallets.length === 0 ? <Note>No wallet linked.</Note> : (
        <ul className="grid gap-1 text-sm">
          {profile.wallets.map((wallet) => <li key={`${wallet.chainId}:${wallet.address}`} className="wrap-anywhere"><code>{wallet.address}</code> · linked {formatMoment(wallet.linkedAt)}</li>)}
        </ul>
      )}
    </Panel>
  );
}

function WalletMoney({ wallet }: { wallet: CustomerWalletBalance }) {
  const snapshot = wallet.snapshot;
  return (
    <div className="grid gap-2">
      <h3 className="font-medium wrap-anywhere">{formatAddress(wallet.address)}</h3>
      {!snapshot ? <Note>No balance observation yet. Balances appear after this wallet&apos;s next Home balance read.</Note> : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            As of {formatMoment(snapshot.observedAt)}
            {snapshot.stale ? <Badge variant="warning">Stale</Badge> : null}
            {snapshot.complete ? null : <Badge variant="warning">Partial</Badge>}
          </p>
          {snapshot.currency === null ? <Note>Values are unavailable without a quote currency.</Note> : (
            <Facts>
              <Fact label="Cash and savings">{formatUsd(snapshot.cash)}</Fact>
              <Fact label="Investments and collateral">{formatUsd(snapshot.investments)}</Fact>
              <Fact label="Borrowed">{formatUsd(snapshot.debt)}</Fact>
              <Fact label="Net">{snapshot.net !== null && snapshot.netNegative ? `−${formatUsd(snapshot.net)}` : formatUsd(snapshot.net)}</Fact>
            </Facts>
          )}
          {snapshot.complete ? null : <Note>Totals are unavailable because some holdings, prices or markets weren&apos;t observed.</Note>}
          {snapshot.holdings.length + snapshot.debts.length === 0 ? <Note>No positions observed.</Note> : (
            <ul className="grid gap-1 text-sm">
              {snapshot.holdings.map((holding) => (
                <li key={`${holding.category}:${holding.symbol}:${holding.name}`}>{holding.amount} {holding.symbol} · {holding.category} · {holding.value === null ? "unpriced" : formatUsd(holding.value)}</li>
              ))}
              {snapshot.debts.map((debt) => <li key={`debt:${debt.symbol}`}>{debt.amount} {debt.symbol} · borrowed · {debt.value === null ? "unpriced" : formatUsd(debt.value)}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function ActionRow({ action }: { action: CustomerAction }) {
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle>{action.title ?? action.kind}</ItemTitle>
        <ItemDescription lines="wrap">
          {action.kind} · confirmed {formatMoment(action.confirmedAt)}{action.transactionHash ? ` · ${shortHash(action.transactionHash)}` : " · no transaction hash"}
        </ItemDescription>
      </ItemContent>
      <ItemActions><Badge variant={actionResult(action).settled ? "outline" : "warning"}>{actionResult(action).label}</Badge></ItemActions>
    </Item>
  );
}

function FundingRow({ order }: { order: CustomerFundingOrder }) {
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle>{order.fiatAmount} · {order.providerId} ({order.region})</ItemTitle>
        <ItemDescription lines="wrap">
          Created {formatMoment(order.createdAt)} · updated {formatMoment(order.updatedAt)} · order <span className="wrap-anywhere">{order.id}</span>{order.providerOrderId ? ` · provider order ${order.providerOrderId}` : ""}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <span className="flex flex-wrap justify-end gap-1">
          {order.sandbox ? <Badge variant="outline">Sandbox</Badge> : null}
          <Badge variant={order.state === "received" ? "secondary" : "outline"}>{order.state}</Badge>
        </span>
      </ItemActions>
    </Item>
  );
}

function DetailBody({ detail }: { detail: Detail }) {
  return (
    <div className="grid gap-4">
      <Note>Actions and funding orders recorded before customer IDs were linked may be missing here.</Note>
      <Profile profile={detail.profile} />
      <Panel title="Money">
        <Section value={detail.balances} unavailable="Balances couldn't load. Reload to try again.">
          {(wallets) => wallets.length === 0 ? <Note>No Base wallet linked.</Note> : <div className="grid gap-4">{wallets.map((wallet) => <WalletMoney key={wallet.address} wallet={wallet} />)}</div>}
        </Section>
      </Panel>
      <Panel title="Recent actions">
        <Section value={detail.actions} unavailable="Actions couldn't load. Reload to try again.">
          {(actions) => actions.items.length === 0 ? <Note>No confirmed actions linked to this customer.</Note> : (
            <div className="grid gap-2">
              {actions.items.map((action) => <ActionRow key={action.id} action={action} />)}
              {actions.more ? <Note>Showing the latest {actions.items.length}.</Note> : null}
            </div>
          )}
        </Section>
      </Panel>
      <Panel title="Funding orders">
        <Section value={detail.funding} unavailable="Funding orders couldn't load. Reload to try again.">
          {(funding) => funding.items.length === 0 ? <Note>No funding orders linked to this customer.</Note> : (
            <div className="grid gap-2">
              {funding.items.map((order) => <FundingRow key={order.id} order={order} />)}
              {funding.more ? <Note>Showing the latest {funding.items.length}.</Note> : null}
            </div>
          )}
        </Section>
        <h3 className="font-medium">Provider verification</h3>
        <Section value={detail.verification} unavailable="Verification status couldn't load.">
          {(rows) => rows.length === 0 ? <Note>No provider verification on record.</Note> : (
            <ul className="grid gap-1 text-sm">{rows.map((row) => <li key={`${row.providerId}:${row.region}`}>{row.providerId} ({row.region}) · {row.state} · updated {formatMoment(row.updatedAt)}</li>)}</ul>
          )}
        </Section>
      </Panel>
      <Panel title="Invites">
        <Section value={detail.invites} unavailable="Invite attribution couldn't load.">
          {(invites) => (
            <Facts>
              <Fact label="Invited by">
                {invites.inviterCustomerId
                  ? <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/customers/${invites.inviterCustomerId}`}>Customer with code {invites.attributedCode}</Link>
                  : invites.attributedCode ? `Code ${invites.attributedCode}` : "Not attributed"}
              </Fact>
              <Fact label="Own invite code">{invites.ownCode ?? "None yet"}</Fact>
              <Fact label="Attributed sign-ups">{invites.attributedSignups === null ? "No invite link" : invites.attributedSignups}</Fact>
            </Facts>
          )}
        </Section>
      </Panel>
      <Panel title="Support">
        <Section value={detail.support} unavailable="Support status couldn't load.">
          {(support) => support === null ? <Note>No support conversation.</Note> : (
            <div className="grid gap-2">
              <Note>{support.status === "open" ? "Open" : "Resolved"} · last message {formatMoment(support.lastMessageAt)}</Note>
              <Link className={buttonVariants({ variant: "outline", size: "touch", className: "w-fit" })} href={`/admin/support/${support.conversationId}`}>Open conversation</Link>
            </div>
          )}
        </Section>
      </Panel>
    </div>
  );
}

export function CustomersBackLink() {
  const fragment = useLocationFragment();
  return (
    <Link href={customerListHref(fragment ?? "")} className="-mb-6 inline-flex min-h-11 w-fit items-center gap-2 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />Customers
    </Link>
  );
}

export function CustomerDetail({ operator, customerId }: { operator: `0x${string}`; customerId: string }) {
  const fragment = useLocationFragment();
  const backHref = customerListHref(fragment ?? "");
  const detail = useHomeQuery(ownerQuery({
    owner: operator,
    scope: "admin-customer-detail",
    key: [customerId],
    queryFn: ({ signal }) => fetchCustomerDetail(customerId, signal),
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  }));
  const failure = detail.error instanceof CustomerReadError ? detail.error.reason : detail.error ? "unavailable" : null;
  usePurgeCustomersOnAccessLoss(operator, failure);
  const visible = useDocumentVisible();
  if (failure === "signed-out" || failure === "forbidden") return <CustomerAccessLost reason={failure} />;
  if (failure === "not-found" || failure === "invalid") {
    return (
      <div role="alert" className="grid gap-2">
        <p>No customer has this ID.</p>
        <Link className={buttonVariants({ variant: "outline", size: "touch", className: "w-fit" })} href={backHref}>Back to customers</Link>
      </div>
    );
  }
  if (failure === "not-configured") return <p role="status">Customer details need a database.</p>;
  if (failure) {
    return (
      <div role="alert" className="grid gap-2">
        <p>This customer couldn&apos;t load. Try again.</p>
        <Button variant="outline" size="touch" className="w-fit" loading={detail.isFetching} onClick={() => void detail.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!detail.data || !detail.isFetchedAfterMount || detail.isRefetching || !visible) return <div className="grid gap-4" aria-busy="true" aria-label="Loading customer"><Skeleton className="h-48 w-full" /><Skeleton className="h-32 w-full" /></div>;
  return <DetailBody detail={detail.data} />;
}

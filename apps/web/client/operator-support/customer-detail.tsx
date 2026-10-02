import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OperatorSupportConversationResponse } from "@/shared/support/contract";

export function CustomerDetail({ data }: { data: OperatorSupportConversationResponse }) {
  const { customer, conversation } = data;
  const events = customer.recentEvents.map((event, position, all) => ({ ...event, key: `${event.occurredAt}:${event.name}:${all.slice(0, position).filter((earlier) => earlier.occurredAt === event.occurredAt && earlier.name === event.name).length}` }));
  const content = <div className="grid gap-4 text-sm wrap-anywhere">
    <div><dt className="text-muted-foreground">Status</dt><dd>{customer.status}</dd></div>
    {customer.country && <div><dt className="text-muted-foreground">Country</dt><dd>{customer.country}</dd></div>}
    <div><dt className="text-muted-foreground">First seen</dt><dd>{customer.firstSeenAt.slice(0, 10)}</dd></div>
    <div><dt className="text-muted-foreground">Last seen</dt><dd>{customer.lastSeenAt.slice(0, 10)}</dd></div>
    {customer.emails.length > 0 && <div><dt className="text-muted-foreground">Email</dt>{customer.emails.map((email) => <dd key={email}>{email}</dd>)}</div>}
    {customer.accountProviders.length > 0 && <div><dt className="text-muted-foreground">Account providers</dt>{customer.accountProviders.map((provider) => <dd key={provider}>{provider}</dd>)}</div>}
    {customer.wallets.length > 0 && <div><dt className="text-muted-foreground">Wallets</dt>{customer.wallets.map((wallet) => <dd key={wallet}>{wallet}</dd>)}</div>}
    {conversation.contextRefs.length > 0 && <div><dt className="text-muted-foreground">Context</dt>{conversation.contextRefs.map((ref) => <dd key={`${ref.kind}:${ref.id}`}>{ref.kind === "funding_order" ? "Funding order" : "Money action"}: {ref.summary ?? ref.id}</dd>)}</div>}
    {events.length > 0 && <div><dt className="text-muted-foreground">Recent events</dt>{events.map((event) => <dd key={event.key}>{event.name} · {event.occurredAt.slice(0, 16).replace("T", " ")}</dd>)}</div>}
  </div>;
  return <>
    <details className="lg:hidden"><summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Customer details</summary><dl className="pb-4">{content}</dl></details>
    <Card className="hidden self-start lg:flex"><CardHeader><CardTitle>Customer details</CardTitle></CardHeader><CardContent><dl>{content}</dl></CardContent></Card>
  </>;
}

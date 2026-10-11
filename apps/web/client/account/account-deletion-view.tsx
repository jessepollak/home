"use client";

import { useState } from "react";
import type { AccountDeletionReceipt, AccountDeletionBlockerClass } from "@/shared/account/contracts/account-deletion";
import { FINANCIAL_EVIDENCE_RETENTION_YEARS } from "@/shared/account/financial-retention";
import type { AccountExportHomeClass } from "@/shared/account/contracts/data-export";
import type { DeviceDeletionRow } from "./account-deletion-device";
import type { useAccountExport } from "./use-account-export";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { formatPresentationDate } from "@/shared/formatting";

const storeLabels: Record<AccountExportHomeClass, string> = {
  customer: "Home profile", credentials: "Sign-in links", wallets: "Wallet links", preferences: "Preferences", invites: "Invites", email_requests: "Email requests", operator_events: "Product events", access_audit: "Access audit", actions: "Money actions", cashout_orders: "Cash-out orders", operator_fees: "Operator fees", funding_orders: "Funding orders", funding_provider_customers: "Funding provider links", funding_provider_credentials: "Funding provider credentials", balance_snapshots: "Balance snapshots", balance_history_addresses: "Balance history addresses", balance_changes: "Balance changes", balance_checkpoints: "Balance checkpoints", card_accounts: "Card accounts", cards: "Cards", card_events: "Card events", card_transactions: "Card transactions", support_conversations: "Support conversations", support_messages: "Support messages", support_assistant_runs: "Support assistant runs", support_context_refs: "Support context links",
};
const blockerLabels: Record<AccountDeletionBlockerClass, [string, string]> = {
  actions: ["money action", "money actions"], cashout_orders: ["cash-out order", "cash-out orders"], funding_orders: ["funding order", "funding orders"], card_transactions: ["card transaction", "card transactions"],
};

export function AccountDeletionReview({ accountExport, loading, error, ready, onDelete, onRefresh, onBack }: {
  accountExport: ReturnType<typeof useAccountExport>; loading: boolean; error: boolean; ready: boolean;
  onDelete: () => void; onRefresh: () => void; onBack: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="space-y-4 py-2" aria-labelledby="leave-home-heading">
      <Button variant="outline" size="touch" onClick={onBack}>Back</Button>
      <h2 id="leave-home-heading" className="text-lg font-semibold">Leave Home</h2>
      <Card><CardContent inset="list">
        <Item><ItemContent><ItemTitle>Save a copy first</ItemTitle><ItemDescription lines="wrap">Download your Home data before deleting your account.</ItemDescription>
          <Button variant="outline" size="touch" disabled={accountExport.state === "generating"} aria-busy={accountExport.state === "generating"} onClick={() => void accountExport.start()}>{accountExport.state === "generating" ? "Preparing…" : "Export my data"}</Button>
          <ItemDescription lines="wrap" role="status">{accountExport.state === "success" ? "Export downloaded" : accountExport.state === "error" ? "Couldn't create your export. Try again before deleting." : ""}</ItemDescription>
        </ItemContent></Item>
        <Item><ItemContent><ItemDescription lines="wrap">Home deletes your Home data and sign-in links. Minimum financial records are kept with pseudonymized ownership for {FINANCIAL_EVIDENCE_RETENTION_YEARS} years.</ItemDescription></ItemContent></Item>
        <Item><ItemContent><ItemDescription lines="wrap">Provider-held records stay with providers. Public-chain history cannot be erased.</ItemDescription></ItemContent></Item>
        <Item><ItemContent><ItemDescription lines="wrap">If money items are still pending, deletion waits until they reconcile.</ItemDescription></ItemContent></Item>
      </CardContent></Card>
      {error ? <Alert variant="destructive"><AlertDescription>Couldn&apos;t check your deletion request. Deletion is not confirmed.</AlertDescription><AlertAction><Button variant="outline" size="touch" onClick={onRefresh}>Try again</Button></AlertAction></Alert> : null}
      <Button variant="destructive" size="touch" disabled={!ready || loading} aria-busy={loading} onClick={() => setConfirm(true)}>Delete my Home account</Button>
      {confirm ? <Card><CardContent className="space-y-3">
        <ItemTitle>Delete your Home account?</ItemTitle>
        <ItemDescription lines="wrap">This cannot be undone once deletion completes. Export your data first if you want a copy.</ItemDescription>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="touch" onClick={() => setConfirm(false)}>Cancel deletion</Button>
          <Button variant="destructive" size="touch" disabled={!ready || loading} onClick={() => { setConfirm(false); onDelete(); }}>Confirm deletion</Button>
        </div>
      </CardContent></Card> : null}
    </section>
  );
}

export function AccountDeletionQueued({ receipt, loading, error, onRefresh, onBack }: { receipt: AccountDeletionReceipt; loading: boolean; error: boolean; onRefresh: () => void; onBack: () => void }) {
  return <section className="space-y-4 py-2" aria-labelledby="deletion-queued-heading">
    <Button variant="outline" size="touch" onClick={onBack}>Back</Button>
    <h2 id="deletion-queued-heading" className="text-lg font-semibold">Deletion queued</h2>
    <p>{receipt.blockers.length ? "Deletion is not complete. Home will retry after pending money items reconcile." : "Deletion is not complete. Home will try again."}</p>
    {receipt.blockers.length ? <Card><CardContent inset="list">{receipt.blockers.map((blocker) => <Item key={blocker.name}><ItemContent><ItemTitle>{blocker.count} {blockerLabels[blocker.name][blocker.count === 1 ? 0 : 1]} still pending</ItemTitle></ItemContent></Item>)}</CardContent></Card> : null}
    {receipt.lastAttempt?.outcome === "failed" ? <Alert variant="destructive"><AlertDescription>The last attempt failed. Your Home account has not been deleted.</AlertDescription></Alert> : null}
    {error ? <Alert variant="destructive"><AlertDescription>Couldn&apos;t refresh the request. The last known status is queued, not complete.</AlertDescription></Alert> : null}
    <ItemDescription lines="wrap">Requested {formatPresentationDate(receipt.requestedAt, { style: "date-time-zone" })}</ItemDescription>
    <Button variant="outline" size="touch" disabled={loading} aria-busy={loading} onClick={onRefresh}>{loading ? "Checking…" : "Check status"}</Button>
  </section>;
}

export function AccountDeletionReceiptView({ receipt, deviceRows, busy = false, error, onRetry }: { receipt: AccountDeletionReceipt | null; deviceRows: DeviceDeletionRow[]; busy?: boolean; error?: string | null; onRetry?: () => void }) {
  function download() {
    if (!receipt) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...receipt, currentDevice: deviceRows }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `home-deletion-receipt-${receipt.requestId}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <section className="space-y-4 py-2" aria-labelledby="deletion-receipt-heading">
    <h2 id="deletion-receipt-heading" className="text-lg font-semibold">{receipt ? "Home account deleted" : "Account deletion receipt"}</h2>
    {busy ? <p role="status">Clearing this device and signing out…</p> : null}
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {onRetry && error ? <Button variant="outline" size="touch" onClick={onRetry}>Try again</Button> : null}
    {receipt && !busy ? <>
      {receipt.completedAt ? <ItemDescription lines="wrap">Completed {formatPresentationDate(receipt.completedAt, { style: "date-time-zone" })}</ItemDescription> : null}
      <Button variant="outline" size="touch" onClick={download}>Download receipt</Button>
      {(["deleted", "retained-pseudonymized"] as const).map((disposition) => <section className="space-y-3" key={disposition} aria-label={disposition === "deleted" ? "Deleted by Home" : "Retained with pseudonymized ownership"}>
        <h3 className="font-semibold">{disposition === "deleted" ? "Deleted by Home" : "Retained with pseudonymized ownership"}</h3>
        <Card><CardContent inset="list">{receipt.stores.filter((store) => store.disposition === disposition).map((store) => <Item key={store.name}><ItemContent><ItemTitle>{storeLabels[store.name]}</ItemTitle>{store.disposition === "retained-pseudonymized" ? <><ItemDescription lines="wrap">{store.evidence}. {store.reason}</ItemDescription><ItemDescription lines="wrap">Expires {formatPresentationDate(store.expiresAt, { style: "date-time-zone" })}</ItemDescription></> : null}</ItemContent></Item>)}</CardContent></Card>
      </section>)}
      <section className="space-y-3" aria-label="Held by providers"><h3 className="font-semibold">Held by providers</h3><Card><CardContent inset="list">{receipt.providers.map((provider) => <Item key={`${provider.provider}-${provider.records}`}><ItemContent><ItemTitle>{provider.provider}</ItemTitle><ItemDescription lines="wrap">{provider.records} — {provider.statement}</ItemDescription></ItemContent></Item>)}</CardContent></Card></section>
      <section className="space-y-3" aria-label="Public chain"><h3 className="font-semibold">Public chain</h3><p>{receipt.publicChain.statement}</p></section>
    </> : null}
    {deviceRows.length ? <section className="space-y-3" aria-label="This device"><h3 className="font-semibold">This device</h3><Card><CardContent inset="list">{deviceRows.map((row) => <Item key={row.name}><ItemContent><ItemTitle>{row.name}</ItemTitle><ItemDescription lines="wrap">{row.cleared ? "Cleared on this device" : "Couldn't confirm clearing on this device"}</ItemDescription></ItemContent></Item>)}</CardContent></Card><ItemDescription lines="wrap">Other devices were not cleared by this browser.</ItemDescription></section> : null}
  </section>;
}

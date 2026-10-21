"use client";

import { useRouter } from "next/navigation";
import { AddressText } from "@/components/address-text";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InviteRewardRiskSignal, InviteRewardState } from "@/shared/growth/reward";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import type { GrowthSettings } from "@/shared/operator-settings/growth";
import { GrowthSettingsForm } from "./growth-settings-form";
import { GrowthRewardQueue, growthUsdc } from "./growth-reward-queue";

export type GrowthQueueEntry = {
  id: string; inviterShortId: string; inviteeShortId: string; depositAssetsAtoms: string;
  attributedAt: string; qualifiedAt: string; riskSignals: InviteRewardRiskSignal[];
};
export type GrowthDashboardData = {
  stats: { inviteLinks: number; attributedSignUps: number } | null;
  funnel: { counts: Record<InviteRewardState, number>; historyPendingCount: number; reservedAtoms: string; approvedCount: number } | null;
  queue: { qualified: GrowthQueueEntry[]; approved: (GrowthQueueEntry & { reservedAtoms: string; decidedAt: string })[]; approvedAtoms: string } | null;
  settings: SettingsEntry<GrowthSettings>["settings"] | null;
  signerState: "absent" | "misconfigured" | "configured";
  payoutIsSigner: boolean | null;
};

export function GrowthDashboard({ data, operator }: { data: GrowthDashboardData; operator: `0x${string}` }) {
  const router = useRouter();
  const { funnel, stats, settings, queue } = data;
  const account = settings?.value.payoutAccount;
  const remaining = settings && funnel ? BigInt(settings.value.budgetAtoms) - BigInt(funnel.reservedAtoms) : null;
  const metrics = [
    ["Attributed sign-ups", stats?.attributedSignUps], ["Invite links", stats?.inviteLinks],
    ["Ineligible", funnel?.counts.ineligible], ["Joined", funnel?.counts.joined], ["Holding", funnel?.counts.saved],
    ["In review", funnel?.counts.qualified], ["Approved", funnel?.approvedCount],
    ["Approved amount", queue ? growthUsdc(queue.approvedAtoms) : null], ["Rejected", funnel?.counts.rejected],
    ["Didn't complete", funnel?.counts.disqualified], ["Waiting for balance history", funnel?.historyPendingCount],
    ["Budget used", funnel ? growthUsdc(funnel.reservedAtoms) : null],
    ["Budget remaining", remaining === null ? null : `${remaining < BigInt(0) ? "−" : ""}${growthUsdc((remaining < BigInt(0) ? -remaining : remaining).toString())}`],
    ["Budget", settings ? growthUsdc(settings.value.budgetAtoms) : null],
  ];
  return <div className="grid gap-8">
    <Card><CardHeader><CardTitle>Funnel and cost</CardTitle></CardHeader><CardContent>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([label, value]) => <div key={label} className="grid gap-1"><dt className="text-sm text-muted-foreground">{label}</dt><dd>{value ?? "Unavailable"}</dd></div>)}</dl>
    </CardContent></Card>
    {funnel && funnel.historyPendingCount > 0 && <Alert><AlertDescription>Balance history is behind for {funnel.historyPendingCount} rewards</AlertDescription></Alert>}
    {settings ? <GrowthSettingsForm key={operator} initial={settings} operator={operator} signerState={data.signerState} payoutIsSigner={data.payoutIsSigner} onSaved={() => router.refresh()} /> : <Alert><AlertDescription>Program settings are unavailable.</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>Payout account</CardTitle></CardHeader><CardContent className="grid gap-3">
      {settings ? account ? <><AddressText address={account} /><p className="text-sm text-muted-foreground">Top up this address with USDC on Base.</p></> : <p>No payout account configured.</p> : <p>Payout account is unavailable.</p>}
      <p>Approved, awaiting payout: {queue ? growthUsdc(queue.approvedAtoms) : "Unavailable"}</p>
      {account && operator.toLowerCase() !== account && <p>Sign in as the payout account to pay</p>}
      <p className="text-sm text-muted-foreground">Payout ships separately.</p>
    </CardContent></Card>
    {queue ? <GrowthRewardQueue queue={queue} onDecision={() => router.refresh()} /> : <Alert><AlertDescription>Approval queue is unavailable.</AlertDescription></Alert>}
  </div>;
}

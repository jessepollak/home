"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { DeploymentExpiredError, deploymentHeaders, throwIfDeploymentExpired } from "@/client/query/deployment-headers";
import { parseGrowthAdminErrorResponse, parseRewardDecisionResponse, type GrowthAdminErrorCode, type RewardDecisionRequest } from "@/shared/growth/admin-contract";
import type { InviteRewardRiskSignal } from "@/shared/growth/reward";
import { readJson } from "@/shared/http/read-json";
import { formatDecimalAmount } from "@/shared/amounts/decimal";
import type { GrowthDashboardData, GrowthQueueEntry } from "./growth-dashboard";

export function growthUsdc(atoms: string) {
  return `${formatDecimalAmount(BigInt(atoms), 6)} USDC`;
}

const riskLabels: Record<InviteRewardRiskSignal, string> = {
  "funded-by-inviter": "Funded by inviter", "funded-by-customer": "Funded by another customer", "signup-burst": "Sign-up burst", "inviter-burst": "Inviter burst", "withdrew-after-window": "Withdrew after holding window", "preexisting-shares": "Pre-existing Save shares",
};
const errors: Record<GrowthAdminErrorCode, string> = {
  UNAUTHENTICATED: "Session ended. Sign in again.", AUTH_UNAVAILABLE: "Authentication is unavailable.", OPERATOR_FORBIDDEN: "This account is not an operator.", NOT_FOUND: "Reward not found. Refresh the queue.", INVALID_REQUEST: "Check the rejection reason (1–200 characters).", CROSS_ORIGIN: "Reload this page before trying again.", UNAVAILABLE: "Reward decisions are unavailable. Try again shortly.", NOT_QUALIFIED: "This reward is no longer in review. Refresh the queue.", NO_LONGER_QUALIFIES: "The balance dropped. This reward no longer qualifies.", HISTORY_PENDING: "Balance history is behind. Try again after it catches up.", CAP_REACHED: "The inviter has reached the current reward cap.", BUDGET_EXHAUSTED: "The current reward budget is exhausted.", SETTINGS_MISSING: "Growth settings are unavailable. Save valid settings first.",
};

async function decide(id: string, request: RewardDecisionRequest) {
  const headers = { "Content-Type": "application/json", ...deploymentHeaders() };
  const response = await fetch(`/api/admin/growth/rewards/${id}`, { method: "POST", credentials: "same-origin", headers, body: JSON.stringify(request) });
  const body = await readJson(response).catch(() => null);
  if (response.ok) {
    const parsed = parseRewardDecisionResponse(body);
    if (!parsed) throw new Error("Couldn't confirm the decision. Refresh before trying again.");
    return parsed;
  }
  const failure = parseGrowthAdminErrorResponse(body);
  throwIfDeploymentExpired(response, headers, failure?.error.code ?? null);
  throw new Error(failure ? `${failure.error.code}: ${errors[failure.error.code]}` : "Couldn't confirm the decision. Refresh before trying again.");
}

function RewardRow({ row, onDecision }: { row: GrowthQueueEntry; onDecision: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState("");
  async function submit(action: "approve" | "reject") {
    if (pending || state) return;
    setPending(true); setError("");
    try {
      const result = await decide(row.id, action === "approve" ? { version: 1, action } : { version: 1, action, reason: reason.trim() });
      setState(result.state === "approved" ? "Approved, awaiting payout." : "Rejected."); onDecision();
    } catch (caught) {
      setError(caught instanceof DeploymentExpiredError || caught instanceof Error ? caught.message : "Couldn't confirm the decision. Refresh before retrying.");
    } finally { setPending(false); }
  }
  return <Card size="sm"><CardContent className="grid gap-3">
    <h3 className="text-sm font-medium">Inviter {row.inviterShortId} → Invitee {row.inviteeShortId}</h3>
    <p>Deposit: {growthUsdc(row.depositAssetsAtoms)}</p>
    <p className="text-sm text-muted-foreground">Joined {row.attributedAt} · Qualified {row.qualifiedAt}</p>
    {row.riskSignals.length > 0 && <div className="flex flex-wrap gap-2">{row.riskSignals.map((signal) => <Badge key={signal} variant="secondary">{riskLabels[signal]}</Badge>)}</div>}
    {rejecting && !state && <Field><FieldLabel htmlFor={`reject-${row.id}`}>Rejection reason (operator only)</FieldLabel><Textarea id={`reject-${row.id}`} value={reason} maxLength={200} disabled={pending} onChange={(event) => setReason(event.target.value)} /></Field>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {state ? <p role="status">{state}</p> : <div className="flex flex-wrap gap-2">
      {!rejecting && <Button size="touch" loading={pending} onClick={() => void submit("approve")}>Approve</Button>}
      <Button variant="outline" size="touch" disabled={pending || (rejecting && reason.trim().length === 0)} onClick={() => rejecting ? void submit("reject") : setRejecting(true)}>{rejecting ? "Confirm rejection" : "Reject"}</Button>
      {rejecting && <Button variant="ghost" size="touch" disabled={pending} onClick={() => setRejecting(false)}>Cancel</Button>}
    </div>}
  </CardContent></Card>;
}

export function GrowthRewardQueue({ queue, onDecision }: { queue: NonNullable<GrowthDashboardData["queue"]>; onDecision: () => void }) {
  return <div className="grid gap-6">
    <section aria-labelledby="growth-queue-heading" className="grid gap-3"><h2 id="growth-queue-heading" className="text-lg font-semibold">Approval queue</h2>
      {queue.qualified.length ? queue.qualified.map((row) => <RewardRow key={row.id} row={row} onDecision={onDecision} />) : <p>No rewards in review.</p>}
    </section>
    <Card><CardHeader><CardTitle>Approved, awaiting payout</CardTitle></CardHeader><CardContent className="grid gap-3">
      {queue.approved.length ? queue.approved.map((row) => <div key={row.id}><p>{row.inviterShortId} → {row.inviteeShortId} · {growthUsdc(row.reservedAtoms)}</p><p className="text-sm text-muted-foreground">Approved {row.decidedAt}</p></div>) : <p>No approved rewards.</p>}
    </CardContent></Card>
  </div>;
}

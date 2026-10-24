"use client";

import { useState, type FormEvent } from "react";
import { countryRegionIds, presentationRegions } from "@/config/regions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DeploymentExpiredError, deploymentHeaders, throwIfDeploymentExpired } from "@/client/query/deployment-headers";
import { formatDecimalAmount, parseDecimalAmount } from "@/shared/amounts/decimal";
import { readJson } from "@/shared/http/read-json";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseOperatorSettingsErrorResponse, parseSettingsResponse, type SettingsEntry } from "@/shared/operator-settings/contract";
import { growthEnableBlockers, parseGrowthSettings, type GrowthSettings } from "@/shared/operator-settings/growth";

type Entry = SettingsEntry<GrowthSettings>["settings"];
function draftOf(value: GrowthSettings) {
  return { ...value, inviterRewardAtoms: formatDecimalAmount(BigInt(value.inviterRewardAtoms), 6), minDepositAtoms: formatDecimalAmount(BigInt(value.minDepositAtoms), 6), budgetAtoms: formatDecimalAmount(BigInt(value.budgetAtoms), 6), holdDays: String(value.holdDays), perInviterCap: String(value.perInviterCap), startsAt: value.startsAt?.slice(0, 16) ?? "", endsAt: value.endsAt?.slice(0, 16) ?? "", payoutAccount: value.payoutAccount ?? "" };
}
function readEntry(body: unknown): Entry | null {
  const parsed = parseSettingsResponse(body);
  const value = parsed?.domain === "growth" ? parseGrowthSettings(parsed.settings.value) : null;
  return parsed && value ? { ...parsed.settings, value } : null;
}

export function GrowthSettingsForm({ initial, operator, signerState, payoutIsSigner, onSaved }: {
  initial: Entry; operator: `0x${string}`; signerState: "absent" | "misconfigured" | "configured"; payoutIsSigner: boolean | null; onSaved: () => void;
}) {
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial.value));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [operatorChanged, setOperatorChanged] = useState(false);
  let value: GrowthSettings | null = null;
  try {
    value = parseGrowthSettings({ ...draft, inviterRewardAtoms: parseDecimalAmount(draft.inviterRewardAtoms, 6).toString(), minDepositAtoms: parseDecimalAmount(draft.minDepositAtoms, 6).toString(), budgetAtoms: parseDecimalAmount(draft.budgetAtoms, 6).toString(), holdDays: Number(draft.holdDays), perInviterCap: Number(draft.perInviterCap), startsAt: draft.startsAt ? new Date(`${draft.startsAt}:00Z`).toISOString() : null, endsAt: draft.endsAt ? new Date(`${draft.endsAt}:00Z`).toISOString() : null, payoutAccount: draft.payoutAccount.trim() || null });
  } catch {
    value = null;
  }
  const blockers = value ? growthEnableBlockers(value) : [];
  function edit(patch: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(""); setMessage("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!value || pending || operatorChanged || (draft.enabled && blockers.length > 0)) return;
    setPending(true); setError(""); setMessage("");
    const headers = { "Content-Type": "application/json", ...deploymentHeaders() };
    try {
      const response = await fetch("/api/admin/settings/growth", { method: "PUT", credentials: "same-origin", headers, body: JSON.stringify({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision: baseline.revision, value, operator }) });
      const body = await readJson(response).catch(() => null);
      if (response.ok) {
        const entry = readEntry(body);
        if (!entry) throw new Error("Invalid settings response");
        setBaseline(entry); setDraft(draftOf(entry.value)); setMessage("Program settings saved."); onSaved();
      } else {
        const failure = parseOperatorSettingsErrorResponse(body);
        throwIfDeploymentExpired(response, headers, failure?.error.code ?? null);
        if (failure?.error.code === "SETTINGS_CONFLICT") {
          const current = readEntry(failure.current);
          if (!current) throw new Error("Invalid conflict response");
          setBaseline(current);
          setError("Someone else changed these settings. Your draft is kept. Review it against the latest saved values before saving again.");
        } else if (failure?.error.code === "OPERATOR_CHANGED") {
          setOperatorChanged(true);
          setError("A different operator is signed in. Reload this page before saving.");
        } else if (failure?.error.code === "INVALID_REQUEST") {
          setError(value.payoutAccount ? signerState === "absent" ? "Payout signer list is unset. Non-empty payout accounts cannot be saved." : signerState === "misconfigured" ? "Payout signer list is invalid. Non-empty payout accounts cannot be saved." : "Settings rejected. The payout account must be on the payout signer list; check the values and enable requirements." : "Settings rejected. Check the values and enable requirements.");
        } else {
          setError(failure ? `Settings not saved: ${failure.error.code}.` : "Couldn't confirm the save. Reload before trying again.");
        }
      }
    } catch (caught) {
      setError(caught instanceof DeploymentExpiredError ? caught.message : "Couldn't confirm the save. Reload this page before trying again.");
    } finally { setPending(false); }
  }
  const fields = [
    ["inviterRewardAtoms", "Reward amount (USDC)", "text"], ["minDepositAtoms", "Minimum deposit (USDC)", "text"],
    ["holdDays", "Hold days", "number"], ["perInviterCap", "Per-inviter cap", "number"], ["budgetAtoms", "Budget (USDC)", "text"],
    ["startsAt", "Start (UTC)", "datetime-local"], ["endsAt", "End (UTC)", "datetime-local"], ["payoutAccount", "Payout account", "text"],
  ] as const;
  return <Card><CardHeader><CardTitle>Program settings</CardTitle></CardHeader><CardContent>
    <form className="grid gap-5" onSubmit={(event) => void save(event)}>
      <p className="text-sm text-muted-foreground">{baseline.source === "default" ? "Not saved yet." : `Saved revision ${baseline.revision} · ${baseline.updatedAt ?? "Unknown time"}`}</p>
      <Field orientation="horizontal"><FieldLabel htmlFor="growth-enabled">Enabled</FieldLabel><Switch id="growth-enabled" checked={draft.enabled} onCheckedChange={(enabled) => edit({ enabled })} disabled={pending || operatorChanged} /></Field>
      <fieldset disabled={pending || operatorChanged} className="grid gap-5">
        <legend className="sr-only">Program configuration</legend>
        <fieldset className="grid gap-3"><legend>Countries</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{countryRegionIds.map((code) => <Field key={code} orientation="horizontal"><Switch id={`growth-country-${code}`} checked={draft.countries.includes(code)} onCheckedChange={(checked) => edit({ countries: checked ? [...draft.countries, code] : draft.countries.filter((id) => id !== code) })} /><FieldLabel htmlFor={`growth-country-${code}`}>{presentationRegions[code].countryName}</FieldLabel></Field>)}</div></fieldset>
        <Field orientation="horizontal"><Switch id="growth-tax" checked={draft.acknowledgements.taxReporting} onCheckedChange={(checked) => edit({ acknowledgements: { ...draft.acknowledgements, taxReporting: checked === true } })} /><FieldLabel htmlFor="growth-tax">Tax-reporting acknowledged</FieldLabel></Field>
        <Field orientation="horizontal"><Switch id="growth-sanctions" checked={draft.acknowledgements.sanctionsScreening} onCheckedChange={(checked) => edit({ acknowledgements: { ...draft.acknowledgements, sanctionsScreening: checked === true } })} /><FieldLabel htmlFor="growth-sanctions">Sanctions-screening acknowledged</FieldLabel></Field>
        <div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label, type]) => <Field key={key}><FieldLabel htmlFor={`growth-${key}`}>{label}</FieldLabel><Input id={`growth-${key}`} type={type} inputMode={key.endsWith("Atoms") ? "decimal" : undefined} value={draft[key]} onChange={(event) => edit({ [key]: event.target.value })} /></Field>)}</div>
        <Field><FieldLabel htmlFor="growth-terms">Terms text</FieldLabel><Textarea id="growth-terms" maxLength={8000} value={draft.termsText} onChange={(event) => edit({ termsText: event.target.value })} /></Field>
      </fieldset>
      <p className="text-sm">{signerState === "absent" ? "Payout signer list is unset." : signerState === "misconfigured" ? "Payout signer list is invalid." : initial.value.payoutAccount ? payoutIsSigner ? "Saved payout account is on the payout signer list." : "Saved payout account is not a payout signer." : "No saved payout account."}</p>
      {value === null && <p role="status">Check amounts (up to 6 decimal places), whole-number limits, address and date ordering.</p>}
      {blockers.length > 0 && <p>Missing enable requirements: {blockers.join(", ")}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <p role="status">{message}</p>
      <div><Button type="submit" size="touch" loading={pending} disabled={!value || operatorChanged || (draft.enabled && blockers.length > 0)}>Save program settings</Button></div>
    </form>
  </CardContent></Card>;
}

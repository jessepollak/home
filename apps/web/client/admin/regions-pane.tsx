"use client";

import { useState } from "react";
import { countryRegionIds, presentationRegions, type CountryCode, type RegionId } from "@/config/regions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseOperatorSettingsErrorResponse, parseSettingsResponse, type SettingsEntry } from "@/shared/operator-settings/contract";
import { parseRegionSettings, type RegionSettings } from "@/shared/operator-settings/regions";
import { DeploymentExpiredError, deploymentHeaders, throwIfDeploymentExpired } from "@/client/query/deployment-headers";

type RegionEntry = SettingsEntry<RegionSettings>["settings"];

export function regionChanges(before: RegionSettings, after: RegionSettings) {
  const previous = new Set(before.offered);
  const next = new Set(after.offered);
  return {
    turnedOn: countryRegionIds.filter((id) => !previous.has(id) && next.has(id)),
    turnedOff: countryRegionIds.filter((id) => previous.has(id) && !next.has(id)),
    defaultChanged: before.defaultRegion !== after.defaultRegion,
  };
}

function regionName(id: RegionId) {
  return id === "GLOBAL" ? "Global" : presentationRegions[id].countryName;
}

function savedAt(value: string | null) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC` : "at an unknown time";
}

function readEntry(value: unknown): RegionEntry | null {
  const parsed = parseSettingsResponse(value);
  if (parsed?.domain !== "regions") return null;
  const settings = parseRegionSettings(parsed.settings.value);
  return settings ? { ...parsed.settings, value: settings } : null;
}

function errorMessage(status: number, code?: string) {
  if (code === "OPERATOR_CHANGED") return "A different operator is signed in. Reload this page before saving.";
  if (status === 400 || code === "INVALID_REQUEST") return "These settings couldn't be saved. Check the selected regions and try again.";
  if (status === 401 || status === 403 || code === "CROSS_ORIGIN" || code === "OPERATOR_FORBIDDEN") return "Access to settings has changed. Sign in as an operator and try again.";
  if (status === 503 || code === "SETTINGS_UNAVAILABLE") return "Settings are unavailable. Try again shortly.";
  return "Couldn't confirm the save. Refresh this page before trying again.";
}

export function RegionsPane({ initialEntry, operator }: { initialEntry: RegionEntry; operator: `0x${string}` }) {
  const [baseline, setBaseline] = useState(initialEntry);
  const [draft, setDraft] = useState<RegionSettings>(initialEntry.value);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeOperator, setActiveOperator] = useState(operator);
  if (activeOperator !== operator) {
    setActiveOperator(operator);
    setBaseline(initialEntry);
    setDraft(initialEntry.value);
    setReviewOpen(false);
    setMessage("");
    setError("");
  }
  const changes = regionChanges(baseline.value, draft);
  const dirty = changes.turnedOn.length > 0 || changes.turnedOff.length > 0 || changes.defaultChanged;

  function toggle(id: CountryCode, on: boolean) {
    setMessage("");
    setError("");
    setDraft((current) => {
      const offered = new Set(current.offered);
      if (on) offered.add(id);
      else offered.delete(id);
      return {
        offered: countryRegionIds.filter((code) => offered.has(code)),
        defaultRegion: !on && current.defaultRegion === id ? "GLOBAL" : current.defaultRegion,
      };
    });
  }

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setError("");
    setMessage("");
    const headers = { "Content-Type": "application/json", ...deploymentHeaders() };
    try {
      const response = await fetch("/api/admin/settings/regions", {
        method: "PUT",
        headers,
        body: JSON.stringify({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision: baseline.revision, value: draft, operator }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const updated = readEntry(body);
        if (!updated) throw new Error("Invalid settings response");
        setBaseline(updated);
        setDraft(updated.value);
        setReviewOpen(false);
        setMessage("Region settings saved.");
      } else {
        const parsed = parseOperatorSettingsErrorResponse(body);
        throwIfDeploymentExpired(response, headers, parsed?.error.code ?? null);
        if (response.status === 409 && parsed?.error.code === "SETTINGS_CONFLICT") {
          const current = readEntry(parsed.current);
          if (!current) throw new Error("Invalid conflict response");
          setBaseline(current);
          setReviewOpen(false);
          setError("Someone else changed these settings. Your draft is still here. Review it against the latest settings before saving again.");
        } else {
          setError(errorMessage(response.status, parsed?.error.code));
        }
      }
    } catch (error) {
      setError(error instanceof DeploymentExpiredError ? error.message : "Couldn't confirm the save. Refresh this page before trying again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="regions-heading" className="grid gap-6">
      <div className="grid gap-1">
        <h2 id="regions-heading" className="text-lg font-semibold">Regions</h2>
        <p className="text-sm text-muted-foreground">
          {baseline.source === "default"
            ? "Using Home's built-in regions. Nothing is saved yet."
            : `Saved ${savedAt(baseline.updatedAt)} by ${baseline.updatedBy ? `${baseline.updatedBy.slice(0, 6)}…${baseline.updatedBy.slice(-4)}` : "an unknown operator"}.`}
        </p>
      </div>
      <div className="grid gap-3">
        <h3 className="text-sm font-medium">Offered countries ({draft.offered.length})</h3>
        <ItemGroup>
          {countryRegionIds.map((id) => (
            <Item key={id} role="listitem" variant="outline" className="min-w-0">
              <ItemContent className="min-w-0">
                <ItemTitle truncate="wrap">{presentationRegions[id].countryName} · {presentationRegions[id].currency.code}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <span className="text-sm text-muted-foreground" aria-hidden="true">{draft.offered.includes(id) ? "On" : "Off"}</span>
                <Switch aria-label={presentationRegions[id].countryName} checked={draft.offered.includes(id)} onCheckedChange={(on) => toggle(id, on)} disabled={pending} />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </div>
      <div className="grid gap-2">
        <label htmlFor="operator-default-region" className="text-sm font-medium">Default region</label>
        <NativeSelect id="operator-default-region" value={draft.defaultRegion} disabled={pending} wrapperClassName="max-w-sm" onChange={(event) => {
          const selected = event.target.value;
          if (selected === "GLOBAL" || draft.offered.some((id) => id === selected)) {
            setDraft((current) => ({ ...current, defaultRegion: selected as RegionId }));
            setMessage("");
            setError("");
          }
        }}>
          <option value="GLOBAL">Global</option>
          {draft.offered.map((id) => <option key={id} value={id}>{regionName(id)}</option>)}
        </NativeSelect>
        {baseline.value.defaultRegion !== "GLOBAL" && draft.defaultRegion === "GLOBAL" && !draft.offered.includes(baseline.value.defaultRegion) && (
          <p className="text-sm text-muted-foreground">Default reset to Global because {regionName(baseline.value.defaultRegion)} is off.</p>
        )}
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
      <div><Button size="touch" disabled={!dirty || pending} onClick={() => setReviewOpen(true)}>Review changes</Button></div>
      <Drawer open={reviewOpen} onOpenChange={(open) => { if (!pending) setReviewOpen(open); }}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Review region changes</DrawerTitle>
            <DrawerDescription>Confirm which countries Home offers before saving.</DrawerDescription>
          </DrawerHeader>
          <div className="grid min-h-0 gap-3 overflow-y-auto p-4">
            <div><strong>Turn on</strong><p>{changes.turnedOn.length ? changes.turnedOn.map(regionName).join(", ") : "None"}</p></div>
            {changes.turnedOn.length > 0 && <p>Turning countries on re-opens money in and out through their corridors.</p>}
            <div><strong>Turn off</strong><p>{changes.turnedOff.length ? changes.turnedOff.map(regionName).join(", ") : "None"}</p></div>
            {changes.turnedOff.length > 0 && <p>New customers stop seeing these countries and new orders stop. Existing balances and orders keep working.</p>}
            <div><strong>Default region</strong><p>{changes.defaultChanged ? `${regionName(baseline.value.defaultRegion)} → ${regionName(draft.defaultRegion)}` : "Unchanged"}</p></div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          </div>
          <DrawerFooter className="flex-row justify-end">
            <Button variant="outline" size="touch" disabled={pending} onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button size="touch" loading={pending} disabled={!dirty} onClick={() => { void save(); }}>Confirm changes</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </section>
  );
}

"use client";

import { useState } from "react";
import { investAssets, type InvestAssetCategory } from "@/config/invest-assets";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { formatPresentationDate } from "@/shared/formatting";
import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseOperatorSettingsErrorResponse, parseSettingsResponse, type SettingsEntry } from "@/shared/operator-settings/contract";
import { parseInvestSettings, parseInvestSettingsWrite, type InvestSettings } from "@/shared/operator-settings/invest";
import { DeploymentExpiredError, deploymentHeaders, throwIfDeploymentExpired } from "@/client/query/deployment-headers";

type InvestEntry = SettingsEntry<InvestSettings>["settings"];

const categories: readonly { id: InvestAssetCategory; name: string }[] = [
  { id: "stock", name: "Stocks" },
  { id: "crypto", name: "Crypto" },
  { id: "meme", name: "Memes" },
];

function readEntry(value: unknown): InvestEntry | null {
  const response = parseSettingsResponse(value);
  if (response?.domain !== "invest") return null;
  const settings = parseInvestSettings(response.settings.value);
  return settings ? { ...response.settings, value: settings } : null;
}

function sameSettings(a: InvestSettings, b: InvestSettings): boolean {
  return a.hiddenCategories.join("|") === b.hiddenCategories.join("|") && a.hiddenAssets.join("|") === b.hiddenAssets.join("|");
}

export function InvestPane({ initialEntry }: { initialEntry: InvestEntry }) {
  const [baseline, setBaseline] = useState(initialEntry);
  const [draft, setDraft] = useState<InvestSettings>(initialEntry.value);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty = !sameSettings(baseline.value, draft);

  function updateDraft(value: InvestSettings) {
    const canonical = parseInvestSettingsWrite(value);
    if (canonical) setDraft(canonical);
    setMessage("");
    setError("");
  }

  function toggleCategory(id: InvestAssetCategory, shown: boolean) {
    updateDraft({ ...draft, hiddenCategories: shown
      ? draft.hiddenCategories.filter((category) => category !== id)
      : [...draft.hiddenCategories, id] });
  }

  function toggleAsset(id: string, shown: boolean) {
    updateDraft({ ...draft, hiddenAssets: shown
      ? draft.hiddenAssets.filter((asset) => asset !== id)
      : [...draft.hiddenAssets, id] });
  }

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setError("");
    setMessage("");
    const headers = { "Content-Type": "application/json", ...deploymentHeaders() };
    try {
      const response = await fetch("/api/admin/settings/invest", {
        method: "PUT",
        headers,
        body: JSON.stringify({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision: baseline.revision, value: draft }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const next = readEntry(body);
        if (!next) throw new Error("Invalid settings response");
        setBaseline(next);
        setDraft(next.value);
        setMessage("Invest settings saved.");
      } else {
        const parsed = parseOperatorSettingsErrorResponse(body);
        throwIfDeploymentExpired(response, headers, parsed?.error.code ?? null);
        if (response.status === 409 && parsed?.error.code === "SETTINGS_CONFLICT") {
          const current = readEntry(parsed.current);
          if (!current) throw new Error("Invalid conflict response");
          setBaseline(current);
          setDraft(current.value);
          setError("Someone else changed these settings. Review the latest values and save again.");
        } else {
          setError("Couldn't save. Try again.");
        }
      }
    } catch (error) {
      setError(error instanceof DeploymentExpiredError ? error.message : "Couldn't save. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="invest-heading" className="grid gap-6">
      <div className="grid gap-1">
        <h2 id="invest-heading" className="text-lg font-semibold">Invest</h2>
        <p className="text-sm text-muted-foreground" suppressHydrationWarning>
          {baseline.source === "default"
            ? "Using Home's built-in catalog"
            : `Saved ${baseline.updatedAt ? formatPresentationDate(baseline.updatedAt, { style: "date-time-zone" }) : "at an unknown time"} by ${baseline.updatedBy ? `${baseline.updatedBy.slice(0, 6)}…${baseline.updatedBy.slice(-4)}` : "an unknown operator"}`}
        </p>
      </div>
      {categories.map(({ id, name }) => {
        const categoryShown = !draft.hiddenCategories.includes(id);
        return (
          <div key={id} className="grid gap-3">
            <h3 className="text-sm font-medium">{name}</h3>
            <ItemGroup>
              <Item variant="outline" role="listitem" className="min-w-0">
                <ItemContent className="min-w-0"><ItemTitle truncate="wrap">{name} category</ItemTitle></ItemContent>
                <ItemActions>
                  <span className="text-sm text-muted-foreground" aria-hidden="true">{categoryShown ? "Shown" : "Hidden"}</span>
                  <Switch aria-label={`${name} category`} checked={categoryShown} onCheckedChange={(shown) => toggleCategory(id, shown)} disabled={pending} />
                </ItemActions>
              </Item>
              {categoryShown && investAssets.filter((asset) => asset.category === id).map((asset) => {
                const shown = !draft.hiddenAssets.includes(asset.id);
                return (
                  <Item key={asset.id} variant="outline" role="listitem" className="min-w-0">
                    <ItemContent className="min-w-0">
                      <ItemTitle truncate="wrap">{asset.displayName}</ItemTitle>
                      <ItemDescription>{asset.displaySymbol}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <span className="text-sm text-muted-foreground" aria-hidden="true">{shown ? "Shown" : "Hidden"}</span>
                      <Switch aria-label={`${asset.displayName} (${asset.displaySymbol})`} checked={shown} onCheckedChange={(value) => toggleAsset(asset.id, value)} disabled={pending} />
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
            {id === "meme" && <p className="text-sm text-muted-foreground">Trending memes can only be hidden as a category.</p>}
          </div>
        );
      })}
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
      <div><Button size="touch" disabled={!dirty || pending} loading={pending} onClick={() => { void save(); }}>Save changes</Button></div>
    </section>
  );
}

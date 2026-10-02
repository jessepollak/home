"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddressText } from "@/components/address-text";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { RadioGroup, RadioGroupSegment } from "@/components/ui/radio-group";
import { OPERATOR_SETTINGS_CONTRACT_VERSION } from "@/shared/operator-settings/contract";
import { formatPresentationDate } from "@/shared/formatting";
import {
  orphanedProductSettingIds,
  resolveProductOffering,
  type CatalogEntry,
  type ProductCatalog,
  type ProductSettings,
} from "@/shared/operator-settings/products";
import { exactCatalogSettings, reviewEnables, saveOutcome, type ProductSettingsEntry, type ReviewItem } from "./product-settings-model";

export function ProductSettingsLoadError() {
  const router = useRouter();
  return <Alert variant="destructive"><AlertTitle>Settings could not load.</AlertTitle><AlertDescription>Check the database connection, then try again.</AlertDescription><Button variant="outline" size="touch" onClick={() => router.refresh()}>Try again</Button></Alert>;
}

type Names = { vaults: Record<string, string>; markets: Record<string, string> };
type Props = { initialEntry: ProductSettingsEntry; catalog: ProductCatalog; names: Names; missingInvestCredentials: readonly string[]; operator: `0x${string}` };

function ModeRow({ label, detail, status, value, options, onChange, disabled }: {
  label: string; detail?: string; status: string; value: string; options: readonly (readonly [string, string])[];
  onChange: (value: string) => void; disabled?: boolean;
}) {
  return (
    <Item variant="outline" className="gap-4">
      <ItemContent>
        <ItemTitle truncate="wrap">{label}</ItemTitle>
        {detail && <ItemDescription lines="wrap">{detail}</ItemDescription>}
        <Badge variant={status === "On" || status === "Enabled" ? "secondary" : "outline"}>{status}</Badge>
      </ItemContent>
      <RadioGroup variant="segmented" aria-label={`${label} mode`} value={value} onValueChange={onChange} disabled={disabled} className="w-full shrink-0 sm:w-64">
        {options.map(([mode, text]) => <RadioGroupSegment key={mode} value={mode}>{text}</RadioGroupSegment>)}
      </RadioGroup>
    </Item>
  );
}

const exitableOptions = [["on", "On"], ["exit-only", "Exit only"]] as const;
const sendOptions = [["on", "On"], ["off", "Off"]] as const;
const entryOptions = [["enabled", "Enabled"], ["reducing-only", "Reducing only"]] as const;

export function ProductSettingsEditor({ initialEntry, catalog, names, missingInvestCredentials, operator }: Props) {
  const router = useRouter();
  const [entry, setEntry] = useState(initialEntry);
  const [draft, setDraft] = useState<ProductSettings>(() => exactCatalogSettings(initialEntry.settings.value, catalog));
  const [review, setReview] = useState<{ items: ReviewItem[]; draft: ProductSettings } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ProductSettingsEntry | null | undefined>(undefined);
  const orphans = orphanedProductSettingIds(entry.settings.value, catalog);
  const baseline = resolveProductOffering(entry.settings.source === "default" ? { kind: "deployment" } : { kind: "saved", value: entry.settings.value }, catalog);
  const updateProduct = (product: keyof ProductSettings["products"], value: string) => {
    setDraft((previous) => ({ ...previous, products: { ...previous.products, [product]: value } }));
    setError(null);
  };
  const updateEntry = (key: "vaults" | "markets", id: string, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: { ...previous[key], [id]: value } }));
    setError(null);
  };
  const save = async (snapshot: ProductSettings) => {
    if (pending) return;
    setPending(true);
    setError(null);
    setReview(null);
    try {
      const response = await fetch("/api/admin/settings/products", {
        method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision: entry.settings.revision, value: snapshot, operator }),
      });
      const body: unknown = await response.json();
      const outcome = saveOutcome(response.status, body);
      if (outcome.kind === "saved") {
        setEntry(outcome.entry);
        setDraft(exactCatalogSettings(outcome.entry.settings.value, catalog));
        setConflict(undefined);
      } else if (outcome.kind === "conflict") {
        setConflict(outcome.current);
        setError(outcome.message);
      } else setError(outcome.message);
    } catch {
      setError("Could not reach settings. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };
  const startSave = () => {
    const snapshot = exactCatalogSettings(draft, catalog);
    const items = reviewEnables(baseline, snapshot, names, catalog);
    if (items.length) setReview({ items, draft: snapshot });
    else void save(snapshot);
  };
  const reload = () => {
    if (conflict) {
      setEntry(conflict);
      setDraft(exactCatalogSettings(conflict.settings.value, catalog));
      setConflict(undefined);
      setError(null);
    } else router.refresh();
  };
  const entryRows = (kind: "vaults" | "markets", entries: readonly CatalogEntry[], parentOff: boolean) => entries.map(({ id, mode }) => {
    const locked = mode !== "enabled";
    const effective = parentOff || locked ? "reducing-only" : draft[kind][id];
    return (
      <ModeRow key={id} label={names[kind][id] ?? id} detail={locked ? "Reducing only in code" : parentOff ? "Exit only while the product is paused" : undefined}
        status={effective === "enabled" ? "Enabled" : "Reducing only"} value={effective} options={entryOptions} disabled={locked || parentOff || pending || review !== null || conflict !== undefined}
        onChange={(value) => updateEntry(kind, id, value)} />
    );
  });
  return (
    <div className="grid gap-8">
      <Alert><AlertTitle>{entry.settings.source === "default" ? "Using deployment values — review and save" : "Saved settings"}</AlertTitle>
        {entry.settings.source === "stored" && entry.settings.updatedAt && <AlertDescription><span>{formatPresentationDate(entry.settings.updatedAt, { style: "date-time-zone", timeZone: "UTC" })}</span>{entry.settings.updatedBy && <> · <AddressText address={entry.settings.updatedBy} presentation="compact" /></>}</AlertDescription>}
      </Alert>
      <section className="grid gap-3" aria-labelledby="operator-products-heading">
        <h2 id="operator-products-heading" className="text-lg font-semibold">Products</h2>
        {(["save", "borrow", "invest", "send"] as const).map((product) => {
          const mode = draft.products[product];
          const notConnected = product === "invest" && missingInvestCredentials.length > 0;
          const label = product[0].toUpperCase() + product.slice(1);
          return <ModeRow key={product} label={label} value={mode} options={product === "send" ? sendOptions : exitableOptions}
            status={notConnected ? "Not connected" : mode === "on" ? "On" : product === "send" ? "Off" : "Exit only"}
            detail={notConnected ? `Missing ${missingInvestCredentials.join(", ")}` : mode === "exit-only" ? "Customers with balances can still withdraw, repay or sell." : undefined}
            disabled={pending || review !== null || conflict !== undefined} onChange={(value) => updateProduct(product, value)} />;
        })}
      </section>
      <section className="grid gap-3" aria-labelledby="operator-vaults-heading">
        <h2 id="operator-vaults-heading" className="text-lg font-semibold">Save vaults</h2>
        {entryRows("vaults", catalog.vaults, draft.products.save !== "on")}
      </section>
      <section className="grid gap-3" aria-labelledby="operator-markets-heading">
        <h2 id="operator-markets-heading" className="text-lg font-semibold">Borrow markets</h2>
        {entryRows("markets", catalog.markets, draft.products.borrow !== "on")}
      </section>
      {(orphans.vaults.length > 0 || orphans.markets.length > 0) && <Alert><AlertTitle>No longer in the catalog</AlertTitle><AlertDescription>These IDs will be dropped on the next save: {[...orphans.vaults, ...orphans.markets].join(", ")}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertTitle>{error}</AlertTitle>{conflict !== undefined && <Button variant="outline" size="touch" onClick={reload}>Reload settings</Button>}</Alert>}
      {review === null ? <div><Button size="touch" loading={pending} disabled={conflict !== undefined} onClick={startSave}>Save settings</Button></div> : (
        <section aria-labelledby="operator-review-heading" className="grid gap-3">
          <Alert>
            <AlertTitle id="operator-review-heading">Turn on new entries?</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-2 ps-5">
                {review.items.map((item) => <li key={item.id}><strong>{item.label}</strong> — {item.id === "invest" && missingInvestCredentials.length ? "When connected, customers can buy investments." : item.effect}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2"><Button size="touch" loading={pending} onClick={() => void save(review.draft)}>Turn on</Button><Button variant="outline" size="touch" disabled={pending} onClick={() => setReview(null)}>Cancel</Button></div>
        </section>
      )}
    </div>
  );
}

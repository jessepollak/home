"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { RadioGroup, RadioGroupSegment } from "@/components/ui/radio-group";
import { OPERATOR_SETTINGS_CONTRACT_VERSION } from "@/shared/operator-settings/contract";
import {
  deploymentProductSettings,
  orphanedProductSettingIds,
  resolveProductOffering,
  type CatalogEntry,
  type ProductCatalog,
  type ProductSettings,
} from "@/shared/operator-settings/products";
import { exactCatalogSettings, reviewChanges, saveOutcome, type ProductSettingsEntry, type ReviewItem } from "./product-settings-model";
import { SavedSettingsLine } from "./saved-settings-line";
import { useHydrated } from "./use-hydrated";

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
  const hydrated = useHydrated();
  return (
    <Item variant="outline" className="gap-4">
      <ItemContent>
        <ItemTitle truncate="wrap">{label}</ItemTitle>
        {detail && <ItemDescription lines="wrap">{detail}</ItemDescription>}
        <Badge variant={status === "On" || status === "Enabled" ? "secondary" : "outline"}>{status}</Badge>
      </ItemContent>
      <RadioGroup variant="segmented" aria-label={`${label} mode`} value={value} onValueChange={onChange} disabled={disabled} readOnly={!hydrated} className="w-full shrink-0 sm:w-64">
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<ProductSettingsEntry | null | undefined>(undefined);
  const orphans = orphanedProductSettingIds(entry.settings.value, catalog);
  const baseline = resolveProductOffering(entry.settings.source === "default" ? { kind: "deployment" } : { kind: "saved", value: entry.settings.value }, catalog);
  const savedSettings = entry.settings.source === "default" ? deploymentProductSettings(catalog) : entry.settings.value;
  const updateProduct = (product: keyof ProductSettings["products"], value: string) => {
    setDraft((previous) => ({ ...previous, products: { ...previous.products, [product]: value } }));
    setError(null);
    setMessage("");
  };
  const updateEntry = (key: "vaults" | "markets", id: string, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: { ...previous[key], [id]: value } }));
    setError(null);
    setMessage("");
  };
  const save = async (snapshot: ProductSettings) => {
    if (pending) return;
    setPending(true);
    setError(null);
    setMessage("");
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
        setReviewOpen(false);
        setMessage(outcome.entry.settings.revision === entry.settings.revision ? "No changes to save." : "Product settings saved.");
      } else if (outcome.kind === "conflict") {
        setReviewOpen(false);
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
    const items = reviewChanges(baseline, savedSettings, snapshot, names, catalog);
    setMessage("");
    if (items.some((item) => item.turnsOn)) {
      setReview({ items, draft: snapshot });
      setReviewOpen(true);
    } else void save(snapshot);
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
        status={effective === "enabled" ? "Enabled" : "Reducing only"} value={effective} options={entryOptions} disabled={locked || parentOff || pending || reviewOpen || conflict !== undefined}
        onChange={(value) => updateEntry(kind, id, value)} />
    );
  });
  return (
    <div className="grid gap-8">
      <SavedSettingsLine settings={entry.settings} unsaved="Using deployment values — review and save" />
      <section className="grid gap-3" aria-labelledby="operator-products-heading">
        <h2 id="operator-products-heading" className="text-lg font-semibold">Products</h2>
        {(["save", "borrow", "invest", "send"] as const).map((product) => {
          const mode = draft.products[product];
          const notConnected = product === "invest" && missingInvestCredentials.length > 0;
          const label = product[0].toUpperCase() + product.slice(1);
          return <ModeRow key={product} label={label} value={mode} options={product === "send" ? sendOptions : exitableOptions}
            status={notConnected ? "Not connected" : mode === "on" ? "On" : product === "send" ? "Off" : "Exit only"}
            detail={notConnected ? `Missing ${missingInvestCredentials.join(", ")}` : mode === "exit-only" ? "Customers with balances can still withdraw, repay or sell." : undefined}
            disabled={pending || reviewOpen || conflict !== undefined} onChange={(value) => updateProduct(product, value)} />;
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
      {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
      <div><Button size="touch" loading={pending} disabled={conflict !== undefined || reviewOpen} onClick={startSave}>Save settings</Button></div>
      <Drawer open={reviewOpen} onOpenChange={(open) => { if (!pending) setReviewOpen(open); }}>
        <DrawerContent initialFocus={cancelButton}>
          <DrawerHeader>
            <DrawerTitle>Review changes</DrawerTitle>
            <DrawerDescription>Confirm what changes for customers before saving.</DrawerDescription>
          </DrawerHeader>
          <div className="grid min-h-0 gap-3 overflow-y-auto p-4">
            <ul className="list-disc space-y-2 ps-5">
              {review?.items.map((item) => <li key={item.id}><strong>{item.label}</strong> → {item.state} — {item.id === "invest" && item.turnsOn && missingInvestCredentials.length ? "When connected, customers can buy investments." : item.effect}</li>)}
            </ul>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          </div>
          <DrawerFooter className="flex-row justify-end">
            <Button size="touch" loading={pending} disabled={!review} onClick={() => { if (review) void save(review.draft); }}>Save changes</Button>
            <Button ref={cancelButton} variant="outline" size="touch" disabled={pending} onClick={() => setReviewOpen(false)}>Cancel</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

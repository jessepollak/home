import {
  normalizeProductSettings,
  parseProductSettings,
  productCatalog,
  resolveProductOffering,
  type ProductCatalog,
  type ProductOffering,
  type ProductSettings,
} from "@/shared/operator-settings/products";
import {
  parseOperatorSettingsErrorResponse,
  parseSettingsResponse,
  type SettingsResponse,
} from "@/shared/operator-settings/contract";

export type ProductSettingsEntry = SettingsResponse & { settings: SettingsResponse["settings"] & { value: ProductSettings } };
export type ReviewItem = { id: string; label: string; state: string; effect: string; turnsOn: boolean };

export function settingsEntry(value: unknown): ProductSettingsEntry | null {
  const parsed = parseSettingsResponse(value);
  if (!parsed || parsed.domain !== "products") return null;
  const product = parseProductSettings(parsed.settings.value);
  return product ? { ...parsed, settings: { ...parsed.settings, value: product } } : null;
}

export function exactCatalogSettings(value: ProductSettings, catalog: ProductCatalog = productCatalog()): ProductSettings {
  return normalizeProductSettings({
    products: { ...value.products },
    vaults: Object.fromEntries(catalog.vaults.map(({ id, mode }) => [id, mode === "enabled" ? value.vaults[id] ?? "reducing-only" : "reducing-only"])),
    markets: Object.fromEntries(catalog.markets.map(({ id, mode }) => [id, mode === "enabled" ? value.markets[id] ?? "reducing-only" : "reducing-only"])),
  });
}

const productEffects = {
  save: { on: "Customers can deposit into enabled vaults.", off: "Customers can withdraw but can't deposit." },
  borrow: { on: "Customers can open new debt in enabled markets.", off: "Customers can repay but can't open new debt." },
  invest: { on: "Customers can buy investments.", off: "Customers can sell but can't buy investments." },
  send: { on: "Customers can send funds.", off: "Customers can't send funds." },
} as const;
const entryEffects = {
  vaults: { on: "Customers can deposit into this vault.", off: "Customers can withdraw but can't deposit into this vault." },
  markets: { on: "Customers can borrow in this market.", off: "Customers can repay but can't borrow in this market." },
} as const;

export function reviewChanges(before: ProductOffering, saved: ProductSettings, next: ProductSettings, labels: { vaults: Record<string, string>; markets: Record<string, string> }, catalog: ProductCatalog = productCatalog()): ReviewItem[] {
  const stored = exactCatalogSettings(saved, catalog);
  const draft = exactCatalogSettings(next, catalog);
  const after = resolveProductOffering({ kind: "saved", value: draft }, catalog);
  const items: ReviewItem[] = [];
  for (const [id, label] of [["save", "Save"], ["borrow", "Borrow"], ["invest", "Invest"], ["send", "Send"]] as const) {
    const mode = after.products[id];
    if (before.products[id] === mode) continue;
    const turnsOn = mode === "on";
    items.push({ id, label, state: turnsOn ? "On" : mode === "off" ? "Off" : "Exit only", effect: productEffects[id][turnsOn ? "on" : "off"], turnsOn });
  }
  for (const [key, entries, names] of [["vaults", catalog.vaults, labels.vaults], ["markets", catalog.markets, labels.markets]] as const) {
    const product = key === "vaults" ? "Save" : "Borrow";
    for (const { id } of entries) {
      if (before[key][id] === after[key][id]) {
        if (stored[key][id] !== draft[key][id]) {
          items.push({ id, label: names[id] ?? id, state: draft[key][id] === "enabled" ? "Enabled" : "Reducing only", effect: `Applies when ${product} is on.`, turnsOn: false });
        }
        continue;
      }
      const turnsOn = after[key][id] === "enabled";
      items.push({ id, label: names[id] ?? id, state: turnsOn ? "Enabled" : "Reducing only", effect: entryEffects[key][turnsOn ? "on" : "off"], turnsOn });
    }
  }
  return items;
}

export type SaveOutcome =
  | { kind: "saved"; entry: ProductSettingsEntry }
  | { kind: "conflict"; current: ProductSettingsEntry | null; message: string }
  | { kind: "error"; message: string };

export function saveOutcome(status: number, body: unknown): SaveOutcome {
  if (status >= 200 && status < 300) {
    const entry = settingsEntry(body);
    return entry ? { kind: "saved", entry } : { kind: "error", message: "Could not read saved settings. Reload this page." };
  }
  const parsed = parseOperatorSettingsErrorResponse(body);
  if (status === 409 && parsed?.error.code === "SETTINGS_CONFLICT") {
    return { kind: "conflict", current: settingsEntry(parsed.current), message: "Settings changed since you opened this page." };
  }
  if (status === 409 && parsed?.error.code === "OPERATOR_CHANGED") return { kind: "error", message: "A different operator is signed in. Reload this page before saving." };
  if (status === 400) return { kind: "error", message: "These settings could not be saved. Check the choices and try again." };
  if (status === 403) return { kind: "error", message: "You no longer have access to change settings. Sign in as an operator." };
  if (status === 503) return { kind: "error", message: "Settings are unavailable. Try again shortly." };
  return { kind: "error", message: "Could not save settings. Try again." };
}

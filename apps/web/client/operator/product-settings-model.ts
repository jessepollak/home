import {
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
export type ReviewItem = { id: string; label: string; effect: string };

export function settingsEntry(value: unknown): ProductSettingsEntry | null {
  const parsed = parseSettingsResponse(value);
  if (!parsed || parsed.domain !== "products") return null;
  const product = parseProductSettings(parsed.settings.value);
  return product ? { ...parsed, settings: { ...parsed.settings, value: product } } : null;
}

export function exactCatalogSettings(value: ProductSettings, catalog: ProductCatalog = productCatalog()): ProductSettings {
  return {
    products: { ...value.products },
    vaults: Object.fromEntries(catalog.vaults.map(({ id, mode }) => [id, mode === "enabled" ? value.vaults[id] ?? "reducing-only" : "reducing-only"])),
    markets: Object.fromEntries(catalog.markets.map(({ id, mode }) => [id, mode === "enabled" ? value.markets[id] ?? "reducing-only" : "reducing-only"])),
  };
}

export function reviewEnables(before: ProductOffering, next: ProductSettings, labels: { vaults: Record<string, string>; markets: Record<string, string> }, catalog: ProductCatalog = productCatalog()): ReviewItem[] {
  const after = resolveProductOffering({ kind: "saved", value: exactCatalogSettings(next, catalog) }, catalog);
  const items: ReviewItem[] = [];
  const effects: Record<string, string> = {
    save: "Customers can deposit into enabled vaults.",
    borrow: "Customers can open new debt in enabled markets.",
    invest: "Customers can buy investments.",
    send: "Customers can send funds.",
  };
  for (const [id, label] of [["save", "Save"], ["borrow", "Borrow"], ["invest", "Invest"], ["send", "Send"]] as const) {
    if (before.products[id] !== "on" && after.products[id] === "on") items.push({ id, label, effect: effects[id] });
  }
  for (const [key, entries, names] of [["vaults", catalog.vaults, labels.vaults], ["markets", catalog.markets, labels.markets]] as const) {
    for (const { id } of entries) {
      if (before[key][id] !== "enabled" && after[key][id] === "enabled") {
        items.push({ id, label: names[id] ?? id, effect: key === "vaults" ? "Customers can deposit into this vault." : "Customers can borrow in this market." });
      }
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

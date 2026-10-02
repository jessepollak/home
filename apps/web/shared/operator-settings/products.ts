import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";

export type ExitableProductMode = "on" | "exit-only";
export type SwitchProductMode = "on" | "off";
export type CatalogEntryMode = "enabled" | "reducing-only";

export const EXITABLE_PRODUCTS = ["save", "borrow", "invest"] as const;
export type ExitableProduct = (typeof EXITABLE_PRODUCTS)[number];

export type ProductModes = Record<ExitableProduct, ExitableProductMode> & { send: SwitchProductMode };

export type ProductSettings = {
  products: ProductModes;
  vaults: Record<string, CatalogEntryMode>;
  markets: Record<string, CatalogEntryMode>;
};

export type ProductOfferingSource = "deployment" | "saved" | "unavailable";

export type ProductOffering = {
  source: ProductOfferingSource;
  products: ProductModes;
  vaults: Record<string, CatalogEntryMode>;
  markets: Record<string, CatalogEntryMode>;
};

export type CatalogEntry = { id: string; mode: CatalogEntryMode };
export type ProductCatalog = { vaults: readonly CatalogEntry[]; markets: readonly CatalogEntry[] };

export const PRODUCT_SETTINGS_MAX_ENTRIES = 64;
const VAULT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MARKET_ID = /^0x[0-9a-f]{64}$/;

export function productCatalog(): ProductCatalog {
  return {
    vaults: VERIFIED_SAVE_VAULTS.flatMap((vault) => vault.capabilities.save ? [{ id: vault.id, mode: vault.capabilities.save }] : []),
    markets: BORROW_MARKETS.map((market) => ({ id: market.marketId.toLowerCase(), mode: market.availability })),
  };
}

export function deploymentProductSettings(catalog: ProductCatalog = productCatalog()): ProductSettings {
  return {
    products: { save: "on", borrow: "on", invest: "on", send: "on" },
    vaults: Object.fromEntries(catalog.vaults.map((entry) => [entry.id, entry.mode])),
    markets: Object.fromEntries(catalog.markets.map((entry) => [entry.id, entry.mode])),
  };
}

export function parseProductSettings(value: unknown): ProductSettings | null {
  if (!isObject(value) || !exactKeys(value, ["products", "vaults", "markets"])) return null;
  const products = parseProductModes(value.products);
  const vaults = parseEntryModes(value.vaults, VAULT_ID);
  const markets = parseEntryModes(value.markets, MARKET_ID);
  return products && vaults && markets ? { products, vaults, markets } : null;
}

export function productSettingsMatchCatalog(value: ProductSettings, catalog: ProductCatalog = productCatalog()): boolean {
  return sameIds(value.vaults, catalog.vaults) && sameIds(value.markets, catalog.markets);
}

export const FAIL_CLOSED_PRODUCT_MODES: ProductModes = { save: "exit-only", borrow: "exit-only", invest: "exit-only", send: "off" };

export function resolveProductOffering(
  input: { kind: "deployment" } | { kind: "saved"; value: ProductSettings } | { kind: "unavailable" },
  catalog: ProductCatalog = productCatalog(),
): ProductOffering {
  const products = input.kind === "unavailable" ? FAIL_CLOSED_PRODUCT_MODES
    : input.kind === "saved" ? input.value.products : deploymentProductSettings(catalog).products;
  const narrow = (entries: readonly CatalogEntry[], saved: Record<string, CatalogEntryMode> | undefined, productMode: ExitableProductMode) =>
    Object.fromEntries(entries.map((entry): [string, CatalogEntryMode] => {
      if (input.kind === "unavailable" || productMode !== "on" || entry.mode !== "enabled") return [entry.id, "reducing-only"];
      if (!saved) return [entry.id, "enabled"];
      return [entry.id, Object.hasOwn(saved, entry.id) && saved[entry.id] === "enabled" ? "enabled" : "reducing-only"];
    }));
  const saved = input.kind === "saved" ? input.value : undefined;
  return {
    source: input.kind,
    products: { ...products },
    vaults: narrow(catalog.vaults, saved?.vaults, products.save),
    markets: narrow(catalog.markets, saved?.markets, products.borrow),
  };
}

export function orphanedProductSettingIds(value: ProductSettings, catalog: ProductCatalog = productCatalog()): { vaults: string[]; markets: string[] } {
  const known = (entries: readonly CatalogEntry[]) => new Set(entries.map((entry) => entry.id));
  const vaults = known(catalog.vaults);
  const markets = known(catalog.markets);
  return {
    vaults: Object.keys(value.vaults).filter((id) => !vaults.has(id)),
    markets: Object.keys(value.markets).filter((id) => !markets.has(id)),
  };
}

export function offeredVaultMode(offering: ProductOffering, vaultId: string): CatalogEntryMode {
  return Object.hasOwn(offering.vaults, vaultId) && offering.vaults[vaultId] === "enabled" ? "enabled" : "reducing-only";
}

export function offeredMarketMode(offering: ProductOffering, marketId: string): CatalogEntryMode {
  const id = marketId.toLowerCase();
  return Object.hasOwn(offering.markets, id) && offering.markets[id] === "enabled" ? "enabled" : "reducing-only";
}

function parseProductModes(value: unknown): ProductModes | null {
  if (!isObject(value) || !exactKeys(value, [...EXITABLE_PRODUCTS, "send"])) return null;
  const save = parseExitableProductMode(value.save);
  const borrow = parseExitableProductMode(value.borrow);
  const invest = parseExitableProductMode(value.invest);
  if (!save || !borrow || !invest) return null;
  if (value.send !== "on" && value.send !== "off") return null;
  return { save, borrow, invest, send: value.send };
}

function parseExitableProductMode(value: unknown): ExitableProductMode | null {
  return value === "on" || value === "exit-only" ? value : null;
}

function parseEntryModes(value: unknown, pattern: RegExp): Record<string, CatalogEntryMode> | null {
  if (!isObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > PRODUCT_SETTINGS_MAX_ENTRIES) return null;
  const parsed: Record<string, CatalogEntryMode> = {};
  for (const [id, mode] of entries) {
    if (!pattern.test(id) || (mode !== "enabled" && mode !== "reducing-only")) return null;
    parsed[id] = mode;
  }
  return parsed;
}

function sameIds(value: Record<string, CatalogEntryMode>, entries: readonly CatalogEntry[]): boolean {
  const keys = Object.keys(value);
  return keys.length === entries.length && entries.every((entry) => Object.hasOwn(value, entry.id));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

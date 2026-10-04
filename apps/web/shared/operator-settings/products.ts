import * as z from "zod/mini";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";

const exitableProductModeSchema = z.enum(["on", "exit-only"]);
const switchProductModeSchema = z.enum(["on", "off"]);
const catalogEntryModeSchema = z.enum(["enabled", "reducing-only"]);

export type ExitableProductMode = z.output<typeof exitableProductModeSchema>;
export type CatalogEntryMode = z.output<typeof catalogEntryModeSchema>;

export type ProductModes = z.output<typeof productModesSchema>;
export type ProductSettings = z.output<typeof productSettingsSchema>;

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

const plainObjectSchema = z.custom<Record<string, unknown>>((value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype && !Object.hasOwn(value, "__proto__"));
const productModesSchema = z.pipe(plainObjectSchema, z.strictObject({
  save: exitableProductModeSchema,
  borrow: exitableProductModeSchema,
  invest: exitableProductModeSchema,
  send: switchProductModeSchema,
}));
const entryModesSchema = (pattern: RegExp) => z.pipe(plainObjectSchema,
  z.record(z.string().check(z.regex(pattern)), catalogEntryModeSchema)
    .check(z.refine((entries) => Object.keys(entries).length <= PRODUCT_SETTINGS_MAX_ENTRIES)));
const productSettingsSchema = z.pipe(plainObjectSchema, z.strictObject({
  products: productModesSchema,
  vaults: entryModesSchema(VAULT_ID),
  markets: entryModesSchema(MARKET_ID),
}));

export function parseProductSettings(value: unknown): ProductSettings | null {
  const result = productSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
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

function sameIds(value: Record<string, CatalogEntryMode>, entries: readonly CatalogEntry[]): boolean {
  const keys = Object.keys(value);
  return keys.length === entries.length && entries.every((entry) => Object.hasOwn(value, entry.id));
}

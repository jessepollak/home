import { describe, expect, test } from "bun:test";
import {
  deploymentProductSettings, offeredMarketMode, offeredVaultMode, orphanedProductSettingIds,
  parseProductSettings, productSettingsMatchCatalog, resolveProductOffering,
  PRODUCT_SETTINGS_MAX_ENTRIES, type ProductCatalog,
} from "./products";

const market = `0x${"a".repeat(64)}`;
const legacy = `0x${"b".repeat(64)}`;
const catalog: ProductCatalog = {
  vaults: [{ id: "save-1", mode: "enabled" }, { id: "save-2", mode: "reducing-only" }],
  markets: [{ id: market, mode: "enabled" }, { id: legacy, mode: "reducing-only" }],
};

describe("product offering resolver", () => {
  test("deployment preserves catalog ceilings and saved settings only narrow entries", () => {
    const deployment = resolveProductOffering({ kind: "deployment" }, catalog);
    expect(deployment.vaults).toEqual({ "save-1": "enabled", "save-2": "reducing-only" });
    const saved = resolveProductOffering({ kind: "saved", value: {
      products: { save: "on", borrow: "on", invest: "on", send: "on" },
      vaults: { "save-1": "reducing-only", "save-2": "enabled" },
      markets: { [market]: "reducing-only", [legacy]: "enabled" },
    } }, catalog);
    expect(saved.vaults).toEqual({ "save-1": "reducing-only", "save-2": "reducing-only" });
    expect(saved.markets).toEqual({ [market]: "reducing-only", [legacy]: "reducing-only" });
    expect(offeredVaultMode(saved, "absent")).toBe("reducing-only");
    expect(offeredMarketMode(saved, market.toUpperCase().replace("0X", "0x"))).toBe("reducing-only");
  });
  test("exit-only products cascade, missing catalog ids fail closed and orphan ids stay visible", () => {
    const settings = { ...deploymentProductSettings(catalog), products: { save: "exit-only" as const, borrow: "exit-only" as const, invest: "exit-only" as const, send: "off" as const },
      vaults: { "save-1": "enabled" as const, orphan: "enabled" as const }, markets: { [legacy]: "enabled" as const } };
    const saved = resolveProductOffering({ kind: "saved", value: settings }, catalog);
    expect(saved.vaults["save-1"]).toBe("reducing-only");
    expect(saved.markets[market]).toBe("reducing-only");
    expect(orphanedProductSettingIds(settings, catalog)).toEqual({ vaults: ["orphan"], markets: [] });
    expect(productSettingsMatchCatalog(settings, catalog)).toBe(false);
    const missing = resolveProductOffering({ kind: "saved", value: { ...settings, products: { save: "on", borrow: "on", invest: "on", send: "on" } } }, catalog);
    expect(missing.vaults["save-2"]).toBe("reducing-only");
    expect(missing.markets[market]).toBe("reducing-only");
    expect(resolveProductOffering({ kind: "unavailable" }, catalog)).toMatchObject({ products: { save: "exit-only", borrow: "exit-only", invest: "exit-only", send: "off" }, vaults: { "save-1": "reducing-only" }, markets: { [market]: "reducing-only" } });
  });
  test("strict parser rejects unknown keys, invalid ids and excessive entries; writes require exact catalog ids", () => {
    const defaults = deploymentProductSettings(catalog);
    expect(productSettingsMatchCatalog(defaults, catalog)).toBe(true);
    expect(parseProductSettings(defaults)).toEqual(defaults);
    expect(parseProductSettings({ ...defaults, surprise: true })).toBeNull();
    expect(parseProductSettings({ ...defaults, products: { ...defaults.products, unknown: "on" } })).toBeNull();
    expect(parseProductSettings({ ...defaults, vaults: { "BAD ID": "enabled" } })).toBeNull();
    expect(parseProductSettings({ ...defaults, markets: { "0xBAD": "enabled" } })).toBeNull();
    expect(parseProductSettings({ ...defaults, vaults: Object.fromEntries(Array.from({ length: PRODUCT_SETTINGS_MAX_ENTRIES + 1 }, (_, index) => [`vault-${index}`, "enabled"])) })).toBeNull();
    expect(productSettingsMatchCatalog({ ...defaults, markets: { [market]: "enabled" } }, catalog)).toBe(false);
    expect(productSettingsMatchCatalog({ ...defaults, vaults: { ...defaults.vaults, orphan: "enabled" } }, catalog)).toBe(false);
  });
});

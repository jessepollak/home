import { expect, test } from "bun:test";
import {
  deploymentProductSettings,
  resolveProductOffering,
  type ProductCatalog,
} from "@/shared/operator-settings/products";
import { exactCatalogSettings, reviewEnables, saveOutcome } from "./product-settings-model";

const catalog: ProductCatalog = {
  vaults: [{ id: "vault-a", mode: "enabled" }, { id: "vault-locked", mode: "reducing-only" }],
  markets: [{ id: `0x${"1".repeat(64)}`, mode: "enabled" }],
};
const names = { vaults: { "vault-a": "Vault A" }, markets: { [catalog.markets[0].id]: "BTC collateral" } };
const defaults = deploymentProductSettings(catalog);

function entry(value = defaults, revision = 0) {
  return { version: 1 as const, domain: "products", settings: { value, revision, source: revision ? "stored" as const : "default" as const, updatedAt: null, updatedBy: null } };
}

test("review lists newly available product and catalog entries, never pauses or already-on entries", () => {
  const paused = { ...defaults, products: { save: "exit-only" as const, borrow: "exit-only" as const, invest: "exit-only" as const, send: "off" as const } };
  const before = resolveProductOffering({ kind: "saved", value: paused }, catalog);
  expect(reviewEnables(before, defaults, names, catalog).map(({ label }) => label)).toEqual(["Save", "Borrow", "Invest", "Send", "Vault A", "BTC collateral"]);
  expect(reviewEnables(resolveProductOffering({ kind: "deployment" }, catalog), paused, names, catalog)).toEqual([]);
  expect(reviewEnables(resolveProductOffering({ kind: "deployment" }, catalog), defaults, names, catalog)).toEqual([]);
});

test("enabling a child behind an exit-only parent does not request review until parent goes on", () => {
  const paused = { ...defaults, products: { ...defaults.products, save: "exit-only" as const }, vaults: { ...defaults.vaults, "vault-a": "reducing-only" as const } };
  const next = { ...paused, vaults: { ...paused.vaults, "vault-a": "enabled" as const } };
  const before = resolveProductOffering({ kind: "saved", value: paused }, catalog);
  expect(reviewEnables(before, next, names, catalog)).toEqual([]);
  expect(reviewEnables(before, { ...next, products: defaults.products }, names, catalog).map(({ label }) => label)).toEqual(["Save", "Vault A"]);
});

test("writes exactly catalog IDs; drops orphans and does not widen code-locked or missing entries", () => {
  const value = { ...defaults, vaults: { "vault-a": "enabled" as const, "vault-locked": "enabled" as const, orphan: "enabled" as const }, markets: { orphan: "enabled" as const } };
  expect(exactCatalogSettings(value, catalog)).toEqual({
    products: defaults.products,
    vaults: { "vault-a": "enabled", "vault-locked": "reducing-only" },
    markets: { [catalog.markets[0].id]: "reducing-only" },
  });
});

test("conflict preserves validated current row for explicit reload; errors give recovery messages", () => {
  const current = entry({ ...defaults, products: { ...defaults.products, save: "exit-only" } }, 2);
  expect(saveOutcome(409, { error: { code: "SETTINGS_CONFLICT" }, current })).toEqual({
    kind: "conflict", current, message: "Settings changed since you opened this page.",
  });
  expect(saveOutcome(409, { error: { code: "SETTINGS_CONFLICT" }, current: { ...current, settings: { ...current.settings, value: "bad" } } })).toMatchObject({ kind: "conflict", current: null });
  for (const status of [400, 403, 503]) expect(saveOutcome(status, { error: { code: "INVALID_REQUEST" } })).toMatchObject({ kind: "error", message: expect.any(String) });
  expect(saveOutcome(409, { error: { code: "OPERATOR_CHANGED" } })).toEqual({ kind: "error", message: "A different operator is signed in. Reload this page before saving." });
  expect(saveOutcome(200, current)).toMatchObject({ kind: "saved", entry: current });
});

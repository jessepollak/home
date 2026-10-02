import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { deploymentProductSettings, type ProductCatalog } from "@/shared/operator-settings/products";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { ProductSettingsEditor } from "./product-settings-editor";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const appRouter = { bfcacheId: "test", back: () => {}, forward: () => {}, push: () => {}, refresh: () => {}, replace: () => {}, prefetch: () => {} };
const operator = "0x1111111111111111111111111111111111111111" as const;

const catalog: ProductCatalog = {
  vaults: [{ id: "vault-a", mode: "enabled" }],
  markets: [{ id: `0x${"1".repeat(64)}`, mode: "enabled" }],
};
const defaults = deploymentProductSettings(catalog);
const initial = {
  version: 1 as const,
  domain: "products",
  settings: {
    value: { ...defaults, products: { ...defaults.products, save: "exit-only" as const, borrow: "exit-only" as const }, vaults: { "vault-a": "reducing-only" as const } },
    revision: 3,
    source: "stored" as const,
    updatedAt: null,
    updatedBy: null,
  },
};

test("review freezes all modes and saves the reviewed snapshot, then cancel restores editing", async () => {
  const requests: unknown[] = [];
  globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ ...initial, settings: { ...initial.settings, value: defaults, revision: 4 } });
  }, { preconnect: originalFetch.preconnect });
  const view = render(<AppRouterContext.Provider value={appRouter}>
    <ProductSettingsEditor initialEntry={initial} catalog={catalog} names={{ vaults: { "vault-a": "Vault A" }, markets: { [catalog.markets[0].id]: "Market A" } }} missingInvestCredentials={[]} operator={operator} />
  </AppRouterContext.Provider>);
  const mode = (name: string) => within(view.getByRole("radiogroup", { name: `${name} mode` }));
  fireEvent.click(mode("Save").getByRole("radio", { name: "On" }));
  fireEvent.click(mode("Vault A").getByRole("radio", { name: "Enabled" }));
  fireEvent.click(view.getByRole("button", { name: "Save settings" }));
  expect(view.getByRole("region", { name: "Turn on new entries?" }).textContent).toContain("Vault A");
  for (const name of ["Save", "Borrow", "Invest", "Send", "Vault A", "Market A"]) {
    expect(view.getByRole("radiogroup", { name: `${name} mode` }).getAttribute("aria-disabled")).toBe("true");
  }
  fireEvent.click(mode("Borrow").getByRole("radio", { name: "On" }));
  expect(mode("Borrow").getByRole("radio", { name: "Exit only" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(view.getByRole("radiogroup", { name: "Borrow mode" }).getAttribute("aria-disabled")).not.toBe("true");
  fireEvent.click(view.getByRole("button", { name: "Save settings" }));
  fireEvent.click(view.getByRole("button", { name: "Turn on" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({ version: 1, expectedRevision: 3, value: {
    products: { ...initial.settings.value.products, save: "on" },
    vaults: { "vault-a": "enabled" },
    markets: defaults.markets,
  }, operator });
});

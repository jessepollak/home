import "@/client/account/dom-test-harness";

import { afterEach, expect, mock, test } from "bun:test";
import { useContext, type ReactNode } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { FundingOfferingView } from "@/shared/funding/offering";

const addressA = "0x1111111111111111111111111111111111111111" as const;
const addressB = "0x2222222222222222222222222222222222222222" as const;
let address: `0x${string}` = addressA;
const view: FundingOfferingView = {
  source: "saved", revision: 4, updatedAt: null, updatedBy: null,
  corridors: [{
    key: "coinbase:US:onramp", providerId: "coinbase", providerName: "Coinbase", region: "US", regionName: "United States",
    direction: "onramp", currency: "USD", paymentMethods: ["Apple Pay"], connection: "connected", missingEnv: [], credentials: [],
    selected: true, offered: true, confirmedBy: null, newSinceSave: false,
  }],
  providers: [], legacy: [], unknownSaved: [],
};

const actualOperatorPage = await import("@/server/operator/page");
await mock.module("@/server/operator/page", () => ({
  ...actualOperatorPage,
  readOperatorPageDecision: async () => ({ kind: "operator", address }),
}));
const actualOffering = await import("@/server/funding/offering");
await mock.module("@/server/funding/offering", () => ({ ...actualOffering, readFundingOfferingView: async () => view }));
const actualNavigation = await import("next/navigation");
await mock.module("next/navigation", () => ({
  ...actualNavigation,
  useRouter: () => useContext(AppRouterContext),
}));

const { default: FundingSettingsPage } = await import("./page");
const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const nativeFetch = globalThis.fetch;
const router: AppRouterInstance = {
  bfcacheId: "test", back() {}, forward() {}, prefetch() {}, push() {}, replace() {}, refresh() {},
};

afterEach(() => {
  cleanup();
  address = addressA;
  globalThis.fetch = nativeFetch;
});

test("a new authorized operator remounts the panel and loses the prior operator's draft and save state", async () => {
  globalThis.fetch = Object.assign(async () => Response.json({ error: { code: "SETTINGS_CONFLICT" } }, { status: 409 }), { preconnect: nativeFetch.preconnect });
  const wrap = (element: ReactNode) => <AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>;
  const page = render(wrap(await FundingSettingsPage()));
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await waitFor(() => expect(page.getByText("Someone else changed these settings")).toBeTruthy());
  page.rerender(wrap(await FundingSettingsPage()));
  expect(page.getByText("Someone else changed these settings")).toBeTruthy();

  address = addressB;
  page.rerender(wrap(await FundingSettingsPage()));
  expect(page.queryByText("Someone else changed these settings")).toBeNull();
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("true");
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
});

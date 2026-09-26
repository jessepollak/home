import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { FundingBinding } from "@/shared/funding/contracts/providers";
import { MoneyModal } from "@/client/money-modal";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { FundingOrderFlow } = await import("./order-flow");

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

test("selecting a payment method does not request a quote until Review quote", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  const binding: FundingBinding = {
    direction: "onramp", providerId: "ripio", displayName: "Ripio", region: "CO", assetId: "base:wcop", assetSymbol: "wCOP", assetDecimals: 18,
    currency: "COP", paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }, { id: "breb", label: "Bre-B" }],
    quotes: true, customerSetup: null,
  };
  render(
    <MoneyModal open labelledBy="deposit-title" onCancel={() => {}} onClose={() => {}}>
      <FundingOrderFlow
      binding={binding}
      fetchAccountResource={async (path, options) => {
        requests.push({ path, body: options?.body });
        if (path === "/api/funding/quotes") return {
          quoteToken: "signed-token",
          quote: { fiatAmount: "100", tokenAmountAtomic: "100000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
        };
        throw new Error(`Unexpected request: ${path}`);
      }}
      titleId="deposit-title"
      onBack={() => {}}
      onClose={() => {}}
      onOpenRedirect={() => {}}
      />
    </MoneyModal>,
  );
  const group = page().getByRole("radiogroup", { name: "Payment method" });
  expect(group).toBeTruthy();
  expect(page().getByRole("radio", { name: "Bank transfer" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(page().getByText("Bre-B"));
  expect(page().getByRole("radio", { name: "Bre-B" }).getAttribute("aria-checked")).toBe("true");
  expect(requests).toEqual([]);
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "100" } });
  expect(requests).toEqual([]);
  fireEvent.click(page().getByRole("button", { name: "Review quote" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ path: "/api/funding/quotes", body: { paymentMethod: "breb", fiatAmount: "100" } });
  await page().findByRole("heading", { name: "Review quote" });
  expect(page().queryByRole("radiogroup", { name: "Payment method" })).toBeNull();
});

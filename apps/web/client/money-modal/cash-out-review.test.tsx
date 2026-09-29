import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { CashoutQuote } from "@/shared/funding/cash-out-quote";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { cleanup, render, fireEvent } = await import("@testing-library/react");
const { CashOutReview } = await import("./cash-out-review");
afterEach(cleanup);

const action: PreparedMoneyAction = {
  id: "review-test", kind: "cash-out", title: "Cash out", calls: [], warnings: [],
  createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2099-09-01T00:00:00.000Z",
  owner: { subject: "test", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  amounts: [{ assetId: "base:usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000", direction: "spend" }],
};
const quote: CashoutQuote = {
  fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null }, rate: null,
  receive: { amount: "50", currency: "USD", approximate: true }, arrival: { source: "observed", kind: "within", seconds: 3600 },
};
function review(next: CashoutQuote = quote, nextAction = action) {
  return render(<CashOutReview action={nextAction} amount="$50.00" quote={next} providerName="Peer" platform="cashapp" platformLabel="Cash App" canonicalHandle="alice" onEdit={() => {}} />);
}
function facts(element: HTMLElement) {
  return Array.from(element.querySelectorAll("dl > div"), (row) => ({
    label: row.querySelector("dt")?.textContent, value: row.querySelector("dd")?.textContent,
  }));
}

describe("cash-out review", () => {
  test("orders essential facts, leaves context in Details, and does not duplicate the USDC network fee", () => {
    const view = review({ ...quote, rate: { from: "USDC", to: "GBP", value: "0.741234" },
      fees: { provider: { amount: "0", currency: "USD" }, network: { amount: "0.25", currency: "USD" }, operator: { amount: "0.50", currency: "USD" } } },
    { ...action, networkFee: { payment: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "20000", decimals: 6 } });
    expect(facts(view.container).map((row) => row.label)).toEqual(["You send", "Peer fee", "Network fee", "Provider network fee", "Service fee", "Rate", "You receive", "Arrives"]);
    expect(facts(view.container)).toContainEqual({ label: "Peer fee", value: "None" });
    expect(facts(view.container)).toContainEqual({ label: "Rate", value: "1 USDC = 0.7412 GBP" });
    expect(view.getByText("≈ $50.00 to Cash App")).toBeTruthy();
    expect(view.getByText("Usually within 1 hour")).toBeTruthy();
    expect(view.queryByText("Provider", { exact: true })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: /Details/ }));
    expect(facts(view.container).map((row) => row.label).slice(-3)).toEqual(["From", "Provider", "Network"]);
  });
  test("unknown arrival invents no delivery time, and absent rates/fees remain explicit", () => {
    const view = review({ ...quote, fees: { provider: null, network: null, operator: null }, arrival: { source: "unknown" } });
    expect(facts(view.container)).toContainEqual({ label: "Peer fee", value: "Not quoted" });
    expect(facts(view.container)).toContainEqual({ label: "Arrives", value: "Arrival time varies" });
    expect(facts(view.container).some((row) => row.label === "Rate" || row.label === "Service fee")).toBe(false);
    expect(view.queryByText("hour", { exact: false })).toBeNull();
  });
  test("renders token-denominated fees without the fiat formatter", () => {
    const view = review({ ...quote, fees: { provider: { amount: "0.5", currency: "USDC" }, network: { amount: "0.02", currency: "USDC" }, operator: null } });
    expect(facts(view.container)).toContainEqual({ label: "Peer fee", value: "0.50 USDC" });
    expect(facts(view.container)).toContainEqual({ label: "Network fee", value: "0.02 USDC" });
  });
});

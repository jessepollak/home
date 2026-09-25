import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { afterEach, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { cleanup, render } = await import("@testing-library/react");
const { MoneyConfirmSummary } = await import("./confirm-summary");

const action: PreparedMoneyAction = {
  id: "fee-review", kind: "send", title: "Send USDC", calls: [], amounts: [], warnings: [],
  owner: { subject: "subject", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  createdAt: "2026-09-23T00:00:00.000Z", expiresAt: "2099-09-23T00:00:00.000Z",
  networkFee: { payment: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "20000", decimals: 6 },
};

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test("review shows the maximum network fee in USDC and USD", () => {
  render(<MoneyConfirmSummary amount="$1.00" lead="Send USDC" rows={[]} action={action} />);
  expect(page().getByText("Network fee")).toBeTruthy();
  expect(page().getByText("Up to 0.02 USDC · ≈ $0.02")).toBeTruthy();
});

test("native and disabled fees leave review without a USDC fee row", () => {
  const view = render(<MoneyConfirmSummary amount="$1.00" lead="Send USDC" rows={[]} action={{ ...action, networkFee: { payment: "native" } }} />);
  expect(page().queryByText("Network fee")).toBeNull();
  view.rerender(<MoneyConfirmSummary amount="$1.00" lead="Send USDC" rows={[]} action={{ ...action, networkFee: undefined }} />);
  expect(page().queryByText("Network fee")).toBeNull();
});

test("review converts the fee using a fresh presentation FX quote", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    version: 1, provider: "codex", fetchedAt: new Date().toISOString(), markets: {},
    fx: [{ quoteCurrency: "EUR", quoteUnitsPerUsd: { atoms: "9", scale: 1 }, status: "fresh" }],
  }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  try {
    render(<PresentationRegionProvider regionId="DE"><MoneyConfirmSummary amount="$1.00" lead="Send USDC" rows={[]} action={action} /></PresentationRegionProvider>);
    expect(await page().findByText("Up to 0.02 USDC · ≈ 0,02 €")).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

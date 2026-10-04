import { expect, test } from "bun:test";
import { FUNDING_ORDER_VERSION, isFundingOrderSummary, readFundingOrder, readFundingOrderResponse, type FundingOrderSummary } from "./order";
import { FUNDING_ORDER_RESOLUTION_VERSION, readResolveFundingOrderResponse } from "./order-resolution";

const fullOrder = {
  id: "order-1", providerId: "provider-1", region: "AR", assetId: "base:wars",
  paymentMethod: "bank_transfer", state: "received", fiatAmount: "1",
  quote: {
    providerQuoteId: "provider-quote", fiatAmount: "1", tokenAmountAtomic: "100",
    fees: [{ label: "Provider", amount: "0.01", currency: "ARS" }], feesKnown: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  quoteToken: "signed-quote", sandbox: false, expectedTokenAmountAtomic: "100",
  fees: [{ label: "Provider", amount: "0.01", currency: "ARS" }], expiresAt: null,
  providerStatus: "COMPLETED", instructions: null, transactionHash: `0x${"aB".repeat(32)}`,
  createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z",
} satisfies FundingOrderSummary;

function response<T>(order: T) {
  return { version: FUNDING_ORDER_RESOLUTION_VERSION, order };
}

test("accepts a full order through the summary, order reader and resolution reader", () => {
  expect(isFundingOrderSummary(fullOrder)).toBe(true);
  expect(readFundingOrder(response(fullOrder))).toBe(fullOrder);
  expect(readResolveFundingOrderResponse(response(fullOrder))).toEqual(response(fullOrder));
});

test("accepts minimal legacy orders, nullable fields, zero atomic amounts and string fees", () => {
  const minimal = { id: "id", providerId: "provider", state: "pending", fiatAmount: "0", providerStatus: null, instructions: null };
  expect(isFundingOrderSummary(minimal)).toBe(true);
  expect(isFundingOrderSummary({ ...fullOrder, expectedTokenAmountAtomic: null, transactionHash: null, expiresAt: "2099-01-01" })).toBe(true);
  expect(isFundingOrderSummary({ ...fullOrder, expectedTokenAmountAtomic: "0" })).toBe(true);
  expect(isFundingOrderSummary({ ...fullOrder, fees: [{ label: "Fee", amount: "provider-formatted", currency: "ARS" }] })).toBe(true);
});

test.each([
  ["id", { id: null }],
  ["providerId", { providerId: 1 }],
  ["region", { region: 7 }],
  ["assetId", { assetId: 123 }],
  ["paymentMethod", { paymentMethod: 5 }],
  ["state", { state: {} }],
  ["fiatAmount", { fiatAmount: "1.2.3" }],
  ["quote", { quote: {} }],
  ["null quote", { quote: null }],
  ["quoteToken", { quoteToken: null }],
  ["sandbox", { sandbox: "false" }],
  ["expectedTokenAmountAtomic", { expectedTokenAmountAtomic: 100 }],
  ["fees", { fees: "oops" }],
  ["null fees", { fees: null }],
  ["fee label", { fees: [{ label: 1, amount: "0.01", currency: "ARS" }] }],
  ["fee amount", { fees: [{ label: "Fee", amount: 1, currency: "ARS" }] }],
  ["fee currency", { fees: [{ label: "Fee", amount: "0.01", currency: null }] }],
  ["null fee", { fees: [null] }],
  ["expiresAt", { expiresAt: false }],
  ["providerStatus", { providerStatus: undefined }],
  ["instructions", { instructions: {} }],
  ["transactionHash", { transactionHash: `0x${"g".repeat(64)}` }],
  ["short transactionHash", { transactionHash: "0x123" }],
  ["unprefixed transactionHash", { transactionHash: "a".repeat(64) }],
  ["createdAt", { createdAt: null }],
  ["updatedAt", { updatedAt: 7 }],
])("rejects malformed %s through every order reader", (_field, override) => {
  const order = { ...fullOrder, ...override };
  expect(isFundingOrderSummary(order)).toBe(false);
  expect(readFundingOrder(response(order))).toBeNull();
  expect(readFundingOrderResponse(response(order))).toBeNull();
  expect(readResolveFundingOrderResponse(response(order))).toBeNull();
});

test.each(["1.5", "-1", "+1", "01", "1e2", " 1", ""])("rejects non-canonical atomic amount %p", (expectedTokenAmountAtomic) => {
  expect(isFundingOrderSummary({ ...fullOrder, expectedTokenAmountAtomic })).toBe(false);
});

test.each([
  ["providerQuoteId", { providerQuoteId: null }],
  ["undefined providerQuoteId", { providerQuoteId: undefined }],
  ["feesKnown", { feesKnown: "true" }],
  ["undefined feesKnown", { feesKnown: undefined }],
  ["fiatAmount", { fiatAmount: 1 }],
  ["tokenAmountAtomic", { tokenAmountAtomic: undefined }],
  ["expiresAt", { expiresAt: null }],
  ["fees", { fees: "oops" }],
  ["fee label", { fees: [{ label: 1, amount: "0.01", currency: "ARS" }] }],
  ["fee amount", { fees: [{ label: "Fee", amount: null, currency: "ARS" }] }],
  ["fee currency", { fees: [{ label: "Fee", amount: "0.01", currency: 1 }] }],
])("rejects malformed quote %s through every order reader", (_field, override) => {
  const order = { ...fullOrder, quote: { ...fullOrder.quote, ...override } };
  expect(isFundingOrderSummary(order)).toBe(false);
  expect(readFundingOrder(response(order))).toBeNull();
  expect(readFundingOrderResponse(response(order))).toBeNull();
  expect(readResolveFundingOrderResponse(response(order))).toBeNull();
});

test.each(["region", "assetId", "paymentMethod", "quote", "quoteToken", "sandbox", "expectedTokenAmountAtomic", "fees", "expiresAt", "transactionHash", "createdAt", "updatedAt"])("treats undefined optional %s as absent in every order reader", (field) => {
  const order = { ...fullOrder, [field]: undefined };
  expect(isFundingOrderSummary(order)).toBe(true);
  expect(readFundingOrder(response(order))).toBe(order);
  expect(readResolveFundingOrderResponse(response(order))).toEqual(response(order));
});

test("rejects undefined required summary fields", () => {
  for (const field of ["id", "providerId", "state", "fiatAmount", "providerStatus", "instructions"]) {
    expect(isFundingOrderSummary({ ...fullOrder, [field]: undefined })).toBe(false);
  }
});


test("strict order envelopes require version 1 while cached summaries and other envelopes stay permissive", () => {
  expect(FUNDING_ORDER_VERSION).toBe(1);
  expect(readFundingOrderResponse({ version: 1, order: fullOrder })).toBe(fullOrder);
  expect(isFundingOrderSummary(fullOrder)).toBe(true);
  for (const envelope of [{ order: fullOrder }, { version: 7, order: fullOrder }]) {
    expect(readFundingOrder(envelope)).toBe(fullOrder);
    expect(readFundingOrderResponse(envelope)).toBeNull();
  }
  expect(readFundingOrderResponse({ version: 1, order: null })).toBeNull();
});

import { describe, expect, test } from "bun:test";
import {
  assertFundingOpenOrderResponse,
  FUNDING_OPEN_ORDER_VERSION,
  fundingOpenOrderPath,
  fundingOrderMatchesQuery,
  parseFundingOpenOrderQuery,
  readFundingOpenOrderResponse,
} from "./open-order";

const partialOrder = { id: "id", providerId: "provider", state: "pending", fiatAmount: "1" };

test.each([null, {}, { version: FUNDING_OPEN_ORDER_VERSION, order: undefined }, { version: FUNDING_OPEN_ORDER_VERSION, order: {} }, { version: FUNDING_OPEN_ORDER_VERSION, order: [] }, { version: FUNDING_OPEN_ORDER_VERSION, order: { id: "id" } }, { version: FUNDING_OPEN_ORDER_VERSION, order: partialOrder }, { version: FUNDING_OPEN_ORDER_VERSION, order: { ...partialOrder, providerStatus: null } }])("rejects unknown or partial open-order response: %p", (value) => {
  expect(() => assertFundingOpenOrderResponse(value, "AR")).toThrow("Invalid funding open order response");
});

test.each([undefined, 0, 2])("rejects a missing or stale open-order version: %p", (version) => {
  expect(() => assertFundingOpenOrderResponse({ ...(version === undefined ? {} : { version }), order: null }, "AR")).toThrow("Invalid funding open order response");
});

test("accepts a known no-open-order response and a parsed order", () => {
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: null }, "AR")).not.toThrow();
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...partialOrder, providerStatus: null, instructions: null } }, "AR")).not.toThrow();
});

const completeOrder = { ...partialOrder, providerStatus: null };

test("binds the open order to the requested region while accepting a legacy order without one", () => {
  const order = { ...completeOrder, instructions: null };
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...order, region: "AR" } }, "AR")).not.toThrow();
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order }, "AR")).not.toThrow();
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...order, region: "BR" } }, "AR")).toThrow("Invalid funding open order response");
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...order, region: "AR" } }, "BR")).toThrow("Invalid funding open order response");
});

test.each([
  { kind: "redirect", url: "https://example.com/pay" },
  { kind: "embed", url: "https://example.com/apple-pay", presentation: "apple-pay", amount: "25", currency: "USD" },
  { kind: "bank-transfer", rail: "ACH", accountNumber: "123", amount: "25", currency: "USD", accountName: "Home", bank: "Bank", alias: "alias", reference: "ref" },
  { kind: "qr", scheme: "pix", payload: "qr-payload", amount: "25", currency: "BRL" },
  { kind: "payment-key", scheme: "upi", key: "payment-key", amount: "25", currency: "INR" },
])('accepts complete %s instructions', (instructions) => {
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...completeOrder, instructions } }, "AR")).not.toThrow();
});

test.each([
  { kind: "redirect" },
  { kind: "embed", url: "https://example.com/apple-pay", presentation: "apple-pay", amount: "25" },
  { kind: "bank-transfer", rail: "ACH", amount: "25", currency: "USD" },
  { kind: "qr", scheme: "pix", amount: "25", currency: "BRL" },
  { kind: "payment-key", scheme: "upi", amount: "25", currency: "INR" },
  { kind: "unknown", url: "https://example.com/pay" },
  { kind: "bank-transfer", rail: "ACH", accountNumber: "123", amount: "25", currency: "USD", reference: 123 },
  { kind: "bank-transfer", rail: "ACH", accountNumber: "123", amount: "25", currency: "USD", accountName: null },
  { kind: "bank-transfer", rail: "ACH", accountNumber: "123", amount: "25", currency: "USD", bank: 123 },
  { kind: "bank-transfer", rail: "ACH", accountNumber: "123", amount: "25", currency: "USD", alias: false },
  { kind: "bank-transfer", rail: "ACH", accountNumber: "123", amount: "25", currency: "USD", reference: undefined },
  { kind: "qr", scheme: "unsupported", payload: "qr-payload", amount: "25", currency: "BRL" },
  { kind: "embed", url: "https://example.com/apple-pay", presentation: "card", amount: "25", currency: "USD" },
])('rejects incomplete or invalid %s instructions', (instructions) => {
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...completeOrder, instructions } }, "AR")).toThrow("Invalid funding open order response");
});

const fullOrder = {
  ...partialOrder, region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer",
  quote: { fiatAmount: "1", tokenAmountAtomic: "100", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
  quoteToken: "signed-quote", sandbox: false, expectedTokenAmountAtomic: "100",
  fees: [{ label: "Provider", amount: "0.01", currency: "ARS" }], expiresAt: null,
  providerStatus: null, instructions: { kind: "redirect", url: "https://example.com/pay" },
  transactionHash: null, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z",
};

test("accepts all summary fields and legitimate nullable order fields", () => {
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: fullOrder }, "AR")).not.toThrow();
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...fullOrder, expectedTokenAmountAtomic: null, transactionHash: `0x${"a".repeat(64)}`, providerStatus: "PENDING", expiresAt: "2099-01-01T00:00:00.000Z" } }, "AR")).not.toThrow();
});

test.each([
  ["provider quote id and fee certainty", { providerQuoteId: "provider-quote", feesKnown: true }, false],
  ["non-string provider quote id", { providerQuoteId: null }, true],
  ["undefined provider quote id", { providerQuoteId: undefined }, true],
  ["non-boolean fee certainty", { feesKnown: "true" }, true],
  ["undefined fee certainty", { feesKnown: undefined }, true],
  ["missing atomic token amount", { tokenAmountAtomic: undefined }, true],
  ["missing expiry", { expiresAt: null }, true],
  ["non-string quote fee currency", { fees: [{ label: "Provider", amount: "0.01", currency: 1 }] }, true],
])('handles the quote %s field', (_field, override, rejected) => {
  const order = { ...fullOrder, quote: { ...fullOrder.quote, ...override } };
  const check = () => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order }, "AR");
  if (rejected) expect(check).toThrow("Invalid funding open order response");
  else expect(check).not.toThrow();
});

test.each([
  ["id", { id: null }],
  ["providerId", { providerId: 1 }],
  ["state", { state: {} }],
  ["fiatAmount", { fiatAmount: [] }],
  ["foreign region", { region: "BR" }],
  ["non-string region", { region: 1 }],
  ["assetId", { assetId: [] }],
  ["paymentMethod", { paymentMethod: null }],
  ["incomplete quote", { quote: { fiatAmount: "1" } }],
  ["quote fee", { quote: { ...fullOrder.quote, fees: [null] } }],
  ["quoteToken", { quoteToken: {} }],
  ["sandbox", { sandbox: "false" }],
  ["atomic amount object", { expectedTokenAmountAtomic: { value: "100" } }],
  ["non-atomic amount", { expectedTokenAmountAtomic: "1.5" }],
  ["fees not an array", { fees: null }],
  ["string fees", { fees: "oops" }],
  ["null fee", { fees: [null] }],
  ["partial fee", { fees: [{ label: "Provider", amount: "0.01" }] }],
  ["fee amount", { fees: [{ label: "Provider", amount: {}, currency: "ARS" }] }],
  ["expiresAt", { expiresAt: false }],
  ["providerStatus", { providerStatus: {} }],
  ["instructions", { instructions: {} }],
  ["transactionHash", { transactionHash: "0xnot-a-hash" }],
  ["createdAt", { createdAt: 1 }],
  ["updatedAt", { updatedAt: [] }],
])('rejects a malformed %s summary field', (_field, override) => {
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...fullOrder, ...override } }, "AR")).toThrow("Invalid funding open order response");
});

test.each(["region", "assetId", "paymentMethod", "quote", "quoteToken", "sandbox", "expectedTokenAmountAtomic", "fees", "expiresAt", "transactionHash", "createdAt", "updatedAt"])('accepts explicitly undefined optional %s in an in-process order', (field) => {
  expect(() => assertFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: { ...fullOrder, [field]: undefined } }, "AR")).not.toThrow();
});

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  providerId: "ripio",
  region: "AR",
  assetId: "base:wars",
  paymentMethod: "bank_transfer",
  state: "awaiting-payment",
  fiatAmount: "1000",
  providerStatus: null,
  instructions: null,
};

describe("funding open-order contract", () => {
  test("builds region-wide and provider-scoped paths", () => {
    expect(fundingOpenOrderPath({ region: "AR" })).toBe("/api/funding/orders?region=AR");
    expect(fundingOpenOrderPath({ region: "AR", providerId: "ripio", paymentMethod: "bank_transfer" }))
      .toBe("/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer");
    expect(fundingOpenOrderPath({ region: "AR", providerId: "ripio", paymentMethod: "bank_transfer", assetId: "base:wars" }))
      .toBe("/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=base%3Awars");
  });

  test("parses valid region-wide and provider-scoped queries", () => {
    expect(parseFundingOpenOrderQuery(new URLSearchParams("region=AR"))).toEqual({ ok: true, query: { region: "AR" } });
    expect(parseFundingOpenOrderQuery(new URLSearchParams("region=AR&providerId=ripio&paymentMethod=bank_transfer")))
      .toEqual({ ok: true, query: { region: "AR", providerId: "ripio", paymentMethod: "bank_transfer" } });
    expect(parseFundingOpenOrderQuery(new URLSearchParams("region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=base%3Awars")))
      .toEqual({ ok: true, query: { region: "AR", providerId: "ripio", paymentMethod: "bank_transfer", assetId: "base:wars" } });
    expect(parseFundingOpenOrderQuery(new URLSearchParams("region=AR&providerId=ripio&assetId=base%3Awars")))
      .toEqual({ ok: true, query: { region: "AR", providerId: "ripio", assetId: "base:wars" } });
  });

  test("rejects missing region and invalid scopes", () => {
    expect(parseFundingOpenOrderQuery(new URLSearchParams())).toEqual({ ok: false, reason: "region" });
    for (const providerId of ["UPPERCASE", "", "provider_id"]) {
      expect(parseFundingOpenOrderQuery(new URLSearchParams({ region: "AR", providerId })))
        .toEqual({ ok: false, reason: "provider" });
    }
    expect(parseFundingOpenOrderQuery(new URLSearchParams({ region: "AR", providerId: "ripio", paymentMethod: "INVALID" })))
      .toEqual({ ok: false, reason: "paymentMethod" });
    expect(parseFundingOpenOrderQuery(new URLSearchParams({ region: "AR", paymentMethod: "bank_transfer" })))
      .toEqual({ ok: false, reason: "paymentMethod" });
    for (const assetId of ["", "BASE:wars", "base/wars", "2asset", "base_wars", "x".repeat(65)]) {
      expect(parseFundingOpenOrderQuery(new URLSearchParams({ region: "AR", providerId: "ripio", assetId })))
        .toEqual({ ok: false, reason: "asset" });
    }
    expect(parseFundingOpenOrderQuery(new URLSearchParams({ region: "AR", assetId: "base:wars" })))
      .toEqual({ ok: false, reason: "asset" });
  });

  test("reads an explicit empty response and a valid order", () => {
    expect(readFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order: null }))
      .toEqual({ version: 1, order: null });
    expect(readFundingOpenOrderResponse({ version: FUNDING_OPEN_ORDER_VERSION, order }))
      .toEqual({ version: 1, order });
  });

  test("rejects unversioned, incompatible, missing, or malformed responses", () => {
    for (const value of [
      { order },
      { version: 2, order },
      { version: FUNDING_OPEN_ORDER_VERSION },
      { version: FUNDING_OPEN_ORDER_VERSION, order: { id: "truncated" } },
      { version: FUNDING_OPEN_ORDER_VERSION, order: null, error: { code: "ORDER_UNAVAILABLE" } },
      null,
      "invalid",
      [{ version: FUNDING_OPEN_ORDER_VERSION, order }],
    ]) expect(readFundingOpenOrderResponse(value)).toBeNull();
  });

  test("requires an order to match the requested provider, region, payment method, and asset", () => {
    const query = { region: "AR", providerId: "ripio", paymentMethod: "bank_transfer" };
    expect(fundingOrderMatchesQuery(order, query)).toBe(true);
    expect(fundingOrderMatchesQuery(order, { ...query, providerId: "other" })).toBe(false);
    expect(fundingOrderMatchesQuery(order, { ...query, region: "CO" })).toBe(false);
    expect(fundingOrderMatchesQuery(order, { ...query, paymentMethod: "card" })).toBe(false);
    expect(fundingOrderMatchesQuery(order, { ...query, assetId: "base:wars" })).toBe(true);
    expect(fundingOrderMatchesQuery(order, { ...query, assetId: "base:usdc" })).toBe(false);
  });
});

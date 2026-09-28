import { describe, expect, test } from "bun:test";
import { FUNDING_QUOTE_VERSION, readFundingQuote, readQuoteDraft } from "./quotes";

const minimal = {
  version: FUNDING_QUOTE_VERSION,
  quote: {
    fiatAmount: "25",
    tokenAmountAtomic: "25000000",
    fees: [],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  quoteToken: "signed-token",
};

describe("funding quote draft", () => {
  test("parses a full draft including provider metadata", () => {
    const full = {
      ...minimal,
      quote: {
        ...minimal.quote,
        providerQuoteId: "provider-quote",
        feesKnown: true,
        fees: [{ label: "Network", amount: "0.50", currency: "USD" }],
      },
      sandbox: true,
    };
    expect(readQuoteDraft(full)).toEqual(full);
  });

  test("defaults an absent sandbox to false without adding absent optional fields", () => {
    expect(readQuoteDraft(minimal)).toEqual({ ...minimal, sandbox: false });
  });

  test("strips unknown keys at every object level", () => {
    expect(readQuoteDraft({
      ...minimal,
      extra: "ignored",
      quote: {
        ...minimal.quote,
        extra: "ignored",
        fees: [{ label: "Network", amount: "0.50", currency: "USD", extra: "ignored" }],
      },
    })).toEqual({
      ...minimal,
      sandbox: false,
      quote: { ...minimal.quote, fees: [{ label: "Network", amount: "0.50", currency: "USD" }] },
    });
  });

  test.each([
    ["null", null],
    ["non-object", "draft"],
    ["array", []],
    ["missing version", { quote: minimal.quote, quoteToken: minimal.quoteToken }],
    ["wrong numeric version", { ...minimal, version: 2 }],
    ["string version", { ...minimal, version: "1" }],
    ["non-string quoteToken", { ...minimal, quoteToken: 5 }],
    ["quote not an object", { ...minimal, quote: [] }],
    ["fees not an array", { ...minimal, quote: { ...minimal.quote, fees: "0" } }],
    ["fee missing currency", { ...minimal, quote: { ...minimal.quote, fees: [{ label: "Fee", amount: "1" }] } }],
    ["fee amount not a string", { ...minimal, quote: { ...minimal.quote, fees: [{ label: "Fee", amount: 1, currency: "USD" }] } }],
    ["feesKnown not boolean", { ...minimal, quote: { ...minimal.quote, feesKnown: "true" } }],
    ["providerQuoteId not string", { ...minimal, quote: { ...minimal.quote, providerQuoteId: 1 } }],
    ["sandbox not boolean", { ...minimal, sandbox: "false" }],
    ["missing expiresAt", { ...minimal, quote: { fiatAmount: "25", tokenAmountAtomic: "25000000", fees: [] } }],
  ])("rejects %s", (_label, value) => {
    expect(readQuoteDraft(value)).toBeNull();
  });
});

describe("funding quote", () => {
  test("parses only contract-shaped quotes", () => {
    expect(readFundingQuote(minimal.quote)).toEqual(minimal.quote);
  });

  test("strips undeclared quote fields", () => {
    expect(readFundingQuote({ ...minimal.quote, undeclared: "ignored" })).toEqual(minimal.quote);
  });

  test.each([
    ["missing currency", { ...minimal.quote, fees: [{ label: "Fee", amount: "1" }] }],
    ["non-string currency", { ...minimal.quote, fees: [{ label: "Fee", amount: "1", currency: 1 }] }],
    ["missing expiresAt", { fiatAmount: "25", tokenAmountAtomic: "25000000", fees: [] }],
    ["null", null],
    ["array", []],
  ])("rejects a quote with %s", (_label, value) => {
    expect(readFundingQuote(value)).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { serverBoundRipioOrder, serverBoundRipioQuote } from "./ripio-service";

const ADDRESS = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as const;

describe("Ripio server owner/destination binding", () => {
  test("derives country/token/Base/destination from verified server session and config", () => {
    expect(serverBoundRipioQuote({
      session: { user: { subject: "home-user" }, smartAccount: { address: ADDRESS, chainId: 8453 }, accountProvider: "base-account" },
      country: "AR",
      fromAmount: "2100",
      paymentMethodType: "bank_transfer",
    })).toEqual({ country: "AR", fromCurrency: "ARS", toCurrency: "wARS", fromAmount: "2100", chain: "BASE", paymentMethodType: "bank_transfer", destination: ADDRESS.toLowerCase() as `0x${string}` });
  });

  test("creates provider order arguments only from the durable Home order", () => {
    expect(serverBoundRipioOrder({ order: { customerId: "customer", quoteId: "quote", homeOrderId: "home-order", destination: ADDRESS, fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", paymentMethodType: "bank_transfer", expectedAmountAtomic: "2100000000000000000000", tokenDecimals: 18 } })).toEqual({ customerId: "customer", quoteId: "quote", externalRef: "home-order", destination: ADDRESS, fromCurrency: "ARS", toCurrency: "wARS", chain: "BASE", paymentMethodType: "bank_transfer", finalToAmount: "2100" });
  });
});

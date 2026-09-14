import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { authenticateFundingQuote } from "./quote-token";

const secret = "quote-token-test-secret-that-is-long-enough";

function signRawClaims(claims: unknown): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

describe("authenticateFundingQuote", () => {
  test("rejects a validly signed legacy token without a sandbox claim", () => {
    const token = signRawClaims({
      subject: "user",
      accountProvider: "base-account",
      providerId: "fixture",
      region: "US",
      paymentMethod: "apple-pay",
      destination: "0x1111111111111111111111111111111111111111",
      assetId: "base:usdc",
      fiatAmount: "25",
      quote: {
        fiatAmount: "25",
        tokenAmountAtomic: "25000000",
        fees: [],
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      customerRef: null,
    });

    expect(authenticateFundingQuote(token, secret)).toBeNull();
  });
});

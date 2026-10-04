import { describe, expect, test } from "bun:test";
import { formatFiatAmount } from "@/shared/formatting";
import { cashoutArrivalSeconds, cashoutQuoteFromLegacy, formatCashoutArrival, parseCashoutQuote, type CashoutFee, type CashoutQuote } from "./cash-out-quote";
import { formatCashoutFee, formatCashoutReceive } from "./cash-out-quote-format";

const quote = {
  fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null },
  rate: null,
  receive: { amount: "2.50", currency: "USD", approximate: true },
  arrival: { source: "observed", kind: "within", seconds: 3600 },
} as const;

describe("cash-out quote", () => {
  test("formats USD payout amounts and fees with Brazilian presentation separators", () => {
    const receive: CashoutQuote["receive"] = { amount: "1234.56", currency: "USD", approximate: false };
    const fee: CashoutFee = { amount: "1234.56", currency: "USD" };
    const formattedAmount = formatFiatAmount("1234.56", "USD", { regionId: "BR" });
    const formattedReceive = formatCashoutReceive(receive, "PIX", "BR");
    expect(formattedReceive).toBe(`${formattedAmount} to PIX`);
    expect(formattedReceive).toContain("1.234,56");
    expect(formatCashoutFee(fee, "BR")).toBe(formattedAmount);
    expect(formatCashoutFee(fee, "BR")).toContain("1.234,56");
  });

  test("keeps US presentation separators for USD payout amounts and fees", () => {
    const receive: CashoutQuote["receive"] = { amount: "1234.56", currency: "USD", approximate: false };
    expect(formatCashoutReceive(receive, "Cash App", "US")).toBe("$1,234.56 to Cash App");
    expect(formatCashoutFee({ amount: "1234.56", currency: "USD" }, "US")).toBe("$1,234.56");
  });

  test("parses the fee, receive, rate and timing contract", () => {
    expect(parseCashoutQuote(quote)).toEqual(quote);
    expect(parseCashoutQuote({ ...quote, rate: { from: "USDC", to: "EUR", value: "0.9" } })).toMatchObject({ rate: { value: "0.9" } });
    expect(cashoutArrivalSeconds(quote.arrival)).toBe(3600);
  });

  test.each([
    { fees: { ...quote.fees, network: { amount: "-1", currency: "USD" } } },
    { fees: { ...quote.fees, operator: undefined } },
    { rate: { from: "USDC", to: "EUR", value: "0" } },
    { rate: { from: "USDC", to: "EUR", value: "NaN" } },
    { receive: { ...quote.receive, amount: "1e2" } },
    { receive: { ...quote.receive, approximate: "true" } },
    { arrival: { source: "observed", kind: "within", seconds: 0 } },
    { arrival: { source: "declared", kind: "business-days", minDays: 3, maxDays: 2 } },
  ])("rejects a malformed quote part", (part) => {
    expect(parseCashoutQuote({ ...quote, ...part })).toBeNull();
  });

  test.each([
    [60, "Usually within 1 minute"],
    [119, "Usually within 2 minutes"],
    [3600, "Usually within 1 hour"],
    [7200, "Usually within 2 hours"],
  ] as const)("formats %i seconds as %s", (seconds, copy) => {
    expect(formatCashoutArrival({ source: "observed", kind: "within", seconds })).toBe(copy);
  });

  test("formats declared business-day windows and unknown arrival", () => {
    expect(formatCashoutArrival({ source: "declared", kind: "business-days", minDays: 1, maxDays: 3 })).toBe("1–3 business days");
    expect(formatCashoutArrival({ source: "declared", kind: "business-days", minDays: 1, maxDays: 1 })).toBe("1 business day");
    expect(formatCashoutArrival({ source: "unknown" })).toBe("Arrival time varies");
  });

  test("converts legacy metadata with and without an ETA", () => {
    const input = { approximateFiatAmount: "2", currency: "USD" };
    expect(cashoutQuoteFromLegacy({ ...input, etaSeconds: 60 })).toMatchObject({ receive: { amount: "2" }, arrival: { source: "observed", kind: "within", seconds: 60 } });
    expect(cashoutQuoteFromLegacy(input)).toMatchObject({ arrival: { source: "unknown" }, fees: { provider: null, network: null, operator: null } });
  });
});

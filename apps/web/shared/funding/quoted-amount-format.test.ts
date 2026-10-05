import { describe, expect, test } from "bun:test";
import { formatFiatAmount } from "@/shared/formatting";
import { formatCashoutFee, formatCashoutReceive } from "./cash-out-quote-format";
import { formatOnrampFee, formatOnrampReceive, formatQuotedAmount } from "./quoted-amount-format";

describe("onramp receive precision", () => {
  test.each([
    ["base:usdc", 6, "USDC", "1234567", "$1.234567"],
    ["base:eurc", 6, "EURC", "1234567", "€1,234567"],
    ["base:idrx", 2, "IDRX", "1234567", "Rp\u00a012.345,67"],
    ["base:wbrl", 18, "wBRL", "1234567890123456789", "R$\u00a01,234567890123456789"],
    ["base:wars", 18, "wARS", "1234567890123456789", "$1,234567890123456789"],
    ["base:wcop", 18, "wCOP", "1234567890123456789", "$1,234567890123456789"],
  ] as const)("preserves all atomic digits for %s without conversion", (assetId, assetDecimals, assetSymbol, atoms, expected) => {
    expect(formatOnrampReceive(atoms, { assetId, assetDecimals, assetSymbol })).toBe(expected);
  });

  test("preserves tiny and beyond-safe-integer cash amounts", () => {
    const asset = { assetId: "base:usdc", assetDecimals: 6, assetSymbol: "USDC" };
    expect(formatOnrampReceive("1", asset)).toBe("$0.000001");
    expect(formatOnrampReceive("9007199254740993500001", asset)).toBe("$9,007,199,254,740,993.500001");
  });

  test("does not truncate or infer cash denomination for an unknown asset's symbol", () => {
    expect(formatOnrampReceive("1234567", { assetId: "unknown", assetDecimals: 6, assetSymbol: "USDC" })).toBe("1.234567\u00a0USDC");
    expect(formatOnrampReceive("1", { assetId: "eth", assetDecimals: 18, assetSymbol: "ETH" })).toBe("0.000000000000000001\u00a0ETH");
  });
});

describe("onramp fee formatting", () => {
  test.each([
    ["USDC", "$1.50"],
    ["EURC", "€1,50"],
    ["IDRX", "Rp\u00a01,50"],
    ["wBRL", "R$\u00a01,50"],
    ["wARS", "$1,50"],
    ["wCOP", "$1,50"],
  ])("formats registered cash token %s in its native denomination", (symbol, expected) => {
    expect(formatOnrampFee("1.50", symbol)).toBe(expected);
  });

  test("keeps cash-token fee precision and does not convert its amount", () => {
    expect(formatOnrampFee("1234.567890", "wBRL")).toBe("R$\u00a01.234,56789");
    expect(formatOnrampFee("0.000001", "USDC")).toBe("$0.000001");
    expect(formatOnrampFee("9007199254740993.50", "USDC")).toBe("$9,007,199,254,740,993.50");
    expect(formatOnrampFee("3", "USDC")).toBe("$3.00");
    expect(formatOnrampFee("0", "USDC")).toBe("$0.00");
  });

  test.each(["abc", "-1", "1e2", "01", "1.", " 1.5", "0.123456789012345678901"])("rejects malformed cash-token fee %s", (amount) => {
    expect(formatOnrampFee(amount, "USDC")).toBe("—");
  });

  test.each(["USDT", "usdc", "ZZZ"])("keeps unregistered token %s explicit", (symbol) => {
    expect(formatOnrampFee("1.50", symbol)).toBe(`1.50 ${symbol}`);
  });

  test("keeps noncash and fiat quote presentation", () => {
    expect(formatOnrampFee("0.1234567", "ETH")).toBe("0.1234 ETH");
    expect(formatOnrampFee("2.50", "USD")).toBe("$2.50");
    expect(formatOnrampFee("2.50", "BRL")).toBe("R$\u00a02,50");
  });

  test("does not change cash-out token fees or payout presentation", () => {
    expect(formatCashoutFee({ amount: "1.50", currency: "USDC" }, "BR")).toBe("1,50 USDC");
    expect(formatCashoutFee({ amount: "1.50", currency: "wBRL" }, "BR")).toBe("1,50 wBRL");
    expect(formatCashoutFee(null, "US")).toBe("Not quoted");
    expect(formatCashoutFee({ amount: "0", currency: "USDC" }, "US")).toBe("None");
    expect(formatCashoutReceive({ amount: "25", currency: "USD", approximate: true }, "Cash App", "BR")).toBe("≈ $25,00 to Cash App");
  });
});

describe("quoted amount formatting", () => {
  test("formats ISO fees using their native currency presentation", () => {
    const formatted = formatQuotedAmount("2.50", "USD", { currencyNative: true });
    expect(formatted).toBe(formatFiatAmount("2.50", "USD", { currencyNative: true }));
    expect(formatted).toBe("$2.50");
  });

  test("formats token fees with their token symbol instead of a fiat symbol", () => {
    const formatted = formatQuotedAmount("1.5", "USDC", { currencyNative: true });
    expect(formatted).toBe("1.50 USDC");
    expect(formatted).toContain("USDC");
    expect(formatted).not.toContain("$");
  });

  test("formats token amounts without an input fractional part", () => {
    expect(formatQuotedAmount("3", "USDC", { currencyNative: true })).toBe("3.00 USDC");
  });

  test("formats token amounts with more than six decimal places", () => {
    const format = () => formatQuotedAmount("0.1234567", "ETH", { currencyNative: true });
    expect(format).not.toThrow();
    expect(format()).toBe("0.1234 ETH");
    expect(format()).not.toBe("—");
  });

  test.each(["abc", "-1"])("rejects malformed token amount %s", (amount) => {
    expect(formatQuotedAmount(amount, "USDC", { currencyNative: true })).toBe("—");
  });

  test.each(["usd", "ZZZ"])("formats non-ISO code %s as a token", (currency) => {
    const formatted = formatQuotedAmount("2.50", currency, { currencyNative: true });
    expect(formatted).toBe(`2.50 ${currency}`);
    expect(formatted).not.toContain("$");
  });

  test("preserves regional token presentation", () => {
    expect(formatQuotedAmount("1234.56", "USDC", { regionId: "BR" })).toBe("1.234,56 USDC");
  });
});

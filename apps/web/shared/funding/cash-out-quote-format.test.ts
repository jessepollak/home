import { describe, expect, test } from "bun:test";
import { formatCashoutFee, formatCashoutRate, formatCashoutReceive } from "./cash-out-quote-format";

describe("cash-out quote formatting", () => {
  test("formats destination and default currency locale without implying exactness", () => {
    expect(formatCashoutReceive({ amount: "250", currency: "BRL", approximate: true }, "Pix")).toBe("≈ R$ 250,00 to Pix");
    expect(formatCashoutReceive({ amount: "50", currency: "USD", approximate: false }, "Cash App")).toBe("$50.00 to Cash App");
  });
  test("distinguishes absent fees from quoted zero", () => {
    expect(formatCashoutFee(null)).toBe("Not quoted");
    expect(formatCashoutFee({ amount: "0.00", currency: "USD" })).toBe("None");
    expect(formatCashoutFee({ amount: "0.75", currency: "USD" })).toBe("$0.75");
  });
  test("formats token-denominated fees as token amounts", () => {
    expect(formatCashoutFee({ amount: "0.5", currency: "USDC" })).toBe("0.50 USDC");
    expect(formatCashoutFee({ amount: "12.345678", currency: "USDC" })).toBe("12.34 USDC");
    expect(formatCashoutFee({ amount: "0", currency: "USDC" })).toBe("None");
  });
  test("keeps non-ISO receive codes off the fiat formatter", () => {
    expect(formatCashoutReceive({ amount: "2.5", currency: "ETH", approximate: true }, "Wallet")).toBe("≈ 2.5000 ETH to Wallet");
  });
  test("formats every code as a token when the runtime cannot list ISO currencies", () => {
    const original = Intl.supportedValuesOf;
    Reflect.deleteProperty(Intl, "supportedValuesOf");
    try {
      expect(formatCashoutFee({ amount: "0.5", currency: "ETH" })).toBe("0.5000 ETH");
    } finally {
      Object.defineProperty(Intl, "supportedValuesOf", { value: original, configurable: true, writable: true });
    }
  });
  test("formats optional rates with at most four digits", () => {
    expect(formatCashoutRate(null)).toBeNull();
    expect(formatCashoutRate({ from: "USDC", to: "GBP", value: "0.741234" })).toBe("1 USDC = 0.7412 GBP");
    expect(formatCashoutRate({ from: "USDC", to: "EUR", value: "1.20000" })).toBe("1 USDC = 1.2 EUR");
    expect(formatCashoutRate({ from: "USDC", to: "GBP", value: "0.00001" })).toBe("1 USDC = <0.0001 GBP");
    expect(formatCashoutRate({ from: "USDC", to: "GBP", value: "0.00005" })).toBe("1 USDC = 0.0001 GBP");
  });
});

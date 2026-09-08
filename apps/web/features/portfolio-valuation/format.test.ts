import { describe, expect, test } from "bun:test";
import {
  formatFiatValue,
  formatPresentationFiat,
  presentationCurrencyName,
} from "./format";

describe("portfolio fiat formatting", () => {
  test("keeps positive values below display precision distinct from true zero", () => {
    expect(formatFiatValue({ atoms: "4", scale: 3 }, "USD")).toBe(
      "USD <0.01",
    );
    expect(formatFiatValue({ atoms: "1", scale: 19 }, "EUR")).toBe(
      "EUR <0.01",
    );
    expect(formatFiatValue({ atoms: "0", scale: 18 }, "USD")).toBe(
      "USD 0.00",
    );
  });

  test("presents everyday currency names and symbols without ISO/stablecoin labels", () => {
    expect(presentationCurrencyName("USD")).toBe("US dollar");
    expect(presentationCurrencyName("BRL")).toBe("Brazilian real");
    expect(formatPresentationFiat({ atoms: "0", scale: 6 }, "USD")).toBe("$0.00");
    expect(formatPresentationFiat({ atoms: "0", scale: 6 }, "BRL")).toBe(
      "R$ 0,00",
    );
    expect(formatPresentationFiat({ atoms: "4", scale: 3 }, "USD")).toBe(
      "<$0.01",
    );
  });
});

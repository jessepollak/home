import { describe, expect, test } from "bun:test";
import { presentationQuoteForRegion } from "./presentation-quote";

describe("presentationQuoteForRegion", () => {
  test("keeps USD identity for US and GLOBAL", () => {
    expect(presentationQuoteForRegion("US", [])).toEqual({
      valueCurrency: "USD",
      quoteUnitsPerUsd: { atoms: "1", scale: 0 },
    });
    expect(presentationQuoteForRegion("GLOBAL", null)).toEqual({
      valueCurrency: "USD",
      quoteUnitsPerUsd: { atoms: "1", scale: 0 },
    });
  });

  test("selects a fresh IDR FX quote and fail-closes when it is missing", () => {
    expect(
      presentationQuoteForRegion("ID", [
        {
          quoteCurrency: "IDR",
          quoteUnitsPerUsd: { atoms: "16425", scale: 0 },
          status: "fresh",
        },
      ]),
    ).toEqual({
      valueCurrency: "IDR",
      quoteUnitsPerUsd: { atoms: "16425", scale: 0 },
    });
    expect(presentationQuoteForRegion("ID", [])).toEqual({
      valueCurrency: "IDR",
      quoteUnitsPerUsd: null,
    });
  });
});

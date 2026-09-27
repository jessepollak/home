import { describe, expect, test } from "bun:test";
import { parseStockTradeEligibilityResponse } from "./contract-stock-eligibility";

describe("stock trade eligibility contract", () => {
  test("parses exactly the status contract", () => {
    for (const buy of ["eligible", "restricted"] as const) {
      expect(parseStockTradeEligibilityResponse({ version: 1, buy, sell: "eligible" })).toEqual({ version: 1, buy, sell: "eligible" });
    }
    for (const value of [null, [], {}, { version: 2, buy: "eligible", sell: "eligible" },
      { version: 1, buy: "unknown", sell: "eligible" }, { version: 1, buy: "eligible", sell: "restricted" },
      { version: 1, buy: "eligible", sell: "eligible", country: "DE" }]) {
      expect(parseStockTradeEligibilityResponse(value)).toBeNull();
    }
  });
});

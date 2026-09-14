import { describe, expect, test } from "bun:test";
import { DEFAULT_VERIFIED_MORPHO_MARKET } from "@/shared/morpho-markets/config";
import { actionKindForLendOperation, parseLendActionIntent } from "./types";

const marketId = DEFAULT_VERIFIED_MORPHO_MARKET.marketId;

describe("lend action intents", () => {
  test.each([
    ["supply", "lend-supply", { amountBaseUnits: "1" }],
    ["withdraw", "lend-withdraw", { amountBaseUnits: "2" }],
    ["withdraw-all", "lend-withdraw", {}],
  ] as const)("strictly parses %s as %s", (operation, kind, fields) => {
    expect(parseLendActionIntent({ marketId, operation, ...fields })).toEqual({ marketId, operation, ...fields });
    expect(actionKindForLendOperation(operation)).toBe(kind);
  });

  test.each([
    { marketId, operation: "supply" },
    { marketId, operation: "withdraw-all", amountBaseUnits: "1" },
    { marketId, operation: "withdraw", amountBaseUnits: "0" },
    { marketId, operation: "withdraw", amountBaseUnits: "1", owner: "0xdead" },
  ])("rejects invalid or widened intent %#", (value) => {
    expect(parseLendActionIntent(value)).toBeNull();
  });
});

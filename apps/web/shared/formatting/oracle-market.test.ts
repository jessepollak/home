import { describe, expect, test } from "bun:test";
import { formatOracleUsd } from "./money";
import { liquidationPriceRaw } from "@/shared/morpho-markets/math";

const examples = [
  { symbol: "cbBTC", decimals: 8, collateral: "100000000", debt: "72518889400", lltv: "860000000000000000", expected: "$84,324.29" },
  { symbol: "cbXRP", decimals: 6, collateral: "1000000", debt: "940462", lltv: "625000000000000000", expected: "$1.50" },
  { symbol: "cbETH", decimals: 18, collateral: "1000000000000000000", debt: "2355448822", lltv: "770000000000000000", expected: "$3,059.02" },
  { symbol: "cbDOGE", decimals: 8, collateral: "100000000", debt: "58817", lltv: "625000000000000000", expected: "$0.09" },
  { symbol: "cbADA", decimals: 6, collateral: "1000000", debt: "149177", lltv: "625000000000000000", expected: "$0.24" },
];

describe("Morpho oracle dollar formatting", () => {
  test.each(examples)("scales $symbol liquidation price with its collateral decimals", ({ decimals, collateral, debt, lltv, expected }) => {
    const liquidation = liquidationPriceRaw(BigInt(debt), BigInt(collateral), BigInt(lltv));
    expect(liquidation).not.toBeNull();
    expect(formatOracleUsd(liquidation!.toString(), { loanDecimals: 6, collateralDecimals: decimals })).toBe(expected);
  });
});

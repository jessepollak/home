import { describe, expect, test } from "bun:test";
import { formatOracleUsd } from "./money";
import { liquidationPriceRaw } from "@/shared/morpho-markets/math";

const WAD = BigInt("1000000000000000000");
const examples = [
  { symbol: "cbBTC", decimals: 8, lltv: BigInt("860000000000000000"), priceRaw: BigInt("843242900000000000000000000000000000000"), expected: "$84,324.29" },
  { symbol: "cbXRP", decimals: 6, lltv: BigInt("625000000000000000"), priceRaw: BigInt("1504740000000000000000000000000000000"), expected: "$1.50" },
  { symbol: "cbETH", decimals: 18, lltv: BigInt("770000000000000000"), priceRaw: BigInt("3059024445000000000000000000"), expected: "$3,059.02" },
  { symbol: "cbDOGE", decimals: 8, lltv: BigInt("625000000000000000"), priceRaw: BigInt("941080000000000000000000000000000"), expected: "$0.09" },
  { symbol: "cbADA", decimals: 6, lltv: BigInt("625000000000000000"), priceRaw: BigInt("238684290000000000000000000000000000"), expected: "$0.24" },
];

describe("Morpho oracle dollar formatting", () => {
  test.each(examples)("scales $symbol liquidation price with its collateral decimals", ({ decimals, lltv, priceRaw, expected }) => {
    const collateral = BigInt(10) ** BigInt(decimals);
    const debt = priceRaw * collateral * lltv / (BigInt(10) ** BigInt(36) * WAD);
    const liquidation = liquidationPriceRaw(debt, collateral, lltv);
    expect(liquidation).not.toBeNull();
    expect(formatOracleUsd(liquidation!.toString(), { loanDecimals: 6, collateralDecimals: decimals })).toBe(expected);
  });
});

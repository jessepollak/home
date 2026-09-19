import { describe, expect, test } from "bun:test";
import {
  parseUsdcAmount,
  readUsdcBaseUnits,
  shortVaultLabel,
} from "./format";

describe("savings format", () => {
  test("shortens vault names", () => {
    expect(shortVaultLabel("Gauntlet USDC Prime")).toBe("Gauntlet");
    expect(shortVaultLabel("Steakhouse USDC")).toBe("Steakhouse");
  });

  test("parses dollar amounts into six-decimal USDC base units", () => {
    expect(parseUsdcAmount("100")).toBe("100000000");
    expect(parseUsdcAmount("1.234567")).toBe("1234567");
    expect(readUsdcBaseUnits("820000000")).toBe(BigInt("820000000"));
    expect(readUsdcBaseUnits(null)).toBeNull();
  });
});

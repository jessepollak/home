import { describe, expect, test } from "bun:test";
import {
  formatApy,
  formatUsdcUsd,
  parseUsdcAmount,
  readUsdcBaseUnits,
  shortVaultLabel,
} from "./format";

describe("savings format", () => {
  test("formats USDC base units as dollar hero amounts", () => {
    expect(formatUsdcUsd("0")).toBe("$0.00");
    expect(formatUsdcUsd("1240000000")).toBe("$1,240.00");
    expect(formatUsdcUsd("820000000")).toBe("$820.00");
    expect(formatUsdcUsd("2100000")).toBe("$2.10");
    expect(formatUsdcUsd("not-raw")).toBe("—");
  });

  test("keeps APY quiet and shortens vault names", () => {
    expect(formatApy(0.041)).toBe("4.10%");
    expect(formatApy(null)).toBe("—");
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

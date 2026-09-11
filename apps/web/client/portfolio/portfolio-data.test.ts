import { describe, expect, test } from "bun:test";
import { formatBaseUnitAmount } from "./format";
import { PortfolioResponseError, parsePortfolioSnapshot } from "./parse";
import type { PortfolioSnapshot, VerifiedPortfolioSession } from "@/shared/portfolio/types";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const verifiedSession: VerifiedPortfolioSession = {
  subject: "subject-a",
  smartAccountAddress: ADDRESS,
  chainId: 8453,
};

function validSnapshot(): PortfolioSnapshot {
  return {
    walletAddress: ADDRESS,
    chainId: 8453,
    blockNumber: "16",
    blockHash: `0x${"ab".repeat(32)}`,
    blockTimestamp: "100",
    fetchedAt: "2026-09-07T20:30:00.000Z",
    assets: [
      {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        kind: "erc20",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        balanceBaseUnits: "1234500",
      },
      {
        id: "eth",
        symbol: "ETH",
        decimals: 18,
        kind: "native",
        balanceBaseUnits: "1",
      },
    ],
  };
}

describe("portfolio response parser", () => {
  test("accepts the exact Base USDC and native ETH contract", () => {
    const parsed = parsePortfolioSnapshot(validSnapshot(), verifiedSession);

    expect(parsed.assets[0]?.balanceBaseUnits).toBe("1234500");
    expect(parsed.assets[1]?.balanceBaseUnits).toBe("1");
  });

  test("rejects mismatched wallet, chain, token identity, duplicate assets, and malformed integers", () => {
    const cases: unknown[] = [
      { ...validSnapshot(), walletAddress: "0x2222222222222222222222222222222222222222" },
      { ...validSnapshot(), chainId: 1 },
      {
        ...validSnapshot(),
        assets: validSnapshot().assets.map((asset) =>
          asset.id === "usdc"
            ? { ...asset, tokenAddress: "0x2222222222222222222222222222222222222222" }
            : asset,
        ),
      },
      {
        ...validSnapshot(),
        assets: [validSnapshot().assets[0], validSnapshot().assets[0]],
      },
      {
        ...validSnapshot(),
        assets: validSnapshot().assets.map((asset) => ({
          ...asset,
          balanceBaseUnits: "01",
        })),
      },
    ];

    for (const value of cases) {
      expect(() => parsePortfolioSnapshot(value, verifiedSession)).toThrow(
        PortfolioResponseError,
      );
    }
  });
});

describe("exact portfolio amount formatting", () => {
  test("formats USDC and ETH without floating point or trailing zeroes", () => {
    expect(formatBaseUnitAmount("1234500", 6)).toBe("1.2345");
    expect(formatBaseUnitAmount("1000000", 6)).toBe("1");
    expect(formatBaseUnitAmount("42", 0)).toBe("42");
  });

  test("keeps the smallest positive ETH and USDC amounts visibly positive", () => {
    expect(formatBaseUnitAmount("1", 18)).toBe("0.000000000000000001");
    expect(formatBaseUnitAmount("1", 6)).toBe("0.000001");
    expect(formatBaseUnitAmount("0", 18)).toBe("0");
  });

  test("rejects non-canonical input rather than silently rounding it", () => {
    expect(() => formatBaseUnitAmount("01", 6)).toThrow(TypeError);
    expect(() => formatBaseUnitAmount("1.5", 6)).toThrow(TypeError);
    expect(() => formatBaseUnitAmount("-1", 6)).toThrow(TypeError);
  });
});

import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  portfolioVaults,
} from "@/config/portfolio-assets";
import {
  CODEX_RECOGNIZED_CATALOG_LIMIT,
  createCodexRecognizedTokenCatalogReader,
  normalizeRecognizedTokenCatalog,
} from "./recognized-catalog";

function row(
  address: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    liquidity: "1000000",
    volume24: "50000",
    token: {
      address,
      name: "Recognized",
      symbol: "RCG",
      decimals: "18",
      networkId: "8453",
      info: { imageSmallUrl: "https://images.example.test/token.png" },
    },
    ...overrides,
  };
}

function withToken(
  value: Record<string, unknown>,
  token: Record<string, unknown>,
): Record<string, unknown> {
  return { ...value, token: { ...(value.token as Record<string, unknown>), ...token } };
}

describe("Codex recognized-token catalog", () => {
  test("preserves successful catalog pages when one page fails", async () => {
    const reader = createCodexRecognizedTokenCatalogReader({
      apiKey: "fixture-key",
      fetchImpl: async (_input, init) => {
        const { variables } = JSON.parse(String(init?.body)) as {
          variables: { offset: number };
        };
        if (variables.offset === 200) throw new Error("page unavailable");
        const results = variables.offset === 0
          ? [row("0x1111111111111111111111111111111111111111")]
          : [withToken(row("0x2222222222222222222222222222222222222222"), { symbol: "TWO" })];
        return Response.json({
          data: {
            filterTokens: {
              results,
              count: results.length,
              page: variables.offset,
            },
          },
        });
      },
    });

    const result = await reader();
    expect(result.status).toBe("incomplete");
    expect(result.entries.map(({ address }) => address)).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);
  });

  test("validates, sanitizes, deduplicates, excludes configured identities, and caps in liquidity order", () => {
    const valid = row("0x1111111111111111111111111111111111111111");
    const cases = [
      valid,
      row("0x1111111111111111111111111111111111111111"),
      row(PORTFOLIO_USDC_ADDRESS),
      row(portfolioVaults[0].address),
      row("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),
      withToken(row("0x2222222222222222222222222222222222222222"), { symbol: "ETH" }),
      withToken(row("0x3333333333333333333333333333333333333333"), { decimals: "256" }),
      withToken(row("0x4444444444444444444444444444444444444444"), { networkId: "1" }),
      row("0x5555555555555555555555555555555555555555", { liquidity: "0" }),
      row("0x6666666666666666666666666666666666666666", { volume24: "invalid" }),
      withToken(row("0x7777777777777777777777777777777777777777"), {
        symbol: "SAFE",
        info: { imageSmallUrl: "http://unsafe.example.test/token.png" },
      }),
    ];
    const filler = Array.from({ length: CODEX_RECOGNIZED_CATALOG_LIMIT + 2 }, (_, index) =>
      withToken(
        row(`0x${(index + 100).toString(16).padStart(40, "0")}`),
        { symbol: `R${index}` },
      ),
    );

    const normalized = normalizeRecognizedTokenCatalog([...cases, ...filler]);
    expect(normalized).toHaveLength(CODEX_RECOGNIZED_CATALOG_LIMIT);
    expect(normalized[0]).toMatchObject({
      address: "0x1111111111111111111111111111111111111111",
      name: "Recognized",
      symbol: "RCG",
      decimals: 18,
      liquidityUsd: { atoms: "1000000", scale: 0 },
      volume24Usd: { atoms: "50000", scale: 0 },
      imageUrl: "https://images.example.test/token.png",
    });
    expect(normalized[1]).toMatchObject({
      address: "0x7777777777777777777777777777777777777777",
      symbol: "SAFE",
    });
    expect(normalized[1]).not.toHaveProperty("imageUrl");
    expect(new Set(normalized.map(({ address }) => address)).size).toBe(normalized.length);
  });
});

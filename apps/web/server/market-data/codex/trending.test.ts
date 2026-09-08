import { describe, expect, test } from "bun:test";
import { memeAssets } from "@/config/invest-assets";
import { CodexMarketDataError } from "./client";
import { CODEX_GRAPHQL_ENDPOINT } from "./config";
import {
  CODEX_TRENDING_LIMIT,
  CODEX_TRENDING_MEME_CATEGORY,
  CODEX_TRENDING_QUERY,
  createCodexTrendingMemesReader,
  normalizeTrendingMemes,
} from "./trending";

const NOW = new Date("2026-09-08T20:00:00.000Z");
const degen = memeAssets[0];

function trendingPayload(results: unknown[]) {
  return { filterTokens: { results } };
}

describe("Codex trending memes", () => {
  test("queries Base memes by trendingScore24 and fail-closes without a key", async () => {
    const seen: { body?: unknown } = {};
    const reader = createCodexTrendingMemesReader({
      apiKey: "fixture-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => {
        seen.body = JSON.parse(String(init?.body));
        expect(String(_url)).toBe(CODEX_GRAPHQL_ENDPOINT);
        return new Response(
          JSON.stringify({
            data: trendingPayload([
              {
                priceUSD: "0.0123",
                change24: "0.05",
                lastTransaction: "1757361600",
                token: {
                  address: "0x1111111111111111111111111111111111111111",
                  name: "Higher",
                  symbol: "HIGHER",
                  decimals: "18",
                  networkId: "8453",
                  info: { imageSmallUrl: "https://icons.example.test/higher.png" },
                },
              },
            ]),
          }),
        );
      },
    });

    const result = await reader();
    expect(seen.body).toEqual({
      query: CODEX_TRENDING_QUERY,
      variables: {
        filters: {
          network: [8453],
          potentialScam: false,
          trendingIgnored: false,
          categories: { anyOf: [CODEX_TRENDING_MEME_CATEGORY] },
        },
        rankings: [{ attribute: "trendingScore24", direction: "DESC" }],
        limit: CODEX_TRENDING_LIMIT,
        excludeTokens: expect.any(Array),
      },
    });
    expect(result.status).toBe("ready");
    expect(result.assets[0]).toMatchObject({
      id: "base:0x1111111111111111111111111111111111111111",
      displayName: "Higher",
      displaySymbol: "HIGHER",
      imageUrl: "https://icons.example.test/higher.png",
    });
    expect(result.snapshots[0]).toMatchObject({
      assetId: "base:0x1111111111111111111111111111111111111111",
      displayPrice: "$0.0123",
      changeLabel: "+5.00%",
    });

    const unavailable = await createCodexTrendingMemesReader({
      apiKey: "   ",
      fetchImpl: async () => {
        throw new Error("should not contact Codex");
      },
    })();
    expect(unavailable).toEqual({ status: "unavailable", assets: [], snapshots: [] });
  });

  test("reuses configured meme identity and omits stock/crypto contracts", () => {
    const result = normalizeTrendingMemes(
      trendingPayload([
        {
          priceUSD: "0.01",
          token: {
            address: degen.contractAddress,
            name: "Degen",
            symbol: "DEGEN",
            decimals: "18",
            networkId: "8453",
            info: { imageThumbUrl: "https://icons.example.test/degen.png" },
          },
        },
        {
          priceUSD: "64000",
          token: {
            address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
            name: "Bitcoin",
            symbol: "BTC",
            decimals: "8",
            networkId: "8453",
          },
        },
      ]),
      NOW,
    );

    expect(result.assets.map((asset) => asset.id)).toEqual(["degen"]);
    expect(result.assets[0]?.imageUrl).toBe("https://icons.example.test/degen.png");
  });

  test("returns empty when Codex has no usable meme rows", () => {
    expect(normalizeTrendingMemes(trendingPayload([null, {}]), NOW)).toEqual({
      status: "empty",
      assets: [],
      snapshots: [],
    });
  });

  test("rejects an invalid filterTokens envelope", () => {
    expect(() => normalizeTrendingMemes({ filterTokens: {} }, NOW)).toThrow(
      CodexMarketDataError,
    );
  });
});

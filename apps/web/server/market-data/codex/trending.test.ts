import { describe, expect, test } from "bun:test";
import { memeAssets } from "@/config/invest-assets";
import { CodexMarketDataError } from "./client";
import { CODEX_GRAPHQL_ENDPOINT } from "./config";
import {
  CODEX_TRENDING_LIMIT,
  CODEX_TRENDING_MEME_CATEGORY,
  CODEX_TRENDING_PAGE_SIZE,
  CODEX_TRENDING_QUERY,
  createCodexTrendingMemeAdmissionReader,
  createCodexTrendingMemesPageReader,
  createCodexTrendingMemesReader,
  normalizeTrendingMemeAdmission,
  normalizeTrendingMemes,
  normalizeTrendingMemesPage,
} from "./trending";

const NOW = new Date("2026-09-08T20:00:00.000Z");
const degen = memeAssets[0];

function trendingPayload(results: unknown[], page = 0) {
  return { filterTokens: { results, count: results.length, page } };
}

function memeRow(address: string, name: string) {
  return {
    priceUSD: "0.0123",
    change24: "0.05",
    lastTransaction: "1757361600",
    token: {
      address,
      name,
      symbol: name.toUpperCase(),
      decimals: "18",
      networkId: "8453",
      info: { imageSmallUrl: `https://icons.example.test/${name}.png` },
    },
  };
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
        offset: 0,
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

describe("Codex trending memes pages", () => {
  test("advances offset by provider-returned rows and reports truthfully", () => {
    const page = normalizeTrendingMemesPage(
      trendingPayload(
        [
          memeRow("0x1111111111111111111111111111111111111111", "Higher"),
          memeRow("0x2222222222222222222222222222222222222222", "Lower"),
        ],
        0,
      ),
      NOW,
      { offset: 0, limit: 2 },
    );

    expect(page.status).toBe("ready");
    expect(page.assets).toHaveLength(2);
    expect(page.exhausted).toBe(false);
    expect(page.nextOffset).toBe(2);
  });

  test("exhausts when provider returns fewer rows than the requested limit", () => {
    const page = normalizeTrendingMemesPage(
      trendingPayload(
        [memeRow("0x1111111111111111111111111111111111111111", "Higher")],
        48,
      ),
      NOW,
      { offset: 48, limit: CODEX_TRENDING_PAGE_SIZE },
    );

    expect(page.assets).toHaveLength(1);
    expect(page.exhausted).toBe(true);
    expect(page.nextOffset).toBeNull();
  });

  test("deduplicates duplicate contracts without using them for exhaustion", () => {
    const page = normalizeTrendingMemesPage(
      trendingPayload([
        memeRow("0x1111111111111111111111111111111111111111", "Higher"),
        memeRow("0x1111111111111111111111111111111111111111", "Higher"),
        memeRow("0x2222222222222222222222222222222222222222", "Lower"),
      ]),
      NOW,
      { offset: 0, limit: 3 },
    );

    expect(page.assets.map((asset) => asset.id)).toEqual([
      "base:0x1111111111111111111111111111111111111111",
      "base:0x2222222222222222222222222222222222222222",
    ]);
    // Provider returned 3 rows, so next offset stays 3 even though one was dropped.
    expect(page.nextOffset).toBe(3);
    expect(page.exhausted).toBe(false);
  });

  test("rejects an inconsistent provider count", () => {
    const payload = { filterTokens: { results: [memeRow("0x1111111111111111111111111111111111111111", "Higher")], count: 5, page: 0 } };
    expect(() =>
      normalizeTrendingMemesPage(payload, NOW, {
        offset: 0,
        limit: CODEX_TRENDING_PAGE_SIZE,
      }),
    ).toThrow(CodexMarketDataError);
  });

  test("does not cache a failed page and refetches the same offset", async () => {
    let upstreamCalls = 0;
    const reader = createCodexTrendingMemesPageReader({
      apiKey: "fixture-key",
      now: () => NOW,
      fetchImpl: async () => {
        upstreamCalls += 1;
        throw new CodexMarketDataError("fixture envelope failure");
      },
    });

    await expect(reader(0)).rejects.toThrow();
    await expect(reader(0)).rejects.toThrow();
    expect(upstreamCalls).toBe(2);
  });


});

describe("Codex trending meme admission", () => {
  const address = "0x1111111111111111111111111111111111111111";

  function admissionPayload(results: unknown[]) {
    return { filterTokens: { results, count: results.length } };
  }

  test("admits the exact Base meme and rejects non-matching contracts", () => {
    expect(
      normalizeTrendingMemeAdmission(
        admissionPayload([{ token: { address, networkId: "8453" } }]),
        address,
        8453,
      ),
    ).toBe(true);

    expect(
      normalizeTrendingMemeAdmission(
        admissionPayload([
          { token: { address: "0x2222222222222222222222222222222222222222", networkId: "8453" } },
        ]),
        address,
        8453,
      ),
    ).toBe(false);

    expect(
      normalizeTrendingMemeAdmission(admissionPayload([]), address, 8453),
    ).toBe(false);
  });

  test("rejects inconsistent admission metadata and invalid envelopes", () => {
    expect(() =>
      normalizeTrendingMemeAdmission(
        { filterTokens: { results: [{}], count: 5 } },
        address,
        8453,
      ),
    ).toThrow(CodexMarketDataError);
    expect(() =>
      normalizeTrendingMemeAdmission({ filterTokens: {} }, address, 8453),
    ).toThrow(CodexMarketDataError);
  });

  test("queries the provider once per contract and fails closed without a key", async () => {
    const seen: unknown[] = [];
    const reader = createCodexTrendingMemeAdmissionReader({
      apiKey: "fixture-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => {
        seen.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            data: admissionPayload([{ token: { address, networkId: "8453" } }]),
          }),
        );
      },
    });

    expect(await reader(address, 8453)).toBe(true);
    expect(await reader(address, 8453)).toBe(true); // cached
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      variables: {
        tokens: [`${address}:8453`],
        limit: 1,
        filters: {
          network: [8453],
          potentialScam: false,
          trendingIgnored: false,
          categories: { anyOf: [CODEX_TRENDING_MEME_CATEGORY] },
        },
      },
    });

    const noKey = createCodexTrendingMemeAdmissionReader({
      apiKey: "   ",
      fetchImpl: async () => {
        throw new Error("should not contact Codex");
      },
    });
    expect(await noKey(address, 8453)).toBe(false);
    expect(await noKey(address, 137)).toBe(false); // non-Base network
  });
});

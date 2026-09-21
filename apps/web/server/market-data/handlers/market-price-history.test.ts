import "server-only";

import { describe, expect, test } from "bun:test";
import { createMarketPriceHistoryHandler } from "./market-price-history";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const ASSET_ID = `base:${ADDRESS}`;

describe("market price history admission", () => {
  test("a page-2 meme still passes history admission", async () => {
    const admissions: Array<[string, number]> = [];
    const reads: Array<[string, string]> = [];
    const handler = createMarketPriceHistoryHandler(
      async (assetId, range) => {
        reads.push([assetId, range]);
        return {
          version: 1,
          provider: "codex",
          assetId: assetId as `base:0x${string}`,
          range: range as "1W",
          currency: "USD",
          points: [{ time: "2026-09-13T12:00:00.000Z", value: "1.25" }],
          fetchedAt: "2026-09-13T12:01:00.000Z",
          status: "ready",
        };
      },
      async (address, networkId) => {
        admissions.push([address, networkId]);
        return true;
      },
    );

    const response = await handler(new Request(`https://home.invalid/api/market/history?assetId=${ASSET_ID}&range=1W`));

    expect(response.status).toBe(200);
    expect(admissions).toEqual([[ADDRESS, 8453]]);
    expect(reads).toEqual([[ASSET_ID, "1W"]]);
    expect(await response.json()).toMatchObject({ assetId: ASSET_ID, status: "ready" });
  });
});

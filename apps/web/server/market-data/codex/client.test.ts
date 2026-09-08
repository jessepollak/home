import { describe, expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import {
  CodexMarketDataError,
  createCodexMarketPricesReader,
} from "./client";
import {
  CODEX_GRAPHQL_ENDPOINT,
  CODEX_MAX_TOKENS_PER_REQUEST,
  CODEX_PRICE_SOURCE_URL,
  CODEX_TOKEN_PRICES_QUERY,
} from "./config";
import { MARKET_PRICE_DISPLAY_FRESHNESS_MS } from "./public-contract";

const NOW_ISO = "2026-09-07T20:30:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const NOW_SECONDS = Math.floor(NOW_MS / 1_000);
const now = () => new Date(NOW_MS);

function responseFromRows(rows: string, status = 200) {
  return new Response(`{"data":{"getTokenPrices":[${rows}]}}`, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function row({
  address,
  price = "1.25",
  timestamp = String(NOW_SECONDS),
  networkId = "8453",
}: {
  address: string;
  price?: string;
  timestamp?: string;
  networkId?: string;
}) {
  return `{"address":${JSON.stringify(address)},"networkId":${networkId},"priceUsd":${price},"timestamp":${timestamp}}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Codex market price reader", () => {
  test("uses the live GetPriceInput schema contract", () => {
    expect(CODEX_TOKEN_PRICES_QUERY).toContain("$inputs: [GetPriceInput!]!");
    expect(CODEX_TOKEN_PRICES_QUERY).not.toContain("GetTokenPricesInput");
  });

  test("sends one exact allowlisted Base batch and maps reversed scoped records by contract", async () => {
    const seen: { url?: string; init?: RequestInit; body?: unknown } = {};
    const records = [...investAssets]
      .reverse()
      .map((asset, index) =>
        row({ address: asset.contractAddress, price: `${index + 1}.125` }),
      )
      .join(",");
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.url = String(url);
      seen.init = init;
      seen.body = JSON.parse(String(init?.body));
      return responseFromRows(records);
    });

    const result = await createCodexMarketPricesReader({
      apiKey: "fixture-key",
      fetchImpl,
      now,
    })();

    expect(seen.url).toBe(CODEX_GRAPHQL_ENDPOINT);
    expect(seen.init?.method).toBe("POST");
    expect(new Headers(seen.init?.headers).get(["Author", "ization"].join(""))).toBe(
      "fixture-key",
    );
    expect(seen.body).toEqual({
      query: CODEX_TOKEN_PRICES_QUERY,
      variables: {
        inputs: investAssets.map((asset) => ({
          address: asset.contractAddress,
          networkId: asset.chainId,
        })),
      },
    });
    expect(investAssets.length).toBeLessThanOrEqual(CODEX_MAX_TOKENS_PER_REQUEST);
    expect(result.fetchedAt).toBe(NOW_ISO);
    expect(result.markets.stock.status).toBe("ready");
    expect(result.markets.meme.status).toBe("ready");
    if (result.markets.stock.status !== "ready") throw new Error("unreachable");
    expect(result.markets.stock.snapshots.map(({ assetId }) => assetId)).toEqual(
      investAssets
        .filter(({ category }) => category === "stock")
        .map(({ id }) => id),
    );
    expect(result.markets.stock.snapshots[0]?.sourceUrl).toBe(
      CODEX_PRICE_SOURCE_URL,
    );
    expect(result.markets.stock.snapshots[0]?.asOf).toBe(NOW_ISO);
  });

  test("preserves raw decimal lexemes, including tiny prices, without Number coercion", async () => {
    const tiny = "0.0000000000000000001234567890123456789";
    const asset = investAssets[0];
    const reader = createCodexMarketPricesReader({
      apiKey: "fixture-key",
      fetchImpl: (async () =>
        responseFromRows(row({ address: asset.contractAddress, price: tiny }))),
      now,
    });

    const result = await reader();
    const market = result.markets[asset.category];
    expect(market?.status).toBe("ready");
    if (market?.status !== "ready") throw new Error("unreachable");
    expect(market.snapshots).toContainEqual({
      assetId: asset.id,
      displayPrice: `$${tiny}`,
      asOf: NOW_ISO,
      sourceLabel: "Codex",
      sourceUrl: CODEX_PRICE_SOURCE_URL,
    });
  });

  test("keeps allowlisted thinner-market rows older than five minutes when Codex still has coverage", async () => {
    const doge = investAssets.find(({ id }) => id === "cbdoge");
    const ltc = investAssets.find(({ id }) => id === "cbltc");
    const toshi = investAssets.find(({ id }) => id === "toshi");
    if (!doge || !ltc || !toshi) throw new Error("expected invest roster ids");

    const rows = [
      row({
        address: doge.contractAddress,
        price: "0.090026586654",
        timestamp: String(NOW_SECONDS - 6 * 60),
      }),
      row({
        address: ltc.contractAddress,
        price: "54.155267889",
        timestamp: String(NOW_SECONDS - 9 * 60),
      }),
      row({
        address: toshi.contractAddress,
        price: "0.000122856768656",
        timestamp: String(NOW_SECONDS - 17 * 60),
      }),
    ].join(",");
    const result = await createCodexMarketPricesReader({
      apiKey: "fixture-key",
      fetchImpl: (async () => responseFromRows(rows)),
      now,
    })();

    const crypto = result.markets.crypto;
    const meme = result.markets.meme;
    expect(crypto?.status).toBe("ready");
    expect(meme?.status).toBe("ready");
    if (crypto?.status !== "ready" || meme?.status !== "ready") {
      throw new Error("unreachable");
    }
    expect(crypto.snapshots.map(({ assetId, displayPrice }) => [assetId, displayPrice])).toEqual([
      ["cbdoge", "$0.090026586654"],
      ["cbltc", "$54.155267889"],
    ]);
    expect(meme.snapshots.map(({ assetId, displayPrice }) => [assetId, displayPrice])).toEqual([
      ["toshi", "$0.000122856768656"],
    ]);
  });

  test("treats null, zero, negative, malformed, stale, future, duplicate, and out-of-scope records as unavailable", async () => {
    const [first, second, third, fourth, fifth, sixth] = investAssets;
    const stale = NOW_SECONDS - MARKET_PRICE_DISPLAY_FRESHNESS_MS / 1_000 - 1;
    const future = NOW_SECONDS + 61;
    const rows = [
      "null",
      row({ address: first.contractAddress, price: "0" }),
      row({ address: second.contractAddress, price: "-1" }),
      row({ address: third.contractAddress, price: "null" }),
      row({ address: fourth.contractAddress, timestamp: String(stale) }),
      row({ address: fifth.contractAddress, timestamp: String(future) }),
      row({ address: sixth.contractAddress, price: "2" }),
      row({ address: sixth.contractAddress, price: "3" }),
      row({
        address: "0x1111111111111111111111111111111111111111",
        price: "4",
      }),
      row({ address: first.contractAddress, price: "5", networkId: "1" }),
      "{\"address\":42}",
    ].join(",");
    const result = await createCodexMarketPricesReader({
      apiKey: "fixture-key",
      fetchImpl: (async () => responseFromRows(rows)),
      now,
    })();

    for (const market of Object.values(result.markets)) {
      expect(market.status).toBe("ready");
      if (market.status === "ready") expect(market.snapshots).toEqual([]);
    }
  });

  test("uses the production cache path and coalesces concurrent reads", async () => {
    const pending = deferred<Response>();
    let calls = 0;
    let currentTime = NOW_MS;
    const reader = createCodexMarketPricesReader({
      apiKey: "fixture-key",
      fetchImpl: (() => {
        calls += 1;
        return pending.promise;
      }),
      now: () => new Date(currentTime),
    });

    const first = reader();
    const second = reader();
    expect(calls).toBe(1);
    pending.resolve(responseFromRows(""));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);

    currentTime += 44_999;
    const cached = await reader();
    expect(calls).toBe(1);
    expect(cached).toBe(firstResult);
  });

  test("refreshes after the 45-second process cache expires", async () => {
    let calls = 0;
    let currentTime = NOW_MS;
    const reader = createCodexMarketPricesReader({
      apiKey: "fixture-key",
      fetchImpl: (async () => {
        calls += 1;
        return responseFromRows("");
      }),
      now: () => new Date(currentTime),
    });

    await reader();
    currentTime += 45_001;
    await reader();
    expect(calls).toBe(2);
  });

  test("does not call the network when the server-only key is missing", async () => {
    let calls = 0;
    const result = await createCodexMarketPricesReader({
      apiKey: undefined,
      fetchImpl: (async () => {
        calls += 1;
        throw new Error("must not run");
      }),
      now,
    })();

    expect(calls).toBe(0);
    expect(result.unavailableReason).toBe("not-configured");
    expect(result.fetchedAt).toBeNull();
    expect(Object.values(result.markets).every(({ status }) => status === "unavailable")).toBeTrue();
  });

  test("bounds a hanging upstream request with a timeout", async () => {
    const reader = createCodexMarketPricesReader({
      apiKey: "fixture-key",
      timeoutMs: 5,
      now,
      fetchImpl: ((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        })),
    });

    await expect(reader()).rejects.toThrow("timed out");
  });

  test("surfaces 429 and GraphQL failures without normalizing them as prices", async () => {
    const rateLimited = createCodexMarketPricesReader({
      apiKey: "fixture-key",
      fetchImpl: (async () => new Response("rate limited", { status: 429 })),
      now,
    });
    await expect(rateLimited()).rejects.toBeInstanceOf(CodexMarketDataError);

    const graphError = createCodexMarketPricesReader({
      apiKey: "fixture-key",
      fetchImpl: (async () =>
        Response.json({ data: null, errors: [{ message: "private upstream detail" }] })),
      now,
    });
    await expect(graphError()).rejects.toThrow("returned an error");
  });
});

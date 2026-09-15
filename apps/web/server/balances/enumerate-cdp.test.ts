import { describe, expect, test } from "bun:test";
import {
  CDP_NATIVE_TOKEN_ADDRESS,
  CDP_TOKEN_BALANCES_MAX_PAGES,
  CdpTokenBalancesError,
  createCdpTokenBalancesClient,
  parseNextPageToken,
  tokenBalancesRequestPath,
} from "./enumerate-cdp";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const IDRX = "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22";
const configuredEnv = {
  CDP_API_KEY_ID: "key-id",
  ["CDP_API_KEY_" + "SECRET"]: "secret",
};

function token(
  contractAddress: string,
  amount: string,
  options: {
    amount?: Record<string, unknown>;
    token?: Record<string, unknown>;
  } = {},
) {
  return {
    amount: { amount, decimals: 18, ...options.amount },
    token: {
      network: "base",
      symbol: "TKN",
      name: "Token",
      contractAddress,
      ...options.token,
    },
  };
}

describe("CDP Onchain Data Token Balances client", () => {
  test("pins the Onchain Data GET path and server API-key JWT family", async () => {
    const jwtOptions: unknown[] = [];
    const urls: string[] = [];
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async (options) => {
        jwtOptions.push(options);
        return "signed-jwt";
      },
      fetchImpl: (async (input, init) => {
        urls.push(String(input));
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer signed-jwt");
        return Response.json({
          balances: [
            token("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "3"),
            token(USDC, "1000000"),
          ],
        });
      }) as typeof fetch,
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(jwtOptions).toEqual([
      {
        apiKeyId: "key-id",
        apiKeySecret: "secret",
        requestMethod: "GET",
        requestHost: "api.cdp.coinbase.com",
        requestPath: tokenBalancesRequestPath(ADDRESS),
        expiresIn: 120,
      },
    ]);
    expect(urls[0]).toBe(
      `https://api.cdp.coinbase.com/platform/v2/data/evm/token-balances/base/${ADDRESS}?pageSize=100`,
    );
    expect(tokenBalancesRequestPath(ADDRESS)).toBe(
      `/platform/v2/data/evm/token-balances/base/${ADDRESS}`,
    );
    expect(listed).toMatchObject({
      complete: true,
      balances: [
        {
          contractAddress: USDC.toLowerCase() as `0x${string}`,
          amountBaseUnits: "1000000",
          name: "Token",
          symbol: "TKN",
          decimals: 18,
        },
      ],
    });
  });

  test("parses bounded metadata, drops invalid optional fields, and skips native", async () => {
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => Response.json({
        balances: [
          token(CDP_NATIVE_TOKEN_ADDRESS, "1"),
          token(USDC, "2", {
            token: { name: "  USD Coin  ", symbol: "USDC" },
            amount: { decimals: 6 },
          }),
          token(IDRX, "3", {
            token: { name: "", symbol: "x".repeat(65) },
            amount: { decimals: 256 },
          }),
        ],
      }),
    });

    await expect(client.listBalances({ address: ADDRESS })).resolves.toMatchObject({
      complete: true,
      balances: [
        {
          contractAddress: USDC.toLowerCase() as `0x${string}`,
          amountBaseUnits: "2",
          name: "USD Coin",
          symbol: "USDC",
          decimals: 6,
        },
        {
          contractAddress: IDRX,
          amountBaseUnits: "3",
        },
      ],
    });
  });

  test("carries the official pageToken and pageSize=100 on pagination requests", async () => {
    const official =
      "eyJsYXN0X2lkIjogImFiYzEyMyIsICJ0aW1lc3RhbXAiOiAxNzA3ODIzNzAxfQ==";
    expect(parseNextPageToken(official)).toBe(official);
    expect(parseNextPageToken("page-two")).toBe("page-two");
    expect(parseNextPageToken("abc+def/ghi=")).toBe("abc+def/ghi=");
    expect(parseNextPageToken("has space")).toBeUndefined();

    const urls: string[] = [];
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: (async (input) => {
        urls.push(String(input));
        return urls.length === 1
          ? Response.json({ balances: [token(USDC, "1")], nextPageToken: official })
          : Response.json({ balances: [token(IDRX, "2")] });
      }) as typeof fetch,
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(urls[1]).toBe(
      `https://api.cdp.coinbase.com/platform/v2/data/evm/token-balances/base/${ADDRESS}?pageSize=100&pageToken=${encodeURIComponent(official)}`,
    );
    expect(listed.complete).toBeTrue();
    expect(listed.balances.map(({ amountBaseUnits }) => amountBaseUnits)).toEqual(["1", "2"]);
  });

  test("starts from a supplied resume page token", async () => {
    const urls: string[] = [];
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: (async (input) => {
        urls.push(String(input));
        return Response.json({ balances: [token(IDRX, "2")] });
      }) as typeof fetch,
    });

    const listed = await client.listBalances({
      address: ADDRESS,
      pageToken: "page-two",
    });
    expect(urls[0]).toContain("pageToken=page-two");
    expect(listed).toMatchObject({
      complete: true,
      nextPageToken: null,
      pagesRead: 1,
    });
  });

  test("keeps a slow successful first page even when it finishes after the soft start budget", async () => {
    let clock = 0;
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      pageStartBudgetMs: 2_500,
      now: () => clock,
      fetchImpl: async () => {
        calls += 1;
        clock = 3_000;
        return Response.json({
          balances: [token(USDC, "1")],
          nextPageToken: "page-two",
        });
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(calls).toBe(1);
    expect(listed).toMatchObject({
      complete: false,
      nextPageToken: "page-two",
      pagesRead: 1,
      durationMs: 3_000,
      balances: [{ amountBaseUnits: "1" }],
    });
  });

  test("lets a healthy in-flight page finish after the soft budget then stops", async () => {
    let clock = 0;
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      pageStartBudgetMs: 2_500,
      now: () => clock,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          clock = 2_000;
          return Response.json({ balances: [token(USDC, "1")], nextPageToken: "page-two" });
        }
        clock = 3_000;
        return Response.json({ balances: [token(IDRX, "2")], nextPageToken: "page-three" });
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(calls).toBe(2);
    expect(listed).toMatchObject({
      complete: false,
      nextPageToken: "page-three",
      pagesRead: 2,
      durationMs: 3_000,
    });
    expect(listed.balances.map(({ amountBaseUnits }) => amountBaseUnits)).toEqual(["1", "2"]);
  });

  test("bounds a stalled first page with the hard page ceiling", async () => {
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      timeoutMs: 10,
      pageAttempts: 1,
      fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });

    await expect(client.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      code: "timed-out",
    });
  });

  test("returns every collected row as incomplete when the page budget is exhausted", async () => {
    let pages = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        pages += 1;
        return Response.json({
          balances: [token(`0x${pages.toString(16).padStart(40, "0")}`, String(pages))],
          nextPageToken: `page-${pages + 1}`,
        });
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(pages).toBe(CDP_TOKEN_BALANCES_MAX_PAGES);
    expect(listed.complete).toBeFalse();
    expect(listed.balances).toHaveLength(CDP_TOKEN_BALANCES_MAX_PAGES);
    expect(listed.balances.at(-1)?.amountBaseUnits).toBe(String(CDP_TOKEN_BALANCES_MAX_PAGES));
  });

  test("keeps collected rows when a transient middle page fails after retry", async () => {
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json({
            balances: [token(USDC, "1000000")],
            nextPageToken: "page-two",
          });
        }
        throw new Error("connection reset");
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(calls).toBe(3);
    expect(listed).toMatchObject({
      complete: false,
      balances: [{
        contractAddress: USDC.toLowerCase() as `0x${string}`,
        amountBaseUnits: "1000000",
        name: "Token",
        symbol: "TKN",
        decimals: 18,
      }],
    });
  });

  test("keeps collected rows as incomplete when a later page remains rate-limited", async () => {
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json({
            balances: [token(USDC, "42")],
            nextPageToken: "page-two",
          });
        }
        return new Response("slow down", { status: 429 });
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(calls).toBe(3);
    expect(listed).toMatchObject({
      complete: false,
      balances: [{
        contractAddress: USDC.toLowerCase() as `0x${string}`,
        amountBaseUnits: "42",
        name: "Token",
        symbol: "TKN",
        decimals: 18,
      }],
    });
  });

  test("fails with CdpTokenBalancesError when the first page fails after retry", async () => {
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => new Response("slow down", { status: 429 }),
    });
    await expect(client.listBalances({ address: ADDRESS })).rejects.toBeInstanceOf(
      CdpTokenBalancesError,
    );
    await expect(client.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      code: "rate-limited",
    });
  });

  test("treats 404 as empty and fails closed on auth or missing configuration", async () => {
    const empty = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    await expect(empty.listBalances({ address: ADDRESS })).resolves.toMatchObject({
      balances: [],
      complete: true,
    });

    const unauthorized = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => new Response("no", { status: 401 }),
    });
    await expect(unauthorized.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      code: "unauthorized",
    });

    const missing = createCdpTokenBalancesClient({ env: {} });
    await expect(missing.listBalances({ address: ADDRESS })).rejects.toBeInstanceOf(
      CdpTokenBalancesError,
    );
  });
});

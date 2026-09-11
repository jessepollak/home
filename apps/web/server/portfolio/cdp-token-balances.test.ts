import { describe, expect, test } from "bun:test";
import {
  CDP_NATIVE_TOKEN_ADDRESS,
  CDP_TOKEN_BALANCES_MAX_PAGES,
  CdpTokenBalancesError,
  createCdpTokenBalancesClient,
  parseNextPageToken,
  tokenBalancesRequestPath,
} from "./cdp-token-balances";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const IDRX = "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22";

function token(
  contractAddress: string,
  amount: string,
  extras: Record<string, unknown> = {},
) {
  return {
    amount: { amount, decimals: 99, ...extras },
    token: {
      network: "base",
      symbol: "IGNORE",
      name: "ignore",
      contractAddress,
    },
  };
}

describe("CDP Onchain Data Token Balances client", () => {
  test("pins the Onchain Data GET path and server API-key JWT family", async () => {
    const jwtOptions: unknown[] = [];
    const urls: string[] = [];
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async (options) => {
        jwtOptions.push(options);
        return "signed-jwt";
      },
      fetchImpl: (async (input, init) => {
        urls.push(String(input));
        expect(init?.method).toBe("GET");
        expect(init?.headers).toMatchObject({ authorization: "Bearer signed-jwt" });
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
        apiKeySecret: "key-secret",
        requestMethod: "GET",
        requestHost: "api.cdp.coinbase.com",
        requestPath: tokenBalancesRequestPath(ADDRESS),
        expiresIn: 120,
      },
    ]);
    expect(urls[0]).toBe(
      `https://api.cdp.coinbase.com/platform/v2/data/evm/token-balances/base/${ADDRESS}?pageSize=20`,
    );
    expect(tokenBalancesRequestPath(ADDRESS)).toBe(
      `/platform/v2/data/evm/token-balances/base/${ADDRESS}`,
    );
    expect(listed).toEqual({
      complete: true,
      balances: [
        {
          contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
          amountBaseUnits: "3",
          native: true,
        },
        {
          contractAddress: USDC.toLowerCase() as `0x${string}`,
          amountBaseUnits: "1000000",
          native: false,
        },
      ],
    });
  });

  test("accepts the official CDP base64 nextPageToken including padding", async () => {
    const official =
      "eyJsYXN0X2lkIjogImFiYzEyMyIsICJ0aW1lc3RhbXAiOiAxNzA3ODIzNzAxfQ==";
    expect(parseNextPageToken(official)).toBe(official);
    expect(parseNextPageToken("page-two")).toBe("page-two");
    expect(parseNextPageToken("abc+def/ghi=")).toBe("abc+def/ghi=");
    expect(parseNextPageToken("has space")).toBeUndefined();

    const urls: string[] = [];
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: (async (input) => {
        urls.push(String(input));
        if (urls.length === 1) {
          return Response.json({
            balances: [token("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "1")],
            nextPageToken: official,
          });
        }
        return Response.json({
          balances: [token(USDC, "1000000"), token(IDRX, "2500")],
        });
      }) as typeof fetch,
    });

    const listed = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([USDC.toLowerCase(), IDRX]),
    });
    expect(urls[1]).toBe(
      `https://api.cdp.coinbase.com/platform/v2/data/evm/token-balances/base/${ADDRESS}?pageSize=20&pageToken=${encodeURIComponent(official)}`,
    );
    expect(listed.complete).toBeTrue();
    expect(
      listed.balances.some(
        ({ contractAddress, amountBaseUnits }) =>
          contractAddress === USDC.toLowerCase() && amountBaseUnits === "1000000",
      ),
    ).toBeTrue();
    expect(
      listed.balances.some(
        ({ contractAddress, amountBaseUnits }) =>
          contractAddress === IDRX && amountBaseUnits === "2500",
      ),
    ).toBeTrue();
  });

  test("paginates until the allowlist is satisfied and then stops", async () => {
    const urls: string[] = [];
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: (async (input) => {
        urls.push(String(input));
        if (urls.length === 1) {
          return Response.json({
            balances: [token(USDC, "1")],
            nextPageToken: "page-two",
          });
        }
        return Response.json({
          balances: [
            token(IDRX, "2500"),
            token("0x9999999999999999999999999999999999999999", "9"),
          ],
          nextPageToken: "page-three",
        });
      }) as typeof fetch,
    });

    const listed = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([USDC.toLowerCase(), IDRX]),
    });
    expect(urls).toEqual([
      `https://api.cdp.coinbase.com/platform/v2/data/evm/token-balances/base/${ADDRESS}?pageSize=20`,
      `https://api.cdp.coinbase.com/platform/v2/data/evm/token-balances/base/${ADDRESS}?pageSize=20&pageToken=page-two`,
    ]);
    expect(listed.complete).toBeTrue();
    expect(listed.balances.map(({ contractAddress }) => contractAddress)).toEqual([
      USDC.toLowerCase() as `0x${string}`,
      IDRX,
      "0x9999999999999999999999999999999999999999" as `0x${string}`,
    ]);
  });

  test("finds a needed supported token after more than 160 synthetic balances", async () => {
    let pages = 0;
    const needed = USDC.toLowerCase() as `0x${string}`;
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        pages += 1;
        const balances = Array.from({ length: 20 }, (_, index) =>
          token(
            `0x${((pages - 1) * 20 + index + 1).toString(16).padStart(40, "0")}`,
            "1",
          ),
        );
        if (pages === 9) balances[7] = token(needed, "2500000");
        return Response.json({
          balances,
          nextPageToken: `page-${pages + 1}`,
        });
      },
    });

    const listed = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([needed]),
    });
    expect(pages).toBe(9);
    expect(listed.complete).toBeTrue();
    expect(listed.balances.find(({ contractAddress }) => contractAddress === needed)).toEqual({
      contractAddress: needed,
      amountBaseUnits: "2500000",
      native: false,
    });
  });

  test("marks the page set incomplete when the page budget ends with a remaining cursor", async () => {
    let pages = 0;
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        pages += 1;
        return Response.json({
          balances: [token(`0x${pages.toString(16).padStart(40, "0")}`, "1")],
          nextPageToken: `page-${pages + 1}`,
        });
      },
    });

    const listed = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([IDRX]),
    });
    expect(pages).toBe(CDP_TOKEN_BALANCES_MAX_PAGES);
    expect(listed.complete).toBeFalse();
    expect(listed.balances.some(({ contractAddress }) => contractAddress === IDRX)).toBeFalse();
  });

  test("retries a transient middle page and continues without losing quantities", async () => {
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json({
            balances: [token(USDC, "1000000")],
            nextPageToken: "page-two",
          });
        }
        if (calls === 2) return new Response("slow down", { status: 429 });
        return Response.json({ balances: [token(IDRX, "2500")] });
      },
    });

    const listed = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([USDC.toLowerCase(), IDRX]),
    });
    expect(calls).toBe(3);
    expect(listed.complete).toBeTrue();
    expect(listed.balances.map(({ amountBaseUnits }) => amountBaseUnits)).toEqual([
      "1000000",
      "2500",
    ]);
  });

  test("resumes a failed middle page from a bounded same-owner checkpoint", async () => {
    let calls = 0;
    let middleFailures = 0;
    const client = createCdpTokenBalancesClient({
      pageAttempts: 2,
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async (input) => {
        calls += 1;
        const pageToken = new URL(String(input)).searchParams.get("pageToken");
        if (pageToken === null) {
          return Response.json({
            balances: [token(USDC, "1000000")],
            nextPageToken: "page-two",
          });
        }
        if (middleFailures < 2) {
          middleFailures += 1;
          return new Response("slow down", { status: 429 });
        }
        return Response.json({ balances: [token(IDRX, "2500")] });
      },
    });

    const first = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([IDRX]),
    });
    expect(first).toMatchObject({ complete: false });
    expect(first.balances[0]?.amountBaseUnits).toBe("1000000");

    const second = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([IDRX]),
    });
    expect(calls).toBe(4);
    expect(second.complete).toBeFalse();
    expect(second.balances.map(({ amountBaseUnits }) => amountBaseUnits)).toEqual([
      "1000000",
      "2500",
    ]);
    expect(second.authoritativeContractAddresses).toEqual(new Set([IDRX]));
  });

  test("expires a repeatedly failing checkpoint from the original observation time", async () => {
    let currentTime = 0;
    let pageOneCalls = 0;
    let continuationFailures = 0;
    const client = createCdpTokenBalancesClient({
      cacheTtlMs: 60_000,
      pageAttempts: 1,
      now: () => currentTime,
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async (input) => {
        const pageToken = new URL(String(input)).searchParams.get("pageToken");
        if (pageToken === null) {
          pageOneCalls += 1;
          return Response.json({
            balances: [token(USDC, pageOneCalls === 1 ? "1000000" : "2000000")],
            nextPageToken: "page-two",
          });
        }
        if (continuationFailures < 2) {
          continuationFailures += 1;
          return new Response("slow down", { status: 429 });
        }
        return Response.json({ balances: [token(IDRX, "2500")] });
      },
    });

    const request = {
      address: ADDRESS,
      neededContractAddresses: new Set([IDRX]),
    };
    expect(await client.listBalances(request)).toMatchObject({ complete: false });

    currentTime = 59_000;
    expect(await client.listBalances(request)).toMatchObject({ complete: false });

    currentTime = 118_000;
    const recovered = await client.listBalances(request);
    expect(pageOneCalls).toBe(2);
    expect(recovered.complete).toBeTrue();
    expect(
      recovered.balances.find(
        ({ contractAddress }) => contractAddress === USDC.toLowerCase(),
      )?.amountBaseUnits,
    ).toBe("2000000");
  });

  test("stops safely when an upstream cursor is exhausted without advancing", async () => {
    let pages = 0;
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        pages += 1;
        return Response.json({
          balances: [token(USDC, "1000000")],
          nextPageToken: "stuck",
        });
      },
    });

    const listed = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([IDRX]),
    });
    expect(pages).toBe(2);
    expect(listed.complete).toBeFalse();
    expect(listed.balances[0]?.amountBaseUnits).toBe("1000000");
  });

  test("keeps already-listed balances when a later page is rate-limited", async () => {
    let pages = 0;
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        pages += 1;
        if (pages === 1) {
          return Response.json({
            balances: [token("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "42")],
            nextPageToken: "page-two",
          });
        }
        return new Response("slow down", { status: 429 });
      },
    });

    const listed = await client.listBalances({
      address: ADDRESS,
      neededContractAddresses: new Set([IDRX]),
    });
    expect(pages).toBe(3);
    expect(listed.complete).toBeFalse();
    expect(listed.balances).toEqual([
      {
        contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
        amountBaseUnits: "42",
        native: true,
      },
    ]);
  });

  test("still fails closed when the first Token Balances page is rate-limited", async () => {
    const client = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => new Response("slow down", { status: 429 }),
    });
    await expect(client.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      name: "CdpTokenBalancesError",
      code: "rate-limited",
    });
  });

  test("treats 404 as an empty page set and fails closed on auth or upstream errors", async () => {
    const empty = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    await expect(empty.listBalances({ address: ADDRESS })).resolves.toEqual({
      balances: [],
      complete: true,
    });

    const unauthorized = createCdpTokenBalancesClient({
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => new Response("no", { status: 401 }),
    });
    await expect(unauthorized.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      name: "CdpTokenBalancesError",
      code: "unauthorized",
    });

    const missing = createCdpTokenBalancesClient({ env: {} });
    await expect(missing.listBalances({ address: ADDRESS })).rejects.toBeInstanceOf(
      CdpTokenBalancesError,
    );
  });
});

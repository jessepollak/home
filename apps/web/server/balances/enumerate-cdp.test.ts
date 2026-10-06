import { describe, expect, test } from "bun:test";
import {
  CDP_NATIVE_TOKEN_ADDRESS,
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

function createDeadlineClock() {
  let clock = 0;
  const timers = new Set<{ at: number; controller: AbortController }>();
  const scheduledDelays: number[] = [];
  return {
    now: () => clock,
    scheduledDelays,
    timeout: (ms: number) => {
      const controller = new AbortController();
      timers.add({ at: clock + ms, controller });
      scheduledDelays.push(ms);
      return controller.signal;
    },
    advanceTo: (target: number) => {
      while (true) {
        const timer = [...timers].sort((a, b) => a.at - b.at)[0];
        if (!timer || timer.at > target) break;
        clock = timer.at;
        timers.delete(timer);
        timer.controller.abort();
      }
      clock = target;
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

  test("stops when the provider repeats a page token", async () => {
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ balances: [token(USDC, "1")], nextPageToken: "same-token" })
          : Response.json({ balances: [token(IDRX, "2")], nextPageToken: "same-token" });
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(calls).toBe(2);
    expect(listed).toMatchObject({
      complete: false,
      nextPageToken: "same-token",
      pagesRead: 2,
    });
    expect(listed.balances.map(({ amountBaseUnits }) => amountBaseUnits)).toEqual(["1", "2"]);
    expect(listed).not.toHaveProperty("interruption");
  });

  test("keeps a slow first page that finishes before the inventory deadline", async () => {
    let clock = 0;
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      pageStartBudgetMs: 2_500,
      clock: { now: () => clock, timeout: () => new AbortController().signal },
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
    expect(listed).not.toHaveProperty("interruption");
  });

  test("keeps a second page that finishes before the inventory deadline then stops starting pages", async () => {
    let clock = 0;
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      pageStartBudgetMs: 2_500,
      clock: { now: () => clock, timeout: () => new AbortController().signal },
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

  test("aborts a stalled later page at the inventory deadline and retains its resume cursor", async () => {
    const clock = createDeadlineClock();
    const started = Promise.withResolvers<void>();
    let calls = 0;
    let abortedAt: number | undefined;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      clock,
      fetchImpl: (_input, init) => {
        calls += 1;
        if (calls === 1) {
          clock.advanceTo(2_400);
          return Promise.resolve(Response.json({
            balances: [token(USDC, "42")],
            nextPageToken: "page-two",
          }));
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            abortedAt = clock.now();
            reject(new Error("aborted"));
          }, { once: true });
          started.resolve();
        });
      },
    });

    const pending = client.listBalances({ address: ADDRESS });
    await started.promise;
    expect(clock.scheduledDelays).toEqual([4_000]);
    clock.advanceTo(4_000);
    const listed = await pending;
    expect(abortedAt).toBe(4_000);
    expect(calls).toBe(2);
    expect(listed).toMatchObject({
      durationMs: 4_000,
      complete: false,
      nextPageToken: "page-two",
      pagesRead: 1,
      interruption: "timed-out",
      detail: "page-ceiling",
      balances: [{ contractAddress: USDC.toLowerCase(), amountBaseUnits: "42" }],
    });
  });

  test("retains earlier rows and the cursor when a later response body stalls until the deadline", async () => {
    const clock = createDeadlineClock();
    const started = Promise.withResolvers<void>();
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      clock,
      fetchImpl: async (_input, init) => {
        calls += 1;
        if (calls === 1) {
          clock.advanceTo(2_400);
          return Response.json({
            balances: [token(USDC, "42")],
            nextPageToken: "page-two",
          });
        }
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              controller.error(new Error("body aborted"));
            }, { once: true });
          },
          pull() {
            started.resolve();
            return new Promise<void>(() => {});
          },
        }, { highWaterMark: 0 }));
      },
    });

    const pending = client.listBalances({ address: ADDRESS });
    await started.promise;
    clock.advanceTo(4_000);
    await expect(pending).resolves.toMatchObject({
      durationMs: 4_000,
      complete: false,
      nextPageToken: "page-two",
      pagesRead: 1,
      balances: [{ contractAddress: USDC.toLowerCase(), amountBaseUnits: "42" }],
    });
    expect(calls).toBe(2);
  });

  test("retains earlier rows and the cursor when later JWT generation never settles", async () => {
    const clock = createDeadlineClock();
    const started = Promise.withResolvers<void>();
    let jwtCalls = 0;
    let fetchCalls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => {
        jwtCalls += 1;
        if (jwtCalls === 1) return "signed-jwt";
        started.resolve();
        return new Promise<string>(() => {});
      },
      clock,
      fetchImpl: async () => {
        fetchCalls += 1;
        clock.advanceTo(2_400);
        return Response.json({
          balances: [token(USDC, "42")],
          nextPageToken: "page-two",
        });
      },
    });

    const pending = client.listBalances({ address: ADDRESS });
    await started.promise;
    clock.advanceTo(4_000);
    await expect(pending).resolves.toMatchObject({
      durationMs: 4_000,
      complete: false,
      nextPageToken: "page-two",
      pagesRead: 1,
      balances: [{ contractAddress: USDC.toLowerCase(), amountBaseUnits: "42" }],
    });
    expect(jwtCalls).toBe(2);
    expect(fetchCalls).toBe(1);
  });

  test("gives a later-page retry only the remaining inventory deadline", async () => {
    const clock = createDeadlineClock();
    const started = Promise.withResolvers<void>();
    let calls = 0;
    let abortedAt: number | undefined;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      clock,
      fetchImpl: (_input, init) => {
        calls += 1;
        if (calls === 1) {
          clock.advanceTo(2_400);
          return Promise.resolve(Response.json({
            balances: [token(USDC, "42")],
            nextPageToken: "page-two",
          }));
        }
        if (calls === 2) {
          clock.advanceTo(3_000);
          return Promise.resolve(new Response("unavailable", { status: 503 }));
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            abortedAt = clock.now();
            reject(new Error("aborted"));
          }, { once: true });
          started.resolve();
        });
      },
    });

    const pending = client.listBalances({ address: ADDRESS });
    await started.promise;
    expect(clock.scheduledDelays).toEqual([4_000]);
    clock.advanceTo(4_000);
    await expect(pending).resolves.toMatchObject({
      durationMs: 4_000,
      complete: false,
      nextPageToken: "page-two",
      pagesRead: 1,
      balances: [{ amountBaseUnits: "42" }],
    });
    expect(abortedAt).toBe(4_000);
    expect(calls).toBe(3);
  });

  test("rejects a stalled first page at the inventory deadline", async () => {
    const clock = createDeadlineClock();
    const started = Promise.withResolvers<void>();
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      deadlineMs: 10,
      pageStartBudgetMs: 5,
      clock,
      fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
        calls += 1;
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        started.resolve();
      }),
    });

    const pending = client.listBalances({ address: ADDRESS });
    await started.promise;
    clock.advanceTo(10);
    await expect(pending).rejects.toMatchObject({ code: "timed-out" });
    expect(calls).toBe(1);
  });

  test.each([
    { name: "malformed JSON", body: "{", status: 200, code: "invalid-response", detail: "malformed-json" },
    { name: "invalid envelope", body: "{}", status: 200, code: "invalid-response", detail: "invalid-envelope" },
    { name: "malformed amount", body: JSON.stringify({ balances: [token(USDC, "1.5")] }), status: 200, code: "invalid-response", detail: "malformed-amount" },
    { name: "out-of-range amount", body: JSON.stringify({ balances: [token(USDC, (BigInt(1) << BigInt(256)).toString())] }), status: 200, code: "invalid-response", detail: "amount-out-of-range" },
    { name: "page ceiling", body: "", status: 200, code: "timed-out", detail: "page-ceiling" },
    { name: "page ceiling during the body", body: "", status: 200, code: "timed-out", detail: "page-ceiling" },
    { name: "504", body: "timeout", status: 504, code: "timed-out", detail: "upstream-status" },
  ])("classifies $name without accepting invalid inventory", async ({ name, body, status, code, detail }) => {
    const clock = createDeadlineClock();
    const started = Promise.withResolvers<void>();
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      deadlineMs: 4_000,
      pageAttempts: 1,
      clock,
      fetchImpl: (_input, init) => {
        if (name === "page ceiling during the body") {
          return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
            },
            pull() {
              started.resolve();
              return new Promise<void>(() => {});
            },
          }, { highWaterMark: 0 }), { status }));
        }
        started.resolve();
        if (detail !== "page-ceiling") return Promise.resolve(new Response(body, { status }));
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    });
    const failure = client.listBalances({ address: ADDRESS }).then(
      () => { throw new Error("expected inventory failure"); },
      (error: unknown) => error,
    );
    await started.promise;
    if (detail === "page-ceiling") clock.advanceTo(4_000);
    expect(await failure).toMatchObject({ code, detail, pagesRead: 0 });
  });

  test.each([
    { name: "oversized", laterPage: false, detail: "oversized-body" },
    { name: "oversized", laterPage: true, detail: "oversized-body" },
    { name: "truncated", laterPage: false, detail: "malformed-json" },
    { name: "truncated", laterPage: true, detail: "malformed-json" },
  ])("rejects a $name success body with earlier inventory: $laterPage", async ({ name, laterPage, detail }) => {
    const payload = JSON.stringify({ balances: [token(IDRX, "2")] });
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        calls += 1;
        if (laterPage && calls === 1) {
          return Response.json({ balances: [token(USDC, "1")], nextPageToken: "page-two" });
        }
        return name === "oversized"
          ? new Response(payload + " ".repeat(1024 * 1024))
          : new Response(payload, {
            headers: { "content-length": String(new TextEncoder().encode(payload).byteLength + 1) },
          });
      },
    });

    await expect(client.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      code: "invalid-response",
      detail,
      pagesRead: laterPage ? 1 : 0,
    });
    expect(calls).toBe(laterPage ? 2 : 1);
  });

  test("rejects a first page when its inventory deadline expires during the body read", async () => {
    let now = 0;
    let calls = 0;
    const scheduledDelays: number[] = [];
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      clock: {
        now: () => now,
        timeout: (ms) => {
          scheduledDelays.push(ms);
          return new AbortController().signal;
        },
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            now = 4_000;
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ balances: [token(USDC, "1")] })));
            controller.close();
          },
        }, { highWaterMark: 0 }));
      },
    });

    await expect(client.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      code: "timed-out",
      detail: "page-ceiling",
      pagesRead: 0,
    });
    expect(calls).toBe(1);
    expect(scheduledDelays).toEqual([4_000]);
  });

  test("fails the whole enumeration with one page read when page two has a malformed amount", async () => {
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ balances: [token(USDC, "1000000")], nextPageToken: "page-two" })
          : Response.json({ balances: [token(IDRX, "malformed")] });
      },
    });
    await expect(client.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      code: "invalid-response",
      detail: "malformed-amount",
      pagesRead: 1,
    });
    expect(calls).toBe(2);
  });

  test("retries a body-read transport failure with budget remaining", async () => {
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      clock: { now: () => 0, timeout: () => new AbortController().signal },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(new ReadableStream({
            start(controller) {
              controller.error(new Error("connection reset"));
            },
          }), { status: 200 });
        }
        return Response.json({ balances: [token(USDC, "42")] });
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(calls).toBe(2);
    expect(listed).toMatchObject({
      complete: true,
      pagesRead: 1,
      balances: [{ amountBaseUnits: "42" }],
    });
  });

  test("rejects a first page whose inventory deadline expired before it started", async () => {
    let reads = 0;
    let calls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      clock: {
        now: () => (reads++ === 0 ? 0 : 10_000),
        timeout: () => new AbortController().signal,
      },
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ balances: [token(USDC, "1")] });
      },
    });

    await expect(client.listBalances({ address: ADDRESS })).rejects.toMatchObject({
      code: "timed-out",
      detail: "page-ceiling",
    });
    expect(calls).toBe(0);
  });

  test("carries the inventory deadline detail when a later page crosses the deadline before its fetch", async () => {
    let clock = 0;
    let jwtCalls = 0;
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => {
        jwtCalls += 1;
        if (jwtCalls > 1) clock = 4_500;
        return "signed-jwt";
      },
      pageStartBudgetMs: 4_000,
      clock: { now: () => clock, timeout: () => new AbortController().signal },
      fetchImpl: async () => {
        clock = 3_000;
        return Response.json({ balances: [token(USDC, "42")], nextPageToken: "page-two" });
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(listed).toMatchObject({
      complete: false,
      nextPageToken: "page-two",
      pagesRead: 1,
      detail: "page-ceiling",
      balances: [{ amountBaseUnits: "42" }],
    });
  });

  test("rejects a page-start budget that exceeds the inventory deadline", () => {
    try {
      createCdpTokenBalancesClient({ pageStartBudgetMs: 11, deadlineMs: 10 });
      throw new Error("expected invalid inventory budgets to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CdpTokenBalancesError);
      expect(error).toMatchObject({ code: "not-configured" });
    }
  });

  test("returns every collected row as incomplete when the page budget is exhausted", async () => {
    const pageHorizon = 64;
    let pages = 0;
    const served: string[] = [];
    const client = createCdpTokenBalancesClient({
      env: configuredEnv,
      generateJwtImpl: async () => "signed-jwt",
      clock: { now: () => 0, timeout: () => new AbortController().signal },
      fetchImpl: async () => {
        pages += 1;
        const amount = String(pages);
        served.push(amount);
        return Response.json({
          balances: [token(`0x${pages.toString(16).padStart(40, "0")}`, amount)],
          nextPageToken: pages < pageHorizon ? `page-${pages + 1}` : undefined,
        });
      },
    });

    const listed = await client.listBalances({ address: ADDRESS });
    expect(pages).toBeGreaterThan(1);
    expect(listed.complete, "fixture horizon must exceed the page budget").toBeFalse();
    expect(listed.pagesRead).toBe(pages);
    expect(listed.balances.map(({ amountBaseUnits }) => amountBaseUnits)).toEqual(served);
    expect(listed.nextPageToken).toBe(`page-${pages + 1}`);
    expect(listed).not.toHaveProperty("interruption");
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
      interruption: "upstream-error",
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
      interruption: "rate-limited",
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
    const failure = client.listBalances({ address: ADDRESS }).then(
      () => { throw new Error("expected first page to fail"); },
      (error: unknown) => error,
    );
    const error = await failure;
    expect(error).toBeInstanceOf(CdpTokenBalancesError);
    expect(error).toMatchObject({ code: "rate-limited" });
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

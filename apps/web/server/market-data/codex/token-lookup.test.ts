import { describe, expect, test } from "bun:test";
import { ACTIVITY_TOKEN_CODEX_TIMEOUT_MS } from "@/server/activity/token-metadata";
import {
  CODEX_TOKEN_LOOKUP_BATCH_MAX,
  CODEX_TOKEN_LOOKUP_QUERY,
  createCodexTokenLookup,
} from "./token-lookup";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const DUP = "0x3333333333333333333333333333333333333333" as const;

function result(address: string) {
  return {
    liquidity: "100000.5",
    volume24: "10000",
    token: {
      address,
      name: "Codex Name",
      symbol: "CODEX",
      decimals: "18",
      networkId: "8453",
      info: {
        imageSmallUrl: "https://images.example.test/codex.png",
      },
    },
  };
}

describe("Codex token lookup", () => {
  test("issues the exact top-level tokens request seam shared by balances and Activity", async () => {
    const lookup = createCodexTokenLookup({
      apiKey: "fixture-key",
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          query: string;
          variables: { tokens: string[]; limit: number };
        };
        expect(body.query).toBe(CODEX_TOKEN_LOOKUP_QUERY);
        expect(body.query).toContain("$tokens: [String!]");
        expect(body.query).toContain("filterTokens(tokens: $tokens, limit: $limit)");
        expect(body.query).not.toContain("filters:");
        expect(Object.keys(body.variables).sort()).toEqual(["limit", "tokens"]);
        expect(body.variables.limit).toBe(body.variables.tokens.length);
        expect(
          body.variables.tokens.every((token) => token.endsWith(":8453")),
        ).toBeTrue();
        return Response.json({
          data: { filterTokens: { results: [result(ADDRESS)] } },
        });
      },
    });

    const entries = await lookup([ADDRESS]);
    expect(entries.get(ADDRESS)).toEqual({
      address: ADDRESS,
      name: "Codex Name",
      symbol: "CODEX",
      decimals: 18,
      imageUrl: "https://images.example.test/codex.png",
      liquidityUsd: { atoms: "1000005", scale: 1 },
    });
  });

  test("serves the Activity consumer with the same request seam and timeout contract", async () => {
    let requests = 0;
    const lookup = createCodexTokenLookup({
      apiKey: "fixture-key",
      timeoutMs: ACTIVITY_TOKEN_CODEX_TIMEOUT_MS,
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      fetchImpl: async (_input, init) => {
        requests += 1;
        const body = JSON.parse(String(init?.body)) as {
          query: string;
          variables: { tokens: string[]; limit: number };
        };
        expect(Object.keys(body.variables).sort()).toEqual(["limit", "tokens"]);
        expect(body.variables).toEqual({ tokens: [`${ADDRESS}:8453`], limit: 1 });
        return Response.json({
          data: { filterTokens: { results: [result(ADDRESS)] } },
        });
      },
    });

    const entries = await lookup([ADDRESS]);
    expect(requests).toBe(1);
    expect(entries.get(ADDRESS)?.symbol).toBe("CODEX");
  });

  test("uses address filters in bounded batches and caches known and unknown contracts", async () => {
    let calls = 0;
    const batchSizes: number[] = [];
    const lookup = createCodexTokenLookup({
      apiKey: "fixture-key",
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      fetchImpl: async (_input, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as {
          variables: { tokens: string[]; limit: number };
        };
        const tokens = body.variables.tokens;
        batchSizes.push(tokens.length);
        expect(body.variables.limit).toBe(tokens.length);
        expect(tokens.every((token) => token.endsWith(":8453"))).toBeTrue();
        const results = tokens.flatMap((token) => {
          const address = token.slice(0, 42);
          return address === ADDRESS ? [result(address)] : [];
        });
        return Response.json({ data: { filterTokens: { results } } });
      },
    });
    const addresses = [
      ADDRESS,
      ...Array.from(
        { length: CODEX_TOKEN_LOOKUP_BATCH_MAX },
        (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
      ),
    ];

    const first = await lookup(addresses);
    const second = await lookup(addresses);

    expect(batchSizes).toEqual([CODEX_TOKEN_LOOKUP_BATCH_MAX, 1]);
    expect(calls).toBe(2);
    expect(first.get(ADDRESS)).toEqual({
      address: ADDRESS,
      name: "Codex Name",
      symbol: "CODEX",
      decimals: 18,
      imageUrl: "https://images.example.test/codex.png",
      liquidityUsd: { atoms: "1000005", scale: 1 },
    });
    expect(second).toEqual(first);
  });

  test("keeps valid rows and drops malformed and duplicated response rows fail-closed", async () => {
    const lookup = createCodexTokenLookup({
      apiKey: "fixture-key",
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      fetchImpl: async () => Response.json({
        data: {
          filterTokens: {
            results: [
              result(ADDRESS),
              result(DUP),
              result(DUP),
              { ...result(OTHER), token: { ...result(OTHER).token, decimals: "256" } },
              { ...result(OTHER), token: { ...result(OTHER).token, symbol: "" } },
              { ...result(OTHER), token: { ...result(OTHER).token, networkId: "1" } },
              { liquidity: "1", token: { address: OTHER, networkId: "8453" } },
            ],
          },
        },
      }),
    });

    const entries = await lookup([ADDRESS, OTHER, DUP]);
    expect([...entries.keys()]).toEqual([ADDRESS]);
  });

  test("deduplicates concurrent requests per lowercase address and degrades failed lookups", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lookup = createCodexTokenLookup({
      apiKey: "fixture-key",
      fetchImpl: async () => {
        calls += 1;
        await gate;
        throw new Error("lookup unavailable");
      },
    });

    const first = lookup([ADDRESS]);
    const second = lookup([ADDRESS]);
    release();

    expect(await first).toEqual(new Map());
    expect(await second).toEqual(new Map());
    expect(calls).toBe(1);
  });
});

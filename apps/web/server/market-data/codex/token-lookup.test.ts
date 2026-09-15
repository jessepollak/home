import { describe, expect, test } from "bun:test";
import {
  CODEX_TOKEN_LOOKUP_BATCH_MAX,
  CODEX_TOKEN_LOOKUP_QUERY,
  createCodexTokenLookup,
} from "./token-lookup";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

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
  test("uses address filters in bounded batches and caches known and unknown contracts", async () => {
    let calls = 0;
    const batchSizes: number[] = [];
    const lookup = createCodexTokenLookup({
      apiKey: "fixture-key",
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      fetchImpl: async (_input, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as {
          query: string;
          variables: { tokens: string[]; limit: number };
        };
        const tokens = body.variables.tokens;
        batchSizes.push(tokens.length);
        expect(body.query).toBe(CODEX_TOKEN_LOOKUP_QUERY);
        expect(body.query).toContain("filterTokens(tokens: $tokens, limit: $limit)");
        expect(Object.keys(body.variables).sort()).toEqual(["limit", "tokens"]);
        expect(body.variables.limit).toBe(tokens.length);
        expect(tokens.every((token) => token.endsWith(":8453"))).toBeTrue();
        const results = tokens.flatMap((token) => {
          const address = token.slice(0, 42);
          if (address === ADDRESS) return [result(address)];
          return address === OTHER
            ? [result(address), result(address), { token: { address } }]
            : [];
        });
        return Response.json({ data: { filterTokens: { results } } });
      },
    });
    const addresses = [
      ADDRESS,
      OTHER,
      ...Array.from(
        { length: CODEX_TOKEN_LOOKUP_BATCH_MAX - 1 },
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
    expect(first.has(OTHER)).toBeFalse();
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

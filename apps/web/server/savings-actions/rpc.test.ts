import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";
import {
  SAVINGS_ACTION_RPC_CONCURRENCY,
  SAVINGS_ACTION_RPC_TIMEOUT_MS,
  createSavingsActionStateReader,
} from "./rpc";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const VAULT = MORPHO_V1_CANDIDATE_ADDRESSES[0];
const BLOCK_HASH = `0x${"cd".repeat(32)}` as `0x${string}`;

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressWord(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

describe("savings action RPC state", () => {
  test("reads asset, exact balances, allowance, fee, limits and preview at one confirmed Base block", async () => {
    const requests: unknown[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      const body = JSON.parse(String(init?.body)) as
        | { id: number; method: string; params: unknown[] }
        | Array<{ id: number; method: string; params: unknown[] }>;
      requests.push(body);
      const respond = (entry: { id: number; method: string; params: unknown[] }) => {
        if (entry.method === "eth_chainId") {
          return { jsonrpc: "2.0", id: entry.id, result: "0x2105" };
        }
        if (entry.method === "eth_getBlockByNumber") {
          return {
            jsonrpc: "2.0",
            id: entry.id,
            result: { number: "0x10", hash: BLOCK_HASH, timestamp: "0x64" },
          };
        }
        const data = (entry.params[0] as { data: string }).data;
        const selector = data.slice(0, 10);
        const result = selector === "0x38d52e0f"
          ? addressWord(BASE_USDC_ADDRESS)
          : selector === "0x313ce567"
            ? word(BigInt(18))
            : selector === "0x70a08231" && (entry.params[0] as { to: string }).to === BASE_USDC_ADDRESS
              ? word(BigInt("5000000"))
              : selector === "0x70a08231"
                ? word(BigInt("4900000000000000000"))
                : selector === "0xdd62ed3e"
                  ? word(BigInt("1000000"))
                  : selector === "0xddca3f43"
                    ? word(BigInt("250000000000000000"))
                    : selector === "0x402d267d"
                      ? word(BigInt("4000000"))
                      : selector === "0xef8b30f7"
                        ? word(BigInt("1990000000000000000"))
                        : null;
        return result === null
          ? { jsonrpc: "2.0", id: entry.id, error: { code: -1 } }
          : { jsonrpc: "2.0", id: entry.id, result };
      };
      try {
        return Response.json(Array.isArray(body) ? body.map(respond).reverse() : respond(body));
      } finally {
        inFlight -= 1;
      }
    }) as typeof fetch;

    const result = await createSavingsActionStateReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
    })({
      kind: "deposit",
      accountAddress: ACCOUNT,
      vaultAddress: VAULT,
      amount: BigInt("2000000"),
    });

    expect(result).toMatchObject({
      assetAddress: BASE_USDC_ADDRESS.toLowerCase(),
      shareDecimals: 18,
      usdcBalance: BigInt("5000000"),
      sharesBalance: BigInt("4900000000000000000"),
      allowance: BigInt("1000000"),
      limit: BigInt("4000000"),
      previewShares: BigInt("1990000000000000000"),
      fee: BigInt("250000000000000000"),
      block: { number: "16", numberHex: "0x10", hash: BLOCK_HASH },
    });
    const singles = requests.filter(
      (body): body is { method: string; params: unknown[] } => !Array.isArray(body),
    );
    expect(requests.every((body) => !Array.isArray(body))).toBeTrue();
    const calls = singles.filter((entry) => entry.method === "eth_call");
    expect(calls).toHaveLength(8);
    expect(calls.every((entry) => entry.params[1] === "0x10")).toBeTrue();
    expect((requests.at(-1) as { params: unknown[] }).params[0]).toBe("0x10");
    expect(SAVINGS_ACTION_RPC_TIMEOUT_MS).toBe(10_000);
    expect(maxInFlight).toBeLessThanOrEqual(SAVINGS_ACTION_RPC_CONCURRENCY);
  });

  test("retries a public-Base -32016 once, then completes the pinned read", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      expect(Array.isArray(body)).toBeFalse();
      if (body.method === "eth_chainId") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x2105" });
      }
      if (body.method === "eth_getBlockByNumber") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { number: "0x10", hash: BLOCK_HASH, timestamp: "0x64" },
        });
      }
      calls += 1;
      if (calls === 1) {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32016, message: "over rate limit" },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: body.params[0] && (body.params[0] as { data?: string }).data?.startsWith("0x38d52e0f")
          ? addressWord(BASE_USDC_ADDRESS)
          : word(BigInt(1)),
      });
    }) as typeof fetch;

    const result = await createSavingsActionStateReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      retryDelayMs: 400,
      sleep: async (ms) => {
        delays.push(ms);
      },
    })({
      kind: "deposit",
      accountAddress: ACCOUNT,
      vaultAddress: VAULT,
      amount: BigInt("2000000"),
    });

    expect(calls).toBe(9);
    expect(delays).toEqual([400]);
    expect(result.assetAddress).toBe(BASE_USDC_ADDRESS.toLowerCase() as typeof BASE_USDC_ADDRESS);
    expect(result.block.hash).toBe(BLOCK_HASH);
  });

  test("retries HTTP 429 once before succeeding", async () => {
    let posts = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      posts += 1;
      if (posts === 1) {
        return new Response("slow down", { status: 429 });
      }
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      if (body.method === "eth_chainId") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x2105" });
      }
      if (body.method === "eth_getBlockByNumber") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { number: "0x10", hash: BLOCK_HASH, timestamp: "0x64" },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: (body.params[0] as { data?: string }).data?.startsWith("0x38d52e0f")
          ? addressWord(BASE_USDC_ADDRESS)
          : word(BigInt(1)),
      });
    }) as typeof fetch;

    const result = await createSavingsActionStateReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      retryDelayMs: 0,
    })({
      kind: "deposit",
      accountAddress: ACCOUNT,
      vaultAddress: VAULT,
      amount: BigInt("2000000"),
    });

    expect(posts).toBeGreaterThan(8);
    expect(result.block.numberHex).toBe("0x10");
  });

  test("surfaces a typed rate-limited error after retries are exhausted", async () => {
    const fetchImpl = (async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32016, message: "over rate limit" },
      })) as unknown as typeof fetch;

    await expect(createSavingsActionStateReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      retryDelayMs: 0,
    })({
      kind: "deposit",
      accountAddress: ACCOUNT,
      vaultAddress: VAULT,
      amount: BigInt("2000000"),
    })).rejects.toMatchObject({
      name: "SavingsActionRpcError",
      code: "rate-limited",
      message: "Base RPC rejected a savings state read: over rate limit",
    });
  });

  test("surfaces the rejected savings read instead of a mismatched batch", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as
        | { id: number; method: string; params: unknown[] }
        | Array<{ id: number; method: string; params: unknown[] }>;
      const respond = (entry: { id: number; method: string; params: unknown[] }) => {
        if (entry.method === "eth_chainId") {
          return { jsonrpc: "2.0", id: entry.id, result: "0x2105" };
        }
        if (entry.method === "eth_getBlockByNumber") {
          return {
            jsonrpc: "2.0",
            id: entry.id,
            result: { number: "0x10", hash: BLOCK_HASH, timestamp: "0x64" },
          };
        }
        return {
          jsonrpc: "2.0",
          id: entry.id,
          error: { code: -32000, message: "execution reverted" },
        };
      };
      return Response.json(Array.isArray(body) ? body.map(respond) : respond(body));
    }) as typeof fetch;

    await expect(createSavingsActionStateReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
    })({
      kind: "deposit",
      accountAddress: ACCOUNT,
      vaultAddress: VAULT,
      amount: BigInt("2000000"),
    })).rejects.toMatchObject({
      name: "SavingsActionRpcError",
      message: "Base RPC rejected a savings state read: execution reverted",
    });
  });
});

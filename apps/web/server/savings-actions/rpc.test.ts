import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";
import { SAVINGS_ACTION_RPC_BATCH_SIZE, createSavingsActionStateReader } from "./rpc";

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
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
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
      return Response.json(Array.isArray(body) ? body.map(respond).reverse() : respond(body));
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
    const batches = requests.filter(Array.isArray) as Array<Array<{ method: string; params: unknown[] }>>;
    expect(batches.every((batch) => batch.length <= SAVINGS_ACTION_RPC_BATCH_SIZE)).toBeTrue();
    expect(batches.flat()).toHaveLength(8);
    expect(batches.flat().every((entry) => entry.method === "eth_call" && entry.params[1] === "0x10")).toBeTrue();
    expect((requests.at(-1) as { params: unknown[] }).params[0]).toBe("0x10");
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

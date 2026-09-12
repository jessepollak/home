import { describe, expect, test } from "bun:test";
import { BASE_USDC } from "@/shared/assets/base";
import { createVaultPositionsReader } from "./inventory-vault-rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const addressWord = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;

describe("vault positions RPC reader", () => {
  test("reads configured positions from one pinned Base block without Morpho GraphQL", async () => {
    const methods: string[] = [];
    type FixtureRequest = { id: number; method: string; params: Array<{ data?: string } | string | boolean> };
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as FixtureRequest | FixtureRequest[];
      const respond = (entry: FixtureRequest) => {
        methods.push(entry.method);
        if (entry.method === "eth_chainId") return { jsonrpc: "2.0", id: entry.id, result: "0x2105" };
        if (entry.method === "eth_getBlockByNumber") {
          return { jsonrpc: "2.0", id: entry.id, result: { number: "0x10", hash: HASH, timestamp: "0x64" } };
        }
        const firstParam = entry.params[0];
        const data = typeof firstParam === "object" && firstParam ? firstParam.data ?? "" : "";
        return {
          jsonrpc: "2.0",
          id: entry.id,
          result: data.startsWith("0x38d52e0f") ? addressWord(BASE_USDC.address) : word(BigInt(0)),
        };
      };
      return Response.json(Array.isArray(body) ? body.map(respond) : respond(body));
    }) as typeof fetch;

    const result = await createVaultPositionsReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now: () => new Date("2026-09-12T12:00:00.000Z"),
    })(OWNER);

    expect(result.vaults).toHaveLength(3);
    expect(result.vaults.every(({ position }) =>
      position?.assetsRaw === "0" &&
      position.sharesRaw === "0" &&
      position.source.provider === "Base JSON-RPC"
    )).toBeTrue();
    expect(methods.filter((method) => method === "eth_chainId")).toHaveLength(1);
    expect(methods).not.toContain("graphql");
  });
});

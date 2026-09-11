import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  portfolioVaults,
} from "@/config/portfolio-assets";
import { createBaseValuationInventoryReader } from "./valuation-rpc";
import type { VerifiedPortfolioAccount } from "@/shared/portfolio/types";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const account: VerifiedPortfolioAccount = {
  address: ADDRESS,
  chainId: 8453,
  verification: "session-smart-account",
};

function dataWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressWord(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

describe("valuation inventory RPC", () => {
  test("pins the bounded inventory, chunks at ten, validates IDs, and keeps missing reads unavailable", async () => {
    const requests: Array<unknown> = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as
        | { id: number; method: string; params: unknown[] }
        | Array<{ id: number; method: string; params: unknown[] }>;
      requests.push(body);
      const respond = (request: { id: number; method: string; params: unknown[] }) => {
        if (request.method === "eth_chainId") {
          return { jsonrpc: "2.0", id: request.id, result: "0x2105" };
        }
        if (request.method === "eth_getBlockByNumber") {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: { number: "0x10", hash: BLOCK_HASH, timestamp: "0x64" },
          };
        }
        if (request.method === "eth_getBalance") {
          return { jsonrpc: "2.0", id: request.id, result: "0x0" };
        }
        const call = request.params[0] as { to: string; data: string };
        if (call.data === "0x38d52e0f") {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: addressWord(PORTFOLIO_USDC_ADDRESS),
          };
        }
        return { jsonrpc: "2.0", id: request.id, result: dataWord(BigInt(0)) };
      };
      if (!Array.isArray(body)) return Response.json(respond(body));
      return Response.json(
        body
          .filter(({ id }) => id !== 11)
          .map(respond)
          .reverse(),
      );
    }) as typeof fetch;

    const result = await createBaseValuationInventoryReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    })(account, "EUR");

    const batches = requests.filter(Array.isArray) as unknown[][];
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 7]);
    for (const batch of batches) {
      for (const entry of batch as Array<{ params: unknown[] }>) {
        expect(entry.params.at(-1)).toBe("0x10");
      }
    }
    const usdc = result.holdings.find(({ id }) => id === "usdc");
    expect(usdc).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
    expect(
      result.holdings.filter(({ kind }) => kind === "vault-position"),
    ).toHaveLength(3);
    const vaultHoldings = result.holdings.flatMap((holding) =>
      holding.kind === "vault-position" ? [holding] : [],
    );
    expect(
      vaultHoldings.every(
        (holding) =>
          holding.readStatus === "ready" &&
          holding.sharesBaseUnits === "0" &&
          holding.underlyingBaseUnits === "0",
      ),
    ).toBeTrue();
    expect(
      batches.flat().filter((entry) =>
        portfolioVaults.some(
          ({ address }) =>
            (entry as { params: [{ to?: string }] }).params[0]?.to === address,
        ),
      ).length,
    ).toBe(6);
  });
});

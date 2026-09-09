import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  portfolioVaults,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import { createBaseValuationInventoryReader } from "./valuation-rpc";
import type { VerifiedPortfolioAccount } from "./types";

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

function rateLimited(id: number) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code: -32016, message: "over rate limit" },
  };
}

function respondOk(request: { id: number; method: string; params: unknown[] }) {
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
  if (
    typeof call.to === "string" &&
    call.to.toLowerCase() ===
      verifiedLocalCashAssets.IDR.contractAddress.toLowerCase()
  ) {
    return { jsonrpc: "2.0", id: request.id, result: dataWord(BigInt(250000)) };
  }
  return { jsonrpc: "2.0", id: request.id, result: dataWord(BigInt(0)) };
}

describe("valuation inventory RPC", () => {
  test("pins the bounded inventory, chunks at ten, validates IDs, and keeps missing reads unavailable", async () => {
    const requests: Array<unknown> = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as
        | { id: number; method: string; params: unknown[] }
        | Array<{ id: number; method: string; params: unknown[] }>;
      requests.push(body);
      if (!Array.isArray(body)) {
        return Response.json(
          body.id === 11 ? rateLimited(body.id) : respondOk(body),
        );
      }
      return Response.json(
        body
          .filter(({ id }) => id !== 11)
          .map(respondOk)
          .reverse(),
      );
    }) as typeof fetch;

    const result = await createBaseValuationInventoryReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    })(account, "EUR");

    const batches = requests.filter(Array.isArray) as unknown[][];
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 1, 1]);
    expect(
      (batches[3] as Array<{ id: number }>).map(({ id }) => id),
    ).toEqual([11]);
    const firstBatch = batches[0] as Array<{ params: [{ to?: string }] }>;
    expect(
      firstBatch.some(
        (entry) =>
          entry.params[0]?.to?.toLowerCase() ===
          verifiedLocalCashAssets.IDR.contractAddress.toLowerCase(),
      ),
    ).toBeTrue();
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
    const idrx = result.holdings.find(({ id }) => id === "idrx");
    expect(idrx).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "250000",
      decimals: 2,
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

  test("retries a rate-limited IDRX cash read and keeps a successful zero ready", async () => {
    const idrxAddress = verifiedLocalCashAssets.IDR.contractAddress.toLowerCase();
    let idrxAttempts = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as
        | { id: number; method: string; params: unknown[] }
        | Array<{ id: number; method: string; params: unknown[] }>;
      const isIdrx = (request: { params: unknown[] }) =>
        typeof (request.params[0] as { to?: string } | undefined)?.to ===
          "string" &&
        (request.params[0] as { to: string }).to.toLowerCase() === idrxAddress;
      if (!Array.isArray(body)) {
        if (isIdrx(body)) idrxAttempts += 1;
        return Response.json(respondOk(body));
      }
      return Response.json(
        body.map((request) => {
          if (isIdrx(request)) {
            idrxAttempts += 1;
            if (body.length > 1) return rateLimited(request.id);
          }
          return respondOk(request);
        }),
      );
    }) as typeof fetch;

    const result = await createBaseValuationInventoryReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    })(account, "IDR");

    expect(idrxAttempts).toBe(2);
    expect(result.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "250000",
    });
  });

  test("keeps IDRX read-unavailable when the cash call fails after retry", async () => {
    const idrxAddress = verifiedLocalCashAssets.IDR.contractAddress.toLowerCase();
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as
        | { id: number; method: string; params: unknown[] }
        | Array<{ id: number; method: string; params: unknown[] }>;
      const isIdrx = (request: { params: unknown[] }) =>
        typeof (request.params[0] as { to?: string } | undefined)?.to ===
          "string" &&
        (request.params[0] as { to: string }).to.toLowerCase() === idrxAddress;
      if (!Array.isArray(body)) {
        return Response.json(isIdrx(body) ? rateLimited(body.id) : respondOk(body));
      }
      return Response.json(
        body.map((request) =>
          isIdrx(request) ? rateLimited(request.id) : respondOk(request),
        ),
      );
    }) as typeof fetch;

    const result = await createBaseValuationInventoryReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    })(account, "IDR");

    expect(result.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
    expect(result.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "0",
    });
  });
});

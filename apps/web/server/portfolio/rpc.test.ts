import { describe, expect, test } from "bun:test";
import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  type VerifiedPortfolioAccount,
} from "@/shared/portfolio/types";
import {
  PortfolioRpcError,
  createBasePortfolioReader,
  hostedRuntimeExpectsManagedBaseRpcUrl,
  inspectBaseRpcUrl,
  resolveBaseRpcUrl,
} from "./rpc";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const account: VerifiedPortfolioAccount = {
  address: ADDRESS,
  chainId: BASE_CHAIN_ID,
  verification: "session-smart-account",
};

type FixtureOptions = {
  chainId?: string;
  nativeBalance?: string;
  usdcBalance?: string;
  missingBatchResult?: boolean;
  rpcErrorAtId?: number;
  httpStatus?: number;
};

function createRpcFixture(options: FixtureOptions = {}) {
  const requests: unknown[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (options.httpStatus) {
      return Response.json({}, { status: options.httpStatus });
    }
    const body = JSON.parse(String(init?.body)) as
      | { id: number; method: string; params: unknown[] }
      | { id: number; method: string; params: unknown[] }[];
    requests.push(body);

    const respond = (request: { id: number; method: string }) => {
      if (request.id === options.rpcErrorAtId) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: "fixture detail must stay private" },
        };
      }
      if (request.id === 1) {
        return {
          jsonrpc: "2.0",
          id: 1,
          result: options.chainId ?? "0x2105",
        };
      }
      if (request.id === 2 || request.id === 5) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            number: "0x10",
            hash: BLOCK_HASH,
            timestamp: "0x64",
          },
        };
      }
      if (request.id === 3) {
        return {
          jsonrpc: "2.0",
          id: 3,
          result: options.nativeBalance ?? "0x2a",
        };
      }
      return {
        jsonrpc: "2.0",
        id: 4,
        result: options.usdcBalance ?? `0x${"0".repeat(63)}7`,
      };
    };

    if (Array.isArray(body)) {
      const responses = body.map(respond);
      return Response.json(
        options.missingBatchResult ? responses.slice(0, 1) : responses,
      );
    }
    return Response.json(respond(body));
  }) as typeof fetch;

  return { fetchImpl, requests };
}

const now = () => new Date("2026-09-07T20:30:00.000Z");

describe("Base portfolio RPC reader", () => {
  test("verifies Base, pins ETH and USDC reads to one block, and preserves exact integers", async () => {
    const fixture = createRpcFixture();
    const readPortfolio = createBasePortfolioReader({
      fetchImpl: fixture.fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now,
    });

    const result = await readPortfolio(account);

    expect(result).toEqual({
      walletAddress: ADDRESS,
      chainId: 8453,
      blockNumber: "16",
      blockHash: BLOCK_HASH,
      blockTimestamp: "100",
      fetchedAt: "2026-09-07T20:30:00.000Z",
      assets: [
        {
          id: "usdc",
          symbol: "USDC",
          decimals: 6,
          kind: "erc20",
          tokenAddress: BASE_USDC_ADDRESS,
          balanceBaseUnits: "7",
        },
        {
          id: "eth",
          symbol: "ETH",
          decimals: 18,
          kind: "native",
          balanceBaseUnits: "42",
        },
      ],
    });

    const balanceBatch = fixture.requests[2] as {
      method: string;
      params: unknown[];
    }[];
    expect(balanceBatch.map((entry) => entry.method)).toEqual([
      "eth_getBalance",
      "eth_call",
    ]);
    expect(balanceBatch[0]?.params).toEqual([ADDRESS, "0x10"]);
    expect(balanceBatch[1]?.params[1]).toBe("0x10");
    expect(balanceBatch[1]?.params[0]).toEqual({
      to: BASE_USDC_ADDRESS,
      data: `0x70a08231${ADDRESS.slice(2).padStart(64, "0")}`,
    });
  });

  test("keeps a successful zero read distinct from unavailable data", async () => {
    const fixture = createRpcFixture({
      nativeBalance: "0x0",
      usdcBalance: `0x${"0".repeat(64)}`,
    });
    const result = await createBasePortfolioReader({
      fetchImpl: fixture.fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now,
    })(account);

    expect(result.assets.map((asset) => asset.balanceBaseUnits)).toEqual([
      "0",
      "0",
    ]);
  });

  test("accepts the full uint256 range without floating-point conversion", async () => {
    const maximumHex = `0x${"f".repeat(64)}`;
    const maximumDecimal = (
      (BigInt(1) << BigInt(256)) - BigInt(1)
    ).toString(10);
    const fixture = createRpcFixture({
      nativeBalance: maximumHex,
      usdcBalance: maximumHex,
    });
    const result = await createBasePortfolioReader({
      fetchImpl: fixture.fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now,
    })(account);

    expect(result.assets.map((asset) => asset.balanceBaseUnits)).toEqual([
      maximumDecimal,
      maximumDecimal,
    ]);
  });

  test("rejects a wrong-chain RPC before any wallet balance read", async () => {
    const fixture = createRpcFixture({ chainId: "0x1" });
    const readPortfolio = createBasePortfolioReader({
      fetchImpl: fixture.fetchImpl,
      rpcUrl: "https://rpc.example.test",
    });

    await expect(readPortfolio(account)).rejects.toThrow("not Base mainnet");
    expect(fixture.requests).toHaveLength(1);
  });

  test("rejects malformed quantity and ERC-20 result hex", async () => {
    for (const options of [
      { nativeBalance: "0x00" },
      { nativeBalance: "42" },
      { usdcBalance: "0x0" },
      { usdcBalance: `0x${"g".repeat(64)}` },
    ]) {
      const fixture = createRpcFixture(options);
      const readPortfolio = createBasePortfolioReader({
        fetchImpl: fixture.fetchImpl,
        rpcUrl: "https://rpc.example.test",
      });
      await expect(readPortfolio(account)).rejects.toBeInstanceOf(
        PortfolioRpcError,
      );
    }
  });

  test("rejects missing batch results, HTTP failures, and RPC errors", async () => {
    for (const options of [
      { missingBatchResult: true },
      { httpStatus: 429 },
      { rpcErrorAtId: 2 },
    ]) {
      const fixture = createRpcFixture(options);
      const readPortfolio = createBasePortfolioReader({
        fetchImpl: fixture.fetchImpl,
        rpcUrl: "https://rpc.example.test",
      });
      await expect(readPortfolio(account)).rejects.toBeInstanceOf(
        PortfolioRpcError,
      );
    }
  });

  test("requires verified smart-account scope", async () => {
    const fixture = createRpcFixture();
    await expect(
      createBasePortfolioReader({
        fetchImpl: fixture.fetchImpl,
        rpcUrl: "https://rpc.example.test",
      })({ ...account, verification: "not-verified" as never }),
    ).rejects.toThrow("verified Base smart account");
    expect(fixture.requests).toHaveLength(0);
  });
});

describe("Base RPC URL configuration", () => {
  test("defaults to the public Base endpoint and permits loopback HTTP for development", () => {
    // Empty / whitespace means unset. Do not call with `undefined` here —
    // that reads process.env and can leak BASE_RPC_URL into assertion diffs.
    expect(resolveBaseRpcUrl("")).toBe("https://mainnet.base.org");
    expect(resolveBaseRpcUrl("   ")).toBe("https://mainnet.base.org");
    expect(resolveBaseRpcUrl("http://127.0.0.1:8545/")).toBe(
      "http://127.0.0.1:8545",
    );
    expect(inspectBaseRpcUrl("")).toEqual({
      source: "public-default",
      hostClass: "public-base",
      protocol: "https",
    });
  });

  test("accepts CDP Node HTTPS URLs that put the client key in the path", () => {
    const cdpNodeUrl =
      "https://api.developer.coinbase.com/rpc/v1/base/test-client-api-key";
    expect(resolveBaseRpcUrl(cdpNodeUrl)).toBe(cdpNodeUrl);
    expect(inspectBaseRpcUrl(cdpNodeUrl)).toEqual({
      source: "configured",
      hostClass: "cdp-node",
      protocol: "https",
    });
  });

  test("rejects user info and fragments on CDP-style hosts", () => {
    expect(() =>
      resolveBaseRpcUrl(
        "https://user:pass@api.developer.coinbase.com/rpc/v1/base/test-client-api-key",
      ),
    ).toThrow("user info or a URL fragment");
    expect(() =>
      resolveBaseRpcUrl(
        "https://api.developer.coinbase.com/rpc/v1/base/test-client-api-key#token",
      ),
    ).toThrow("user info or a URL fragment");
  });

  test("rejects non-HTTP schemes and non-loopback plaintext endpoints", () => {
    expect(() => resolveBaseRpcUrl("ws://localhost:8545")).toThrow(
      "HTTP or HTTPS",
    );
    expect(() => resolveBaseRpcUrl("http://rpc.example.test")).toThrow(
      "loopback",
    );
  });

  test("treats Production and Preview as hosted runtimes that should set a managed URL", () => {
    expect(hostedRuntimeExpectsManagedBaseRpcUrl("production")).toBe(true);
    expect(hostedRuntimeExpectsManagedBaseRpcUrl("preview")).toBe(true);
    expect(hostedRuntimeExpectsManagedBaseRpcUrl("development")).toBe(false);
    expect(hostedRuntimeExpectsManagedBaseRpcUrl(undefined)).toBe(false);
  });
});

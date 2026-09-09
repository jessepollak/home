import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  getDirectPortfolioAssets,
  portfolioVaults,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import {
  CDP_NATIVE_TOKEN_ADDRESS,
  CdpTokenBalancesError,
} from "./cdp-token-balances";
import { createPortfolioInventoryReader } from "./inventory";
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

function tokenBalance(contractAddress: string, amount: string, decimals = 99) {
  return {
    amount: { amount, decimals },
    token: {
      network: "base",
      symbol: "IGNORE",
      name: "ignore",
      contractAddress,
    },
  };
}

function rpcRespond(request: { id: number; method: string; params: unknown[] }) {
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
    throw new Error("direct native balance must not use RPC");
  }
  const call = request.params[0] as { to: string; data: string };
  const vault = portfolioVaults.find(
    ({ address }) => address.toLowerCase() === call.to.toLowerCase(),
  );
  if (!vault) {
    throw new Error(`unexpected eth_call to ${call.to}`);
  }
  if (call.data === "0x38d52e0f") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: addressWord(PORTFOLIO_USDC_ADDRESS),
    };
  }
  if (call.data.startsWith("0x07a2d13a")) {
    return { jsonrpc: "2.0", id: request.id, result: dataWord(BigInt(999_000)) };
  }
  if (call.data.startsWith("0x70a08231")) {
    const shares = vault.id === "morpho-steakhouse-usdc" ? BigInt(1_000) : BigInt(0);
    return { jsonrpc: "2.0", id: request.id, result: dataWord(shares) };
  }
  throw new Error(`unexpected vault calldata ${call.data}`);
}

function createFetch(options: {
  tokenBalances: (url: URL) => Response | Promise<Response>;
}) {
  const rpcBodies: unknown[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/v2/data/evm/token-balances/")) {
      expect(init?.method).toBe("GET");
      return options.tokenBalances(url);
    }
    const body = JSON.parse(String(init?.body)) as
      | { id: number; method: string; params: unknown[] }
      | Array<{ id: number; method: string; params: unknown[] }>;
    rpcBodies.push(body);
    if (!Array.isArray(body)) return Response.json(rpcRespond(body));
    return Response.json(body.map(rpcRespond));
  }) as typeof fetch;
  return { fetchImpl, rpcBodies };
}

describe("Phase A portfolio inventory", () => {
  test("reads allowlisted directs from Token Balances and converts Morpho vaults on pinned RPC", async () => {
    const { fetchImpl, rpcBodies } = createFetch({
      tokenBalances: () =>
        Response.json({
          balances: [
            tokenBalance("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "42"),
            tokenBalance(PORTFOLIO_USDC_ADDRESS, "1000000", 18),
          ],
        }),
    });

    const snapshot = await createPortfolioInventoryReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    const idrx = snapshot.holdings.find(({ id }) => id === "idrx");
    const usdc = snapshot.holdings.find(({ id }) => id === "usdc");
    const eth = snapshot.holdings.find(({ id }) => id === "eth");
    expect(eth).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "42",
      decimals: 18,
    });
    expect(usdc).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "1000000",
      decimals: 6,
      symbol: "USDC",
    });
    expect(idrx).toMatchObject({
      id: "idrx",
      symbol: verifiedLocalCashAssets.IDR.symbol,
      decimals: verifiedLocalCashAssets.IDR.decimals,
      balanceBaseUnits: "0",
      readStatus: "ready",
    });
    expect(
      getDirectPortfolioAssets().every((asset) =>
        snapshot.holdings.some(
          (holding) => holding.kind === "direct" && holding.id === asset.id,
        ),
      ),
    ).toBeTrue();

    const vaults = snapshot.holdings.filter((holding) => holding.kind === "vault-position");
    expect(vaults).toHaveLength(3);
    expect(vaults.find(({ id }) => id === "morpho-steakhouse-usdc")).toMatchObject({
      readStatus: "ready",
      sharesBaseUnits: "1000",
      underlyingBaseUnits: "999000",
      conversionMethod: "erc4626-convertToAssets",
    });
    expect(
      vaults.filter(({ id }) => id !== "morpho-steakhouse-usdc").every((holding) =>
        holding.readStatus === "ready" &&
        holding.sharesBaseUnits === "0" &&
        holding.underlyingBaseUnits === "0",
      ),
    ).toBeTrue();
    expect(snapshot.block).toEqual({
      number: "16",
      hash: BLOCK_HASH,
      timestamp: "100",
    });

    const rpcCalls = rpcBodies.flatMap((body) =>
      Array.isArray(body) ? body : [body],
    ) as Array<{ method: string; params: unknown[] }>;
    expect(rpcCalls.some(({ method }) => method === "eth_getBalance")).toBeFalse();
    expect(
      rpcCalls.every(
        (call) =>
          call.method !== "eth_call" ||
          portfolioVaults.some(
            ({ address }) =>
              (call.params[0] as { to?: string }).to?.toLowerCase() ===
              address.toLowerCase(),
          ),
      ),
    ).toBeTrue();
    expect(
      rpcCalls.some(
        (call) =>
          call.method === "eth_call" &&
          typeof (call.params[0] as { data?: string }).data === "string" &&
          (call.params[0] as { data: string }).data.startsWith("0x07a2d13a"),
      ),
    ).toBeTrue();
    expect(CDP_NATIVE_TOKEN_ADDRESS).toBe("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  });

  test("marks IDR cash unavailable only on a true Token Balances provider failure", async () => {
    const { fetchImpl } = createFetch({
      tokenBalances: () => new Response("no", { status: 401 }),
    });

    const snapshot = await createPortfolioInventoryReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    const directs = snapshot.holdings.filter((holding) => holding.kind === "direct");
    expect(
      directs.every(
        (holding) =>
          holding.readStatus === "unavailable" && holding.balanceBaseUnits === null,
      ),
    ).toBeTrue();
    expect(directs.find(({ id }) => id === "idrx")).toMatchObject({
      id: "idrx",
      decimals: verifiedLocalCashAssets.IDR.decimals,
      readStatus: "unavailable",
    });
    expect(
      snapshot.holdings.filter((holding) => holding.kind === "vault-position").every(
        (holding) => holding.readStatus === "ready",
      ),
    ).toBeTrue();
    expect(CdpTokenBalancesError).toBeDefined();
  });

  test("does not invent ready zeros when Token Balances pagination is truncated", async () => {
    const snapshot = await createPortfolioInventoryReader({
      listTokenBalances: async () => ({
        complete: false,
        balances: [
          {
            contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
            amountBaseUnits: "42",
            native: true,
          },
        ],
      }),
      readVaultInventory: async () => ({
        block: { number: "16", hash: BLOCK_HASH, timestamp: "100" },
        holdings: [],
      }),
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    expect(snapshot.holdings.find(({ id }) => id === "eth")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "42",
    });
    expect(snapshot.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
  });

  test("rejects unverified accounts and does not invent a wallet", async () => {
    const reader = createPortfolioInventoryReader({
      listTokenBalances: async () => {
        throw new Error("Token Balances must not run");
      },
      readVaultInventory: async () => {
        throw new Error("vault RPC must not run");
      },
    });
    await expect(
      reader(
        {
          address: ADDRESS,
          chainId: 8453,
          verification: "browser-wallet" as never,
        },
        "USD",
      ),
    ).rejects.toMatchObject({ name: "PortfolioInventoryError" });
  });
});

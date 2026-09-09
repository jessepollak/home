import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  PORTFOLIO_USDC_ASSET_KEY,
  assetKeyForErc20,
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

function rpcRespond(
  request: { id: number; method: string; params: unknown[] },
  cashAmounts: ReadonlyMap<string, bigint> = new Map(),
) {
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
  const cash = getDirectPortfolioAssets().find(
    (asset) =>
      asset.cashCurrency &&
      asset.contractAddress?.toLowerCase() === call.to.toLowerCase(),
  );
  const vault = portfolioVaults.find(
    ({ address }) => address.toLowerCase() === call.to.toLowerCase(),
  );
  if (cash && call.data.startsWith("0x70a08231")) {
    const amount = cashAmounts.get(cash.id) ?? BigInt(0);
    return { jsonrpc: "2.0", id: request.id, result: dataWord(amount) };
  }
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
  cashAmounts?: ReadonlyMap<string, bigint>;
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
    if (!Array.isArray(body)) {
      return Response.json(rpcRespond(body, options.cashAmounts));
    }
    return Response.json(body.map((item) => rpcRespond(item, options.cashAmounts)));
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
    const cashContracts = new Set(
      getDirectPortfolioAssets()
        .filter((asset) => asset.cashCurrency && asset.contractAddress)
        .map((asset) => asset.contractAddress!.toLowerCase()),
    );
    expect(
      rpcCalls.every((call) => {
        if (call.method !== "eth_call") return true;
        const to = (call.params[0] as { to?: string }).to?.toLowerCase();
        return (
          portfolioVaults.some(({ address }) => address.toLowerCase() === to) ||
          (to !== undefined && cashContracts.has(to))
        );
      }),
    ).toBeTrue();
    expect(
      rpcCalls.some(
        (call) =>
          call.method === "eth_call" &&
          cashContracts.has(
            ((call.params[0] as { to?: string }).to ?? "").toLowerCase(),
          ) &&
          typeof (call.params[0] as { data?: string }).data === "string" &&
          (call.params[0] as { data: string }).data.startsWith("0x70a08231"),
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

  test("does not invent ready zeros when Token Balances pagination is truncated and cash RPC also fails", async () => {
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
      readOmittedCashBalances: async (requests) =>
        new Map(requests.map(({ id }) => [id, null])),
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

  test("RPC-verifies omitted cash instead of inventing ready zeros", async () => {
    const requested: string[] = [];
    const snapshot = await createPortfolioInventoryReader({
      listTokenBalances: async () => ({
        complete: true,
        balances: [
          {
            contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
            amountBaseUnits: "1101012331497033445",
            native: true,
          },
        ],
      }),
      readVaultInventory: async () => ({
        block: { number: "16", hash: BLOCK_HASH, timestamp: "100" },
        holdings: [],
      }),
      readOmittedCashBalances: async (requests) => {
        requested.push(...requests.map(({ id }) => id));
        return new Map<string, string | null>([
          ["usdc", "10000000"],
          ["idrx", "250000"],
          ["eurc", "0"],
        ]);
      },
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    expect(requested.sort()).toEqual(["eurc", "idrx", "usdc"]);
    expect(snapshot.holdings.find(({ id }) => id === "eth")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "1101012331497033445",
      decimals: 18,
    });
    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "10000000",
      decimals: 6,
    });
    expect(snapshot.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "250000",
      decimals: verifiedLocalCashAssets.IDR.decimals,
    });
    expect(snapshot.holdings.find(({ id }) => id === "eurc")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "0",
    });
  });

  test("keeps omitted cash ready 0 only when pinned RPC balanceOf is actually 0", async () => {
    const snapshot = await createPortfolioInventoryReader({
      listTokenBalances: async () => ({
        complete: true,
        balances: [
          {
            contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
            amountBaseUnits: "1",
            native: true,
          },
          {
            contractAddress: PORTFOLIO_USDC_ADDRESS.toLowerCase() as `0x${string}`,
            amountBaseUnits: "5",
            native: false,
          },
        ],
      }),
      readVaultInventory: async () => ({
        block: { number: "16", hash: BLOCK_HASH, timestamp: "100" },
        holdings: [],
      }),
      readOmittedCashBalances: async (requests) => {
        expect(requests.map(({ id }) => id).sort()).toEqual(["eurc", "idrx"]);
        return new Map(requests.map(({ id }) => [id, "0"]));
      },
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "5",
    });
    expect(snapshot.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "0",
    });
  });

  test("default cash RPC reader restores omitted USDC and IDRX from pinned balanceOf", async () => {
    const { fetchImpl } = createFetch({
      tokenBalances: () =>
        Response.json({
          balances: [tokenBalance("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "7")],
        }),
      cashAmounts: new Map([
        ["usdc", BigInt(10_000_000)],
        ["idrx", BigInt(250_000)],
        ["eurc", BigInt(0)],
      ]),
    });

    const snapshot = await createPortfolioInventoryReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "10000000",
      decimals: 6,
    });
    expect(snapshot.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "250000",
      decimals: 2,
    });
    expect(snapshot.holdings.find(({ id }) => id === "eurc")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "0",
    });
    expect(snapshot.holdings.find(({ id }) => id === "eth")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "7",
    });
  });

  test("vault-only Morpho USDC does not fill omitted cash rows", async () => {
    const snapshot = await createPortfolioInventoryReader({
      listTokenBalances: async () => ({
        complete: true,
        balances: [
          {
            contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
            amountBaseUnits: "1101012331497033445",
            native: true,
          },
        ],
      }),
      readVaultInventory: async () => ({
        block: { number: "16", hash: BLOCK_HASH, timestamp: "100" },
        holdings: [
          {
            kind: "vault-position",
            id: "morpho-steakhouse-usdc",
            assetKey: assetKeyForErc20(portfolioVaults[0].address),
            name: portfolioVaults[0].name,
            symbol: portfolioVaults[0].symbol,
            vaultAddress: portfolioVaults[0].address,
            decimals: 18,
            underlyingAssetKey: PORTFOLIO_USDC_ASSET_KEY,
            underlyingSymbol: "USDC",
            underlyingDecimals: 6,
            sharesBaseUnits: "1000",
            underlyingBaseUnits: "999000",
            readStatus: "ready",
            conversionMethod: "erc4626-convertToAssets",
          },
        ],
      }),
      readOmittedCashBalances: async (requests) =>
        new Map(requests.map(({ id }) => [id, "0"])),
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      kind: "direct",
      readStatus: "ready",
      balanceBaseUnits: "0",
    });
    expect(snapshot.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      kind: "direct",
      readStatus: "ready",
      balanceBaseUnits: "0",
    });
    expect(snapshot.holdings.find(({ id }) => id === "eth")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "1101012331497033445",
    });
    expect(
      snapshot.holdings.find(({ id }) => id === "morpho-steakhouse-usdc"),
    ).toMatchObject({
      kind: "vault-position",
      underlyingBaseUnits: "999000",
      readStatus: "ready",
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

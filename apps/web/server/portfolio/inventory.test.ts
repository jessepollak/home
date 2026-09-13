import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_USDC_ADDRESS,
  PORTFOLIO_USDC_ASSET_KEY,
  assetKeyForErc20,
  getDirectPortfolioAssets,
  investPortfolioAssets,
  portfolioVaults,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import {
  CDP_NATIVE_TOKEN_ADDRESS,
  CdpTokenBalancesError,
} from "./cdp-token-balances";
import { createPortfolioInventoryReader } from "./inventory";
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
  const direct = getDirectPortfolioAssets().find(
    (asset) =>
      asset.kind === "erc20" &&
      asset.contractAddress?.toLowerCase() === call.to.toLowerCase(),
  );
  const vault = portfolioVaults.find(
    ({ address }) => address.toLowerCase() === call.to.toLowerCase(),
  );
  if (direct && call.data.startsWith("0x70a08231")) {
    const amount = cashAmounts.get(direct.id) ?? BigInt(0);
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function omittedZeros(requests: ReadonlyArray<{ id: string }>) {
  return new Map(requests.map(({ id }) => [id, "0"]));
}

function omittedNulls(requests: ReadonlyArray<{ id: string }>) {
  return new Map(requests.map(({ id }) => [id, null]));
}

function cashFirstConfiguredErc20Ids() {
  return [
    "usdc",
    verifiedLocalCashAssets.EUR.id,
    verifiedLocalCashAssets.IDR.id,
    ...investPortfolioAssets.map(({ id }) => id),
  ];
}

function ethOnlyComplete() {
  return {
    complete: true,
    balances: [
      {
        contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
        amountBaseUnits: "1101012331497033445",
        native: true,
      },
    ],
  };
}

function pinnedBlock() {
  return { number: "16" as const, hash: BLOCK_HASH, timestamp: "100" as const };
}

function createFetch(options: {
  tokenBalances: (url: URL) => Response | Promise<Response>;
  cashAmounts?: ReadonlyMap<string, bigint>;
  failFirstCashBatch?: boolean;
}) {
  const rpcBodies: unknown[] = [];
  let failFirstCashBatch = options.failFirstCashBatch === true;
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
    const items = Array.isArray(body) ? body : [body];
    const cashContracts = new Set(
      getDirectPortfolioAssets()
        .filter((asset) => asset.cashCurrency && asset.contractAddress)
        .map((asset) => asset.contractAddress!.toLowerCase()),
    );
    const isCashBatch = items.some((item) => {
      if (item.method !== "eth_call") return false;
      const to = (item.params[0] as { to?: string } | undefined)?.to?.toLowerCase();
      return to !== undefined && cashContracts.has(to);
    });
    if (isCashBatch && failFirstCashBatch) {
      failFirstCashBatch = false;
      return new Response("rate limited", { status: 429 });
    }
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
    const directContracts = new Set(
      getDirectPortfolioAssets()
        .filter((asset) => asset.kind === "erc20" && asset.contractAddress)
        .map((asset) => asset.contractAddress!.toLowerCase()),
    );
    expect(
      rpcCalls.every((call) => {
        if (call.method !== "eth_call") return true;
        const to = (call.params[0] as { to?: string }).to?.toLowerCase();
        return (
          portfolioVaults.some(({ address }) => address.toLowerCase() === to) ||
          (to !== undefined && directContracts.has(to))
        );
      }),
    ).toBeTrue();
    expect(
      rpcCalls.some(
        (call) =>
          call.method === "eth_call" &&
          directContracts.has(
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

  test("recovers CDP-omitted configured tokens from the verified owner and keeps zero assets absent", async () => {
    const affectedIds = ["toshi", "cbxrp", "cbdoge", "cbltc"];
    const affected = investPortfolioAssets.filter(({ id }) => affectedIds.includes(id));
    expect(affected).toHaveLength(4);
    const owners: string[] = [];
    const requested: string[] = [];

    const snapshot = await createPortfolioInventoryReader({
      listTokenBalances: async () => ({
        complete: true,
        balances: [
          {
            contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
            amountBaseUnits: "0",
            native: true,
          },
        ],
      }),
      readConfiguredErc20Balances: async (requests, owner) => {
        owners.push(owner);
        requested.push(...requests.map(({ id }) => id));
        return new Map(
          requests.map(({ id }, index) => [
            id,
            affectedIds.includes(id) ? String(index + 1) : "0",
          ]),
        );
      },
      readVaultInventory: async () => ({ block: pinnedBlock(), holdings: [] }),
      now: () => new Date("2026-09-12T12:00:00.000Z"),
    })(account, "USD");

    expect(owners).toEqual([ADDRESS.toLowerCase()]);
    expect(requested).toEqual(cashFirstConfiguredErc20Ids());
    for (const asset of affected) {
      expect(snapshot.holdings.find(({ id }) => id === asset.id)).toMatchObject({
        readStatus: "ready",
        balanceBaseUnits: expect.not.stringMatching(/^0$/),
      });
    }
    expect(
      snapshot.holdings
        .filter(
          (holding): holding is Extract<
            (typeof snapshot.holdings)[number],
            { kind: "direct" }
          > =>
            holding.kind === "direct" &&
            holding.assetKind === "erc20" &&
            !affectedIds.includes(holding.id),
        )
        .every(
          (holding) =>
            holding.readStatus === "ready" && holding.balanceBaseUnits === "0",
        ),
    ).toBeTrue();
  });

  test("retains the first configured single when the second hits the recovery stage deadline", async () => {
    const targets: string[] = [];
    const cash = getDirectPortfolioAssets().filter(
      (asset): asset is typeof asset & { contractAddress: `0x${string}` } =>
        asset.kind === "erc20" &&
        asset.contractAddress !== null &&
        asset.cashCurrency !== null,
    );
    const snapshot = await createPortfolioInventoryReader({
      rpcUrl: "https://rpc.example.test",
      erc20RecoveryTimeoutMs: 20,
      erc20RecoveryAttempts: 2,
      erc20RecoveryRetryDelayMs: 0,
      listTokenBalances: async () => ethOnlyComplete(),
      readVaultInventory: async () => ({ block: pinnedBlock(), holdings: [] }),
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as {
          params: Array<{ to: string } | string>;
        };
        targets.push((request.params[0] as { to: string }).to);
        if (targets.length === 1) {
          return Response.json({ jsonrpc: "2.0", id: 1, result: dataWord(BigInt(7)) });
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("stage deadline", "AbortError")),
            { once: true },
          );
        });
      },
      log: () => undefined,
      now: () => new Date("2026-09-12T12:00:00.000Z"),
    })(account, "USD");

    expect(targets).toEqual([
      cash[0]!.contractAddress.toLowerCase(),
      cash[1]!.contractAddress.toLowerCase(),
    ]);
    expect(snapshot.holdings.find(({ id }) => id === cash[0]!.id)).toMatchObject({
      balanceBaseUnits: "7",
      readStatus: "ready",
    });
    expect(snapshot.holdings.find(({ id }) => id === cash[1]!.id)).toMatchObject({
      balanceBaseUnits: null,
      readStatus: "unavailable",
    });
  });

  test("RPC-verifies cash when Token Balances fails so empty USDC/IDRX stay ready-0", async () => {
    const { fetchImpl } = createFetch({
      tokenBalances: () => new Response("no", { status: 429 }),
    });

    const snapshot = await createPortfolioInventoryReader({
      fetchImpl,
      rpcUrl: "https://rpc.example.test",
      env: { CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" },
      generateJwtImpl: async () => "signed-jwt",
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    expect(snapshot.holdings.find(({ id }) => id === "eth")).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "0",
    });
    expect(snapshot.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      id: "idrx",
      decimals: verifiedLocalCashAssets.IDR.decimals,
      readStatus: "ready",
      balanceBaseUnits: "0",
    });
    expect(
      snapshot.holdings.filter((holding) => holding.kind === "vault-position").every(
        (holding) => holding.readStatus === "ready",
      ),
    ).toBeTrue();
    expect(CdpTokenBalancesError).toBeDefined();
  });

  test("keeps cash Unavailable when CDP fails and configured ERC-20 RPC also misses", async () => {
    const snapshot = await createPortfolioInventoryReader({
      erc20RecoveryRetryDelayMs: 0,
      listTokenBalances: async () => {
        throw new CdpTokenBalancesError(
          "rate-limited",
          "CDP Token Balances rate limit was reached.",
          { status: 429 },
        );
      },
      readVaultInventory: async () => ({
        block: pinnedBlock(),
        holdings: [],
      }),
      readConfiguredErc20Balances: async (requests) => omittedNulls(requests),
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    expect(snapshot.holdings.find(({ id }) => id === "eth")).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
    expect(snapshot.holdings.find(({ id }) => id === "idrx")).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
  });

  test("keeps checkpointed quantities non-authoritative while accepting fresh resumed-page balances", async () => {
    const snapshot = await createPortfolioInventoryReader({
      listTokenBalances: async () => ({
        complete: false,
        balances: [
          {
            contractAddress: CDP_NATIVE_TOKEN_ADDRESS,
            amountBaseUnits: "42",
            native: true,
          },
          {
            contractAddress: PORTFOLIO_USDC_ADDRESS.toLowerCase() as `0x${string}`,
            amountBaseUnits: "7000000",
            native: false,
          },
        ],
        authoritativeContractAddresses: new Set([
          PORTFOLIO_USDC_ADDRESS.toLowerCase(),
        ]),
      }),
      readVaultInventory: async () => ({
        block: pinnedBlock(),
        holdings: [],
      }),
      readConfiguredErc20Balances: async (requests) => omittedZeros(requests),
      now: () => new Date("2026-09-11T12:00:00.000Z"),
    })(account, "IDR");

    expect(snapshot.holdings.find(({ id }) => id === "eth")).toMatchObject({
      readStatus: "incomplete",
      balanceBaseUnits: null,
    });
    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "7000000",
    });
  });

  test("does not invent ready zeros when Token Balances pagination is truncated and cash RPC also fails", async () => {
    const snapshot = await createPortfolioInventoryReader({
      erc20RecoveryRetryDelayMs: 0,
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
      readConfiguredErc20Balances: async (requests) =>
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

  test("default cash RPC reader restores omitted USDC and IDRX from latest balanceOf", async () => {
    const { fetchImpl, rpcBodies } = createFetch({
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
    const cashContracts = new Set(
      getDirectPortfolioAssets()
        .filter((asset) => asset.cashCurrency && asset.contractAddress)
        .map((asset) => asset.contractAddress!.toLowerCase()),
    );
    const cashBodies = rpcBodies.filter((body) => {
      const items = (
        Array.isArray(body) ? body : [body]
      ) as Array<{ method: string; params: unknown[] }>;
      return items.some((item) => {
        if (item.method !== "eth_call") return false;
        const to = (item.params[0] as { to?: string } | undefined)?.to?.toLowerCase();
        return to !== undefined && cashContracts.has(to);
      });
    });
    expect(cashBodies.length).toBeGreaterThan(0);
    expect(cashBodies.every((body) => !Array.isArray(body))).toBeTrue();
    expect(
      cashBodies.every(
        (body) =>
          !Array.isArray(body) &&
          (body as { params: unknown[] }).params[1] === "latest",
      ),
    ).toBeTrue();
  });

  test("vault-only Morpho USDC does not fill configured ERC-20 rows", async () => {
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
      readConfiguredErc20Balances: async (requests) =>
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

  test("does not invent ready zeros when dedicated cash-verify time runs out", async () => {
    const snapshot = await createPortfolioInventoryReader({
      erc20RecoveryTimeoutMs: 20,
      erc20RecoveryAttempts: 1,
      listTokenBalances: async () => ethOnlyComplete(),
      readVaultInventory: async () => ({
        block: pinnedBlock(),
        holdings: [],
      }),
      readConfiguredErc20Balances: async (requests, _owner, signal) => {
        await wait(60);
        if (signal.aborted) return omittedNulls(requests);
        return omittedZeros(requests);
      },
      now: () => new Date("2026-09-09T01:00:00.000Z"),
    })(account, "IDR");

    expect(snapshot.holdings.find(({ id }) => id === "eth")).toMatchObject({
      readStatus: "ready",
      balanceBaseUnits: "1101012331497033445",
    });
    expect(snapshot.holdings.find(({ id }) => id === "usdc")).toMatchObject({
      readStatus: "unavailable",
      balanceBaseUnits: null,
    });
    expect(snapshot.holdings.find(({ id }) => id === "idrx")).toMatchObject({
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

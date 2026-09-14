import { describe, expect, test } from "bun:test";
import type { RecognizedTokenCatalogEntry } from "@/server/market-data/codex/recognized-catalog";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import type { Holding } from "@/shared/balances/types";
import { createBalancesResolver } from "./resolve";
import { assembleBalancesSnapshot } from "./snapshot";
import type { BalancesEnumeration, BalancesRead, ReadHolding } from "./types";
import { registryEntries } from "./universe";

const registryAddress = "0x1111111111111111111111111111111111111111" as const;
const catalogAddress = "0x2222222222222222222222222222222222222222" as const;
const walletAddress = "0x3333333333333333333333333333333333333333" as const;
const invalidAddress = "0x4444444444444444444444444444444444444444" as const;
const catalog: RecognizedTokenCatalogEntry = {
  address: catalogAddress,
  name: "Catalog Name",
  symbol: "CAT",
  decimals: 6,
  imageUrl: "https://images.test/cat.png",
  liquidityUsd: { atoms: "100000", scale: 0 },
  volume24Usd: { atoms: "10000", scale: 0 },
};
const registryRead: BalancesRead = {
  block: {
    number: "1",
    hash: `0x${"1".repeat(64)}`,
    timestamp: "1",
  },
  observedAt: "2026-09-13T12:00:00.000Z",
  holdings: [{
    key: `eip155:8453/erc20:${registryAddress}`,
    id: "registry-token",
    kind: "erc20",
    source: "registry",
    name: "Registry",
    symbol: "REG",
    decimals: 6,
    contractAddress: registryAddress,
    cashCurrency: null,
    balance: { status: "ready", baseUnits: "9" },
  }],
  coverage: { registry: "complete", catalog: "unavailable" },
};

function enumeration(
  rows: BalancesEnumeration["rows"],
  status: BalancesEnumeration["status"] = "complete",
): BalancesEnumeration {
  return { status, rows, nextCursor: null, pagesRead: 1, durationMs: 1 };
}

describe("balances resolution", () => {
  test("resolves catalog and wallet rows while registry quantities remain pinned", async () => {
    const resolve = createBalancesResolver({
      readCatalog: async () => ({ status: "complete", entries: [catalog] }),
      readAssetIcons: async () => ({}),
      lookupTokens: async () => new Map([[walletAddress, {
        address: walletAddress,
        name: "Codex Wallet",
        symbol: "CWAL",
        decimals: 18,
        imageUrl: "https://images.test/wallet.png",
        liquidityUsd: { atoms: "100000", scale: 0 },
        volume24Usd: { atoms: "10000", scale: 0 },
      }]]),
    });
    const result = await resolve(registryRead, enumeration([
      {
        contractAddress: registryAddress,
        amountBaseUnits: "999",
        name: "Wrong",
        symbol: "BAD",
        decimals: 18,
      },
      {
        contractAddress: catalogAddress,
        amountBaseUnits: "1000000",
        name: "CDP Name",
        symbol: "CDP",
        decimals: 6,
      },
      {
        contractAddress: walletAddress,
        amountBaseUnits: "25",
        name: " Wallet Token ".trim(),
        symbol: "WAL",
        decimals: 18,
      },
      {
        contractAddress: invalidAddress,
        amountBaseUnits: "5",
        name: " Invalid ",
        symbol: "BAD",
        decimals: 18,
      },
      {
        contractAddress: "0x5555555555555555555555555555555555555555",
        amountBaseUnits: "0",
        name: "Zero",
        symbol: "ZERO",
        decimals: 18,
      },
      {
        contractAddress: walletAddress,
        amountBaseUnits: "999",
        name: "Duplicate",
        symbol: "DUP",
        decimals: 18,
      },
    ]));

    expect(result.holdings.find(({ id }) => id === "registry-token")?.balance)
      .toEqual({ status: "ready", baseUnits: "9" });
    expect(result.holdings.find(({ source }) => source === "catalog"))
      .toMatchObject({
        id: `catalog:${catalogAddress}`,
        name: "Catalog Name",
        symbol: "CAT",
        decimals: 6,
        imageUrl: "https://images.test/cat.png",
        balance: { status: "ready", baseUnits: "1000000" },
      });
    expect(result.holdings.find(({ source }) => source === "wallet"))
      .toEqual({
        key: `eip155:8453/erc20:${walletAddress}`,
        id: `wallet:${walletAddress}`,
        kind: "erc20",
        source: "wallet",
        name: "Codex Wallet",
        symbol: "CWAL",
        decimals: 18,
        contractAddress: walletAddress,
        cashCurrency: null,
        imageUrl: "https://images.test/wallet.png",
        liquidityUsd: { atoms: "100000", scale: 0 },
        volume24Usd: { atoms: "10000", scale: 0 },
        marketDataResolved: true,
        balance: { status: "ready", baseUnits: "25" },
      });
    expect(result.holdings).toHaveLength(3);
    expect(result.coverage.catalog).toBe("complete");
  });

  test("skips catalog decimal disagreements and marks coverage incomplete", async () => {
    const resolve = createBalancesResolver({
      readCatalog: async () => ({ status: "complete", entries: [catalog] }),
      readAssetIcons: async () => ({}),
      lookupTokens: async () => new Map(),
    });
    const result = await resolve(registryRead, enumeration([{
      contractAddress: catalogAddress,
      amountBaseUnits: "1",
      decimals: 18,
    }]));

    expect(result.holdings).toEqual(registryRead.holdings);
    expect(result.coverage.catalog).toBe("incomplete");
  });

  test.each([
    ["scan bound", "incomplete" as const, "complete" as const],
    ["catalog partial", "complete" as const, "incomplete" as const],
  ])("marks coverage incomplete for %s", async (_name, scan, catalogStatus) => {
    const resolve = createBalancesResolver({
      readCatalog: async () => ({ status: catalogStatus, entries: [] }),
      readAssetIcons: async () => ({}),
      lookupTokens: async () => new Map(),
    });
    const result = await resolve(registryRead, enumeration([], scan));
    expect(result.coverage.catalog).toBe("incomplete");
  });

  test("enumeration unavailable returns a registry-only snapshot without catalog fetch", async () => {
    let called = false;
    const resolve = createBalancesResolver({
      readCatalog: async () => {
        called = true;
        return { status: "complete", entries: [catalog] };
      },
      readAssetIcons: async () => ({}),
      lookupTokens: async () => new Map(),
    });
    const result = await resolve(registryRead, enumeration([], "unavailable"));

    expect(called).toBeFalse();
    expect(result.holdings).toEqual(registryRead.holdings);
    expect(result.coverage.catalog).toBe("unavailable");
  });

  test("keeps unknown and lookup-failed contracts quantity-only with CDP metadata", async () => {
    for (const lookupTokens of [
      async () => new Map(),
      async (): Promise<Map<string, never>> => {
        throw new Error("Codex unavailable");
      },
    ]) {
      const resolve = createBalancesResolver({
        readCatalog: async () => ({ status: "complete", entries: [] }),
        readAssetIcons: async () => ({}),
        lookupTokens,
      });
      const result = await resolve(registryRead, enumeration([{
        contractAddress: walletAddress,
        amountBaseUnits: "25",
        name: "CDP Wallet",
        symbol: "CDP",
        decimals: 18,
      }]));

      expect(result.holdings.at(-1)).toEqual({
        key: `eip155:8453/erc20:${walletAddress}`,
        id: `wallet:${walletAddress}`,
        kind: "erc20",
        source: "wallet",
        name: "CDP Wallet",
        symbol: "CDP",
        decimals: 18,
        contractAddress: walletAddress,
        cashCurrency: null,
        balance: { status: "ready", baseUnits: "25" },
      });
    }
  });

  test("skips Codex wallet metadata with disagreeing CDP decimals", async () => {
    const resolve = createBalancesResolver({
      readCatalog: async () => ({ status: "complete", entries: [] }),
      readAssetIcons: async () => ({}),
      lookupTokens: async () => new Map([[walletAddress, {
        address: walletAddress,
        name: "Codex Wallet",
        symbol: "CWAL",
        decimals: 6,
      }]]),
    });
    const result = await resolve(registryRead, enumeration([{
      contractAddress: walletAddress,
      amountBaseUnits: "25",
      name: "CDP Wallet",
      symbol: "CDP",
      decimals: 18,
    }]));

    expect(result.holdings).toEqual(registryRead.holdings);
    expect(result.coverage.catalog).toBe("incomplete");
  });

  test("attaches icons only to eligible registry ERC-20 holdings and icon failure remains contract-valid", async () => {
    const fullRead = fullRegistryRead();
    const withIcons = await createBalancesResolver({
      readAssetIcons: async () => ({
        cbbtc: "https://images.test/cbbtc.png",
        usdc: "https://images.test/usdc.png",
      }),
    })(fullRead, enumeration([], "unavailable"));

    expect(withIcons.holdings.find(({ id }) => id === "cbbtc")?.imageUrl)
      .toBe("https://images.test/cbbtc.png");
    expect(withIcons.holdings.find(({ id }) => id === "usdc")?.imageUrl)
      .toBeUndefined();

    const withoutIcons = await createBalancesResolver({
      readAssetIcons: async () => {
        throw new Error("icons unavailable");
      },
    })(fullRead, enumeration([], "unavailable"));
    const holdings = withoutIcons.holdings.map(pricedRegistryHolding);
    const snapshot = assembleBalancesSnapshot({
      owner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      region: "US",
      read: withoutIcons,
      holdings,
    });

    expect(parseBalancesSnapshot(snapshot, {
      subject: "fixture",
      smartAccountAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 8453,
    }, "US")).toEqual(snapshot);
  });
});

function fullRegistryRead(): BalancesRead {
  return {
    block: {
      number: "1",
      hash: `0x${"1".repeat(64)}`,
      timestamp: "1",
    },
    observedAt: "2026-09-13T12:00:00.000Z",
    holdings: registryEntries().map((entry): ReadHolding => ({
      ...entry,
      balance: { status: "ready", baseUnits: "0" },
      ...(entry.kind === "vault-share"
        ? { underlyingBalance: { status: "ready", baseUnits: "0" } }
        : {}),
    })),
    coverage: { registry: "complete", catalog: "unavailable" },
  };
}

function pricedRegistryHolding(holding: ReadHolding): Holding {
  return {
    key: holding.key,
    id: holding.id,
    kind: holding.kind,
    source: holding.source,
    name: holding.name,
    symbol: holding.symbol,
    decimals: holding.decimals,
    contractAddress: holding.contractAddress,
    cashCurrency: holding.cashCurrency,
    balance: holding.balance,
    ...(holding.underlying ? { underlying: holding.underlying } : {}),
    ...(holding.underlyingBalance
      ? { underlyingBalance: holding.underlyingBalance }
      : {}),
    value: {
      status: "priced",
      currency: "USD",
      amount: { atoms: "0", scale: 0 },
      asOf: "2026-09-13T12:00:00.000Z",
    },
    ...(holding.cashCurrency
      ? {
          cashValue: {
            status: "priced" as const,
            currency: holding.cashCurrency,
            amount: { atoms: "0", scale: 0 },
          },
        }
      : {}),
  };
}

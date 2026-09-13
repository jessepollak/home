import { describe, expect, test } from "bun:test";
import type { RecognizedTokenCatalogEntry } from "@/server/market-data/codex/recognized-catalog";
import { createBalancesResolver } from "./resolve";
import type { BalancesEnumeration, BalancesRead } from "./types";

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
  return { status, rows };
}

describe("balances resolution", () => {
  test("resolves catalog and wallet rows while registry quantities remain pinned", async () => {
    const resolve = createBalancesResolver({
      readCatalog: async () => ({ status: "complete", entries: [catalog] }),
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
        name: "Wallet Token",
        symbol: "WAL",
        decimals: 18,
        contractAddress: walletAddress,
        cashCurrency: null,
        balance: { status: "ready", baseUnits: "25" },
      });
    expect(result.holdings).toHaveLength(3);
    expect(result.coverage.catalog).toBe("complete");
  });

  test("skips catalog decimal disagreements and marks coverage incomplete", async () => {
    const resolve = createBalancesResolver({
      readCatalog: async () => ({ status: "complete", entries: [catalog] }),
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
    });
    const result = await resolve(registryRead, enumeration([], "unavailable"));

    expect(called).toBeFalse();
    expect(result.holdings).toEqual(registryRead.holdings);
    expect(result.coverage.catalog).toBe("unavailable");
  });
});

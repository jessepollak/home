import "server-only";

import {
  getCodexRecognizedTokenCatalog,
  type RecognizedTokenCatalogResult,
} from "@/server/market-data/codex/recognized-catalog";
import {
  catalogHoldingId,
  erc20AssetKey,
  walletHoldingId,
} from "@/shared/balances/types";
import type {
  BalancesEnumeration,
  BalancesRead,
  ReadHolding,
} from "./types";

type Dependencies = {
  readCatalog?: () => Promise<RecognizedTokenCatalogResult>;
};

export function createBalancesResolver(dependencies: Dependencies = {}) {
  const readCatalog = dependencies.readCatalog ??
    (() => getCodexRecognizedTokenCatalog());

  return async function resolveBalances(
    registryRead: BalancesRead,
    enumeration: BalancesEnumeration,
  ): Promise<BalancesRead> {
    if (enumeration.status === "unavailable") {
      return {
        ...registryRead,
        coverage: {
          ...registryRead.coverage,
          catalog: "unavailable",
        },
      };
    }

    let catalog: RecognizedTokenCatalogResult;
    try {
      catalog = await readCatalog();
    } catch {
      catalog = { status: "incomplete", entries: [] };
    }

    const registryContracts = new Set(
      registryRead.holdings.flatMap((holding) =>
        holding.source === "registry" && holding.contractAddress
          ? [holding.contractAddress.toLowerCase()]
          : [],
      ),
    );
    const catalogByContract = new Map(
      catalog.entries.map((entry) => [entry.address.toLowerCase(), entry]),
    );
    const seen = new Set<string>();
    const discovered: ReadHolding[] = [];
    let incomplete =
      enumeration.status === "incomplete" || catalog.status === "incomplete";

    for (const row of enumeration.rows) {
      const address = row.contractAddress.toLowerCase() as `0x${string}`;
      if (seen.has(address)) continue;
      seen.add(address);
      if (registryContracts.has(address) || !isPositive(row.amountBaseUnits)) {
        continue;
      }

      const catalogEntry = catalogByContract.get(address);
      if (catalogEntry) {
        if (
          row.decimals !== undefined &&
          row.decimals !== catalogEntry.decimals
        ) {
          incomplete = true;
          continue;
        }
        discovered.push({
          key: erc20AssetKey(address),
          id: catalogHoldingId(address),
          kind: "erc20",
          source: "catalog",
          name: catalogEntry.name,
          symbol: catalogEntry.symbol,
          decimals: catalogEntry.decimals,
          contractAddress: address,
          cashCurrency: null,
          ...(catalogEntry.imageUrl
            ? { imageUrl: catalogEntry.imageUrl }
            : {}),
          liquidityUsd: catalogEntry.liquidityUsd,
          volume24Usd: catalogEntry.volume24Usd,
          balance: {
            status: "ready",
            baseUnits: row.amountBaseUnits,
          },
        });
        continue;
      }

      if (
        !isBoundedText(row.name) ||
        !isBoundedText(row.symbol) ||
        !isDecimals(row.decimals)
      ) {
        continue;
      }
      discovered.push({
        key: erc20AssetKey(address),
        id: walletHoldingId(address),
        kind: "erc20",
        source: "wallet",
        name: row.name,
        symbol: row.symbol,
        decimals: row.decimals,
        contractAddress: address,
        cashCurrency: null,
        balance: {
          status: "ready",
          baseUnits: row.amountBaseUnits,
        },
      });
    }

    return {
      ...registryRead,
      holdings: [...registryRead.holdings, ...discovered],
      coverage: {
        ...registryRead.coverage,
        catalog: incomplete ? "incomplete" : "complete",
      },
    };
  };
}

export const resolveBalances = createBalancesResolver();

function isPositive(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value) && BigInt(value) > BigInt(0);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 64;
}

function isDecimals(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 255;
}

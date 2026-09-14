import "server-only";

import { getResolvedAssetIcons } from "@/server/market-data/asset-icons/resolve";
import {
  getCodexRecognizedTokenCatalog,
  type RecognizedTokenCatalogResult,
} from "@/server/market-data/codex/recognized-catalog";
import {
  getCodexTokenLookup,
  type CodexTokenLookupEntry,
} from "@/server/market-data/codex/token-lookup";
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
  readAssetIcons?: () => Promise<Record<string, string | null>>;
  lookupTokens?: (
    addresses: readonly `0x${string}`[],
  ) => Promise<Map<string, CodexTokenLookupEntry>>;
};

export function createBalancesResolver(dependencies: Dependencies = {}) {
  const readCatalog = dependencies.readCatalog ??
    (() => getCodexRecognizedTokenCatalog());
  const readAssetIcons = dependencies.readAssetIcons ?? getResolvedAssetIcons;
  const lookupTokens = dependencies.lookupTokens ?? getCodexTokenLookup;

  return async function resolveBalances(
    registryRead: BalancesRead,
    enumeration: BalancesEnumeration,
  ): Promise<BalancesRead> {
    const iconsRequest = readAssetIcons().catch(() => ({}));
    const catalogRequest = enumeration.status === "unavailable"
      ? null
      : readCatalog().catch((): RecognizedTokenCatalogResult => ({
          status: "incomplete",
          entries: [],
        }));
    const registryHoldings = attachRegistryIcons(
      registryRead.holdings,
      await iconsRequest,
    );
    const readWithIcons = {
      ...registryRead,
      holdings: registryHoldings,
    };

    if (enumeration.status === "unavailable") {
      return {
        ...readWithIcons,
        coverage: {
          ...readWithIcons.coverage,
          catalog: "unavailable",
        },
      };
    }

    const catalog = await catalogRequest!;

    const registryContracts = new Set(
      registryHoldings.flatMap((holding) =>
        holding.source === "registry" && holding.contractAddress
          ? [holding.contractAddress.toLowerCase()]
          : [],
      ),
    );
    const catalogByContract = new Map(
      catalog.entries.map((entry) => [entry.address.toLowerCase(), entry]),
    );
    const candidateAddresses = [...new Set(enumeration.rows.flatMap((row) => {
      const address = row.contractAddress.toLowerCase() as `0x${string}`;
      return !registryContracts.has(address) &&
          !catalogByContract.has(address) &&
          isPositive(row.amountBaseUnits)
        ? [address]
        : [];
    }))];
    let tokenLookup = new Map<string, CodexTokenLookupEntry>();
    try {
      tokenLookup = await lookupTokens(candidateAddresses);
    } catch {
      // Contract lookup is optional enrichment. CDP metadata remains usable.
    }

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

      const enriched = tokenLookup.get(address);
      if (enriched) {
        if (
          row.decimals !== undefined &&
          row.decimals !== enriched.decimals
        ) {
          incomplete = true;
          continue;
        }
        discovered.push({
          key: erc20AssetKey(address),
          id: walletHoldingId(address),
          kind: "erc20",
          source: "wallet",
          name: enriched.name,
          symbol: enriched.symbol,
          decimals: enriched.decimals,
          contractAddress: address,
          cashCurrency: null,
          ...(enriched.imageUrl ? { imageUrl: enriched.imageUrl } : {}),
          ...(enriched.liquidityUsd
            ? { liquidityUsd: enriched.liquidityUsd }
            : {}),
          ...(enriched.volume24Usd
            ? { volume24Usd: enriched.volume24Usd }
            : {}),
          marketDataResolved: true,
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
      ...readWithIcons,
      holdings: [...registryHoldings, ...discovered],
      coverage: {
        ...readWithIcons.coverage,
        catalog: incomplete ? "incomplete" : "complete",
      },
    };
  };
}

export const resolveBalances = createBalancesResolver();

function attachRegistryIcons(
  holdings: readonly ReadHolding[],
  icons: Readonly<Record<string, string | null>>,
): ReadHolding[] {
  return holdings.map((holding) => {
    const imageUrl = holding.source === "registry" &&
        holding.kind === "erc20" &&
        holding.cashCurrency === null
      ? icons[holding.id]
      : null;
    return imageUrl ? { ...holding, imageUrl } : holding;
  });
}

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

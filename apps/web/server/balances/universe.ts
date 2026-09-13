import "server-only";

import { encodeFunctionData } from "viem";
import {
  getDirectPortfolioAssets,
  portfolioVaults,
  PORTFOLIO_USDC_ASSET_KEY,
} from "@/config/portfolio-assets";
import {
  createBaseRpcClient,
  inspectBaseRpcUrl,
} from "@/server/chain/rpc";
import {
  CODEX_RECOGNIZED_CATALOG_TTL_MS,
  getCodexRecognizedTokenCatalog,
  type RecognizedTokenCatalogEntry,
  type RecognizedTokenCatalogResult,
} from "@/server/market-data/codex/recognized-catalog";
import {
  catalogHoldingId,
  erc20AssetKey,
  nativeAssetKey,
} from "@/shared/balances/types";
import {
  decodeAggregate3,
  decodeDecimals,
  encodeAggregate3,
  erc20Abi,
  MULTICALL3_ADDRESS,
} from "./abi";
import type { BalancesUniverse, UniverseEntry } from "./types";

const CATALOG_CHUNK_SIZE = 128;

type CatalogDecimalsResult = {
  values: Array<number | null>;
  failedIndexes: number[];
};

type Dependencies = {
  readCatalog?: (
    signal?: AbortSignal,
  ) => Promise<RecognizedTokenCatalogResult>;
  readDecimals?: (
    entries: readonly RecognizedTokenCatalogEntry[],
    signal?: AbortSignal,
  ) => Promise<CatalogDecimalsResult>;
  hasApiKey?: () => boolean;
  now?: () => number;
};

type Verification = {
  entries: UniverseEntry[];
  incomplete: boolean;
  transientFailure: boolean;
};

type VerifiedCache = {
  signature: string;
  storedAt: number;
  entries: UniverseEntry[];
};

export function createBalancesUniverseReader(dependencies: Dependencies = {}) {
  const readCatalog = dependencies.readCatalog ?? getCodexRecognizedTokenCatalog;
  const readDecimals = dependencies.readDecimals ?? createCatalogDecimalsReader();
  const hasApiKey = dependencies.hasApiKey ?? (
    () => Boolean(process.env.CODEX_API_KEY?.trim())
  );
  const now = dependencies.now ?? Date.now;
  let verifiedCache: VerifiedCache | null = null;
  let inFlight: {
    signature: string;
    promise: Promise<Verification>;
  } | null = null;

  return async function getBalancesUniverse(
    signal?: AbortSignal,
  ): Promise<BalancesUniverse> {
    const registry = registryEntries();
    if (!hasApiKey()) {
      return {
        entries: registry,
        catalogStatus: "unavailable",
      };
    }

    let catalog: RecognizedTokenCatalogResult;
    try {
      catalog = await readCatalog(signal);
    } catch {
      return {
        entries: registry,
        catalogStatus: "unavailable",
      };
    }

    const signature = catalog.entries
      .map((entry) => `${entry.address.toLowerCase()}:${entry.decimals}`)
      .join("|");
    const currentTime = now();
    let verified: Verification;

    if (
      verifiedCache &&
      verifiedCache.signature === signature &&
      currentTime - verifiedCache.storedAt <= CODEX_RECOGNIZED_CATALOG_TTL_MS
    ) {
      verified = {
        entries: verifiedCache.entries,
        incomplete: false,
        transientFailure: false,
      };
    } else {
      let flight = inFlight;
      if (flight?.signature !== signature) {
        flight = {
          signature,
          promise: verifyCatalog(catalog.entries, readDecimals),
        };
        inFlight = flight;
      }

      verified = await flight.promise;
      if (inFlight === flight) {
        if (!verified.transientFailure) {
          verifiedCache = {
            signature,
            storedAt: now(),
            entries: verified.entries,
          };
        }
        inFlight = null;
      }
      if (
        verified.transientFailure &&
        verifiedCache?.signature === signature
      ) {
        verified = {
          entries: verifiedCache.entries,
          incomplete: true,
          transientFailure: true,
        };
      }
    }

    return {
      entries: [...registry, ...verified.entries],
      catalogStatus:
        catalog.status === "complete" && !verified.incomplete
          ? "complete"
          : "incomplete",
    };
  };
}

export const getBalancesUniverse = createBalancesUniverseReader();

function registryEntries(): UniverseEntry[] {
  const direct = getDirectPortfolioAssets();
  const cash = direct.filter((asset) => asset.cashCurrency !== null);
  const native = direct.filter((asset) => asset.kind === "native");
  const other = direct.filter(
    (asset) => asset.cashCurrency === null && asset.kind !== "native",
  );

  return [
    ...cash,
    ...native,
    ...other,
  ].map((asset): UniverseEntry => ({
    key:
      asset.kind === "native"
        ? nativeAssetKey()
        : erc20AssetKey(asset.contractAddress!),
    kind: asset.kind,
    source: "registry",
    id: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    decimals: asset.decimals,
    contractAddress: asset.contractAddress
      ? asset.contractAddress.toLowerCase() as `0x${string}`
      : null,
    cashCurrency: asset.cashCurrency,
  })).concat(portfolioVaults.map((vault): UniverseEntry => ({
    key: erc20AssetKey(vault.address),
    kind: "vault-share",
    source: "registry",
    id: vault.id,
    name: vault.name,
    symbol: vault.symbol,
    decimals: vault.decimals,
    contractAddress: vault.address.toLowerCase() as `0x${string}`,
    cashCurrency: null,
    underlying: {
      key: PORTFOLIO_USDC_ASSET_KEY,
      symbol: "USDC",
      decimals: 6,
    },
  })));
}

async function verifyCatalog(
  entries: readonly RecognizedTokenCatalogEntry[],
  readDecimals: NonNullable<Dependencies["readDecimals"]>,
): Promise<Verification> {
  let result: CatalogDecimalsResult;
  try {
    result = await readDecimals(entries);
  } catch {
    return {
      entries: [],
      incomplete: true,
      transientFailure: true,
    };
  }

  const failedIndexes = new Set(result.failedIndexes);
  const verified: UniverseEntry[] = [];
  let transientFailure = result.values.length !== entries.length;
  let incomplete = transientFailure;

  entries.forEach((entry, index) => {
    if (failedIndexes.has(index)) {
      incomplete = true;
      return;
    }

    const decimals = result.values[index];
    if (decimals === null || decimals === undefined) {
      incomplete = true;
      transientFailure = true;
      return;
    }
    if (decimals !== entry.decimals) {
      return;
    }

    verified.push({
      key: erc20AssetKey(entry.address),
      kind: "erc20",
      source: "catalog",
      id: catalogHoldingId(entry.address),
      name: entry.name,
      symbol: entry.symbol,
      decimals: entry.decimals,
      contractAddress: entry.address.toLowerCase() as `0x${string}`,
      cashCurrency: null,
      ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
      liquidityUsd: entry.liquidityUsd,
      volume24Usd: entry.volume24Usd,
    });
  });

  return {
    entries: verified,
    incomplete,
    transientFailure: transientFailure || failedIndexes.size > 0,
  };
}

type CatalogDecimalsReaderDependencies = {
  rpc?: {
    request(
      method: string,
      params: readonly unknown[],
      signal?: AbortSignal,
    ): Promise<unknown>;
  };
  inspectRpc?: () => ReturnType<typeof inspectBaseRpcUrl>;
};

export function createCatalogDecimalsReader(
  dependencies: CatalogDecimalsReaderDependencies = {},
) {
  const rpc = dependencies.rpc ?? createBaseRpcClient();
  const inspectRpc = dependencies.inspectRpc ?? (() => inspectBaseRpcUrl());

  return async function readCatalogDecimals(
    entries: readonly RecognizedTokenCatalogEntry[],
    signal?: AbortSignal,
  ): Promise<CatalogDecimalsResult> {
    const chunks = chunk(entries, CATALOG_CHUNK_SIZE);
    const readChunk = async (
      entriesChunk: readonly RecognizedTokenCatalogEntry[],
      chunkIndex: number,
    ): Promise<CatalogDecimalsResult> => {
      const start = chunkIndex * CATALOG_CHUNK_SIZE;
      try {
        const value = await rpc.request(
          "eth_call",
          [
            {
              to: MULTICALL3_ADDRESS,
              data: encodeAggregate3(entriesChunk.map((entry) => ({
                target: entry.address,
                callData: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "decimals",
                }),
              }))),
            },
            "latest",
          ],
          signal,
        );
        const decoded = decodeAggregate3(value);
        return {
          values: entriesChunk.map((_, index) => {
            const row = decoded[index];
            if (!row?.success) {
              return null;
            }
            return decodeDecimals(row.returnData);
          }),
          failedIndexes: [],
        };
      } catch {
        return {
          values: entriesChunk.map(() => null),
          failedIndexes: entriesChunk.map((_, index) => start + index),
        };
      }
    };

    const results: CatalogDecimalsResult[] = [];
    if (inspectRpc().hostClass === "public-base") {
      for (let index = 0; index < chunks.length; index += 1) {
        results.push(await readChunk(chunks[index]!, index));
      }
    } else {
      results.push(...await Promise.all(chunks.map(readChunk)));
    }

    return {
      values: results.flatMap((result) => result.values),
      failedIndexes: results.flatMap((result) => result.failedIndexes),
    };
  };
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

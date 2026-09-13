import "server-only";

import {
  getDirectPortfolioAssets,
  portfolioVaults,
  PORTFOLIO_USDC_ASSET_KEY,
} from "@/config/portfolio-assets";
import { createBaseRpcClient } from "@/server/chain/rpc";
import {
  CODEX_RECOGNIZED_CATALOG_TTL_MS,
  getCodexRecognizedTokenCatalog,
  type RecognizedTokenCatalogEntry,
  type RecognizedTokenCatalogResult,
} from "@/server/market-data/codex/recognized-catalog";
import { catalogHoldingId, erc20AssetKey, nativeAssetKey } from "@/shared/balances/types";
import { decodeAggregate3, decodeDecimals, encodeAggregate3, erc20Abi, MULTICALL3_ADDRESS } from "./abi";
import type { BalancesUniverse, UniverseEntry } from "./types";
import { encodeFunctionData } from "viem";

const CATALOG_CHUNK_SIZE = 128;

type Dependencies = {
  readCatalog?: (signal?: AbortSignal) => Promise<RecognizedTokenCatalogResult>;
  readDecimals?: (entries: readonly RecognizedTokenCatalogEntry[], signal?: AbortSignal) => Promise<Array<number | null>>;
  hasApiKey?: () => boolean;
  now?: () => number;
};

export function createBalancesUniverseReader(dependencies: Dependencies = {}) {
  const readCatalog = dependencies.readCatalog ?? getCodexRecognizedTokenCatalog;
  const readDecimals = dependencies.readDecimals ?? createCatalogDecimalsReader();
  const hasApiKey = dependencies.hasApiKey ?? (() => Boolean(process.env.CODEX_API_KEY?.trim()));
  const now = dependencies.now ?? Date.now;
  let verifiedCache: { signature: string; storedAt: number; entries: UniverseEntry[]; incomplete: boolean } | null = null;
  let inFlight: Promise<{ entries: UniverseEntry[]; incomplete: boolean }> | null = null;

  return async function getBalancesUniverse(signal?: AbortSignal): Promise<BalancesUniverse> {
    const registry = registryEntries();
    if (!hasApiKey()) return { entries: registry, catalogStatus: "unavailable" };

    let catalog: RecognizedTokenCatalogResult;
    try { catalog = await readCatalog(signal); }
    catch { return { entries: registry, catalogStatus: "unavailable" }; }
    const signature = catalog.entries.map((entry) => `${entry.address.toLowerCase()}:${entry.decimals}`).join("|");
    const currentTime = now();
    let verified: { entries: UniverseEntry[]; incomplete: boolean };
    if (verifiedCache && verifiedCache.signature === signature && currentTime - verifiedCache.storedAt <= CODEX_RECOGNIZED_CATALOG_TTL_MS) {
      verified = verifiedCache;
    } else {
      if (!inFlight) {
        inFlight = verifyCatalog(catalog.entries, readDecimals, signal).finally(() => { inFlight = null; });
      }
      verified = await inFlight;
      verifiedCache = { signature, storedAt: now(), ...verified };
    }
    return {
      entries: [...registry, ...verified.entries],
      catalogStatus: catalog.status === "complete" && !verified.incomplete ? "complete" : "incomplete",
    };
  };
}

export const getBalancesUniverse = createBalancesUniverseReader();

function registryEntries(): UniverseEntry[] {
  const direct = getDirectPortfolioAssets();
  const cash = direct.filter((asset) => asset.cashCurrency !== null);
  const native = direct.filter((asset) => asset.kind === "native");
  const other = direct.filter((asset) => asset.cashCurrency === null && asset.kind !== "native");
  return [
    ...cash,
    ...native,
    ...other,
  ].map((asset): UniverseEntry => ({
    key: asset.kind === "native" ? nativeAssetKey() : erc20AssetKey(asset.contractAddress!),
    kind: asset.kind,
    source: "registry",
    id: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    decimals: asset.decimals,
    contractAddress: asset.contractAddress ? asset.contractAddress.toLowerCase() as `0x${string}` : null,
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
    underlying: { key: PORTFOLIO_USDC_ASSET_KEY, symbol: "USDC", decimals: 6 },
  })));
}

async function verifyCatalog(
  entries: readonly RecognizedTokenCatalogEntry[],
  readDecimals: NonNullable<Dependencies["readDecimals"]>,
  signal?: AbortSignal,
): Promise<{ entries: UniverseEntry[]; incomplete: boolean }> {
  let decimals: Array<number | null>;
  try { decimals = await readDecimals(entries, signal); }
  catch { return { entries: [], incomplete: true }; }
  const verified: UniverseEntry[] = [];
  let incomplete = decimals.length !== entries.length;
  entries.forEach((entry, index) => {
    if (decimals[index] !== entry.decimals) { incomplete = true; return; }
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
  return { entries: verified, incomplete };
}

function createCatalogDecimalsReader() {
  const rpc = createBaseRpcClient();
  return async (entries: readonly RecognizedTokenCatalogEntry[], signal?: AbortSignal): Promise<Array<number | null>> => {
    const chunks: RecognizedTokenCatalogEntry[][] = [];
    for (let index = 0; index < entries.length; index += CATALOG_CHUNK_SIZE) chunks.push(entries.slice(index, index + CATALOG_CHUNK_SIZE));
    const results = await Promise.all(chunks.map(async (chunk) => {
      try {
        const value = await rpc.request("eth_call", [{ to: MULTICALL3_ADDRESS, data: encodeAggregate3(chunk.map((entry) => ({
          target: entry.address,
          callData: encodeFunctionData({ abi: erc20Abi, functionName: "decimals" }),
        }))) }, "latest"], signal);
        const decoded = decodeAggregate3(value);
        return chunk.map((_, index) => {
          const result = decoded[index];
          if (!result?.success) return null;
          return decodeDecimals(result.returnData);
        });
      } catch {
        return chunk.map(() => null);
      }
    }));
    return results.flat();
  };
}

import {
  assertUniquePortfolioAssets,
  getDirectPortfolioAssets,
  portfolioVaults,
} from "@/config/portfolio-assets";
import type { FiatCurrencyCode } from "@/config/regions";
import { parseAddress, type Address } from "@/shared/chain/hex";
import {
  erc20AssetKey,
  nativeAssetKey,
  type Holding,
} from "./types";

export type RegistryExpectation = {
  id: string;
  key: string;
  kind: Holding["kind"];
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: Address | null;
  cashCurrency: FiatCurrencyCode | null;
};

export function assertUniqueRegistryInventory(): void {
  assertUniquePortfolioAssets([
    ...getDirectPortfolioAssets(),
    ...portfolioVaults.map((vault) => ({ id: vault.id, assetKey: erc20AssetKey(vault.address) })),
  ]);
}

let registryExpectations: Map<string, RegistryExpectation> | null = null;

let registryKeys: ReadonlySet<string> | null = null;

export function registryAssetKeys(): ReadonlySet<string> {
  registryKeys ??= new Set([...expectedRegistryHoldings().values()].map((holding) => holding.key));
  return registryKeys;
}

export function expectedRegistryHoldings(): ReadonlyMap<string, RegistryExpectation> {
  if (registryExpectations) return registryExpectations;
  const expectations = new Map<string, RegistryExpectation>();
  assertUniqueRegistryInventory();
  for (const asset of getDirectPortfolioAssets()) {
    const key = asset.kind === "native"
      ? nativeAssetKey()
      : asset.contractAddress === null
        ? null
        : erc20AssetKey(asset.contractAddress);
    if (!key) throw new Error(`The supported portfolio inventory has no contract for ${asset.id}.`);
    expectations.set(asset.id, {
      id: asset.id,
      key,
      kind: asset.kind,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      contractAddress: parseAddress(asset.contractAddress),
      cashCurrency: asset.cashCurrency,
    });
  }
  for (const vault of portfolioVaults) {
    expectations.set(vault.id, {
      id: vault.id,
      key: erc20AssetKey(vault.address),
      kind: "vault-share",
      name: vault.name,
      symbol: vault.symbol,
      decimals: vault.decimals,
      contractAddress: parseAddress(vault.address),
      cashCurrency: null,
    });
  }
  registryExpectations = expectations;
  return expectations;
}

export function normalizeNullableAddress(value: unknown): Address | null | undefined {
  return value === null ? null : parseAddress(value) ?? undefined;
}

type RegistryHoldingIdentity = {
  id?: unknown;
  key?: unknown;
  kind?: unknown;
  name?: unknown;
  symbol?: unknown;
  decimals?: unknown;
  contractAddress?: unknown;
  cashCurrency?: unknown;
};

export function registryExpectationMismatch(
  holding: RegistryHoldingIdentity,
  expected: RegistryExpectation | undefined,
): boolean {
  return !expected || holding.key !== expected.key || holding.kind !== expected.kind ||
    holding.name !== expected.name || holding.symbol !== expected.symbol ||
    holding.decimals !== expected.decimals ||
    normalizeNullableAddress(holding.contractAddress) !== expected.contractAddress ||
    (holding.cashCurrency ?? null) !== expected.cashCurrency;
}

export function registryHoldingsMatchExpectations(
  holdings: readonly ({ id: string; source: Holding["source"] } & RegistryHoldingIdentity)[],
): boolean {
  const expected = expectedRegistryHoldings();
  const expectedKeys = registryAssetKeys();
  const seen = new Set<string>();
  for (const holding of holdings) {
    if (holding.source !== "registry") {
      if (typeof holding.key === "string" && expectedKeys.has(holding.key)) return false;
      continue;
    }
    if (seen.has(holding.id) || registryExpectationMismatch(holding, expected.get(holding.id))) return false;
    seen.add(holding.id);
  }
  return seen.size === expected.size;
}

// Route contract.
// GET /api/balances?region=XX → BalancesSnapshot (docs/balances.md §4)
//
// The parser verifies shape and scope only: the snapshot belongs to the
// verified session, every registry asset is present with its configured
// metadata, catalog rows are disjoint from the registry, amounts are decimal
// integer strings, and each status discriminant carries the fields it
// promises. It does not recompute valuation arithmetic.

import {
  getDirectPortfolioAssets,
  portfolioVaults,
  PORTFOLIO_USDC_ASSET_KEY,
} from "@/config/portfolio-assets";
import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";
import {
  BALANCES_CHAIN_ID,
  BALANCES_VERSION,
  catalogHoldingId,
  erc20AssetKey,
  nativeAssetKey,
  walletHoldingId,
  type BalancesSession,
  type BalancesSnapshot,
  type ExactDecimal,
  type Holding,
  type HoldingBalance,
  type HoldingCashValue,
  type HoldingValue,
} from "./types";

export type { BalancesSnapshot } from "./types";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const lowercaseAddressPattern = /^0x[0-9a-f]{40}$/;
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const decimalIntegerPattern = /^(?:0|[1-9]\d*)$/;
const valueUnpricedReasons = new Set([
  "price-unavailable",
  "price-stale",
  "fx-unavailable",
  "below-market-gate",
  "no-quote-currency",
]);
const cashValueUnpricedReasons = new Set([
  "price-unavailable",
  "price-stale",
  "fx-unavailable",
]);

export class BalancesResponseError extends Error {
  constructor(message = "The balances response is invalid.") {
    super(message);
    this.name = "BalancesResponseError";
  }
}

type RegistryExpectation = {
  id: string;
  key: string;
  kind: Holding["kind"];
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: string | null;
  cashCurrency: FiatCurrencyCode | null;
};

let registryExpectations: Map<string, RegistryExpectation> | null = null;

/** Every registry asset the snapshot must carry, keyed by holding id. */
export function expectedRegistryHoldings(): ReadonlyMap<string, RegistryExpectation> {
  if (registryExpectations) return registryExpectations;
  const expectations = new Map<string, RegistryExpectation>();
  for (const asset of getDirectPortfolioAssets()) {
    expectations.set(asset.id, {
      id: asset.id,
      key: asset.kind === "native" ? nativeAssetKey() : erc20AssetKey(asset.contractAddress!),
      kind: asset.kind,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      contractAddress: asset.contractAddress ? asset.contractAddress.toLowerCase() : null,
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
      contractAddress: vault.address.toLowerCase(),
      cashCurrency: null,
    });
  }
  registryExpectations = expectations;
  return expectations;
}

export function parseBalancesSnapshot(
  value: unknown,
  session: BalancesSession,
  expectedRegion: RegionId,
): BalancesSnapshot {
  if (!isRecord(value)) fail("not an object");
  const expectedCurrency = presentationRegions[expectedRegion].currency.code;

  if (value.version !== BALANCES_VERSION) fail("version");
  if (
    !isRecord(value.owner) ||
    typeof value.owner.address !== "string" ||
    !addressPattern.test(value.owner.address) ||
    value.owner.address.toLowerCase() !== session.smartAccountAddress.toLowerCase() ||
    value.owner.chainId !== BALANCES_CHAIN_ID ||
    session.chainId !== BALANCES_CHAIN_ID
  ) {
    fail("owner");
  }
  if (value.region !== expectedRegion) fail("region");
  if (value.quoteCurrency !== expectedCurrency) fail("quoteCurrency");
  if (
    !isRecord(value.block) ||
    !readInteger(value.block.number) ||
    typeof value.block.hash !== "string" ||
    !blockHashPattern.test(value.block.hash) ||
    !readInteger(value.block.timestamp)
  ) {
    fail("block");
  }
  if (!readIso(value.fetchedAt)) fail("fetchedAt");
  if (!Array.isArray(value.holdings)) fail("holdings");

  const quoteCurrency = expectedCurrency as FiatCurrencyCode | null;
  const registry = expectedRegistryHoldings();
  const registryKeys = new Set([...registry.values()].map(({ key }) => key));
  const seenKeys = new Set<string>();
  const seenIds = new Set<string>();
  const seenRegistryIds = new Set<string>();
  const holdings: Holding[] = [];

  for (const raw of value.holdings) {
    const holding = validateHolding(raw, quoteCurrency, registry, registryKeys);
    if (seenKeys.has(holding.key) || seenIds.has(holding.id)) fail("duplicate holding");
    seenKeys.add(holding.key);
    seenIds.add(holding.id);
    if (holding.source === "registry") seenRegistryIds.add(holding.id);
    holdings.push(holding);
  }
  for (const id of registry.keys()) {
    if (!seenRegistryIds.has(id)) fail(`registry holding missing: ${id}`);
  }

  if (
    !isRecord(value.coverage) ||
    !["complete", "partial"].includes(String(value.coverage.registry)) ||
    !["complete", "incomplete", "unavailable"].includes(String(value.coverage.catalog))
  ) {
    fail("coverage");
  }
  const registryUnavailable = holdings.some(
    (holding) => holding.source === "registry" && holding.balance.status === "unavailable",
  );
  if ((value.coverage.registry === "partial") !== registryUnavailable) fail("coverage.registry");

  if (!isRecord(value.total)) fail("total");
  const total = value.total;
  switch (total.status) {
    case "complete":
    case "partial":
      if (!validateDecimal(total.value) || total.currency !== quoteCurrency || quoteCurrency === null) {
        fail("total value");
      }
      break;
    case "unavailable":
      if (total.value !== null || total.currency !== quoteCurrency) fail("total unavailable");
      break;
    case "no-quote-currency":
      if (total.value !== null || total.currency !== null || quoteCurrency !== null) {
        fail("total no-quote-currency");
      }
      break;
    default:
      fail("total status");
  }
  if (quoteCurrency === null && total.status !== "no-quote-currency") fail("total status vs currency");
  if (value.stale !== undefined && value.stale !== true) fail("stale flag");

  return {
    version: BALANCES_VERSION,
    owner: { address: value.owner.address as `0x${string}`, chainId: BALANCES_CHAIN_ID },
    region: expectedRegion,
    quoteCurrency,
    block: {
      number: value.block.number,
      hash: value.block.hash as `0x${string}`,
      timestamp: value.block.timestamp,
    },
    fetchedAt: value.fetchedAt,
    holdings,
    coverage: {
      registry: value.coverage.registry as BalancesSnapshot["coverage"]["registry"],
      catalog: value.coverage.catalog as BalancesSnapshot["coverage"]["catalog"],
    },
    total: {
      status: total.status,
      value: total.value as ExactDecimal | null,
      currency: total.currency as FiatCurrencyCode | null,
    },
    ...(value.stale === true ? { stale: true as const } : {}),
  };
}

function validateHolding(
  raw: unknown,
  quoteCurrency: FiatCurrencyCode | null,
  registry: ReadonlyMap<string, RegistryExpectation>,
  registryKeys: ReadonlySet<string>,
): Holding {
  if (!isRecord(raw)) fail("holding shape");
  if (raw.source !== "registry" && raw.source !== "catalog" && raw.source !== "wallet") {
    fail("holding source");
  }
  if (typeof raw.id !== "string" || typeof raw.key !== "string") fail("holding identity");
  if (!readBoundedText(raw.name) || !readBoundedText(raw.symbol)) fail("holding name");
  if (!readDecimals(raw.decimals)) fail("holding decimals");
  const balance = validateBalance(raw.balance);
  const value = validateValue(raw.value, balance, quoteCurrency);

  if (raw.source === "registry") {
    const expected = registry.get(raw.id);
    if (
      !expected ||
      raw.key !== expected.key ||
      raw.kind !== expected.kind ||
      raw.name !== expected.name ||
      raw.symbol !== expected.symbol ||
      raw.decimals !== expected.decimals ||
      normalizeNullableAddress(raw.contractAddress) !== expected.contractAddress ||
      (raw.cashCurrency ?? null) !== expected.cashCurrency ||
      (raw.imageUrl !== undefined && !validateHttpsImage(raw.imageUrl)) ||
      (raw.imageUrl !== undefined && (expected.kind !== "erc20" || expected.cashCurrency !== null))
    ) {
      fail(`registry holding mismatch: ${raw.id}`);
    }
    const holding: Holding = {
      key: expected.key as Holding["key"],
      id: expected.id,
      kind: expected.kind,
      source: "registry",
      name: expected.name,
      symbol: expected.symbol,
      decimals: expected.decimals,
      contractAddress: expected.contractAddress as Holding["contractAddress"],
      cashCurrency: expected.cashCurrency,
      ...(raw.imageUrl !== undefined ? { imageUrl: raw.imageUrl as string } : {}),
      balance,
      value,
    };
    if (expected.kind === "vault-share") {
      if (
        !isRecord(raw.underlying) ||
        raw.underlying.key !== PORTFOLIO_USDC_ASSET_KEY ||
        raw.underlying.symbol !== "USDC" ||
        raw.underlying.decimals !== 6
      ) {
        fail("vault underlying");
      }
      const underlyingBalance = validateBalance(raw.underlyingBalance);
      if (balance.status === "unavailable" && underlyingBalance.status !== "unavailable") {
        fail("vault underlying balance without shares");
      }
      holding.underlying = { key: PORTFOLIO_USDC_ASSET_KEY, symbol: "USDC", decimals: 6 };
      holding.underlyingBalance = underlyingBalance;
    } else if (raw.underlying !== undefined || raw.underlyingBalance !== undefined) {
      fail("underlying on non-vault");
    }
    if (expected.cashCurrency) {
      holding.cashValue = validateCashValue(raw.cashValue, balance, expected.cashCurrency);
    } else if (raw.cashValue !== undefined) {
      fail("cashValue on non-cash");
    }
    return holding;
  }

  // Catalog or wallet-discovered row: positive ERC-20 outside the registry.
  const contractAddress = typeof raw.contractAddress === "string" ? raw.contractAddress : "";
  const expectedId = raw.source === "catalog"
    ? catalogHoldingId(contractAddress)
    : walletHoldingId(contractAddress);
  if (
    !lowercaseAddressPattern.test(contractAddress) ||
    raw.kind !== "erc20" ||
    raw.id !== expectedId ||
    raw.key !== erc20AssetKey(contractAddress) ||
    registryKeys.has(raw.key) ||
    (raw.cashCurrency ?? null) !== null ||
    raw.underlying !== undefined ||
    raw.underlyingBalance !== undefined ||
    raw.cashValue !== undefined ||
    balance.status !== "ready" ||
    balance.baseUnits === "0" ||
    (raw.imageUrl !== undefined && !validateHttpsImage(raw.imageUrl))
  ) {
    fail(`${raw.source} holding`);
  }
  return {
    key: raw.key as Holding["key"],
    id: raw.id,
    kind: "erc20",
    source: raw.source,
    name: raw.name as string,
    symbol: raw.symbol as string,
    decimals: raw.decimals as number,
    contractAddress: contractAddress as `0x${string}`,
    cashCurrency: null,
    ...(raw.imageUrl !== undefined ? { imageUrl: raw.imageUrl as string } : {}),
    balance,
    value,
  };
}

function validateBalance(raw: unknown): HoldingBalance {
  if (!isRecord(raw)) fail("balance");
  if (raw.status === "ready" && readInteger(raw.baseUnits)) {
    return { status: "ready", baseUnits: raw.baseUnits };
  }
  if (raw.status === "unavailable" && raw.baseUnits === null) {
    return { status: "unavailable", baseUnits: null };
  }
  fail("balance status");
}

function validateValue(
  raw: unknown,
  balance: HoldingBalance,
  quoteCurrency: FiatCurrencyCode | null,
): HoldingValue {
  if (!isRecord(raw)) fail("value");
  if (balance.status === "unavailable") {
    if (raw.status !== "unavailable") fail("value must be unavailable");
    return { status: "unavailable" };
  }
  if (raw.status === "priced") {
    if (
      quoteCurrency === null ||
      raw.currency !== quoteCurrency ||
      !validateDecimal(raw.amount) ||
      !readIso(raw.asOf)
    ) {
      fail("priced value");
    }
    return {
      status: "priced",
      currency: quoteCurrency,
      amount: raw.amount as ExactDecimal,
      asOf: raw.asOf,
    };
  }
  if (raw.status === "unpriced") {
    if (!valueUnpricedReasons.has(String(raw.reason))) fail("unpriced reason");
    if ((quoteCurrency === null) !== (raw.reason === "no-quote-currency")) fail("unpriced vs currency");
    return { status: "unpriced", reason: raw.reason as Extract<HoldingValue, { status: "unpriced" }>["reason"] };
  }
  fail("value status");
}

function validateCashValue(
  raw: unknown,
  balance: HoldingBalance,
  cashCurrency: FiatCurrencyCode,
): HoldingCashValue {
  if (!isRecord(raw)) fail("cashValue");
  if (balance.status === "unavailable") {
    if (raw.status !== "unavailable") fail("cashValue must be unavailable");
    return { status: "unavailable" };
  }
  if (raw.status === "priced") {
    if (raw.currency !== cashCurrency || !validateDecimal(raw.amount)) fail("priced cashValue");
    return { status: "priced", currency: cashCurrency, amount: raw.amount as ExactDecimal };
  }
  if (raw.status === "unpriced") {
    if (!cashValueUnpricedReasons.has(String(raw.reason))) fail("cashValue reason");
    return { status: "unpriced", reason: raw.reason as Extract<HoldingCashValue, { status: "unpriced" }>["reason"] };
  }
  fail("cashValue status");
}

function validateDecimal(value: unknown): value is ExactDecimal {
  return (
    isRecord(value) &&
    readInteger(value.atoms) &&
    typeof value.scale === "number" &&
    Number.isSafeInteger(value.scale) &&
    value.scale >= 0 &&
    value.scale <= 100
  );
}

function validateHttpsImage(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function normalizeNullableAddress(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && addressPattern.test(value)) return value.toLowerCase();
  return undefined;
}

function readBoundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 64
  );
}

function readDecimals(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255;
}

function readInteger(value: unknown): value is string {
  return typeof value === "string" && decimalIntegerPattern.test(value);
}

function readIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function fail(detail: string): never {
  throw new BalancesResponseError(`The balances response is invalid (${detail}).`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

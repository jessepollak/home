import { parseAddress, parseHash32, type Address, type Hash32 } from "@/shared/chain/hex";

import {
  getDirectPortfolioAssets,
  portfolioVaults,
  PORTFOLIO_USDC_ASSET_KEY,
} from "@/config/portfolio-assets";
import { getBorrowMarketRef, type BorrowAssetRef } from "@/shared/borrowing/config";
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
  type BalancesBorrow,
  type BalancesSnapshot,
  type BalancesTotal,
  type BalancesTotals,
  type BorrowCollateralHolding,
  type BorrowDebtLine,
  type BorrowPosition,
  type ExactDecimal,
  type Holding,
  type HoldingBalance,
  type HoldingCashValue,
  type HoldingValue,
  type HoldingValueReference,
} from "./types";

export type { BalancesSnapshot } from "./types";
type ParsedHolding = Holding & { contractAddress: Address | null };
type ParsedBorrowCollateralHolding = BorrowCollateralHolding & { contractAddress: Address; collateral: { marketId: Hash32 } };
type ParsedBorrowDebtLine = BorrowDebtLine & { marketId: Hash32 };
type ParsedBorrowPosition = BorrowPosition & { marketId: Hash32; collateral: ParsedBorrowCollateralHolding; debt: ParsedBorrowDebtLine };
type ParsedBalancesBorrow = BalancesBorrow & { positions: ParsedBorrowPosition[] };
export type ParsedBalancesSnapshot = BalancesSnapshot & {
  owner: { address: Address; chainId: typeof BALANCES_CHAIN_ID };
  block: { number: string; hash: Hash32; timestamp: string };
  holdings: ParsedHolding[];
  borrow: ParsedBalancesBorrow;
};

const decimalIntegerPattern = /^(?:0|[1-9]\d*)$/;
const valueUnpricedReasons = new Set([
  "price-unavailable",
  "price-stale",
  "fx-unavailable",
  "below-market-gate",
  "no-quote-currency",
  "price-paused",
  "asset-removed",
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
  contractAddress: Address | null;
  cashCurrency: FiatCurrencyCode | null;
};

let registryExpectations: Map<string, RegistryExpectation> | null = null;

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

export function parseBalancesSnapshot(
  value: unknown,
  session: BalancesSession,
  expectedRegion: RegionId,
): ParsedBalancesSnapshot {
  if (!isRecord(value)) fail("not an object");
  const expectedCurrency = presentationRegions[expectedRegion].currency.code;

  if (value.version !== BALANCES_VERSION) fail("version");
  const owner = isRecord(value.owner) ? value.owner : null;
  const ownerAddress = parseAddress(owner?.address);
  if (
    !owner ||
    !ownerAddress ||
    ownerAddress !== parseAddress(session.smartAccountAddress) ||
    owner.chainId !== BALANCES_CHAIN_ID ||
    session.chainId !== BALANCES_CHAIN_ID
  ) {
    fail("owner");
  }
  if (value.region !== expectedRegion) fail("region");
  if (value.quoteCurrency !== expectedCurrency) fail("quoteCurrency");
  const block = isRecord(value.block) ? value.block : null;
  const blockHash = parseHash32(block?.hash);
  if (
    !block ||
    !readInteger(block.number) ||
    !blockHash ||
    !readInteger(block.timestamp)
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
  const holdings: ParsedHolding[] = [];

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

  const total = validateTotal(value.total, quoteCurrency, "total");
  const borrow = validateBorrow(value.borrow, quoteCurrency);
  const totals = validateTotals(value.totals, quoteCurrency, borrow);
  if (value.stale !== undefined && value.stale !== true) fail("stale flag");

  return {
    version: BALANCES_VERSION,
    owner: { address: ownerAddress, chainId: BALANCES_CHAIN_ID },
    region: expectedRegion,
    quoteCurrency,
    block: {
      number: block.number,
      hash: blockHash,
      timestamp: block.timestamp,
    },
    fetchedAt: value.fetchedAt,
    holdings,
    coverage: {
      registry: value.coverage.registry as BalancesSnapshot["coverage"]["registry"],
      catalog: value.coverage.catalog as BalancesSnapshot["coverage"]["catalog"],
    },
    total,
    borrow,
    totals,
    ...(value.stale === true ? { stale: true as const } : {}),
  };
}

function validateTotal(
  raw: unknown,
  quoteCurrency: FiatCurrencyCode | null,
  label: string,
): BalancesTotal {
  if (!isRecord(raw)) fail(label);
  switch (raw.status) {
    case "complete":
    case "partial":
      if (!validateDecimal(raw.value) || raw.currency !== quoteCurrency || quoteCurrency === null) {
        fail(`${label} value`);
      }
      break;
    case "unavailable":
      if (raw.value !== null || raw.currency !== quoteCurrency) fail(`${label} unavailable`);
      break;
    case "no-quote-currency":
      if (raw.value !== null || raw.currency !== null || quoteCurrency !== null) {
        fail(`${label} no-quote-currency`);
      }
      break;
    default:
      fail(`${label} status`);
  }
  if (quoteCurrency === null && raw.status !== "no-quote-currency") fail(`${label} status vs currency`);
  return {
    status: raw.status,
    value: raw.value as ExactDecimal | null,
    currency: raw.currency as FiatCurrencyCode | null,
  };
}

function validateTotals(
  raw: unknown,
  quoteCurrency: FiatCurrencyCode | null,
  borrow: BalancesBorrow,
): BalancesTotals {
  if (!isRecord(raw)) fail("totals");
  const cash = validateTotal(raw.cash, quoteCurrency, "totals.cash");
  const investments = validateTotal(raw.investments, quoteCurrency, "totals.investments");
  const debt = validateTotal(raw.borrow, quoteCurrency, "totals.borrow");
  const net = validateTotal(raw.net, quoteCurrency, "totals.net");
  if (!isRecord(raw.net) || typeof raw.net.negative !== "boolean") fail("totals.net sign");
  const negative = raw.net.negative;
  if (net.value === null && negative) fail("totals.net sign without value");
  if (borrow.coverage === "partial" && (debt.status === "complete" || net.status === "complete")) {
    fail("totals complete with partial borrow");
  }
  if (net.status === "complete" && [cash, investments, debt].some((entry) => entry.status !== "complete")) {
    fail("totals.net complete with incomplete component");
  }
  return { cash, investments, borrow: debt, net: { ...net, negative } };
}

function validateBorrow(raw: unknown, quoteCurrency: FiatCurrencyCode | null): ParsedBalancesBorrow {
  if (!isRecord(raw) || (raw.coverage !== "complete" && raw.coverage !== "partial") || !Array.isArray(raw.positions)) {
    fail("borrow");
  }
  const seen = new Set<string>();
  const positions = raw.positions.map((entry): ParsedBorrowPosition => {
    if (!isRecord(entry) || typeof entry.marketId !== "string") fail("borrow position");
    const market = getBorrowMarketRef(entry.marketId);
    const marketId = parseHash32(entry.marketId);
    if (!marketId || !market || marketId !== parseHash32(market.marketId) || seen.has(marketId)) fail("borrow market");
    seen.add(marketId);
    if (!readInteger(entry.borrowAprWad)) fail("borrow apr");
    const collateral = validateCollateral(entry.collateral, market.collateralToken, marketId, quoteCurrency);
    const debt = validateDebt(entry.debt, market.loanToken, marketId, quoteCurrency);
    if (collateral.balance.baseUnits === "0" && debt.balance.baseUnits === "0") fail("empty borrow position");
    return { marketId, collateral, debt, borrowAprWad: entry.borrowAprWad };
  });
  return { coverage: raw.coverage, positions };
}

function validateCollateral(
  raw: unknown,
  asset: BorrowAssetRef,
  marketId: Hash32,
  quoteCurrency: FiatCurrencyCode | null,
): ParsedBorrowCollateralHolding {
  if (!isRecord(raw)) fail("borrow collateral");
  const key = erc20AssetKey(asset.address);
  const balance = validateBalance(raw.balance);
  const contractAddress = parseAddress(asset.address);
  if (
    raw.source !== "borrow" ||
    raw.kind !== "erc20" ||
    raw.key !== key ||
    raw.id !== `borrow-collateral:${marketId}` ||
    !contractAddress ||
    normalizeNullableAddress(raw.contractAddress) !== contractAddress ||
    raw.decimals !== asset.decimals ||
    !readBoundedText(raw.name) ||
    !readBoundedText(raw.symbol) ||
    (raw.cashCurrency ?? null) !== null ||
    !isRecord(raw.collateral) ||
    parseHash32(raw.collateral.marketId) !== marketId ||
    raw.underlying !== undefined ||
    raw.underlyingBalance !== undefined ||
    raw.cashValue !== undefined ||
    raw.imageUrl !== undefined ||
    balance.status !== "ready"
  ) {
    fail("borrow collateral holding");
  }
  const value = validateValue(raw.value, balance, quoteCurrency);
  const unitValue = validateUnitValue(raw.unitValue, value, "erc20");
  return {
    key,
    id: raw.id,
    kind: "erc20",
    source: "borrow",
    name: raw.name,
    symbol: raw.symbol,
    decimals: asset.decimals,
    contractAddress,
    cashCurrency: null,
    balance,
    value,
    ...(unitValue ? { unitValue } : {}),
    collateral: { marketId },
  };
}

function validateDebt(
  raw: unknown,
  asset: BorrowAssetRef,
  marketId: Hash32,
  quoteCurrency: FiatCurrencyCode | null,
): ParsedBorrowDebtLine {
  if (!isRecord(raw) || !isRecord(raw.asset)) fail("borrow debt");
  const key = erc20AssetKey(asset.address);
  const balance = validateBalance(raw.balance);
  if (
    raw.sign !== -1 ||
    parseHash32(raw.marketId) !== marketId ||
    raw.asset.key !== key ||
    raw.asset.decimals !== asset.decimals ||
    !readBoundedText(raw.asset.name) ||
    !readBoundedText(raw.asset.symbol) ||
    balance.status !== "ready"
  ) {
    fail("borrow debt line");
  }
  return {
    sign: -1,
    marketId,
    asset: { key, name: raw.asset.name, symbol: raw.asset.symbol, decimals: asset.decimals },
    balance,
    value: validateValue(raw.value, balance, quoteCurrency),
  };
}

function validateHolding(
  raw: unknown,
  quoteCurrency: FiatCurrencyCode | null,
  registry: ReadonlyMap<string, RegistryExpectation>,
  registryKeys: ReadonlySet<string>,
): ParsedHolding {
  if (!isRecord(raw)) fail("holding shape");
  if (raw.source !== "registry" && raw.source !== "catalog" && raw.source !== "wallet") {
    fail("holding source");
  }
  if (typeof raw.id !== "string" || typeof raw.key !== "string") fail("holding identity");
  if (!readBoundedText(raw.name) || !readBoundedText(raw.symbol)) fail("holding name");
  if (!readDecimals(raw.decimals)) fail("holding decimals");
  const balance = validateBalance(raw.balance);
  const value = validateValue(raw.value, balance, quoteCurrency);
  const unitValue = validateUnitValue(raw.unitValue, value, raw.kind);

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
    const holding: ParsedHolding = {
      key: expected.key as Holding["key"],
      id: expected.id,
      kind: expected.kind,
      source: "registry",
      name: expected.name,
      symbol: expected.symbol,
      decimals: expected.decimals,
      contractAddress: expected.contractAddress,
      cashCurrency: expected.cashCurrency,
      ...(raw.imageUrl !== undefined ? { imageUrl: raw.imageUrl as string } : {}),
      balance,
      value,
      ...(unitValue ? { unitValue } : {}),
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

  const contractAddress = parseAddress(raw.contractAddress);
  if (!contractAddress) fail("holding address");
  const expectedId = raw.source === "catalog"
    ? catalogHoldingId(contractAddress)
    : walletHoldingId(contractAddress);
  if (
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
    contractAddress,
    cashCurrency: null,
    ...(raw.imageUrl !== undefined ? { imageUrl: raw.imageUrl as string } : {}),
    balance,
    value,
    ...(unitValue ? { unitValue } : {}),
  };
}

function validateUnitValue(raw: unknown, value: HoldingValue, kind: unknown): Holding["unitValue"] {
  if (raw === undefined) return undefined;
  if (
    value.status !== "priced" ||
    kind === "vault-share" ||
    !isRecord(raw) ||
    raw.currency !== value.currency ||
    !validateDecimal(raw.amount) ||
    raw.amount.atoms === "0"
  ) {
    fail("unitValue");
  }
  return { currency: value.currency, amount: raw.amount };
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
      !readIso(raw.asOf) ||
      !(raw.reference === undefined || isValueReference(raw.reference))
    ) {
      fail("priced value");
    }
    return {
      status: "priced",
      currency: quoteCurrency,
      amount: raw.amount as ExactDecimal,
      asOf: raw.asOf,
      ...(isValueReference(raw.reference) ? { reference: { kind: "tokenized-equity" as const, session: raw.reference.session } } : {}),
    };
  }
  if (raw.status === "unpriced") {
    if (!valueUnpricedReasons.has(String(raw.reason))) fail("unpriced reason");
    if ((quoteCurrency === null) !== (raw.reason === "no-quote-currency")) fail("unpriced vs currency");
    return { status: "unpriced", reason: raw.reason as Extract<HoldingValue, { status: "unpriced" }>["reason"] };
  }
  fail("value status");
}

function isValueReference(value: unknown): value is HoldingValueReference {
  return isRecord(value) && value.kind === "tokenized-equity" &&
    (value.session === "open" || value.session === "closed");
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

function normalizeNullableAddress(value: unknown): Address | null | undefined {
  return value === null ? null : parseAddress(value) ?? undefined;
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

import {
  PORTFOLIO_NATIVE_ASSET_KEY,
  PORTFOLIO_USDC_ASSET_KEY,
  getDirectPortfolioAssets,
} from "@/config/portfolio-assets";
import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";
import type { PortfolioValuationSnapshot } from "./valuation-state";
import type { VerifiedPortfolioSession } from "@/shared/portfolio/types";
import {
  baseUnitsToFraction,
  exactDecimalToFraction,
  multiplyFractions,
  roundFractionPreservingPositive,
} from "@/shared/portfolio/valuation-math";
import type { ExactDecimal } from "@/shared/portfolio/valuation-types";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const decimalIntegerPattern = /^(?:0|[1-9]\d*)$/;
const assetKeyPattern = /^(?:eip155:8453\/native|eip155:8453\/erc20:0x[0-9a-f]{40})$/;
const nativeCashAssets = getDirectPortfolioAssets().filter(
  (asset): asset is typeof asset & {
    assetKey: `eip155:8453/erc20:${string}`;
    contractAddress: `0x${string}`;
    cashCurrency: FiatCurrencyCode;
  } =>
    asset.kind === "erc20" &&
    asset.contractAddress !== null &&
    asset.cashCurrency !== null,
);
const nativeCashAssetByKey = new Map(
  nativeCashAssets.map((asset) => [asset.assetKey, asset]),
);

export class PortfolioValuationResponseError extends Error {
  constructor() {
    super("The portfolio valuation response is invalid.");
    this.name = "PortfolioValuationResponseError";
  }
}

export function parsePortfolioValuationSnapshot(
  value: unknown,
  expectedSession: VerifiedPortfolioSession,
  expectedRegion: RegionId,
): PortfolioValuationSnapshot {
  if (!isRecord(value)) fail();
  const expectedCurrency = presentationRegions[expectedRegion].currency.code;
  if (
    value.version !== 2 ||
    value.chainId !== 8453 ||
    value.selectedRegion !== expectedRegion ||
    value.quoteCurrency !== expectedCurrency ||
    typeof value.walletAddress !== "string" ||
    !addressPattern.test(value.walletAddress) ||
    value.walletAddress.toLowerCase() !==
      expectedSession.smartAccountAddress.toLowerCase() ||
    !isRecord(value.block) ||
    !readInteger(value.block.number) ||
    typeof value.block.hash !== "string" ||
    !blockHashPattern.test(value.block.hash) ||
    !readInteger(value.block.timestamp) ||
    !readIso(value.fetchedAt) ||
    !isRecord(value.inventory) ||
    value.inventory.scope !== "configured-base-assets-v1" ||
    value.inventory.walletDiscoveryComplete !== false ||
    !Array.isArray(value.inventory.holdings) ||
    !Array.isArray(value.inventory.omissions) ||
    !Array.isArray(value.prices) ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.cashBuckets) ||
    !isRecord(value.nativeEthQuote) ||
    !isRecord(value.total)
  ) {
    fail();
  }

  const holdingKeys = new Set<string>();
  const holdingsByKey = new Map<string, Record<string, unknown>>();
  for (const holding of value.inventory.holdings) {
    if (!validateHolding(holding)) fail();
    if (holdingKeys.has(holding.assetKey)) fail();
    holdingKeys.add(holding.assetKey);
    holdingsByKey.set(holding.assetKey, holding);
  }
  if (
    !holdingKeys.has(PORTFOLIO_NATIVE_ASSET_KEY) ||
    !holdingKeys.has(PORTFOLIO_USDC_ASSET_KEY) ||
    value.inventory.holdings.filter(
      (holding) => isRecord(holding) && holding.kind === "vault-position",
    ).length !== 3
  ) {
    fail();
  }
  for (const omission of value.inventory.omissions) {
    if (
      !isRecord(omission) ||
      typeof omission.code !== "string" ||
      typeof omission.assetOrScope !== "string" ||
      typeof omission.reason !== "string"
    ) {
      fail();
    }
  }
  for (const price of value.prices) if (!validatePrice(price)) fail();
  if (value.fx !== null && !validateFx(value.fx, expectedCurrency)) fail();
  if (!validateNativeEthQuote(value.nativeEthQuote)) fail();
  for (const line of value.lines) {
    if (!validateLine(line, expectedCurrency, holdingKeys)) fail();
  }
  for (const bucket of value.cashBuckets) if (!validateCashBucket(bucket)) fail();
  if (value.nativeCashValuations !== undefined) {
    if (
      !validateNativeCashValuations({
        value: value.nativeCashValuations,
        holdingsByKey,
        prices: value.prices,
        selectedFx: value.fx,
        selectedCurrency: expectedCurrency,
        cashBuckets: value.cashBuckets,
      })
    ) {
      fail();
    }
  }
  if (!validateTotal(value.total, expectedCurrency, holdingKeys)) fail();

  return value as PortfolioValuationSnapshot;
}

function validateHolding(
  value: unknown,
): value is Record<string, unknown> & { assetKey: string } {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.assetKey !== "string" ||
    !assetKeyPattern.test(value.assetKey) ||
    typeof value.name !== "string" ||
    typeof value.symbol !== "string"
  ) {
    return false;
  }
  if (value.kind === "direct") {
    return (
      ["ready", "incomplete", "unavailable"].includes(String(value.readStatus)) &&
      Number.isInteger(value.decimals) &&
      (value.assetKind === "native" || value.assetKind === "erc20") &&
      (value.contractAddress === null ||
        (typeof value.contractAddress === "string" &&
          addressPattern.test(value.contractAddress))) &&
      (value.cashCurrency === null || typeof value.cashCurrency === "string") &&
      (value.balanceBaseUnits === null || readInteger(value.balanceBaseUnits))
    );
  }
  return (
    value.kind === "vault-position" &&
    (value.readStatus === "ready" || value.readStatus === "vault-failure") &&
    typeof value.vaultAddress === "string" &&
    addressPattern.test(value.vaultAddress) &&
    value.underlyingAssetKey === PORTFOLIO_USDC_ASSET_KEY &&
    value.underlyingSymbol === "USDC" &&
    value.underlyingDecimals === 6 &&
    (value.sharesBaseUnits === null || readInteger(value.sharesBaseUnits)) &&
    (value.underlyingBaseUnits === null || readInteger(value.underlyingBaseUnits)) &&
    value.conversionMethod === "erc4626-convertToAssets"
  );
}

function validatePrice(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.assetKey === "string" &&
    /^eip155:8453\/erc20:0x[0-9a-f]{40}$/.test(value.assetKey) &&
    typeof value.contractAddress === "string" &&
    addressPattern.test(value.contractAddress) &&
    value.quoteCurrency === "USD" &&
    validateNullableDecimal(value.unitPrice) &&
    (value.sourceValue === null || typeof value.sourceValue === "string") &&
    ["fresh", "missing", "stale", "invalid", "unavailable"].includes(
      String(value.status),
    ) &&
    validateSource(value.source)
  );
}

function validateFx(value: unknown, currency: string | null): boolean {
  return (
    isRecord(value) &&
    currency !== null &&
    value.baseCurrency === "USD" &&
    value.quoteCurrency === currency &&
    validateNullableDecimal(value.quoteUnitsPerUsd) &&
    (value.sourceValue === null || typeof value.sourceValue === "string") &&
    ["fresh", "missing", "invalid", "unavailable"].includes(
      String(value.status),
    ) &&
    validateSource(value.source)
  );
}

function validateNativeEthQuote(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.baseCurrency === "USD" &&
    value.assetSymbol === "ETH" &&
    validateNullableDecimal(value.assetUnitsPerUsd) &&
    (value.sourceValue === null || typeof value.sourceValue === "string") &&
    ["fresh", "missing", "invalid", "unavailable"].includes(
      String(value.status),
    ) &&
    validateSource(value.source)
  );
}

function validateLine(
  value: unknown,
  currency: string | null,
  holdingKeys: Set<string>,
): boolean {
  return (
    currency !== null &&
    isRecord(value) &&
    typeof value.holdingAssetKey === "string" &&
    holdingKeys.has(value.holdingAssetKey) &&
    value.valueCurrency === currency &&
    validateNullableDecimal(value.value) &&
    [
      "priced",
      "unpriced",
      "read-incomplete",
      "read-unavailable",
      "vault-failure",
    ].includes(String(value.status)) &&
    (value.reason === null || typeof value.reason === "string")
  );
}

function validateNativeCashValuations({
  value,
  holdingsByKey,
  prices,
  selectedFx,
  selectedCurrency,
  cashBuckets,
}: {
  value: unknown;
  holdingsByKey: ReadonlyMap<string, Record<string, unknown>>;
  prices: unknown[];
  selectedFx: unknown;
  selectedCurrency: FiatCurrencyCode | null;
  cashBuckets: unknown[];
}): boolean {
  if (!Array.isArray(value) || value.length !== nativeCashAssets.length) {
    return false;
  }

  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.holdingAssetKey !== "string") {
      return false;
    }
    const asset = nativeCashAssetByKey.get(
      entry.holdingAssetKey as `eip155:8453/erc20:${string}`,
    );
    if (!asset || seen.has(asset.assetKey)) return false;
    seen.add(asset.assetKey);

    const holding = holdingsByKey.get(asset.assetKey);
    if (
      !holding ||
      holding.kind !== "direct" ||
      holding.assetKey !== asset.assetKey ||
      typeof holding.contractAddress !== "string" ||
      holding.contractAddress.toLowerCase() !== asset.contractAddress.toLowerCase() ||
      holding.cashCurrency !== asset.cashCurrency ||
      holding.symbol !== asset.symbol ||
      holding.decimals !== asset.decimals ||
      entry.denominationCurrency !== asset.cashCurrency ||
      !validateNullableDecimal(entry.value) ||
      !validateNativeCashPrice(entry.exactContractUsdPrice, asset, prices) ||
      !validateNativeCashFx(entry.denominationFx, asset.cashCurrency)
    ) {
      return false;
    }

    if (
      (entry.denominationFx === null &&
        entry.status !== "unpriced" &&
        entry.status !== "read-incomplete" &&
        entry.status !== "read-unavailable") ||
      (selectedCurrency === asset.cashCurrency &&
        selectedFx !== null &&
        !sameFxQuote(entry.denominationFx, selectedFx))
    ) {
      return false;
    }

    const readReady =
      holding.readStatus === "ready" &&
      typeof holding.balanceBaseUnits === "string" &&
      readInteger(holding.balanceBaseUnits);
    const isZero = readReady && holding.balanceBaseUnits === "0";
    const priceReady =
      isRecord(entry.exactContractUsdPrice) &&
      entry.exactContractUsdPrice.status === "fresh" &&
      validateDecimal(entry.exactContractUsdPrice.unitPrice);
    const fxReady =
      isRecord(entry.denominationFx) &&
      entry.denominationFx.status === "fresh" &&
      validateDecimal(entry.denominationFx.quoteUnitsPerUsd);

    if (!readReady) {
      const incomplete = holding.readStatus === "incomplete";
      if (
        entry.status !== (incomplete ? "read-incomplete" : "read-unavailable") ||
        entry.reason !==
          (incomplete ? "holding-read-incomplete" : "holding-read-unavailable") ||
        entry.value !== null
      ) {
        return false;
      }
    } else if (isZero || (priceReady && fxReady)) {
      const pricedValue = entry.value;
      const expectedValue = expectedNativeCashValue(
        holding,
        entry.exactContractUsdPrice,
        entry.denominationFx,
      );
      if (
        entry.status !== "priced" ||
        entry.reason !== null ||
        !validateDecimal(pricedValue) ||
        !expectedValue ||
        !sameExactDecimal(pricedValue, expectedValue) ||
        (isZero && (!isRecord(pricedValue) || pricedValue.atoms !== "0")) ||
        (!isZero && (!isRecord(pricedValue) || pricedValue.atoms === "0"))
      ) {
        return false;
      }
    } else {
      const expectedReason = priceReady
        ? "denomination-fx-unavailable"
        : "exact-contract-price-unavailable";
      if (
        entry.status !== "unpriced" ||
        entry.reason !== expectedReason ||
        entry.value !== null
      ) {
        return false;
      }
    }
  }

  for (const bucket of cashBuckets) {
    if (!isRecord(bucket) || typeof bucket.assetKey !== "string") continue;
    const asset = nativeCashAssetByKey.get(
      bucket.assetKey as `eip155:8453/erc20:${string}`,
    );
    if (!asset) return false;
    const valuation = value.find(
      (entry) =>
        isRecord(entry) && entry.holdingAssetKey === bucket.assetKey,
    );
    const holding = holdingsByKey.get(bucket.assetKey);
    if (
      !isRecord(valuation) ||
      !holding ||
      bucket.denominationCurrency !== valuation.denominationCurrency ||
      bucket.symbol !== holding.symbol ||
      bucket.tokenAmountBaseUnits !== holding.balanceBaseUnits ||
      bucket.tokenDecimals !== holding.decimals ||
      bucket.valuationStatus !== valuation.status ||
      !sameExactDecimal(bucket.indicativeValue, valuation.value)
    ) {
      return false;
    }
  }

  return seen.size === nativeCashAssets.length;
}

function expectedNativeCashValue(
  holding: Record<string, unknown>,
  price: unknown,
  fx: unknown,
): ExactDecimal | null {
  if (
    typeof holding.balanceBaseUnits !== "string" ||
    !readInteger(holding.balanceBaseUnits) ||
    typeof holding.decimals !== "number" ||
    !Number.isInteger(holding.decimals)
  ) {
    return null;
  }
  if (holding.balanceBaseUnits === "0") {
    return { atoms: "0", scale: 18 };
  }
  if (
    !isRecord(price) ||
    !validateDecimal(price.unitPrice) ||
    !isRecord(fx) ||
    !validateDecimal(fx.quoteUnitsPerUsd)
  ) {
    return null;
  }
  try {
    return roundFractionPreservingPositive(
      multiplyFractions(
        baseUnitsToFraction(holding.balanceBaseUnits, holding.decimals),
        exactDecimalToFraction(price.unitPrice as ExactDecimal),
        exactDecimalToFraction(fx.quoteUnitsPerUsd as ExactDecimal),
      ),
    );
  } catch {
    return null;
  }
}

function validateNativeCashPrice(
  value: unknown,
  asset: (typeof nativeCashAssets)[number],
  prices: readonly unknown[],
): boolean {
  if (value === null) {
    return !prices.some(
      (price) => isRecord(price) && price.assetKey === asset.assetKey,
    );
  }
  if (
    !validatePrice(value) ||
    !isRecord(value) ||
    value.assetKey !== asset.assetKey ||
    typeof value.contractAddress !== "string" ||
    value.contractAddress.toLowerCase() !== asset.contractAddress.toLowerCase() ||
    !isRecord(value.source) ||
    value.source.provider !== "Codex" ||
    !(
      (value.status === "fresh" && validateDecimal(value.unitPrice)) ||
      (value.status !== "fresh" && value.unitPrice === null)
    )
  ) {
    return false;
  }
  const matches = prices.filter(
    (price) => isRecord(price) && price.assetKey === asset.assetKey,
  );
  return matches.length === 1 && samePriceQuote(value, matches[0]);
}

function validateNativeCashFx(
  value: unknown,
  currency: FiatCurrencyCode,
): boolean {
  if (value === null) return true;
  return (
    validateFx(value, currency) &&
    isRecord(value) &&
    isRecord(value.source) &&
    value.source.provider === "Coinbase Exchange Rates" &&
    ((value.status === "fresh" && validateDecimal(value.quoteUnitsPerUsd)) ||
      (value.status !== "fresh" && value.quoteUnitsPerUsd === null))
  );
}

function samePriceQuote(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  return (
    left.assetKey === right.assetKey &&
    typeof left.contractAddress === "string" &&
    typeof right.contractAddress === "string" &&
    left.contractAddress.toLowerCase() === right.contractAddress.toLowerCase() &&
    left.quoteCurrency === right.quoteCurrency &&
    left.sourceValue === right.sourceValue &&
    left.status === right.status &&
    sameExactDecimal(left.unitPrice, right.unitPrice) &&
    sameSource(left.source, right.source)
  );
}

function sameFxQuote(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  return (
    left.baseCurrency === right.baseCurrency &&
    left.quoteCurrency === right.quoteCurrency &&
    left.sourceValue === right.sourceValue &&
    left.status === right.status &&
    sameExactDecimal(left.quoteUnitsPerUsd, right.quoteUnitsPerUsd) &&
    sameSource(left.source, right.source)
  );
}

function sameExactDecimal(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  return (
    isRecord(left) &&
    isRecord(right) &&
    left.atoms === right.atoms &&
    left.scale === right.scale
  );
}

function sameSource(left: unknown, right: unknown): boolean {
  return (
    isRecord(left) &&
    isRecord(right) &&
    left.provider === right.provider &&
    left.method === right.method &&
    left.fetchedAt === right.fetchedAt &&
    left.asOf === right.asOf &&
    left.timeBasis === right.timeBasis
  );
}

function validateCashBucket(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.roles) &&
    value.roles.every(
      (role) => role === "canonical-usd" || role === "selected-local",
    ) &&
    (value.assetKey === null ||
      (typeof value.assetKey === "string" &&
        /^eip155:8453\/erc20:0x[0-9a-f]{40}$/.test(value.assetKey))) &&
    typeof value.symbol === "string" &&
    typeof value.denominationCurrency === "string" &&
    (value.tokenAmountBaseUnits === null || readInteger(value.tokenAmountBaseUnits)) &&
    (value.tokenDecimals === null || Number.isInteger(value.tokenDecimals)) &&
    validateNullableDecimal(value.indicativeValue) &&
    [
      "priced",
      "unpriced",
      "read-incomplete",
      "read-unavailable",
      "unsupported",
    ].includes(
      String(value.valuationStatus),
    )
  );
}

function validateTotal(
  value: unknown,
  currency: string | null,
  holdingKeys: Set<string>,
): boolean {
  return (
    isRecord(value) &&
    value.label === "supported-portfolio-value" &&
    [
      "all-supported-read-holdings-priced",
      "partial",
      "unavailable-no-quote-currency",
      "unavailable",
    ].includes(String(value.status)) &&
    value.currency === currency &&
    validateNullableDecimal(value.value) &&
    Array.isArray(value.unpricedAssetKeys) &&
    value.unpricedAssetKeys.every(
      (key) => typeof key === "string" && holdingKeys.has(key),
    ) &&
    Array.isArray(value.unavailableAssetKeys) &&
    value.unavailableAssetKeys.every(
      (key) => typeof key === "string" && holdingKeys.has(key),
    )
  );
}

function validateNullableDecimal(value: unknown): boolean {
  return value === null || validateDecimal(value);
}

function validateDecimal(value: unknown): boolean {
  return (
    isRecord(value) &&
    readInteger(value.atoms) &&
    Number.isInteger(value.scale) &&
    typeof value.scale === "number" &&
    value.scale >= 0 &&
    value.scale <= 100
  );
}

function validateSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["Base JSON-RPC", "Codex", "Coinbase Exchange Rates"].includes(
      String(value.provider),
    ) &&
    typeof value.method === "string" &&
    readIso(value.fetchedAt) &&
    (value.asOf === null || readIso(value.asOf)) &&
    ["block", "provider-as-of", "retrieved-at"].includes(String(value.timeBasis))
  );
}

function readInteger(value: unknown): value is string {
  return typeof value === "string" && decimalIntegerPattern.test(value);
}

function readIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function fail(): never {
  throw new PortfolioValuationResponseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

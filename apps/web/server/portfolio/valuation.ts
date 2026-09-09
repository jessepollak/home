import {
  PORTFOLIO_NATIVE_ASSET_KEY,
  PORTFOLIO_USDC_ASSET_KEY,
  getDirectPortfolioAssets,
  verifiedLocalCashAssets,
  type PortfolioAssetKey,
} from "@/config/portfolio-assets";
import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";
import {
  getCodexRawQuotes,
  type CodexRawQuoteInput,
} from "@/server/market-data/codex/raw-quotes";
import {
  getCoinbaseExchangeRates,
  supportedFiatCurrencies,
} from "@/server/valuation/fx-coinbase";
import {
  addFractions,
  baseUnitsToFraction,
  divideFractions,
  exactDecimalToFraction,
  multiplyFractions,
  roundFractionPreservingPositive,
  type Fraction,
} from "@/server/valuation/math";
import type {
  CashBucket,
  FxQuote,
  NativeEthQuote,
  PortfolioInventorySnapshot,
  PortfolioValuationSnapshot,
  PriceQuote,
  ValuationLine,
  ValuationSource,
} from "@/server/valuation/types";
import type { VerifiedPortfolioAccount } from "./types";
import { getPortfolioInventory } from "./inventory";

const ZERO: Fraction = { numerator: BigInt(0), denominator: BigInt(1) };

export type PortfolioValuationReader = (
  account: VerifiedPortfolioAccount,
  region: RegionId,
  signal?: AbortSignal,
) => Promise<PortfolioValuationSnapshot>;

export function createPortfolioValuationReader(dependencies: {
  readInventory?: typeof getPortfolioInventory;
  readPrices?: (inputs: readonly CodexRawQuoteInput[]) => Promise<PriceQuote[]>;
  readExchangeRates?: typeof getCoinbaseExchangeRates;
} = {}): PortfolioValuationReader {
  const readInventory = dependencies.readInventory ?? getPortfolioInventory;
  const readPrices = dependencies.readPrices ?? getCodexRawQuotes;
  const readExchangeRates =
    dependencies.readExchangeRates ?? getCoinbaseExchangeRates;

  return async function readPortfolioValuation(account, region, signal) {
    const quoteCurrency = presentationRegions[region].currency.code;
    const priceInputs = getDirectPortfolioAssets()
      .filter(
        (asset): asset is typeof asset & { contractAddress: `0x${string}` } =>
          asset.kind === "erc20" && asset.contractAddress !== null,
      )
      .map(({ assetKey, contractAddress }) => ({
        assetKey: assetKey as `eip155:8453/erc20:${string}`,
        address: contractAddress,
        networkId: 8453 as const,
      }));

    const [inventory, pricesResult, exchangeRatesResult] = await Promise.all([
      readInventory(account, quoteCurrency, signal),
      readPrices(priceInputs).catch(() => unavailablePrices(priceInputs)),
      readExchangeRates().catch(() => unavailableExchangeRates()),
    ]);
    if (signal?.aborted) throw new Error("Portfolio valuation was aborted.");

    const prices = pricesResult;
    const fxQuotes = exchangeRatesResult.quotes;
    const nativeEthQuote = exchangeRatesResult.nativeEthQuote;
    const lineFractions = new Map<PortfolioAssetKey, Fraction>();
    const lines: ValuationLine[] = [];
    const seenHoldings = new Set<PortfolioAssetKey>();

    for (const holding of inventory.holdings) {
      if (seenHoldings.has(holding.assetKey)) {
        throw new Error("The portfolio inventory contains a duplicate holding.");
      }
      seenHoldings.add(holding.assetKey);
      if (quoteCurrency === null) continue;
      const amount =
        holding.kind === "direct"
          ? holding.balanceBaseUnits
          : holding.underlyingBaseUnits;
      const decimals =
        holding.kind === "direct" ? holding.decimals : holding.underlyingDecimals;
      if (holding.readStatus !== "ready" || amount === null) {
        lines.push({
          holdingAssetKey: holding.assetKey,
          valueCurrency: quoteCurrency ?? "USD",
          value: null,
          status: "read-unavailable",
          reason: "holding-read-unavailable",
        });
        continue;
      }
      const result = valueHolding({
        holdingAssetKey: holding.assetKey,
        pricingAssetKey:
          holding.kind === "vault-position"
            ? holding.underlyingAssetKey
            : holding.assetKey,
        amount,
        decimals,
        currency: quoteCurrency,
        prices,
        fxQuotes,
        nativeEthQuote,
      });
      lines.push({
        holdingAssetKey: holding.assetKey,
        valueCurrency: quoteCurrency,
        value: result.fraction
          ? roundFractionPreservingPositive(result.fraction)
          : null,
        status: result.status,
        reason: result.reason,
      });
      if (result.fraction) lineFractions.set(holding.assetKey, result.fraction);
    }

    const unavailableAssetKeys = lines
      .filter(({ status }) => status === "read-unavailable")
      .map(({ holdingAssetKey }) => holdingAssetKey);
    const unpricedAssetKeys = lines
      .filter(({ status }) => status === "unpriced")
      .map(({ holdingAssetKey }) => holdingAssetKey);
    const totalFraction = addFractions([...lineFractions.values()]);
    const valuationIncomplete =
      unavailableAssetKeys.length > 0 || unpricedAssetKeys.length > 0;
    const hasValuedNonzeroContribution = totalFraction.numerator > BigInt(0);
    const totalStatus =
      quoteCurrency === null
        ? "unavailable-no-quote-currency"
        : valuationIncomplete && !hasValuedNonzeroContribution
          ? "unavailable"
          : valuationIncomplete
            ? "partial"
            : "all-supported-read-holdings-priced";

    return {
      version: 2,
      walletAddress: inventory.walletAddress,
      chainId: 8453,
      selectedRegion: region,
      quoteCurrency,
      block: inventory.block,
      fetchedAt: inventory.fetchedAt,
      inventory: {
        scope: "configured-base-assets-v1",
        walletDiscoveryComplete: false,
        holdings: inventory.holdings,
        omissions: buildOmissions(region, quoteCurrency),
      },
      prices,
      fx: quoteCurrency
        ? fxQuotes.find(({ quoteCurrency: currency }) => currency === quoteCurrency) ?? null
        : null,
      nativeEthQuote,
      lines,
      cashBuckets: buildCashBuckets({
        region,
        quoteCurrency,
        inventory,
        prices,
        fxQuotes,
        nativeEthQuote,
      }),
      total: {
        label: "supported-portfolio-value",
        status: totalStatus,
        value:
          quoteCurrency === null || totalStatus === "unavailable"
            ? null
            : roundFractionPreservingPositive(totalFraction),
        currency: quoteCurrency,
        unpricedAssetKeys,
        unavailableAssetKeys,
      },
    };
  };
}

export const getPortfolioValuation = createPortfolioValuationReader();

function valueHolding({
  holdingAssetKey,
  pricingAssetKey,
  amount,
  decimals,
  currency,
  prices,
  fxQuotes,
  nativeEthQuote,
}: {
  holdingAssetKey: PortfolioAssetKey;
  pricingAssetKey: PortfolioAssetKey;
  amount: string;
  decimals: number;
  currency: FiatCurrencyCode;
  prices: readonly PriceQuote[];
  fxQuotes: readonly FxQuote[];
  nativeEthQuote: NativeEthQuote;
}): {
  fraction: Fraction | null;
  status: "priced" | "unpriced";
  reason: string | null;
} {
  const quantity = baseUnitsToFraction(amount, decimals);
  if (quantity.numerator === BigInt(0)) {
    return { fraction: ZERO, status: "priced", reason: null };
  }
  const fx = fxQuotes.find(({ quoteCurrency }) => quoteCurrency === currency);
  if (fx?.status !== "fresh" || !fx.quoteUnitsPerUsd) {
    return { fraction: null, status: "unpriced", reason: "fx-unavailable" };
  }
  const fxFraction = exactDecimalToFraction(fx.quoteUnitsPerUsd);
  if (holdingAssetKey === PORTFOLIO_NATIVE_ASSET_KEY) {
    if (
      nativeEthQuote.status !== "fresh" ||
      !nativeEthQuote.assetUnitsPerUsd
    ) {
      return {
        fraction: null,
        status: "unpriced",
        reason: "native-eth-price-unavailable",
      };
    }
    return {
      fraction: multiplyFractions(
        divideFractions(
          quantity,
          exactDecimalToFraction(nativeEthQuote.assetUnitsPerUsd),
        ),
        fxFraction,
      ),
      status: "priced",
      reason: null,
    };
  }
  const price = prices.find(({ assetKey }) => assetKey === pricingAssetKey);
  if (price?.status !== "fresh" || !price.unitPrice) {
    return {
      fraction: null,
      status: "unpriced",
      reason: "exact-contract-price-unavailable",
    };
  }
  return {
    fraction: multiplyFractions(
      quantity,
      exactDecimalToFraction(price.unitPrice),
      fxFraction,
    ),
    status: "priced",
    reason: null,
  };
}

function buildCashBuckets({
  region,
  quoteCurrency,
  inventory,
  prices,
  fxQuotes,
  nativeEthQuote,
}: {
  region: RegionId;
  quoteCurrency: FiatCurrencyCode | null;
  inventory: PortfolioInventorySnapshot;
  prices: readonly PriceQuote[];
  fxQuotes: readonly FxQuote[];
  nativeEthQuote: NativeEthQuote;
}): CashBucket[] {
  const usdc = inventory.holdings.find(
    (holding) =>
      holding.kind === "direct" && holding.assetKey === PORTFOLIO_USDC_ASSET_KEY,
  );
  if (!usdc || usdc.kind !== "direct") {
    throw new Error("Canonical USDC is missing from the portfolio inventory.");
  }
  const buckets: CashBucket[] = [
    supportedCashBucket(
      usdc,
      quoteCurrency === "USD"
        ? ["canonical-usd", "selected-local"]
        : ["canonical-usd"],
      "USD",
      prices,
      fxQuotes,
      nativeEthQuote,
    ),
  ];

  if (quoteCurrency && quoteCurrency !== "USD") {
    const local = verifiedLocalCashAssets[
      quoteCurrency as keyof typeof verifiedLocalCashAssets
    ];
    if (local) {
      const holding = inventory.holdings.find(
        (candidate) =>
          candidate.kind === "direct" && candidate.assetKey === local.assetKey,
      );
      if (!holding || holding.kind !== "direct") {
        throw new Error("The selected local cash holding is missing.");
      }
      buckets.push(
        supportedCashBucket(
          holding,
          ["selected-local"],
          quoteCurrency,
          prices,
          fxQuotes,
          nativeEthQuote,
        ),
      );
    } else {
      const candidate = presentationRegions[region].candidateAsset;
      if (candidate) {
        buckets.push({
          id: `cash:unsupported:${quoteCurrency}`,
          roles: ["selected-local"],
          assetKey: null,
          symbol: candidate.symbol,
          denominationCurrency: quoteCurrency,
          tokenAmountBaseUnits: null,
          tokenDecimals: null,
          indicativeValue: null,
          valuationStatus: "unsupported",
        });
      }
    }
  }
  return buckets;
}

function supportedCashBucket(
  holding: Extract<PortfolioInventorySnapshot["holdings"][number], { kind: "direct" }>,
  roles: CashBucket["roles"],
  currency: FiatCurrencyCode,
  prices: readonly PriceQuote[],
  fxQuotes: readonly FxQuote[],
  nativeEthQuote: NativeEthQuote,
): CashBucket {
  const result =
    holding.balanceBaseUnits === null || holding.readStatus !== "ready"
      ? null
      : valueHolding({
          holdingAssetKey: holding.assetKey,
          pricingAssetKey: holding.assetKey,
          amount: holding.balanceBaseUnits,
          decimals: holding.decimals,
          currency,
          prices,
          fxQuotes,
          nativeEthQuote,
        });
  return {
    id: `cash:${holding.assetKey}`,
    roles,
    assetKey: holding.assetKey as `eip155:8453/erc20:${string}`,
    symbol: holding.symbol,
    denominationCurrency: currency,
    tokenAmountBaseUnits: holding.balanceBaseUnits,
    tokenDecimals: holding.decimals,
    indicativeValue: result?.fraction
      ? roundFractionPreservingPositive(result.fraction)
      : null,
    valuationStatus:
      holding.readStatus !== "ready"
        ? "read-unavailable"
        : result?.status === "priced"
          ? "priced"
          : "unpriced",
  };
}

function buildOmissions(
  region: RegionId,
  quoteCurrency: FiatCurrencyCode | null,
): PortfolioValuationSnapshot["inventory"]["omissions"] {
  const omissions: PortfolioValuationSnapshot["inventory"]["omissions"] = [
    {
      code: "bounded-inventory",
      assetOrScope: "wallet discovery",
      reason:
        "NFTs, LPs, bridges, arbitrary ERC-20s, and unconfigured protocols are outside this supported inventory.",
    },
  ];
  if (
    quoteCurrency &&
    quoteCurrency !== "USD" &&
    !verifiedLocalCashAssets[
      quoteCurrency as keyof typeof verifiedLocalCashAssets
    ]
  ) {
    omissions.push({
      code: "local-cash-unsupported",
      assetOrScope:
        presentationRegions[region].candidateAsset?.symbol ?? quoteCurrency,
      reason:
        "No exact issuer-verified Base contract has been enabled for this local cash candidate.",
    });
  }
  return omissions;
}

function unavailablePrices(
  inputs: readonly CodexRawQuoteInput[],
): PriceQuote[] {
  const fetchedAt = new Date().toISOString();
  const source: ValuationSource = {
    provider: "Codex",
    method: "Exact-contract token prices",
    fetchedAt,
    asOf: null,
    timeBasis: "retrieved-at",
  };
  return inputs.map((input) => ({
    assetKey: input.assetKey,
    contractAddress: input.address.toLowerCase() as `0x${string}`,
    quoteCurrency: "USD",
    unitPrice: null,
    sourceValue: null,
    status: "unavailable",
    source,
  }));
}

function unavailableExchangeRates(): {
  fetchedAt: string;
  quotes: FxQuote[];
  nativeEthQuote: NativeEthQuote;
} {
  const fetchedAt = new Date().toISOString();
  const source: ValuationSource = {
    provider: "Coinbase Exchange Rates",
    method: "USD exchange rates",
    fetchedAt,
    asOf: null,
    timeBasis: "retrieved-at",
  };
  return {
    fetchedAt,
    quotes: supportedFiatCurrencies.map((quoteCurrency) => ({
      baseCurrency: "USD",
      quoteCurrency,
      quoteUnitsPerUsd: null,
      sourceValue: null,
      status: "unavailable",
      source,
    })),
    nativeEthQuote: {
      baseCurrency: "USD",
      assetSymbol: "ETH",
      assetUnitsPerUsd: null,
      sourceValue: null,
      status: "unavailable",
      source,
    },
  };
}

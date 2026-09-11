import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_NATIVE_ASSET_KEY,
  PORTFOLIO_USDC_ADDRESS,
  PORTFOLIO_USDC_ASSET_KEY,
  assetKeyForErc20,
  portfolioVaults,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import { parsePortfolioValuationSnapshot } from "@/shared/portfolio/parse-valuation";
import { presentPortfolioValuation } from "@/shared/portfolio/present-home-balances";
import type { CodexRawQuoteInput } from "@/server/market-data/codex/raw-quotes";
import { supportedFiatCurrencies } from "@/server/portfolio/fx-coinbase";
import type {
  FxQuote,
  NativeEthQuote,
  PortfolioInventorySnapshot,
  PriceQuote,
  ValuationSource,
} from "@/shared/portfolio/valuation-types";
import { createPortfolioValuationReader } from "./valuation";
import type { VerifiedPortfolioAccount } from "@/shared/portfolio/types";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const NOW = "2026-09-08T12:00:00.000Z";
const source = (provider: ValuationSource["provider"]): ValuationSource => ({
  provider,
  method: "fixture",
  fetchedAt: NOW,
  asOf: provider === "Codex" ? NOW : null,
  timeBasis: provider === "Codex" ? "provider-as-of" : "retrieved-at",
});
const account: VerifiedPortfolioAccount = {
  address: ADDRESS,
  chainId: 8453,
  verification: "session-smart-account",
};

function inventory({
  eurc = "0",
  idrx = "0",
  usdc = "1000000",
  vaultUnderlying = "2000000",
}: {
  eurc?: string;
  idrx?: string;
  usdc?: string;
  vaultUnderlying?: string;
} = {}): PortfolioInventorySnapshot {
  const holdings: PortfolioInventorySnapshot["holdings"] = [
    {
      kind: "direct",
      id: "eth",
      assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
      name: "Ethereum",
      symbol: "ETH",
      decimals: 18,
      assetKind: "native",
      contractAddress: null,
      cashCurrency: null,
      balanceBaseUnits: "0",
      readStatus: "ready",
    },
    {
      kind: "direct",
      id: "usdc",
      assetKey: PORTFOLIO_USDC_ASSET_KEY,
      name: "US dollar",
      symbol: "USDC",
      decimals: 6,
      assetKind: "erc20",
      contractAddress: PORTFOLIO_USDC_ADDRESS,
      cashCurrency: "USD",
      balanceBaseUnits: usdc,
      readStatus: "ready",
    },
  ];
  holdings.push(
    {
      ...verifiedLocalCashAssets.EUR,
      kind: "direct",
      assetKind: "erc20",
      balanceBaseUnits: eurc,
      readStatus: "ready",
    },
    {
      ...verifiedLocalCashAssets.IDR,
      kind: "direct",
      assetKind: "erc20",
      balanceBaseUnits: idrx,
      readStatus: "ready",
    },
  );
  holdings.push(
    ...portfolioVaults.map((vault, index) => ({
      kind: "vault-position" as const,
      id: vault.id,
      assetKey: assetKeyForErc20(vault.address),
      name: vault.name,
      symbol: vault.symbol,
      vaultAddress: vault.address,
      decimals: 18,
      underlyingAssetKey: PORTFOLIO_USDC_ASSET_KEY,
      underlyingSymbol: "USDC" as const,
      underlyingDecimals: 6 as const,
      sharesBaseUnits:
        index === 0 && vaultUnderlying !== "0"
          ? "999999999999999999999"
          : "0",
      underlyingBaseUnits: index === 0 ? vaultUnderlying : "0",
      readStatus: "ready" as const,
      conversionMethod: "erc4626-convertToAssets" as const,
    })),
  );
  return {
    walletAddress: ADDRESS,
    chainId: 8453,
    block: { number: "16", hash: `0x${"ab".repeat(32)}`, timestamp: "100" },
    fetchedAt: NOW,
    holdings,
  };
}

function exchangeRates() {
  const fxSource = source("Coinbase Exchange Rates");
  const quotes: FxQuote[] = supportedFiatCurrencies.map((currency) => ({
    baseCurrency: "USD",
    quoteCurrency: currency,
    quoteUnitsPerUsd:
      currency === "EUR" ? { atoms: "9", scale: 1 } : { atoms: "1", scale: 0 },
    sourceValue: currency === "EUR" ? "0.9" : "1",
    status: "fresh",
    source: fxSource,
  }));
  const nativeEthQuote: NativeEthQuote = {
    baseCurrency: "USD",
    assetSymbol: "ETH",
    assetUnitsPerUsd: { atoms: "5", scale: 4 },
    sourceValue: "0.0005",
    status: "fresh",
    source: fxSource,
  };
  return { fetchedAt: NOW, quotes, nativeEthQuote };
}

function prices(inputs: readonly { assetKey: string; address: `0x${string}` }[], missing?: string) {
  return inputs.map((input): PriceQuote => ({
    assetKey: input.assetKey as `eip155:8453/erc20:${string}`,
    contractAddress: input.address,
    quoteCurrency: "USD",
    unitPrice:
      input.assetKey === missing
        ? null
        : input.assetKey === verifiedLocalCashAssets.EUR.assetKey
          ? { atoms: "12", scale: 1 }
          : { atoms: "1", scale: 0 },
    sourceValue: input.assetKey === missing ? null : "1",
    status: input.assetKey === missing ? "missing" : "fresh",
    source: source("Codex"),
  }));
}

describe("supported portfolio valuation assembly", () => {
  test("keeps the fixed local-asset quote set and presents nonselected cash as an asset", async () => {
    let priceInputs: readonly CodexRawQuoteInput[] = [];
    const read = createPortfolioValuationReader({
      readInventory: async () => inventory({ eurc: "1000000" }),
      readPrices: async (inputs) => {
        priceInputs = inputs;
        return prices(inputs);
      },
      readExchangeRates: async () => exchangeRates(),
    });

    const result = await read(account, "US");

    expect(priceInputs).toHaveLength(20);
    expect(priceInputs.map(({ assetKey }) => assetKey)).toContain(
      verifiedLocalCashAssets.EUR.assetKey,
    );
    expect(priceInputs.map(({ assetKey }) => assetKey)).toContain(
      verifiedLocalCashAssets.IDR.assetKey,
    );
    expect(result.cashBuckets).toHaveLength(1);
    expect(result.cashBuckets[0]?.roles).toEqual([
      "canonical-usd",
      "selected-local",
    ]);
    expect(result.total.status).toBe("all-supported-read-holdings-priced");
    expect(result.total.value).toEqual({
      atoms: "4200000000000000000",
      scale: 18,
    });
    expect(
      result.lines.find(
        ({ holdingAssetKey }) =>
          holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
      )?.status,
    ).toBe("priced");
    expect(
      result.nativeCashValuations?.find(
        ({ holdingAssetKey }) =>
          holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
      ),
    ).toMatchObject({
      denominationCurrency: "EUR",
      value: { atoms: "1080000000000000000", scale: 18 },
      status: "priced",
      reason: null,
      exactContractUsdPrice: {
        assetKey: verifiedLocalCashAssets.EUR.assetKey,
        unitPrice: { atoms: "12", scale: 1 },
        status: "fresh",
      },
      denominationFx: {
        baseCurrency: "USD",
        quoteCurrency: "EUR",
        quoteUnitsPerUsd: { atoms: "9", scale: 1 },
        status: "fresh",
      },
    });
    expect(new Set(result.lines.map(({ holdingAssetKey }) => holdingAssetKey)).size).toBe(
      result.lines.length,
    );
  });

  test("separates EUR cash, retains a partial subtotal, and never assumes a missing peg", async () => {
    const read = createPortfolioValuationReader({
      readInventory: async () => inventory({ eurc: "1000000" }),
      readPrices: async (inputs) =>
        prices(inputs, verifiedLocalCashAssets.EUR.assetKey),
      readExchangeRates: async () => exchangeRates(),
    });

    const result = await read(account, "DE");

    expect(result.cashBuckets.map(({ symbol }) => symbol)).toEqual(["USDC", "EURC"]);
    expect(result.cashBuckets[1]?.valuationStatus).toBe("unpriced");
    expect(result.total.status).toBe("partial");
    expect(result.total.value).toEqual({
      atoms: "2700000000000000000",
      scale: 18,
    });
    expect(result.total.unpricedAssetKeys).toEqual([
      verifiedLocalCashAssets.EUR.assetKey,
    ]);
  });

  test("reuses native-cash values across country switches without adding them to totals", async () => {
    const read = createPortfolioValuationReader({
      readInventory: async () =>
        inventory({ eurc: "1000000", idrx: "100", vaultUnderlying: "0" }),
      readPrices: async (inputs) => prices(inputs),
      readExchangeRates: async () => exchangeRates(),
    });

    const germany = await read(account, "DE");
    const indonesia = await read(account, "ID");
    const germanEuro = germany.nativeCashValuations?.find(
      ({ holdingAssetKey }) => holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
    );
    const indonesianEuro = indonesia.nativeCashValuations?.find(
      ({ holdingAssetKey }) => holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
    );

    expect(germanEuro).toEqual(indonesianEuro);
    expect(germany.cashBuckets.find(({ symbol }) => symbol === "EURC")?.indicativeValue).toEqual(
      germanEuro?.value,
    );
    expect(indonesia.cashBuckets.find(({ symbol }) => symbol === "IDRX")?.indicativeValue).toEqual(
      indonesia.nativeCashValuations?.find(
        ({ holdingAssetKey }) => holdingAssetKey === verifiedLocalCashAssets.IDR.assetKey,
      )?.value,
    );
    expect(germany.total.value).toEqual({
      atoms: "2880000000000000000",
      scale: 18,
    });
    expect(indonesia.total.value).toEqual({
      atoms: "3200000000000000000",
      scale: 18,
    });
  });

  test("fails native cash closed for missing, stale, invalid price or denomination FX", async () => {
    for (const status of ["missing", "stale", "invalid"] as const) {
      const read = createPortfolioValuationReader({
        readInventory: async () => inventory({ eurc: "1000000", vaultUnderlying: "0" }),
        readPrices: async (inputs) =>
          prices(inputs).map((quote) =>
            quote.assetKey === verifiedLocalCashAssets.EUR.assetKey
              ? { ...quote, unitPrice: null, sourceValue: null, status }
              : quote,
          ),
        readExchangeRates: async () => exchangeRates(),
      });
      const result = await read(account, "US");
      expect(
        result.nativeCashValuations?.find(
          ({ holdingAssetKey }) =>
            holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
        ),
      ).toMatchObject({
        value: null,
        status: "unpriced",
        reason: "exact-contract-price-unavailable",
        exactContractUsdPrice: { status },
      });
    }

    for (const status of ["missing", "invalid", "unavailable"] as const) {
      const read = createPortfolioValuationReader({
        readInventory: async () => inventory({ eurc: "1000000", vaultUnderlying: "0" }),
        readPrices: async (inputs) => prices(inputs),
        readExchangeRates: async () => {
          const rates = exchangeRates();
          return {
            ...rates,
            quotes: rates.quotes.map((quote) =>
              quote.quoteCurrency === "EUR"
                ? { ...quote, quoteUnitsPerUsd: null, sourceValue: null, status }
                : quote,
            ),
          };
        },
      });
      const result = await read(account, "US");
      expect(
        result.nativeCashValuations?.find(
          ({ holdingAssetKey }) =>
            holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
        ),
      ).toMatchObject({
        value: null,
        status: "unpriced",
        reason: "denomination-fx-unavailable",
        denominationFx: { status },
      });
    }
  });

  test("preserves native-cash zero and failed-read semantics", async () => {
    const base = inventory({ eurc: "0", vaultUnderlying: "0" });
    const eurcIndex = base.holdings.findIndex(
      ({ assetKey }) => assetKey === verifiedLocalCashAssets.EUR.assetKey,
    );
    if (eurcIndex < 0) throw new Error("Expected EURC fixture.");
    base.holdings[eurcIndex] = {
      ...base.holdings[eurcIndex]!,
      balanceBaseUnits: null,
      readStatus: "unavailable",
    } as PortfolioInventorySnapshot["holdings"][number];
    const readUnavailable = createPortfolioValuationReader({
      readInventory: async () => base,
      readPrices: async (inputs) => prices(inputs),
      readExchangeRates: async () => exchangeRates(),
    });
    expect(
      (await readUnavailable(account, "US")).nativeCashValuations?.find(
        ({ holdingAssetKey }) => holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
      ),
    ).toMatchObject({
      value: null,
      status: "read-unavailable",
      reason: "holding-read-unavailable",
    });

    const zeroWithoutQuotes = createPortfolioValuationReader({
      readInventory: async () => inventory({ eurc: "0", vaultUnderlying: "0" }),
      readPrices: async (inputs) =>
        prices(inputs, verifiedLocalCashAssets.EUR.assetKey),
      readExchangeRates: async () => {
        const rates = exchangeRates();
        return {
          ...rates,
          quotes: rates.quotes.map((quote) =>
            quote.quoteCurrency === "EUR"
              ? {
                  ...quote,
                  quoteUnitsPerUsd: null,
                  sourceValue: null,
                  status: "unavailable" as const,
                }
              : quote,
          ),
        };
      },
    });
    expect(
      (await zeroWithoutQuotes(account, "US")).nativeCashValuations?.find(
        ({ holdingAssetKey }) => holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
      ),
    ).toMatchObject({
      value: { atoms: "0" },
      status: "priced",
      reason: null,
    });
  });

  test("vault-only Morpho USDC stays off cash buckets (direct USDC/IDRX remain 0)", async () => {
    const read = createPortfolioValuationReader({
      readInventory: async () =>
        inventory({ usdc: "0", idrx: "0", vaultUnderlying: "2000000" }),
      readPrices: async (inputs) => prices(inputs),
      readExchangeRates: async () => exchangeRates(),
    });

    const result = await read(account, "ID");
    const usdcCash = result.cashBuckets.find(({ symbol }) => symbol === "USDC");
    const idrxCash = result.cashBuckets.find(({ symbol }) => symbol === "IDRX");
    const steakhouse = result.inventory.holdings.find(
      (holding) => holding.kind === "vault-position" && holding.id === "morpho-steakhouse-usdc",
    );

    expect(result.cashBuckets.map(({ symbol }) => symbol)).toEqual(["USDC", "IDRX"]);
    expect(usdcCash).toMatchObject({
      tokenAmountBaseUnits: "0",
      valuationStatus: "priced",
    });
    expect(idrxCash).toMatchObject({
      tokenAmountBaseUnits: "0",
      valuationStatus: "priced",
    });
    expect(steakhouse).toMatchObject({
      kind: "vault-position",
      underlyingBaseUnits: "2000000",
      readStatus: "ready",
    });
    expect(result.inventory.holdings.find(({ id }) => id === "eth")).toMatchObject({
      kind: "direct",
      balanceBaseUnits: "0",
      readStatus: "ready",
    });
    expect(usdcCash?.tokenAmountBaseUnits).not.toBe(
      steakhouse && steakhouse.kind === "vault-position"
        ? steakhouse.underlyingBaseUnits
        : undefined,
    );
  });

  test("distinguishes incomplete inventory from unavailable reads and vault conversion failure", async () => {
    const partial = inventory({ usdc: "0", vaultUnderlying: "0" });
    const ethIndex = partial.holdings.findIndex(({ id }) => id === "eth");
    const eurcIndex = partial.holdings.findIndex(({ id }) => id === "eurc");
    const vaultIndex = partial.holdings.findIndex(
      ({ kind }) => kind === "vault-position",
    );
    partial.holdings[ethIndex] = {
      ...partial.holdings[ethIndex]!,
      balanceBaseUnits: null,
      readStatus: "incomplete",
    } as PortfolioInventorySnapshot["holdings"][number];
    partial.holdings[eurcIndex] = {
      ...partial.holdings[eurcIndex]!,
      balanceBaseUnits: null,
      readStatus: "unavailable",
    } as PortfolioInventorySnapshot["holdings"][number];
    partial.holdings[vaultIndex] = {
      ...partial.holdings[vaultIndex]!,
      underlyingBaseUnits: null,
      readStatus: "vault-failure",
    } as PortfolioInventorySnapshot["holdings"][number];

    const read = createPortfolioValuationReader({
      readInventory: async () => partial,
      readPrices: async (inputs) => prices(inputs),
      readExchangeRates: async () => exchangeRates(),
    });
    const result = await read(account, "US");

    expect(result.lines.find(({ holdingAssetKey }) =>
      holdingAssetKey === PORTFOLIO_NATIVE_ASSET_KEY,
    )).toMatchObject({
      status: "read-incomplete",
      reason: "holding-read-incomplete",
    });
    expect(result.lines.find(({ holdingAssetKey }) =>
      holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
    )).toMatchObject({
      status: "read-unavailable",
      reason: "holding-read-unavailable",
    });
    expect(result.lines.find(({ holdingAssetKey }) =>
      holdingAssetKey === partial.holdings[vaultIndex]!.assetKey,
    )).toMatchObject({
      status: "vault-failure",
      reason: "vault-conversion-failure",
    });
    expect(
      parsePortfolioValuationSnapshot(
        result,
        { subject: "subject-a", smartAccountAddress: ADDRESS, chainId: 8453 },
        "US",
      ),
    ).toBe(result);
  });

  test("makes an incomplete zero subtotal unavailable but preserves a complete zero", async () => {
    const incomplete = createPortfolioValuationReader({
      readInventory: async () =>
        inventory({ usdc: "1000000", vaultUnderlying: "0" }),
      readPrices: async (inputs) => prices(inputs, PORTFOLIO_USDC_ASSET_KEY),
      readExchangeRates: async () => exchangeRates(),
    });
    const unavailable = await incomplete(account, "US");
    expect(unavailable.total.status).toBe("unavailable");
    expect(unavailable.total.value).toBeNull();

    const complete = createPortfolioValuationReader({
      readInventory: async () => inventory({ usdc: "0", vaultUnderlying: "0" }),
      readPrices: async (inputs) => prices(inputs),
      readExchangeRates: async () => exchangeRates(),
    });
    const zero = await complete(account, "US");
    expect(zero.total.status).toBe("all-supported-read-holdings-priced");
    expect(zero.total.value).toEqual({ atoms: "0", scale: 18 });
  });

  test("parses and presents funded EURC with missing denomination FX while rejecting forged null-FX semantics", async () => {
    const read = createPortfolioValuationReader({
      readInventory: async () =>
        inventory({ eurc: "1000000", vaultUnderlying: "0" }),
      readPrices: async (inputs) => prices(inputs),
      readExchangeRates: async () => {
        const rates = exchangeRates();
        return {
          ...rates,
          quotes: rates.quotes.filter(
            ({ quoteCurrency }) => quoteCurrency !== "EUR",
          ),
        };
      },
    });
    const result = await read(account, "US");
    const session = {
      subject: "subject-a",
      smartAccountAddress: ADDRESS,
      chainId: 8453 as const,
    };
    const parsed = parsePortfolioValuationSnapshot(result, session, "US");
    const euro = parsed.nativeCashValuations?.find(
      ({ holdingAssetKey }) =>
        holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
    );

    expect(euro).toMatchObject({
      value: null,
      status: "unpriced",
      reason: "denomination-fx-unavailable",
      exactContractUsdPrice: { status: "fresh" },
      denominationFx: null,
    });
    expect(
      parsed.lines.find(
        ({ holdingAssetKey }) =>
          holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
      )?.status,
    ).toBe("priced");
    expect(parsed.total).toEqual({
      label: "supported-portfolio-value",
      status: "all-supported-read-holdings-priced",
      value: { atoms: "2200000000000000000", scale: 18 },
      currency: "USD",
      unpricedAssetKeys: [],
      unavailableAssetKeys: [],
    });
    expect(
      presentPortfolioValuation({
        status: "ready",
        snapshot: parsed,
        error: null,
      }).items.find(({ name }) => name === "Euro")?.displayBalance,
    ).toBe("1.00 EURC");

    const malformed = [
      (copy: typeof result) => {
        const valuation = copy.nativeCashValuations?.find(
          ({ holdingAssetKey }) =>
            holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
        );
        if (!valuation) return;
        valuation.status = "priced";
        valuation.reason = null;
        valuation.value = { atoms: "108", scale: 2 };
      },
      (copy: typeof result) => {
        const valuation = copy.nativeCashValuations?.find(
          ({ holdingAssetKey }) =>
            holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
        );
        if (valuation) valuation.reason = "exact-contract-price-unavailable";
      },
      (copy: typeof result) => {
        const valuation = copy.nativeCashValuations?.find(
          ({ holdingAssetKey }) =>
            holdingAssetKey === verifiedLocalCashAssets.EUR.assetKey,
        );
        if (!valuation) return;
        valuation.status = "read-unavailable";
        valuation.reason = "holding-read-unavailable";
      },
      (copy: typeof result) => {
        const zeroValuation = copy.nativeCashValuations?.find(
          ({ holdingAssetKey }) =>
            holdingAssetKey === verifiedLocalCashAssets.IDR.assetKey,
        );
        if (zeroValuation) zeroValuation.denominationFx = null;
      },
    ];
    for (const mutate of malformed) {
      const copy = structuredClone(result);
      mutate(copy);
      expect(() => parsePortfolioValuationSnapshot(copy, session, "US")).toThrow(
        "The portfolio valuation response is invalid.",
      );
    }
  });

  test("strictly parses native-cash membership, binding, status, and provenance while accepting legacy v2", async () => {
    const read = createPortfolioValuationReader({
      readInventory: async () => inventory({ eurc: "1000000", vaultUnderlying: "0" }),
      readPrices: async (inputs) => prices(inputs),
      readExchangeRates: async () => exchangeRates(),
    });
    const result = await read(account, "DE");
    const session = {
      subject: "subject-a",
      smartAccountAddress: ADDRESS,
      chainId: 8453 as const,
    };

    expect(parsePortfolioValuationSnapshot(result, session, "DE")).toBe(result);

    const legacy = structuredClone(result);
    delete legacy.nativeCashValuations;
    expect(parsePortfolioValuationSnapshot(legacy, session, "DE")).toBe(legacy);

    const malformed = [
      (copy: typeof result) => copy.nativeCashValuations?.pop(),
      (copy: typeof result) => {
        if (copy.nativeCashValuations?.[0]) {
          copy.nativeCashValuations[0].denominationCurrency = "EUR";
        }
      },
      (copy: typeof result) => {
        if (copy.nativeCashValuations?.[1]) {
          copy.nativeCashValuations[1].status = "unpriced";
          copy.nativeCashValuations[1].reason = "exact-contract-price-unavailable";
          copy.nativeCashValuations[1].value = null;
        }
      },
      (copy: typeof result) => {
        const price = copy.nativeCashValuations?.[1]?.exactContractUsdPrice;
        if (price) price.assetKey = PORTFOLIO_USDC_ASSET_KEY;
      },
      (copy: typeof result) => {
        const source = copy.nativeCashValuations?.[1]?.denominationFx?.source;
        if (source) source.provider = "Codex";
      },
      (copy: typeof result) => {
        const bucket = copy.cashBuckets.find(({ symbol }) => symbol === "EURC");
        if (bucket) bucket.indicativeValue = { atoms: "1", scale: 0 };
      },
    ];
    for (const mutate of malformed) {
      const copy = structuredClone(result);
      mutate(copy);
      expect(() => parsePortfolioValuationSnapshot(copy, session, "DE")).toThrow(
        "The portfolio valuation response is invalid.",
      );
    }
  });

  test("keeps GLOBAL currencyless and exposes unsupported regional cash safely", async () => {
    const read = createPortfolioValuationReader({
      readInventory: async () => inventory(),
      readPrices: async (inputs) => prices(inputs),
      readExchangeRates: async () => exchangeRates(),
    });
    const global = await read(account, "GLOBAL");
    expect(global.quoteCurrency).toBeNull();
    expect(global.total.status).toBe("unavailable-no-quote-currency");
    expect(global.total.value).toBeNull();
    expect(global.lines).toEqual([]);

    const brazil = await read(account, "BR");
    expect(brazil.cashBuckets.at(-1)).toMatchObject({
      roles: ["selected-local"],
      symbol: "BRZ",
      valuationStatus: "unsupported",
      assetKey: null,
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_NATIVE_ASSET_KEY,
  PORTFOLIO_USDC_ADDRESS,
  PORTFOLIO_USDC_ASSET_KEY,
  assetKeyForErc20,
  portfolioVaults,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import type { CodexRawQuoteInput } from "@/server/market-data/codex/raw-quotes";
import { supportedFiatCurrencies } from "@/server/valuation/fx-coinbase";
import type {
  FxQuote,
  NativeEthQuote,
  PortfolioInventorySnapshot,
  PriceQuote,
  ValuationSource,
} from "@/server/valuation/types";
import { createPortfolioValuationReader } from "./valuation";
import type { VerifiedPortfolioAccount } from "./types";

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

import type { FiatCurrencyCode } from "@/config/regions";
import type { PortfolioAddress } from "@/config/portfolio-assets";
import type { ExactDecimal } from "./types";

export type { ExactDecimal } from "./types";

export type ValuationSource = {
  provider: "Base JSON-RPC" | "Codex" | "Coinbase Exchange Rates";
  method: string;
  fetchedAt: string;
  asOf: string | null;
  timeBasis: "block" | "provider-as-of" | "retrieved-at";
};

export type PriceQuote = {
  assetKey: `eip155:8453/erc20:${string}`;
  contractAddress: PortfolioAddress;
  quoteCurrency: "USD";
  unitPrice: ExactDecimal | null;
  sourceValue: string | null;
  status: "fresh" | "missing" | "stale" | "invalid" | "unavailable";
  source: ValuationSource;
};

export type FxQuote = {
  baseCurrency: "USD";
  quoteCurrency: FiatCurrencyCode;
  quoteUnitsPerUsd: ExactDecimal | null;
  sourceValue: string | null;
  status: "fresh" | "missing" | "invalid" | "unavailable";
  source: ValuationSource;
};

export type NativeEthQuote = {
  baseCurrency: "USD";
  assetSymbol: "ETH";
  assetUnitsPerUsd: ExactDecimal | null;
  sourceValue: string | null;
  status: "fresh" | "missing" | "invalid" | "unavailable";
  source: ValuationSource;
};

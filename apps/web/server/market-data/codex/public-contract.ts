import type { FiatCurrencyCode } from "@/config/regions";
import type {
  MarketDataState,
  PresentationFxQuote,
} from "@/features/invest/invest-market";

export const MARKET_PRICES_VERSION = 1 as const;

export type MarketPricesFxQuote = Omit<PresentationFxQuote, "quoteCurrency"> & {
  quoteCurrency: FiatCurrencyCode;
};
/** Valuation / executable-adjacent Codex quotes. */
export const MARKET_PRICE_FRESHNESS_MS = 5 * 60_000;
/**
 * Invest discover indications. Codex `timestamp` is last trade, not fetch time;
 * thinner Base markets (cbDOGE, cbLTC, TOSHI) routinely age past five minutes
 * while still having coverage. Wrong-identity and missing rows stay omitted.
 */
export const MARKET_PRICE_DISPLAY_FRESHNESS_MS = 24 * 60 * 60 * 1_000;

export type MarketPricesResponse = {
  version: typeof MARKET_PRICES_VERSION;
  provider: "codex";
  fetchedAt: string | null;
  unavailableReason?: "not-configured";
  markets: Readonly<Record<string, MarketDataState>>;
  /** Coinbase USD FX for local presentation. Omitted when the FX read fails. */
  fx?: readonly MarketPricesFxQuote[];
};

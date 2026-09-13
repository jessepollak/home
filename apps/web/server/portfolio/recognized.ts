import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import {
  getCodexRecognizedTokenCatalog,
  type RecognizedTokenCatalogEntry,
  type RecognizedTokenCatalogResult,
} from "@/server/market-data/codex/recognized-catalog";
import {
  getCodexRawQuotes,
  type CodexRawQuoteInput,
} from "@/server/market-data/codex/raw-quotes";
import { exactDecimalToFraction } from "@/shared/portfolio/valuation-math";
import type { PriceQuote } from "@/shared/portfolio/valuation-types";
import {
  getRecognizedTokenBalances,
  type RecognizedBalanceHolding,
  type RecognizedBalanceResult,
} from "./recognized-rpc";

export const RECOGNIZED_BRANCH_TIMEOUT_MS = 6_000;
export const RECOGNIZED_PRICE_CANDIDATE_LIMIT = 128;
export const RECOGNIZED_PRICE_BATCH_SIZE = 25;
export const RECOGNIZED_MIN_LIQUIDITY_USD = 100_000;
export const RECOGNIZED_MIN_VOLUME_24_USD = 10_000;

export type RecognizedTokenDiscoveryHolding = RecognizedBalanceHolding & {
  price: PriceQuote | null;
};

export type RecognizedTokenDiscovery = {
  status: "complete" | "incomplete";
  holdings: RecognizedTokenDiscoveryHolding[];
};

export function createRecognizedPortfolioReader(dependencies: {
  readCatalog?: (
    signal?: AbortSignal,
  ) => Promise<RecognizedTokenCatalogResult>;
  readBalances?: (
    catalog: readonly RecognizedTokenCatalogEntry[],
    owner: PortfolioAddress,
    signal: AbortSignal,
  ) => Promise<RecognizedBalanceResult>;
  readPrices?: (inputs: readonly CodexRawQuoteInput[]) => Promise<PriceQuote[]>;
  timeoutMs?: number;
} = {}) {
  const readCatalog = dependencies.readCatalog ?? getCodexRecognizedTokenCatalog;
  const readBalances = dependencies.readBalances ?? getRecognizedTokenBalances;
  const readPrices = dependencies.readPrices ?? getCodexRawQuotes;
  const timeoutMs = dependencies.timeoutMs ?? RECOGNIZED_BRANCH_TIMEOUT_MS;

  return async function readRecognizedPortfolio(
    owner: PortfolioAddress,
    externalSignal?: AbortSignal,
  ): Promise<RecognizedTokenDiscovery> {
    const controller = new AbortController();
    const abort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => controller.abort("recognized-portfolio-timeout"),
      timeoutMs,
    );

    try {
      const pending = (async (): Promise<RecognizedTokenDiscovery> => {
        let catalog: RecognizedTokenCatalogResult;
        try {
          catalog = await readCatalog(controller.signal);
        } catch {
          return { status: "incomplete", holdings: [] };
        }
        if (controller.signal.aborted) return { status: "incomplete", holdings: [] };

        let balances: RecognizedBalanceResult;
        try {
          balances = await readBalances(catalog.entries, owner, controller.signal);
        } catch {
          return { status: "incomplete", holdings: [] };
        }
        if (controller.signal.aborted) {
          return { status: "incomplete", holdings: balances.holdings.map((holding) => ({ ...holding, price: null })) };
        }

        const priceCandidates = balances.holdings
          .filter(passesMarketQualityGate)
          .slice(0, RECOGNIZED_PRICE_CANDIDATE_LIMIT);
        const priceByAssetKey = new Map<string, PriceQuote>();
        let incomplete =
          catalog.status === "incomplete" || balances.status === "incomplete";
        const batches: RecognizedBalanceHolding[][] = [];
        for (
          let index = 0;
          index < priceCandidates.length;
          index += RECOGNIZED_PRICE_BATCH_SIZE
        ) {
          batches.push(priceCandidates.slice(index, index + RECOGNIZED_PRICE_BATCH_SIZE));
        }
        const results = await Promise.all(
          batches.map(async (batch) => {
            try {
              return await readPrices(
                batch.map((holding) => ({
                  assetKey: assetKey(holding.address),
                  address: holding.address,
                  networkId: 8453 as const,
                })),
              );
            } catch {
              incomplete = true;
              return [];
            }
          }),
        );
        for (const quote of results.flat()) priceByAssetKey.set(quote.assetKey, quote);

        return {
          status: controller.signal.aborted || incomplete ? "incomplete" : "complete",
          holdings: balances.holdings.map((holding) => ({
            ...holding,
            price: priceByAssetKey.get(assetKey(holding.address)) ?? null,
          })),
        };
      })();
      const aborted = new Promise<RecognizedTokenDiscovery>((resolve) => {
        const incomplete = () => resolve({ status: "incomplete", holdings: [] });
        if (controller.signal.aborted) incomplete();
        else controller.signal.addEventListener("abort", incomplete, { once: true });
      });
      return await Promise.race([pending, aborted]);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  };
}

export const getRecognizedPortfolio = createRecognizedPortfolioReader();

export function passesMarketQualityGate(
  holding: Pick<RecognizedBalanceHolding, "liquidityUsd" | "volume24Usd">,
): boolean {
  return fractionAtLeast(holding.liquidityUsd, RECOGNIZED_MIN_LIQUIDITY_USD) &&
    fractionAtLeast(holding.volume24Usd, RECOGNIZED_MIN_VOLUME_24_USD);
}

function fractionAtLeast(
  value: RecognizedBalanceHolding["liquidityUsd"],
  threshold: number,
): boolean {
  const fraction = exactDecimalToFraction(value);
  return fraction.numerator >= BigInt(threshold) * fraction.denominator;
}

function assetKey(address: PortfolioAddress): `eip155:8453/erc20:${string}` {
  return `eip155:8453/erc20:${address.toLowerCase()}`;
}

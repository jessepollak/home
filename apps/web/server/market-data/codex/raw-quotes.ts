import type { PortfolioAddress } from "@/config/portfolio-assets";
import { parseExactDecimal } from "@/shared/portfolio/valuation-math";
import type { PriceQuote, ValuationSource } from "@/shared/portfolio/valuation-types";
import {
  CODEX_CACHE_TTL_MS,
  CODEX_GRAPHQL_ENDPOINT,
  CODEX_MAX_FUTURE_SKEW_MS,
  CODEX_MAX_TOKENS_PER_REQUEST,
  CODEX_PRICE_SOURCE_LABEL,
  CODEX_REQUEST_TIMEOUT_MS,
  CODEX_TOKEN_PRICES_QUERY,
} from "./config";
import { parseJsonWithNumberLexemes } from "./lossless-json";
import { MARKET_PRICE_FRESHNESS_MS } from "@/shared/invest/public-contract";

export type CodexRawQuoteInput = {
  assetKey: `eip155:8453/erc20:${string}`;
  address: PortfolioAddress;
  networkId: 8453;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class CodexRawQuoteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexRawQuoteError";
  }
}

export function createCodexRawQuotesReader(options: {
  apiKey: string | undefined;
  inputs: readonly CodexRawQuoteInput[];
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? CODEX_REQUEST_TIMEOUT_MS;
  const inputs = validateInputs(options.inputs);
  let cache: { storedAt: number; quotes: PriceQuote[] } | null = null;
  let inFlight: Promise<PriceQuote[]> | null = null;

  return async function readRawQuotes(): Promise<PriceQuote[]> {
    const fetchedAt = readCurrentTime(now);
    if (!options.apiKey?.trim()) {
      return unavailableQuotes(inputs, fetchedAt.toISOString());
    }
    if (cache && fetchedAt.getTime() - cache.storedAt <= CODEX_CACHE_TTL_MS) {
      const quotes = reevaluateQuoteFreshness(cache.quotes, fetchedAt);
      cache = { ...cache, quotes };
      return quotes;
    }
    if (!inFlight) {
      inFlight = fetchQuotes({
        apiKey: options.apiKey.trim(),
        inputs,
        fetchImpl,
        fetchedAt,
        timeoutMs,
      });
    }
    try {
      const fetchedQuotes = await inFlight;
      const completedAt = readCurrentTime(now);
      const quotes = reevaluateQuoteFreshness(fetchedQuotes, completedAt);
      cache = { storedAt: completedAt.getTime(), quotes };
      return quotes;
    } finally {
      inFlight = null;
    }
  };
}

let sharedApiKey: string | undefined;
const sharedReaders = new Map<string, ReturnType<typeof createCodexRawQuotesReader>>();

export function getCodexRawQuotes(
  inputs: readonly CodexRawQuoteInput[],
): Promise<PriceQuote[]> {
  const apiKey = process.env.CODEX_API_KEY;
  if (sharedApiKey !== apiKey) {
    sharedApiKey = apiKey;
    sharedReaders.clear();
  }
  const key = inputs
    .map(({ networkId, address }) => `${networkId}:${address.toLowerCase()}`)
    .sort()
    .join("|");
  let reader = sharedReaders.get(key);
  if (!reader) {
    reader = createCodexRawQuotesReader({ apiKey, inputs });
    sharedReaders.set(key, reader);
  }
  return reader();
}

async function fetchQuotes({
  apiKey,
  inputs,
  fetchImpl,
  fetchedAt,
  timeoutMs,
}: {
  apiKey: string;
  inputs: readonly CodexRawQuoteInput[];
  fetchImpl: FetchLike;
  fetchedAt: Date;
  timeoutMs: number;
}): Promise<PriceQuote[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
    });
    headers.set(["Author", "ization"].join(""), apiKey);
    const response = await fetchImpl(CODEX_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: CODEX_TOKEN_PRICES_QUERY,
        variables: {
          inputs: inputs.map(({ address, networkId }) => ({ address, networkId })),
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CodexRawQuoteError(`Codex quotes returned HTTP ${response.status}.`);
    }
    const parsed = parseJsonWithNumberLexemes(await response.text());
    const envelope = readRecord(parsed);
    if (Array.isArray(envelope?.errors) && envelope.errors.length > 0) {
      throw new CodexRawQuoteError("Codex quotes returned an error.");
    }
    const data = readRecord(envelope?.data);
    if (!data || !Array.isArray(data.getTokenPrices)) {
      throw new CodexRawQuoteError("Codex quotes returned an invalid price list.");
    }
    return normalizeQuotes(inputs, data.getTokenPrices, fetchedAt);
  } catch (error) {
    if (error instanceof CodexRawQuoteError) throw error;
    throw new CodexRawQuoteError(
      controller.signal.aborted
        ? "Codex quotes timed out."
        : "Codex quotes request failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeQuotes(
  inputs: readonly CodexRawQuoteInput[],
  rows: readonly unknown[],
  fetchedAt: Date,
): PriceQuote[] {
  const inputByContract = new Map(
    inputs.map((input) => [contractKey(input.networkId, input.address), input]),
  );
  const candidates = new Map<string, PriceQuote>();
  const duplicates = new Set<string>();

  for (const value of rows) {
    const row = readRecord(value);
    if (!row) continue;
    const address = readAddress(row.address);
    const networkId = readInteger(row.networkId);
    if (!address || networkId === null) continue;
    const key = contractKey(networkId, address);
    const input = inputByContract.get(key);
    if (!input) continue;

    if (candidates.has(key) || duplicates.has(key)) {
      candidates.delete(key);
      duplicates.add(key);
      continue;
    }

    const source = sourceFor(fetchedAt, null);
    const rawPrice = typeof row.priceUsd === "string" ? row.priceUsd : null;
    const exact = rawPrice ? parseExactDecimal(rawPrice) : null;
    const timestamp = readInteger(row.timestamp);
    let quote: PriceQuote;
    if (!exact || BigInt(exact.atoms) === BigInt(0) || timestamp === null) {
      quote = baseQuote(input, "invalid", source, rawPrice);
    } else {
      const sourceTimeMs = timestamp * 1_000;
      const asOf = Number.isSafeInteger(sourceTimeMs)
        ? new Date(sourceTimeMs)
        : new Date(Number.NaN);
      if (Number.isNaN(asOf.getTime())) {
        quote = baseQuote(input, "invalid", source, rawPrice);
      } else if (
        sourceTimeMs > fetchedAt.getTime() + CODEX_MAX_FUTURE_SKEW_MS
      ) {
        quote = baseQuote(input, "invalid", sourceFor(fetchedAt, asOf), rawPrice);
      } else if (
        fetchedAt.getTime() - sourceTimeMs > MARKET_PRICE_FRESHNESS_MS
      ) {
        quote = baseQuote(input, "stale", sourceFor(fetchedAt, asOf), rawPrice);
      } else {
        quote = {
          ...baseQuote(input, "fresh", sourceFor(fetchedAt, asOf), rawPrice),
          unitPrice: exact,
        };
      }
    }
    candidates.set(key, quote);
  }

  return inputs.map((input) => {
    const key = contractKey(input.networkId, input.address);
    if (duplicates.has(key)) {
      return baseQuote(input, "invalid", sourceFor(fetchedAt, null), null);
    }
    return (
      candidates.get(key) ??
      baseQuote(input, "missing", sourceFor(fetchedAt, null), null)
    );
  });
}

function reevaluateQuoteFreshness(
  quotes: readonly PriceQuote[],
  currentTime: Date,
): PriceQuote[] {
  return quotes.map((quote) => {
    if (quote.status !== "fresh") return quote;
    const asOf = quote.source.asOf ? new Date(quote.source.asOf) : null;
    if (!asOf || Number.isNaN(asOf.getTime())) {
      return { ...quote, unitPrice: null, status: "invalid" };
    }
    if (asOf.getTime() > currentTime.getTime() + CODEX_MAX_FUTURE_SKEW_MS) {
      return { ...quote, unitPrice: null, status: "invalid" };
    }
    if (currentTime.getTime() - asOf.getTime() > MARKET_PRICE_FRESHNESS_MS) {
      return { ...quote, unitPrice: null, status: "stale" };
    }
    return quote;
  });
}

function readCurrentTime(now: () => Date): Date {
  const currentTime = now();
  if (Number.isNaN(currentTime.getTime())) {
    throw new CodexRawQuoteError("The Codex quote fetch time is invalid.");
  }
  return currentTime;
}

function baseQuote(
  input: CodexRawQuoteInput,
  status: PriceQuote["status"],
  source: ValuationSource,
  sourceValue: string | null,
): PriceQuote {
  return {
    assetKey: input.assetKey,
    contractAddress: input.address.toLowerCase() as PortfolioAddress,
    quoteCurrency: "USD",
    unitPrice: null,
    sourceValue,
    status,
    source,
  };
}

function sourceFor(fetchedAt: Date, asOf: Date | null): ValuationSource {
  return {
    provider: "Codex",
    method: CODEX_PRICE_SOURCE_LABEL,
    fetchedAt: fetchedAt.toISOString(),
    asOf: asOf?.toISOString() ?? null,
    timeBasis: asOf ? "provider-as-of" : "retrieved-at",
  };
}

function unavailableQuotes(
  inputs: readonly CodexRawQuoteInput[],
  fetchedAt: string,
): PriceQuote[] {
  const source: ValuationSource = {
    provider: "Codex",
    method: CODEX_PRICE_SOURCE_LABEL,
    fetchedAt,
    asOf: null,
    timeBasis: "retrieved-at",
  };
  return inputs.map((input) => baseQuote(input, "unavailable", source, null));
}

function validateInputs(inputs: readonly CodexRawQuoteInput[]): CodexRawQuoteInput[] {
  if (inputs.length === 0 || inputs.length > CODEX_MAX_TOKENS_PER_REQUEST) {
    throw new CodexRawQuoteError("The Codex quote input count is invalid.");
  }
  const seen = new Set<string>();
  return inputs.map((input) => {
    if (input.networkId !== 8453 || !readAddress(input.address)) {
      throw new CodexRawQuoteError("A Codex quote input is invalid.");
    }
    const key = contractKey(input.networkId, input.address);
    if (seen.has(key)) {
      throw new CodexRawQuoteError("The Codex quote inputs contain a duplicate.");
    }
    seen.add(key);
    return input;
  });
}

function contractKey(networkId: number, address: string): string {
  return `${networkId}:${address.toLowerCase()}`;
}

function readAddress(value: unknown): PortfolioAddress | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as PortfolioAddress)
    : null;
}

function readInteger(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

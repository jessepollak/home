export const CODEX_GRAPHQL_ENDPOINT = "https://graph.codex.io/graphql";
export const CODEX_PRICE_SOURCE_LABEL = "Codex";
export const CODEX_PRICE_SOURCE_URL =
  "https://docs.codex.io/api-reference/queries/gettokenprices";

export const CODEX_TOKEN_PRICES_QUERY = `query GetTokenPrices($inputs: [GetPriceInput!]!) {
  getTokenPrices(inputs: $inputs) {
    address
    networkId
    priceUsd
    timestamp
    priceChange24
  }
}`;

export const CODEX_MAX_TOKENS_PER_REQUEST = 25;
export const CODEX_MAX_BATCHES = 4;
export const CODEX_REQUEST_TIMEOUT_MS = 8_000;
export const CODEX_CACHE_TTL_MS = 45_000;
export const CODEX_MAX_FUTURE_SKEW_MS = 60_000;

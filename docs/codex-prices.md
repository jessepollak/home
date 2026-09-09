# Codex market prices

Live verification date: September 7, 2026

Home Invest uses a server-only Codex GraphQL adapter for read-only USD market indications. These snapshots are not executable trade quotes, guarantees, underlying off-chain stock prices, or claims that one token equals one share or one native coin. Invest formats those USD snapshots in the selected local presentation currency (Coinbase FX, display-only). Cash / currency-balance rows stay native and are not re-denominated.

## Public contracts

- `GET /api/market-prices` is a public, signed-out-safe, same-origin read. It accepts no addresses, GraphQL, SQL, asset IDs, or other browser input.
- The server derives every Codex input from the authoritative `investAssets` export and its exact Base contract identity (`networkId: 8453`).
- The JSON envelope contains `version`, `provider`, a separate server `fetchedAt`, and category-keyed values using the existing `MarketDataState` contract.
- Each ready snapshot retains the exact configured `assetId`, a string-preserved USD display price, Codex source label/link, and Codex source `timestamp` converted to ISO UTC in `asOf`. When Codex returns a nonzero `priceChange24` decimal ratio, the snapshot also includes `changeLabel` (signed Δ%, same formatter as Memes `filterTokens.change24`). Missing, zero, or malformed change is omitted — never invented. The public envelope may also include Coinbase USD FX quotes so the client can present those prices in the selected local fiat without changing the Codex snapshot.
- `useMarketPrices()` loads that endpoint once, returns a stable `{ stockMarket, memeMarket, cryptoMarket? }` props object, and ages source snapshots out while mounted. It does not poll, open a WebSocket, or start background work.
- `PricedInvestExperience` passes that stable object to `InvestExperience`. App Integration only needs to render `PricedInvestExperience` where the unpriced component is currently composed. The optional `cryptoMarket` property automatically becomes meaningful when the Crypto Majors registry/UI change is merged.
- `GET /api/invest/discover` is a separate public read. Memes come from Codex `filterTokens` ranked by `trendingScore24` on Base (fail-closed empty/error). Stock/crypto marks resolve from onchain `contractURI` metadata first, then Codex token images, then initials. It does not change `getTokenPrices` allowlisting.

Missing server configuration returns useful `unavailable` states without contacting Codex. Upstream failures return a generic 502 error state without provider bodies, headers, or credentials.

## Server setup

Create a Codex key at `dashboard.codex.io/api-keys`. The public Codex getting-started documentation currently describes a $1 account activation fee; Home must not automate signup, activation, billing, or key creation.

Put the real server-only value in `apps/web/.env.local`, keep that file permission `0600`, and use this single entry:

```dotenv
CODEX_API_KEY=<your Codex key>
```

Never use a `NEXT_PUBLIC_` prefix. The adapter sends the key raw in the `Authorization` header, without a Bearer prefix. The committed `.env.example` contains an empty placeholder only.

## Provider request and validation

Endpoint: `POST https://graph.codex.io/graphql`

The bounded query is:

```graphql
query GetTokenPrices($inputs: [GetPriceInput!]!) {
  getTokenPrices(inputs: $inputs) {
    address
    networkId
    priceUsd
    timestamp
    priceChange24
  }
}
```

Codex documents a 25-token maximum per `getTokenPrices` request. Home uses one batch for the current roster, splits only when the authoritative registry exceeds 25, and rejects a registry larger than four batches (100 assets). There are no retries. Each request has an eight-second timeout; successful per-process results are cached for 45 seconds and concurrent reads are coalesced.

The per-process cache is not a project-wide production rate limiter. Multiple instances can each call Codex, and every GraphQL query can count against provider quotas. Production rollout must monitor the Codex plan/request budget and add shared coordination only if actual deployment scale requires it; this change intentionally adds no Redis, framework, or SDK.

Codex's current reference describes `TokenPrice.priceUsd` as a GraphQL `Float`, so the JSON response carries a numeric token rather than an arbitrary-precision JSON string. Home parses the response text losslessly and preserves the exact numeric lexeme instead of first coercing it through JavaScript `number`. Positive decimal and exponent forms are accepted. Null, missing, malformed, non-finite, negative, or zero prices are unavailable, never fabricated as zero.

Records are accepted only when address plus network match an allowlisted configured asset. Out-of-scope, duplicate, malformed, stale, or more-than-60-seconds-future records are omitted. Source freshness is based only on Codex `timestamp`; request/fetch time is retained separately and never substituted for trade freshness. Invest discover uses a 24-hour display budget because Codex timestamps last trade, not last fetch — thinner Base markets (cbDOGE, cbLTC, TOSHI) routinely age past five minutes while still returning a price for the exact allowlisted contract. Portfolio valuation quotes keep the five-minute budget. Missing, null, or wrong-identity rows stay omitted; Home does not substitute a native-asset or other-network spot price.

Official references reviewed:

- https://docs.codex.io/api-reference/queries/gettokenprices
- https://docs.codex.io/api-reference/objects/token-price
- https://docs.codex.io/get-started
- https://docs.codex.io/concepts/rate-limits

The authenticated live schema accepts `GetPriceInput`, matching the current public reference. `GetTokenPricesInput` is rejected as an unknown type, so Home now declares the batch variable as `[GetPriceInput!]!`.

## Scoped live verification

A bounded three-request recovery batch was completed on September 7, 2026. The first diagnostic received HTTP 401 `UNAUTHENTICATED` because the probe's initial loader did not apply dotenv parsing; it is not evidence that the rotated key is invalid. The second request loaded only the scoped credential with Bun's dotenv handling and received HTTP 400: `GetTokenPricesInput` was unknown and the field expected `[GetPriceInput]`. The third and final request used `GetPriceInput`, received HTTP 200 with no GraphQL errors, and returned exactly 11 rows matched to the 11 requested Base contracts. No raw response, header, credential, prefix, or hash was recorded.

Codex returned a numeric `priceUsd` token and an integer Unix-seconds `timestamp` for every requested contract. At the successful probe around `2026-09-07T23:01:23Z`, every requested Base contract had coverage. Eight records were within five minutes; `cbltc` (~9 minutes), `cbada` (~5 minutes), and `toshi` (~17 minutes) were older last-trade stamps. Those three were previously omitted by the five-minute discover budget (issue #41). They now display under the 24-hour indication window, still labeled with Codex `asOf` and still never replaced with an underlying equity or native-asset spot price.

| Asset ID | Base representation | Source timestamp (UTC) | Current wrapper result at probe time |
| --- | --- | --- | --- |
| `nvdac` | NVDAc | `2026-09-07T23:01:03Z` | Fresh; displayable |
| `metac` | METAc | `2026-09-07T22:59:45Z` | Fresh; displayable |
| `aaplc` | AAPLc | `2026-09-07T23:01:21Z` | Fresh; displayable |
| `googlc` | GOOGLc | `2026-09-07T23:00:53Z` | Fresh; displayable |
| `cbbtc` | cbBTC | `2026-09-07T23:01:21Z` | Fresh; displayable |
| `cbxrp` | cbXRP | `2026-09-07T23:00:13Z` | Fresh; displayable |
| `cbdoge` | cbDOGE | `2026-09-07T22:58:09Z` | Fresh; displayable |
| `cbltc` | cbLTC | `2026-09-07T22:52:23Z` | Last trade older than five minutes; displayable under the 24-hour indication budget |
| `cbada` | cbADA | `2026-09-07T22:56:05Z` | Last trade older than five minutes; displayable under the 24-hour indication budget |
| `degen` | DEGEN | `2026-09-07T23:00:53Z` | Fresh; displayable |
| `toshi` | TOSHI | `2026-09-07T22:44:15Z` | Last trade older than five minutes; displayable under the 24-hour indication budget |

This closes the provider authentication and schema gate for the rotated key. It does not guarantee that every contract will always have a fresh trade-derived timestamp; null, missing, malformed, or stale future reads continue to stay explicit. No main composition change is needed because `app/page.tsx` already renders `PricedInvestExperience`.

Before production display, also review the applicable Codex terms/API agreement for caching, attribution, redistribution, and commercial display rights. Public API access alone is not treated here as a license conclusion.

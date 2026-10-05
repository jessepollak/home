# Codex market prices

Live verification date: September 7, 2026

Home Invest uses a server-only Codex GraphQL adapter for read-only USD market indications. These snapshots are not executable trade quotes, guarantees, underlying off-chain stock prices, or claims that one token equals one share or one native coin. Invest formats those USD snapshots in the selected local presentation currency (Coinbase FX, display-only). Cash / currency-balance rows stay native and are not re-denominated.

Codex does not price tokenized stocks for display or holdings. `GET /api/market-prices` fills its `stock` category from the Chainlink tokenized-equity reference reader ([stock valuation](invest-data.md#stock-valuation)); those snapshots carry source label `Chainlink`, a `session` (`open`, `closed`, `paused`, `stale`) and `checkedAt`, the Base block time of the read. The parser accepts a session only on a configured stock snapshot that carries `checkedAt`. The client does not age a session snapshot by the feed's `updatedAt`, because a weekend close is valid; it expires the snapshot five minutes after `checkedAt` and refetches then. When every feed read fails, the stock category is an error state, not an empty ready one, and a mounted Invest page rechecks it every five minutes until a reference returns. Codex history is non-stock only. Configured stock charts, range changes and scrub readouts use historical Chainlink tokenized-equity feed answers, on the same per-token basis as the header and holding. A stock never falls back to Codex or DEX history ([stock history](invest-data.md#stock-history)).

## Public contracts

- `GET /api/market-prices` is a public, signed-out-safe, same-origin read. It accepts no addresses, GraphQL, SQL, asset IDs, or other browser input.
- The server derives every Codex price input from the authoritative `investAssets` export, excluding stocks, and its exact Base contract identity (`networkId: 8453`). Batches stay at most 25 tokens each.
- The JSON envelope contains `version`, `provider`, a separate server `fetchedAt`, and category-keyed values using the existing `MarketDataState` contract.
- Each ready snapshot retains the exact configured `assetId`, a string-preserved USD display price, Codex source label/link, and Codex source `timestamp` converted to ISO UTC in `asOf`. When Codex returns a nonzero `priceChange24` decimal ratio, the snapshot also includes `changeLabel` (signed Δ%, same formatter as Memes `filterTokens.change24`). Missing, zero, or malformed change is omitted — never invented. The public envelope may also include Coinbase USD FX quotes so the client can present those prices in the selected local fiat without changing the Codex snapshot.
- `useMarketPrices()` loads that endpoint once, returns a stable `{ stockMarket, memeMarket, cryptoMarket? }` props object, and ages source snapshots out while mounted. Its only scheduled work is the five-minute stock reference recheck above; it does not otherwise poll or open a WebSocket.
- `PricedInvestExperience` passes that stable object to `InvestExperience`. App Integration only needs to render `PricedInvestExperience` where the unpriced component is currently composed. The optional `cryptoMarket` property automatically becomes meaningful when the Crypto Majors registry/UI change is merged.
- `GET /api/invest/discover` is a separate public read. Memes come from Codex `filterTokens` ranked by `trendingScore24` on Base (fail-closed empty/error). Stock/crypto marks resolve from onchain `contractURI` metadata first, then Codex token images, then initials. It does not change `getTokenPrices` allowlisting.
- `GET /api/market-prices/history` recognizes configured static asset IDs plus canonical lowercase `base:0x…` IDs for read-only URL identity. Other networks, malformed IDs, mixed-case aliases, and dynamic aliases of configured assets fail closed. Dynamic history is admitted separately, by server reads only: either the address is in the current server-fetched trending meme catalog, or an exact Codex token lookup on Base returns that same token address. The admission reader caches at most 256 results for 45 seconds, runs at most 8 lookups at once, coalesces identical reads, and fails closed when full or on error. Browser-provided catalog data, the presence of a search result, and syntax alone never authorize a Codex bars request. This resolver is not used to grant execution eligibility; trading keeps its separate static gates.
- `GET /api/invest/search` is a public, signed-out-safe search read (see [Asset search](#asset-search)).
- History contract version 2 carries `source`, verified against the requested asset: non-stock Codex histories carry `{kind: "codex", chainId: 8453, contractAddress}` for the exact token; configured stocks carry their registered Chainlink feed proxy, label and public source link. Sessions and coverage are Chainlink-only, and all point times must be strictly increasing.
- Non-stock Codex history requests use fixed server-owned windows/resolutions, return only the requested canonical identity, and remain short-cache public reads. The per-process history reader keeps at most 64 cached asset/range entries for 45 seconds and at most 8 distinct upstream requests in flight; same-key reads coalesce, least-recently-used entries are evicted, and overflow returns a no-store `503` unavailable response without contacting Codex. The history contract and chart explicitly label values as `USD`. Sub-$0.001 chart labels use four significant digits so positive sub-micro prices do not display as zero. The local-fiat current-price header is unchanged, and Home does not apply today’s FX rate to historical chart values or return labels.
- Codex responses for history, quotes, and other Codex reads have an eight-second timeout and a 4 MB limit. A response over the limit, with a mismatched declared length, or with a redirect fails as an upstream error.

Missing server configuration returns useful `unavailable` states without contacting Codex. Upstream failures return a generic 502 error state without provider bodies, headers, or credentials.

## Asset search

`GET /api/invest/search?q=<query>&offset=<n>` merges registry alias matches with a Codex `filterTokens` phrase search restricted to Base (`filters: { network: [8453] }`), ranked by `trendingScore24`. The contract, customer behavior, and identity rules are in [Invest data](invest-data.md#asset-search).

- **Coverage.** Search considers registry assets plus Base tokens that Codex has indexed, then filters results by the operator's Invest settings after the per-process query cache. Codex phrase matching covers token and pair contract addresses plus partial names and symbols. Home adds no liquidity floor or `trendingIgnored` restriction. The provider still omits some tokens by default: `includeScams` defaults to `false`, so tokens Codex flags as scams do not appear in phrase search, and unindexed contracts never appear. Being searchable is not proof that every deployed Base contract is covered. A full contract query still resolves an unindexed ERC-20 through the exact-address path.
- **Ranking.** One shared rule ranks all loaded pages: exact contract, then configured exact matches, provider exact matches, configured prefix, provider prefix, configured partial, and provider partial matches. The provider's trending order only breaks ties within a tier. Codex pages in `trendingScore24` order, so an exact match on a later provider page appears only after Load more; the first page cannot guarantee every exact match. Partial matches need at least two characters. Provider rows must match their own name, symbol, or contract, which drops pair-address and wrong-chain rows. Surviving rows then get the exact-contract `token0()` pair check through a per-reader, bounded-concurrency gate that caches definitive answers by contract, so an LP token whose own name or symbol matches (for example `UNI-V2`) is dropped. An inconclusive check drops that row and makes the page a partial, uncached `provider: "error"` response that keeps verified rows, configured matches, and `nextOffset`.
- **Pages and bounds.** Queries are at most 64 characters, and blank or invalid requests return `400` without contacting Codex. The reader returns every configured match for the query, and Page 0 caps the visible ones at 8 before appending up to 20 provider rows, so a hidden category or asset never crowds out a visible configured match. Later pages hold provider rows only, each at most 20, with offsets in steps of 20 up to 100. Each page is deduplicated by contract. The per-process reader caches at most 256 successful query/offset entries for 45 seconds, coalesces identical in-flight reads, and runs at most 8 distinct upstream searches at once. Separately, phrase-result pair probes share a per-reader, bounded cache of definitive results and a small concurrency cap across pages; repeated addresses reuse the answer instead of triggering another RPC call. A request beyond the upstream-search cap returns configured matches marked `unavailable` without calling Codex. Requests use the shared eight-second Codex timeout. There is no per-client rate limiter; the 45-second per-process cache and in-flight cap bound upstream use. Search responses use `Cache-Control: no-store` and contain no holdings, eligibility, or other personalized data.
- **Failure.** With a missing key, an overloaded reader, a timeout, HTTP 429, or a malformed response (including pagination metadata), the endpoint still returns visible configured matches. It sets `provider` to `unavailable` or `error` and `coverage: "partial"`, sends `no-store`, and includes no provider body, header, or credential. Malformed pagination metadata is a partial provider failure and is not cached. Incomplete hex queries return configured matches only (`provider: "skipped"`). If Invest settings are unavailable without a last-known-good policy, search fails closed with empty results and partial coverage.
- **Visibility propagation.** Invest settings apply immediately on the instance that saved and within about five seconds on other server instances. Customers see them on their next page load or new search request; an open page can reuse an earlier result for the same query for up to a minute.
- **Prices and exact identity.** Indexed rows carry the same display snapshot as trending memes (`priceUSD`, `change24`, and the last-transaction timestamp). A one-row `filterTokens(tokens: ["<address>:8453"])` read supplies both identity (including the provider image when present) and price for an indexed exact contract; its token address and network must match the query and Base. A valid identity with a missing or non-positive price still appears without a snapshot, never with a zero price. A failed provider read returns no contract result, `provider: "error"`, and `coverage: "partial"` with Retry; it does not trigger onchain fallback or cache the failure. Only a definitive provider miss permits onchain identity, without a price. Configured assets keep the `/api/market-prices` snapshot.
- **Live verification (September 26, 2026).** Read-only authenticated probes through `/api/invest/search` confirmed the request shape against the [`filterTokens` reference](https://docs.codex.io/api-reference/queries/filtertokens). `BTC`, `Bitcoin`, and `cbBTC` return the configured `cbbtc` first; `AAPL` and `Apple` return the configured `aaplc` first; both are followed by distinct same-symbol Base contracts with prices. `kBTC` (not in the trending catalog) returns indexed rows, and its detail and chart history resolve on reload. Exact contracts for an indexed non-configured token return one priced `contract` result, a configured contract returns the configured asset, and a known pool contract (its `token0()` call returns an address) returns no result. Codex echoes the requested offset as `page` (`0`, `20`) and returns the row count as `count`, both as JSON numbers; `BTC` page 2 contains further exact-symbol matches, which is why ranking is applied across loaded pages.
- **Shared resolution.** A full contract query and `GET /api/invest/asset?assetId=<canonical-id>` (detail deep links) share one `resolveAsset` service; detail resolution does not call search. The resolver keeps a 256-entry positive cache with a 45-second TTL and runs at most eight concurrent resolutions. Missing identities and failed or partial results are not cached; configured identities need no provider call. The detail endpoint uses `no-store` for missing or failed results. History admission remains separately indexed/trending-only.

## Server setup

Create a Codex key at `dashboard.codex.io/api-keys`. The public Codex getting-started documentation currently describes a $1 account activation fee; Home must not automate signup, activation, billing, or key creation.

Put the real server-only value in `apps/web/.env.local`, keep that file permission `0600`, and use this single entry:

```dotenv
CODEX_API_KEY=<your Codex key>
```

Never use a `NEXT_PUBLIC_` prefix. The adapter sends the key raw in the `Authorization` header, without a Bearer prefix. The committed `.env.example` contains an empty placeholder only.

## Provider request and validation

Codex close values are nullable floats. A null close contributes no point; every non-null close must pass finite-number and timestamp validation before exposure.

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

Codex documents a 25-token maximum per `getTokenPrices` request. Home uses one batch for the current roster, splits only when the authoritative registry exceeds 25, and rejects a registry larger than four batches (100 assets). There are no retries. Each request has an eight-second timeout and a 4 MB response bound, and a `206` partial response is rejected rather than served; successful per-process results are cached for 45 seconds and concurrent reads are coalesced.

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

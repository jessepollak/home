# Cached Public Stablecoin Transfer Feed

**Status:** implementation specification only

**Reviewed:** September 8, 2026

**Intended destination:** `docs/public-transfer-feed-spec.md`

## Decision

Build a **Base mainnet public ERC-20 `Transfer` event feed** using the existing server-side CDP SQL transport and a shared application cache. Start with the three stablecoin identities already reviewed in Home’s portfolio registry:

| Asset | Chain | Contract | Decimals |
|---|---:|---|---:|
| USDC | Base `8453` | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | 6 |
| EURC | Base `8453` | `0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42` | 6 |
| IDRX | Base `8453` | `0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22` | 2 |

These identities come from `apps/web/config/portfolio-assets.ts`. Circle documents the Base USDC and EURC addresses, and IDRX documents its Base address. ([developers.circle.com](https://developers.circle.com/stablecoins/usdc-contract-addresses?utm_source=openai))

This is a feed of **public token transfer events**, not transactions in general, Home customers, payment activity, remittances, or verified geographic movement. The illustrative globe routes from HOME-9 remain a separate presentation layer and must never be derived from wallet addresses or token denomination.

## Asset admission gate

Ticker or issuer name alone is insufficient. Before an asset is enabled:

1. Chain ID and contract address must match the reviewed Home registry and an issuer-controlled primary source.
2. A bounded Base RPC read at a recorded block must confirm:
   - deployed bytecode is non-empty;
   - `decimals()` equals the registry value;
   - `symbol()` is compatible with the expected symbol, while recognizing that symbol is not identity.
3. At least one decoded `Transfer(address,address,uint256)` row must be compared with the corresponding Base receipt/log.
4. Raw amount formatting must pass fixtures for zero, one base unit, one whole token, maximum supported `uint256`, and trailing-zero fractions.
5. Evidence date and block number must be recorded. A contract upgrade or registry change reopens this gate.

No additional stablecoin enters merely because it appears in `docs/stablecoin-candidates.json`.

## Source and ingestion

### Provider

Use the existing CDP SQL endpoint and transport in `apps/web/server/chain-data/cdp-sql-client.ts`. CDP SQL supports Base decoded event logs, bounded result sets, query caching, and reorganization action semantics. Current official limits include a 30-second query timeout, a 50,000-row result limit, and up to 15 minutes of query-result caching. ([docs.cdp.coinbase.com](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/sql-api/run-sql-query?utm_source=openai))

Create a public-feed query adapter beside the existing wallet-scoped adapter rather than changing authenticated activity behavior. Reuse its validation, string-preserved numeric parsing, timeout/error mapping, and fixed server-only credential boundary.

### Query contract

Query `base.events` for:

- `event_signature = 'Transfer(address,address,uint256)'`;
- `address` in the exact three-contract allowlist;
- a rolling **20-minute mutable window**;
- explicit columns only;
- `GROUP BY log_id HAVING sum(toInt8(action)) > 0`;
- newest-first order by numeric block number, transaction hash, numeric log index, then log ID.

Twenty minutes is an initial overlap/cost setting, not a maximum reorganization horizon or a finality guarantee. Use RPC `safe` and `finalized` heads and canonical block-hash checks for security labels. On startup or a head regression, reconcile all retained non-finalized records within the bounded retention window; if that reconciliation cannot finish within the request budget, keep the feed delayed rather than treating older mutable rows as final. ([Base derivation and finality](https://docs.base.org/base-chain/specs/protocol/consensus/derivation))

Fetch up to 2,000 rows per page and at most three pages per refresh. Use the existing lossless keyset shape:
Freeze the window start/end and head snapshot once per refresh cycle; every page uses that same boundary rather than a newly evaluated rolling time. Budget saturation means incomplete coverage, even when the newest returned rows are recent.

```text
blockNumber + transactionHash + logIndex + logId
```

If the three-page bound is reached before covering the mutable window:

- upsert rows that were returned;
- do not delete absent cached rows, because absence is not yet authoritative;
- set source state to `delayed` and record a saturation metric;
- do not increase bounds automatically without an operator review.

CDP documents `log_id` for source deduplication and net `action` semantics for active versus removed logs. Home’s public identity remains the protocol-level tuple below. ([docs.cdp.coinbase.com](https://docs.cdp.coinbase.com/data/sql-api/schema?utm_source=openai))

### Identity and normalization

The unique key is:

```text
(chainId, transactionHash, logIndex)
```

`logId` is retained as provider evidence but is not the public identity. Reobserving the same key updates block hash, block number, timestamp, participants, amount, provider log ID, and confirmation state transactionally.

One transaction may emit several stablecoin transfers. Every distinct log index remains a distinct feed item.

Normalized server record:

```ts
type PublicTransferRecord = {
  id: `8453:${string}:${string}`; // chain:txHash:logIndex
  chainId: 8453;
  token: {
    id: "usdc" | "eurc" | "idrx";
    address: `0x${string}`;
    symbol: "USDC" | "EURC" | "IDRX";
    decimals: 6 | 2;
  };
  transactionHash: `0x${string}`;
  logIndex: string;
  providerLogId: string;
  blockNumber: string;
  blockHash: `0x${string}`;
  blockTimestamp: string;
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountBaseUnits: string;
  amountDecimal: string;
  eventKind: "transfer" | "mint" | "burn";
  confirmation: "confirming" | "safe" | "finalized";
};
```

All integer fields remain decimal strings across SQL, storage, and API boundaries. `amountDecimal` is produced with `BigInt` division and string operations—never `Number`, floating point, or price conversion. It is canonical, ungrouped, has no exponent, and removes only insignificant trailing fractional zeros.

Examples:

```text
"1234567", 6 decimals -> "1.234567"
"1200000", 6 decimals -> "1.2"
"1",       2 decimals -> "0.01"
```

### Mint, burn, dust, and self-transfer

- Zero-address sender: `eventKind: "mint"` and UI label **Minted**.
- Zero-address recipient: `eventKind: "burn"` and UI label **Burned**.
- Otherwise: `eventKind: "transfer"`.
- Preserve self-transfers and same-transaction multiple logs.
- Reject zero amounts and, initially, amounts below one whole token:
  - USDC: `1_000_000` base units;
  - EURC: `1_000_000` base units;
  - IDRX: `100` base units.

These are transparent anti-noise display thresholds, not USD-value or fraud judgments. Changes require fixture updates and product review.

## Confirmation and reorganization handling

Once per refresh cycle, use the existing Base RPC capability to read `latest`, `safe`, and `finalized` heads:

- block above `safe`: `confirming`;
- block at or below `safe` but above `finalized`: `safe`;
- block at or below `finalized`: `finalized`.

Do not promote confirmation state if RPC head reads fail. Heights alone are insufficient: before promoting a represented block, verify its recorded hash against the canonical RPC block at that height. Group records by block and batch/cache those checks. A mismatch removes the orphaned event and emits a removal revision. A contradiction involving a previously finalized record makes the feed unavailable pending explicit reconciliation rather than silently preserving the old label.

After a complete mutable-window query, transactionally:

1. upsert active events;
2. remove cached, non-finalized events inside that window that are no longer active;
3. emit removal revisions for clients;
4. retain finalized events until normal retention pruning.

A changed block hash on the same event key is an update, not a duplicate. A removed event must disappear from the visible snapshot rather than be marked as a failed payment.

## Shared cache and refresh policy

### Local spike

Use a separate Node SQLite store, following the operational pattern in `apps/web/server/money-actions/sqlite-store.node.ts`, with tables for:

- transfer records;
- cache metadata and last successful source timestamp;
- a refresh lease;
- bounded revision/upsert/removal history.

Bounds:

- retain at most **1,000 records**;
- retain at most **two hours**;
- API snapshot defaults to 20 and caps at 50 rows;
- revision history retains 1,000 changes or 30 minutes, whichever is smaller.

Refresh is **request-driven**, not a permanent worker:

- client polling interval: 15 seconds while visible and unpaused;
- minimum upstream refresh interval: 30 seconds;
- stop upstream work after two minutes without a public-feed request;
- use one transactional refresh lease and in-process single-flight promise;
- lease winner performs the bounded refresh;
- concurrent visitors read the same cache and do not query CDP;
- provider credentials never enter browser responses.

This SQLite design only coordinates one persistent local Node runtime. It is **not production distributed persistence** and cannot prevent separate Vercel instances from independently refreshing.

### Future multi-instance deployment

Before multi-instance production, use an approved shared persistence/cache service with a conditional refresh lease. Home's design proposes Neon/Postgres, but it is not provisioned by this overnight spike and remains a separate operator decision. Do not represent planned infrastructure as already available. No standalone indexer or streaming service is required for the local specification.

If shared persistence is unavailable, do not claim provider-query sharing across instances.

## Rate, quota, backoff, and cost

CDP currently publishes 1,000 free SQL queries per month, then `$0.0083` per query, with a default limit of **two queries per second per project**. The parent independently rechecked the official page on September 8, 2026; it does not establish different billing for cached responses. ([CDP SQL pricing and limits](https://docs.cdp.coinbase.com/data/sql-api/welcome))

Budget conservatively as though every `/run` request is billable, including a provider-cached response, unless the project’s billing terms explicitly prove otherwise:

```text
Qsql <= ceil(activeFeedSeconds / refreshIntervalSeconds) × averagePagesPerRefresh
monthlyCost = max(0, Qsql - 1,000) × providerPricePerQuery
```

At a 30-second interval and one page per refresh:

- continuous 30-day activity: 86,400 queries, approximately `$708.82`;
- eight active hours per day: 28,800 queries, approximately `$230.74`.

These are upper-bound assumptions, not observed Home traffic or invoices.

Operational controls:

- configurable daily and monthly query ceilings;
- never exceed one refresh cycle per 30 seconds;
- honor `Retry-After` on 429;
- exponential backoff of 30 seconds, 60 seconds, 2 minutes, 5 minutes, capped at 15 minutes, with jitter;
- no automatic retry inside one request after authentication, payment, or invalid-query errors;
- trip a circuit breaker after three consecutive failures;
- log only bounded timing/status metadata, never credentials or complete provider rows.

## Outage and freshness states

```ts
type FeedStatus = "fresh" | "delayed" | "stale" | "unavailable";
```

- `fresh`: successful source execution no more than 90 seconds old.
- `delayed`: refresh is backing off, saturated, or RPC confirmation heads are unavailable; cached rows remain visible with their real update time.
- `stale`: last successful source execution is older than 90 seconds.
- `unavailable`: no cache exists, or the cache is more than 15 minutes old.

After 15 minutes without success, keep records internally for recovery but replace the public list with an unavailable state. Never change timestamps, cycle old rows to the top, insert fixtures, or announce cached rows as new.

## Public API

`GET /api/public/transfers?limit=20&cursor=<opaque-revision-cursor>`

No authentication is required. Response headers may be publicly cacheable for at most 10 seconds, but the application cache remains the provider-query control.

```ts
type PublicTransferFeedResponse = {
  version: 1;
  mode: "snapshot" | "delta";
  cursor: string;
  resetRequired: boolean;
  generatedAt: string;
  sourceAsOf: string | null;
  status: "fresh" | "delayed" | "stale" | "unavailable";
  nextPollMs: number;
  items: PublicTransferItem[];
  removedIds: string[];
};

type PublicTransferItem = {
  id: string;
  chainId: 8453;
  token: {
    id: "usdc" | "eurc" | "idrx";
    symbol: "USDC" | "EURC" | "IDRX";
    contractAddress: `0x${string}`;
    decimals: 6 | 2;
  };
  eventKind: "transfer" | "mint" | "burn";
  amountBaseUnits: string;
  amountDecimal: string;
  fromDisplay: string; // e.g. 0x1234…abcd
  toDisplay: string;
  transactionHash: `0x${string}`;
  logIndex: string;
  blockNumber: string;
  blockTimestamp: string;
  confirmation: "confirming" | "safe" | "finalized";
  explorerPath: string;
};
```

A valid retained cursor returns only upserts and removals since that revision. An absent, expired, or unknown cursor returns a newest-first snapshot with `resetRequired: true`. Cursor contents are opaque and contain no provider credentials.

Full participant addresses stay in the server cache; the public API emits shortened forms only. It performs no ENS lookup, customer matching, identity enrichment, location lookup, sanctions characterization, or behavioral classification.

## Landing-page UI

Reuse the shared `ActivityRow` from `apps/web/components/finance-rows.tsx`.

```text
[USDC]  0x1234…89ab → 0xabcd…4321     1,250 USDC   ↗
        Base · Safe · 18s ago
```

Mint/burn variants:

```text
[EURC]  Minted                              50 EURC   ↗
[IDRX]  Burned                          25,000 IDRX   ↗
```

Requirements:

- below-fold ordered list, newest first;
- 20 initial rows, never more than 50;
- compact existing finance-row mobile layout;
- exact, non-rounded token amount preserving all significant token decimals;
- transaction explorer link with an explicit accessible label;
- freshness text such as `Updated 32 seconds ago`;
- pause/resume button;
- pause when the document is hidden;
- queue new records behind a `Show N new transfers` control rather than shifting focused or read rows;
- preserve scroll position when applying queued rows;
- no marquee or endless automatic scrolling;
- reduced-motion mode removes insertion/removal animation;
- one polite live-region summary such as `3 new public transfers available`; do not make the entire list live;
- removed/reorganized rows disappear when queued changes are applied without announcing them as failures;
- empty, delayed, stale, and unavailable states are text, not manufactured activity.

Label the section **Public stablecoin transfers on Base**. Supporting copy, if any, should be limited to: **Public onchain events, not Home customer activity.**

No country flags, city names, routes, “sent around the world,” customer labels, payment labels, or remittance claims may be inferred from these events.

## Implementation phases

1. **Evidence and adapter:** complete the three-asset precision gate; add the fixed public CDP SQL template and lossless normalization tests.
2. **Local shared cache/API:** add the bounded SQLite cache, lease, overlap refresh, revisions, RPC confirmation labels, backoff, and public route.
3. **Landing UI:** compose `ActivityRow`, snapshot/delta polling, queued updates, pause, freshness/error states, mobile and accessibility behavior.
4. **Production hardening:** move the cache/lease boundary to existing shared Postgres before multi-instance deployment; verify actual CDP entitlement, cost, saturation, and stale-state telemetry.

## High-value acceptance checks

1. **Shared refresh:** 100 concurrent API requests against one local runtime cause no more than one CDP refresh cycle; all visitors receive the shared snapshot and no credential.
2. **Event identity:** duplicate pages and overlapping refreshes produce one row per `(8453, transactionHash, logIndex)`, while two logs in the same transaction remain two rows.
3. **Exact amounts:** USDC/EURC six-decimal and IDRX two-decimal fixtures round-trip from base-unit strings to canonical decimal strings without floating-point conversion.
4. **Reorganization:** a mutable event removed by net CDP action disappears, produces one `removedId`, and a changed block hash updates the existing identity; confirmation never advances when RPC head reads fail.
5. **Failure honesty:** 429, timeout, saturated-window, empty-cache, 91-second-old, and 15-minute-old fixtures produce the specified delayed/stale/unavailable behavior without replaying rows as new.
6. **Accessibility/UI:** keyboard pause/resume and `Show N new transfers` work at 320px and desktop widths; focus and scroll remain stable; reduced-motion has no insertion animation; a screen reader receives one concise update summary.

## Primary implementation references

- `apps/web/server/chain-data/base-erc20-transfers.ts`
- `apps/web/server/chain-data/cdp-sql-client.ts`
- `apps/web/server/chain-data/types.ts`
- `apps/web/config/portfolio-assets.ts`
- `apps/web/components/finance-rows.tsx`
- `apps/web/server/money-actions/sqlite-store.node.ts`
- `docs/cdp-sql.md`
- `docs/wallet-runtime-spike.md`
- `docs/target-architecture.md` (production destination; not the current tree)
- Official CDP SQL overview, schema, endpoint, and quickstart. ([docs.cdp.coinbase.com](https://docs.cdp.coinbase.com/data/sql-api/welcome?utm_source=openai))
- Official Circle USDC/EURC and IDRX contract registries. ([developers.circle.com](https://developers.circle.com/stablecoins/usdc-contract-addresses?utm_source=openai))
- Official Base RPC and derivation/finality documentation. ([docs.base.org](https://docs.base.org/base-chain/api-reference/rpc-overview?utm_source=openai))

## Review

- **Correct:** Scope is limited to an implementation-ready specification; no application or repository source was edited.
- **Correct:** The design reuses the existing CDP SQL, Base RPC, shared `ActivityRow`, and local Node SQLite seams.
- **Correct:** Asset identity, exact precision, deduplication, reorganization handling, cache sharing, cost controls, stale behavior, and accessibility have explicit acceptance gates.
- **Note:** Live RPC precision probes, public-feed SQL volume measurements, and authenticated provider billing checks were deliberately not run.
- **Blocker:** None for accepting the specification. Production implementation remains gated on shared persistence and the documented evidence checks.
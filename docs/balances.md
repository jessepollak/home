# Balances: one snapshot, every row, cached on the device

Status: **G1 CDP-first server, G2 deletion, G3 server observation, G3b production completeness, G3c latency/price observations, and G4 dust default shipped** (2026-09-13). Subsystem design under [architecture.md](architecture.md) (principles 2 and 5; the balances snapshot is an *observation*). Restores Phase B/C of the [balances inventory](balances-inventory-architecture.md) summary (Neon snapshot, CDP webhooks, locked Sept 9) and supersedes its Q1 Phase A (the deletion step landed 2026-09-13). Home now enumerates the wallet through CDP, resolves against registry ∪ Codex 512 ∪ wallet metadata, reads the registry at one pinned block, and prices resolved rows.

## What Jesse asked for

1. Balances are cached on the client so they feel instant: reload, tab switch, return-from-background paint from the device, then revalidate.
2. All 512 recognized tokens are first-class everywhere balances appear (Home teaser, Balances, Save), not "nested-Balances-only".
3. Rows look good and identical regardless of which source produced the holding.
4. One backend read with one shape; every feature selects from it.

## What was true before this design (pre-G2 evidence; these paths no longer exist)

| Symptom | Where |
|---|---|
| Five representations of "a balance" in one response: `inventory.holdings` (direct \| vault-position), `recognized.holdings` (different shape), `cashBuckets`, `nativeCashValuations`, `lines` + `prices` + `fx` | `shared/portfolio/valuation-types.ts:160-199` |
| Recognized rows are second-class: stripped from the persisted cache, excluded from the Home teaser, excluded from Send availability, flagged `recognized: true` | `client/query/query-client.tsx:71-89` (`delete persistedData.recognized`), `shared/portfolio/present-home-balances.ts:47-52`, `client/home/send-availability.ts:17` |
| Reload paints registry rows from cache, then the 512 pop in below after the network round trip | consequence of the above; `usePortfolioValuation` meta is `"memory"` (`client/portfolio/use-portfolio-valuation.ts:40`) |
| Four server balance readers for the same wallet: CDP Token Balances paged 20/page up to 32 sequential pages with per-owner checkpoints (519 LOC), configured-ERC-20 RPC recovery, vault RPC, recognized Multicall3 over 512 (sequential chunks at `latest`, unpinned) | `server/portfolio/{cdp-token-balances,inventory,inventory-erc20-rpc,inventory-vault-rpc,recognized-rpc}.ts`; `recognized-rpc.ts:178,213` |
| Plus a second read of the same vault shares for the Save panel | `app/api/savings/positions/route.ts` |
| Savings issues a **second full valuation fetch** with region hard-coded to `"US"` just to read USDC base units | `client/savings/savings-experience.tsx:118-127` |
| Send availability parses the formatted display string back into a number | `client/home/send-availability.ts:29-31` (`parseAvailableDecimal(balanceLabel)`) |
| Latency is the max of four branches, and inventory itself is three sequential stages (CDP scan 10 s, RPC recovery 4 s, vault 10 s budgets) | `server/portfolio/inventory.ts:139-176`, `valuation.ts:81-88` |
| Loading is signalled by the sentinel string `displayContext === "Updating…"` | `client/home/balances-panel.tsx:244` |
| No block consistency across rows: CDP balances have no block; only the vault read pins one | `inventory.ts:184` uses the vault block |

## Boundary: display snapshot vs action-time reads

`GET /api/balances` is the **display and client-availability** source: what rows to paint, what a user *can* start (Send max, Save deposit max). It is not action authority. Where calldata depends on chain state, the action's server `prepare` reads it at a pinned block and validates the amount (`server/borrowing/prepare.ts` via the market-parameterized `BorrowRpcReader.readSnapshot`, exposed for detail display at `/api/borrow/markets/:marketId`; `server/savings/prepare.ts` via `savings/rpc.ts`); a plain Send is checked by the chain at execution. Those reads stay exactly as they are. This is two responsibilities, not two sources of truth.

## Design

### 1. One enumeration + one registry

The server has two bounded inputs with different freshness and authority:

1. **Enumerate per owner.** CDP Token Balances scans up to 32 pages at the documented maximum of 100 rows per page (3,200 rows). It returns lowercase ERC-20 contract addresses, decimal-integer-string amounts, and optional trimmed `name`, `symbol`, and `decimals`. The native `0xeeee…` sentinel is excluded because ETH is read from the registry path. One in-flight scan is shared per owner and detached from route caller aborts. It starts pages inside a 2.5 s soft budget, lets a healthy in-flight page finish, and enforces a 4 s hard ceiling per page including retries. Stopping after one or more pages preserves those rows, marks the scan incomplete, and stores the next page cursor so a stale signal or 120 s backstop resumes instead of restarting.
2. **Read the registry.** `server/balances/universe.ts` contains only configured direct assets and vault shares from `config/portfolio-assets.ts`. Registry ordering stays cash → native → other direct assets → vaults. It never expands to the Codex catalog and never performs a 512-contract `decimals()` verification.

CDP supplies display-grade quantities only for positive non-registry rows. Registry quantities, including ETH and vault shares, always come from the pinned Base read. This deliberately gives action-relevant assets a coherent block while allowing Home to show tokens discovered by the wallet index.

### 2. One chain read

`server/balances/read.ts` reads the registry and vault conversions in one pinned pass through the configured Base RPC:

1. `eth_getBlockByNumber("latest")` selects `{number, hash, timestamp}`. `eth_chainId` remains asserted once per resolved URL.
2. In parallel at that block: `eth_getBalance(owner)` and one Multicall3 `aggregate3(allowFailure: true)` containing every configured ERC-20 and vault-share `balanceOf(owner)` call.
3. One batch converts positive vault shares with `convertToAssets(shares)` and re-reads the pinned block. A changed hash re-pins and retries the whole read once; a second mismatch fails.
4. A failed registry call is retried once. A successful zero is `"0"`; a failed read is `unavailable`, never zero. The whole read retains its 4 s deadline.

The hosted public-default guard is unchanged: preview/production never uses an implicit public RPC for registry quantities, marks those rows unavailable, and emits one `portfolio-balance-source` event per read. There is no catalog chunk and no sequential-public-catalog branch. The snapshot row's hot window drives post-action registry refreshes; instances keep only in-flight dedupe.

### Resolve

After enumeration and the pinned registry read finish concurrently, `server/balances/resolve.ts` joins `registry ∪ Codex 512 catalog ∪ wallet`:

- Registry contracts found in CDP are ignored; their quantity remains the pinned registry quantity.
- A positive enumerated contract in the cached Codex 512 catalog becomes a `catalog` holding. Catalog `name`, `symbol`, `decimals`, image, and liquidity win; the CDP amount supplies the display quantity. If CDP supplies decimals and they disagree with Codex, the row is skipped and coverage becomes incomplete.
- A positive contract outside registry and catalog is looked up on Codex by contract address in batches of 100 (global 60 s, 2,048-address LRU). Codex name, symbol, image, and liquidity win; a CDP/Codex decimals disagreement skips the row and makes coverage incomplete. Unknown or failed lookups remain quantity-only `wallet` rows with valid CDP metadata.
- Registry non-cash ERC-20s receive `imageUrl` from the one-hour configured-asset icon resolver; icon failure is ignored. Cash, ETH, and vault shares never receive an image.
- Zero rows are skipped and contracts are deduped by lowercase address.

The Codex catalog reader remains the three-page, 512-entry, 60 s shared cache. It resolves membership and presentation metadata; it is not part of the chain quantity read.

### 3. One pricing pass

`server/balances/price.ts` prices positive holdings as follows:

- The full registry ERC-20/vault-underlying input set remains one stable batch on every pricing pass.
- Positive `catalog` rows are priced in batches of 25 and retain the ≥ $25k exact-contract liquidity market gate for the total; 24 h volume is not an admission dependency (#470).
- A Codex price is usable for display valuation when its `asOf` is within `BALANCES_PRICE_MAX_AGE_MS` (24 h); older → `price-stale`. Fresh quotes are stored once per asset in `price_observations`, and a cold instance or failed Codex batch may reuse the newest stored quote inside that bound. Trade/borrow authorization keep the 5-minute market-prices rule (decision 7).
- Codex-enriched `wallet` rows share the catalog 25-token price batches and market gate; unknown quantity-only rows return `value: { status: "unpriced", reason: "below-market-gate" }` and never enter the total.
- ETH and FX continue to use Coinbase exchange rates. Cash rows still get `cashValue` in their own denomination.
- `total.status` is determined from registry rows only. Gated-in catalog values add to the amount without changing status.

All amount and valuation math remains bigint / exact-decimal based; no amount crosses through JavaScript `Number`.

### 4. One snapshot (contract v3) and coverage

`GET /api/balances?region=XX` keeps the locked `shared/balances/types.ts` v3 shape. Registry, catalog, and wallet rows all use `holdings[]`; the parser continues to require positive lowercase non-registry ERC-20 rows with source-specific ids and keys.

Coverage now means:

| field | status | meaning |
|---|---|---|
| `coverage.registry` | `complete` | Every configured registry quantity was read successfully. |
| `coverage.registry` | `partial` | At least one registry quantity is unavailable. |
| `coverage.catalog` | `complete` | The CDP scan completed, the Codex catalog cache is complete, and no enumerated catalog row was skipped for a decimals disagreement. |
| `coverage.catalog` | `incomplete` | The scan hit its page or soft page-start bound, Codex returned a partial catalog, or a CDP/Codex decimals disagreement caused a skip. |
| `coverage.catalog` | `unavailable` | CDP enumeration was unavailable; the response is a full registry-only snapshot. |

CDP unavailability never turns `/api/balances` into a 502. A registry read failure retains the existing fail-closed registry row semantics and can still cause the route-level read failure behavior when the pinned pass itself cannot complete.

Server composition is: `enumerate(owner)` and `read(registry, owner)` concurrently → `resolve` → `price` → `snapshot`. Caller abort signals do not cancel shared owner work.

### 5. One client query, persisted whole

`client/balances/use-balances.ts`:

- Key `ownerQueryKey(owner, "balances", region)`, `meta: ownerQueryMeta(owner, "owner")` — **persisted including catalog rows**. This reverses #337's "do not cache recognized rows" rule, which stated no rationale: they are the same private data class as USDC in the same owner-scoped localStorage blob, cleared on every owner-generation bump; positive catalog rows are typically < 20 (≈ 100 KB at a 512-row worst case, under the 5 MB quota and the 24 h TTL). Cache buster becomes `home-query-v2` (the storage prefix stays `home.query.v1:`, which the smoke test keys on) so v2 snapshots are dropped, not migrated.
- Region defaults to `usePresentationRegionId()`; the Save panel gains the same `PresentationRegionProvider` Invest already has (`feature-panels.tsx:32`) so Save and Home share one key. USDC base units are region-independent anyway.
- `staleTime` 15 s, `refetchOnWindowFocus: true`, `placeholderData: keepPreviousData` for the same owner, `retry: false`.
- Reload: `restoreOwnerQueries` hydrates the whole snapshot before first render → cash, registry, and catalog rows all paint at `shell:paint`; `balances:painted` fires on `ready` only; the background refetch animates changed values through `MoneyTicker`. The provisional-session paint from #364 is unchanged (hydration is owner-filtered; a mismatched owner clears the boundary). Measure `presentBalanceRows` on a 512-row fixture against the `balances:painted` budget.
- After an action: `invalidateAfterAction` scopes become `balances, activity, borrow, actions`. `startBalanceFreshness` reads `holdings[].balance.baseUnits` by `id` from the snapshot; the multi-region merge from #373 stays. The post-action `fetchQuery` passes `ownerQueryMeta(owner, "owner")` (today it passes `"memory"`, `after-action.ts:146`, which would silently stop persistence after the first poll); `use-portfolio-valuation.test.tsx:177` inverts accordingly.
- Transport gains `fetchBalances` additively; `fetchPortfolioValuation` / `fetchSavingsPositions` are removed in the deletion step.

`shared/balances/select.ts` (pure, tested, used by every feature):

| Selector | Consumers |
|---|---|
| `selectHolding(snapshot, id)` → `Holding \| null` | Savings USDC max |
| `selectBalanceBaseUnits(snapshot, id)` → `string \| null` | Send max, Savings deposit max |
| `selectVaultPositions(snapshot)` → `{vaultAddress, position: {assetsRaw} \| null}[]` | `summarizeSavingsPortfolio` (`portfolio-summary.ts:85-95` already accepts this) replaces `/api/savings/positions` |
| `selectSendable(snapshot)` → registry ERC-20/native with `balance.status === "ready" && baseUnits !== "0"`, carrying `balanceBaseUnits` | `send-availability.ts`; `MoneyAmountDisplay` takes `availableAmount` (`amount.tsx:216`) so `parseAvailableDecimal(balanceLabel)` is retired, not moved |
| `selectCash(snapshot)` → ordered cash rows for the region (selected local, canonical USD, `unsupported` placeholder) | presenter |
| `selectTotal(snapshot)` | Home hero |

### 6. One row

`shared/balances/present.ts` → `BalanceRowModel[]`, consumed by one `HomeBalanceRowView` for the Home teaser, the Balances page, and any future list:

```ts
type BalanceRowModel = {
  key: string;                  // holding key; stable React key
  group: "cash" | "asset";
  name: string;                 // "US dollar" | "Aerodrome"
  mark: { kind: "flag"; currency } | { kind: "image"; url; fallbackSymbol } | { kind: "eth" } | { kind: "symbol"; symbol };
  primary: string;              // fiat when priced, else quantity with symbol
  secondary: string | null;     // quantity with symbol when primary is fiat; null otherwise
  tone: "default" | "muted" | "error";
};
```

Anatomy, identical for every source: `[40 px mark] name / secondary … primary`. Cash: `[flag] US dollar … $1,234.56` (from `cashValue`). Priced asset: `[image] Aerodrome / 12.5 AERO … $18.20`. Unpriced asset: `[image] Foo … 12.5 FOO` (muted). Unpriced cash keeps its available native quantity in the default tone. Cash unavailable: `Unavailable` in destructive tone. Loading: skeleton rows from a real `loading` state, not the `"Updating…"` sentinel.

Membership rules (today's, made explicit): cash rows (canonical USD + selected local) always render, including at zero and when `unavailable`; non-cash rows render only with an authoritative positive balance — an `unavailable` non-cash registry row is **hidden** and surfaces through `coverage.registry: "partial"` → total status label, never as a wall of error rows; vault shares are never rows (they count in `total` and appear in Save via `selectVaultPositions`). Grouping and ordering: **Cash** (selected local, canonical USD, other cash — authored order, never re-sorted by value) and **Investments** (every other non-vault holding with a positive balance, priced by value desc → unpriced by name → dust last). Each group shows a quote-currency subtotal of its priced rows (omitted, never 0, when nothing is priced). The Home "Your money" card shows the first three non-dust rows of each group with a per-group "More" link into the panel (`?panel=balances&group=cash|investments`); the hero line shows Cash · Investments · Saved subtotals from the same snapshot. Formatting stays in `shared/formatting`. Dust behavior is described in §9.

No 24 h change, no contract addresses, no source labels on rows (ui-direction). Rows are not tappable in this pass (they are not today).

### 7. Actions stay registry-only

Send, Save, Borrow, Trade calldata is issued for registry assets only, exactly as today. Catalog rows are visible everywhere and actionable nowhere. Extending Send to catalog ERC-20s is a separate product decision; nothing here blocks it.

### 8. Server observation: `balance_snapshots` (G3, shipped 2026-09-13)

Jesse accepted one server-side balance cache as an *observation* (architecture.md principle 2): derivable, stamped with its source position, droppable, never authority for an action. It replaces the per-instance TTL caches as the server's cache; per-instance in-flight dedupe stays.

```sql
create table balance_snapshots (
  chain_id     integer not null,
  address      text not null,            -- lowercase smart account; what the chain and the webhook know
  block_number    bigint not null,
  block_hash      text not null,
  block_timestamp bigint not null,    -- unix seconds from the pinned block
  observed_at     timestamptz not null,     -- when the last full observation pinned its block
  stale_at     timestamptz,              -- one-shot: activity seen (webhook, funding receipt)
  hot_until    timestamptz,              -- post-action window: registry re-read on every request
  enumeration_cursor text,               -- next CDP page when a bounded scan is incomplete
  holdings     jsonb not null,           -- pre-pricing holdings with provenance (registry pinned, catalog/wallet from CDP)
  coverage     jsonb not null,
  primary key (chain_id, address)
);
```

Rules:

- **Scope.** The row is keyed by address because that is what the chain and the webhook know; the verified session decides which address a request may read (unchanged verified-scope rule). Two providers on one address share one observation.
- **Writers touch only their columns.** An observation write is a conditional upsert on `block_number` (a newer block never loses to an older one) that writes the observation columns only. Signal writers (`/confirm`, `/handle`, the webhook, a funding receipt) touch only `stale_at` or `hot_until`. A signal before the first observation intentionally no-ops: the first read is fresh by definition, and placeholder rows are forbidden.
- **When a read re-observes.** Precedence is stale/expired/degraded → full; else hot → registry-only; else serve. `hot_until > now()` re-reads the registry only (the action changed a registry asset; catalog/wallet rows keep the last enumeration). `stale_at > observed_at`, degraded coverage, or `observed_at` older than the backstop causes a full re-observe (registry read + CDP enumeration). `hot_until` is set by `POST /api/actions/:id/confirm` and `/handle` to `now() + 60 s`; `stale_at` by the CDP `wallet.activity.multi` webhook (signature-verified; duplicates are harmless because it only sets `stale_at`; it writes no amounts) and by a funding order reaching `received`; the backstop is 120 s.
- **Serving as observed.** `observed_at` is the last full observation's pin time; registry-only refreshes update registry rows and coverage without moving it. `fetchedAt` on the wire is `observed_at`, never the response time. If a required re-observe fails, the row is served as it was, with `stale: true` on the snapshot (additive to v3) and its coverage unchanged; the presenter shows the observation age. Never fresh, never zero.
- **Stale maxima.** Send and Save take their maxima from the snapshot even when stale; the flow shows the observation age beside the max; the server's pinned read at `prepare` remains the authority (§Boundary).
- **Prices never per owner.** Prices and FX stay in the global short-TTL caches and are applied at read time; there is no version column and no conditional-request scheme (the route is `no-store`; if one is wanted later, the ETag is `hash(block_hash, price asOf set, region)`).
- **Dropping the row never affects correctness**; it costs one re-observe and any open hot window.

Enumeration cost moves from "every 60 s per active user" to "once per activity event", which is what makes the all-tokens phase affordable for dusty wallets.

Webhook subscription lifecycle is automatic in production. At the first authenticated balance read for an address, Home lists subscriptions (60 s per-instance cache), selects an enabled `wallet_activity` subscription on `base-mainnet` whose target origin matches this deployment and has fewer than 100 addresses, re-lists immediately before a full-subscription `PUT`, and confirms the address by reading CDP back. If none has room, Home creates one targeting `/api/webhooks/cdp` and persists the returned one-time signing secret in `webhook_subscriptions` before returning. Production derives its origin from `VERCEL_PROJECT_PRODUCTION_URL`; `HOME_WEBHOOK_ORIGIN` is an optional override. Registration is disabled without PostgreSQL because an ephemeral instance cannot retain the secret. `POST /api/webhooks/cdp` loads stored secrets with a 60 s per-instance cache, verifies legacy `v0` or current `v1` HMAC-SHA256 signatures within the five-minute replay window, accepts the documented wallet activity family, sets `stale_at`, and returns 200. Registration failures are non-fatal because the 120 s backstop remains.

Unverified until preview: the production `wallet.activity.multi` delivery envelope and exact documented address fields; whether production deliveries use `wallet.activity`, `wallet.activity.detected`, or `wallet.activity.multi`; list pagination beyond the first response; and address packing/update behavior at the 100-address boundary. The implementation tolerates snake_case list fixtures and emits a bounded failure event without addresses.

### 9. Dust hidden by default (G4, shipped 2026-09-13)

Rows below one cent in the presentation currency and unpriced `wallet` rows are hidden by default behind one "N small balances hidden · Show" control at the end of the Your money panel. The Balances control reveals them for the current page load only; the Account "Show small balances" switch persists per device under `home.show-small-balances.v1`. When enabled, the panel appends those rows after the visible Investments rows and offers "Hide small balances". The Home teaser never shows hidden rows. Cash rows and any row with a priced value ≥ one cent are never hidden. The total and group subtotals are unaffected.

## Sequencing (every integration point stays green)

Additive first, deletions last. No lane deletes something another lane's consumer still imports.

| step | owns | adds / changes | deletes |
|---|---|---|---|
| **B0 contract** (complete) | `shared/balances/{types,contract,fixtures}.ts` + tests | v3 accepts registry, catalog, and wallet rows | — |
| **B1/F1 server baseline** (complete) | `server/balances/**`, route, observability | registry+catalog fixed-universe read, pricing, snapshot, coalescing | — |
| **G1 CDP-first server** (complete) | `server/balances/**`, CDP and FX moves/shims, this doc | per-owner CDP enumeration cache; registry-only pinned read; resolve to catalog/wallet rows; wallet unpriced | removed catalog multicall/decimals verification from the balances path |
| **B2/B3 client + proof** (complete) | client selectors/query/persistence and smoke fixtures | one persisted v3 query and shared rows | — |
| **B4/G2 deletion** (complete) | legacy `server/portfolio/**`, old routes/types/client imports | repoint any final consumers to balances-owned modules | legacy valuation/inventory/recognized paths and temporary re-export shims |
| **G3 server observation** (complete) | `server/balances/{snapshot-store,webhook}.ts`, migration, `/confirm` + `/handle` hot window, `POST /api/webhooks/cdp`, subscription registration, `stale` on the contract + presenter age | §8 | per-instance TTL caches |
| **G3b production completeness** (complete) | registry icons, 24 h display-price freshness, Codex wallet enrichment and pricing | decisions 6–8 | — |
| **G3c latency + price observations** (complete) | four-way Codex price concurrency, bounded-enumeration resume, per-request read timing, per-asset price observations, doc/test drift | §1, §3, §8 | — |
| **G4 dust default** (complete) | `shared/balances/present.ts`, Your money list control, Account preference | §9 | — |

G1 moved CDP Token Balances and Coinbase FX into `server/balances/`; G2 removed the temporary re-export shims with the legacy importers. Valuation math now lives in `shared/balances/math.ts` and presentation fiat formatting in `shared/formatting/presentation-fiat.ts`. Keep unchanged: `recognized-catalog.ts`, `raw-quotes.ts`, `server/chain/rpc.ts`, `MoneyTicker`, `BalanceRow`, `CurrencyMark`, and asset-mark.

## Next

- Add a second enumerator only if preview evidence shows CDP's curated index is too thin for tokens users expect to see.
- Measure on preview: CDP index lag after a Send, Jesse's wallet row count, and Jesse's page count at 100 rows per page.

Actions remain registry-only until a separate product decision extends Send.

## Constants

| Constant | Value | Why |
|---|---|---|
| Client `staleTime` | 15 s | refetch on focus/mount past this; visible-tab interval ~30 s |
| Device cache TTL | 24 h | persisted owner snapshot; cleared on owner change |
| Read dedupe (per instance) | in-flight only | concurrent regions/tabs share one owner observation; no completed-value TTL |
| CDP enumeration dedupe | in-flight only | completed enumeration lives only in `balance_snapshots` |
| Read deadline | 4 s | shorter than the 6 s per-call RPC timeout; a timeout fails the read and the client keeps previous data |
| Enumeration budgets | 2.5 s soft page-start; 4 s hard in-flight page | returns collected rows with `incomplete`; stale signals and the 120 s backstop continue from the stored page token |
| Price batch concurrency | 4 | bounds concurrent Codex batches while avoiding sequential latency |
| Hot window | 60 s | set by `/confirm` and `/handle`; registry re-read on every request |
| Backstop | 120 s | full re-observe when no signal arrived |
| Price maximum age | 24 h | newest per-asset observation inside this bound may value balances |
| Codex prices / Coinbase FX | 45 s / 60 s | global, shared across users |
| Market gate | ≥ $25k exact-contract liquidity, fresh price; no volume requirement | priced catalog/wallet rows enter the total (#337; #470 removed the ≥ $10k 24 h volume gate and set liquidity to $25k) |

## Acceptance

1. **Instant paint.** Playwright: persist a v3 snapshot with cash + registry + 3 catalog rows → reload → all rows visible before the stubbed `/api/balances` responds; `balances:painted` < budget; no layout shift when the response lands with identical data.
2. **One read.** Network log across Home → Save → Balances → Home shows exactly one `/api/balances` per region per 15 s; zero `/api/portfolio/valuation`, `/api/savings/positions` after B4.
3. **One shape.** After B4, `rg "recognized|cashBuckets|nativeCashValuations|inventory.holdings" apps/web` → 0; the route contract test asserts `holdings[]` is the only balance carrier.
4. **Fail closed.** Table-driven: CDP down → registry-only snapshot, `coverage.catalog: "unavailable"`, one event; CDP page/page-start bound or Codex partial → resolved rows retained, `coverage.catalog: "incomplete"`; registry chunk failure after retry → those rows `unavailable`, `coverage.registry: "partial"`, never `"0"`; RPC down → every registry row `unavailable`, total `unavailable`; hosted + public-default RPC → registry unavailable + one observability event.
5. **Cash denomination.** USDC row in a DE view renders in USD; IDRX row in a US view renders in IDR; the total renders in the region currency.
6. **Consistent rows.** DOM test: a cash row, a priced catalog row, an unpriced registry row, an unavailable cash row render through one `BalanceRow`; snapshot test on `presentBalanceRows` ordering and membership (vault shares absent, zero non-cash absent, catalog present).
7. **Selectors.** Send availability from a fixture with USDC `0`, cbBTC positive, a catalog token positive → exactly `[cbbtc]` with base units; `summarizeSavingsPortfolio(selectVaultPositions(fixture))` matches today's `portfolio-summary.test.ts` expectations.
8. **Persistence.** Owner A persists → reload → catalog rows present before first fetch; owner B → cleared; post-action poll does not flip the query to memory-only.
9. `bun check` green at every step; smoke on preview; Jesse sees his own wallet's 512-universe rows on Home, Balances, and Save without a second spinner.

## Decisions taken (Jesse can veto on the issue)

1. **CDP-first:** CDP Token Balances enumerates and supplies display-grade quantities for non-registry rows; one pinned registry+vault multicall backs actions and the total; Codex prices — Jesse, Go, 2026-09-13.
2. Persist catalog rows in the device cache (reverses one #337 rule).
3. Catalog rows visible in the Home teaser, Balances, and Save totals; not actionable. Send for catalog ERC-20s is a later, separate decision.
4. One server-side observation row per `(chain, address)` in Neon with event-driven invalidation and a 120 s backstop; a failed refresh serves the last observation marked stale — Jesse, 2026-09-13 (§8).
5. Dust hidden by default with a per-device "show all" — Jesse, 2026-09-13 (§9); the control lives in Account settings ("Show small balances"), with a one-line "N small balances hidden" affordance at the end of Balances that flips the same preference.
6. **Icons ride on the holding, not on Invest.** Production showed registry Invest rows (cbBTC, DEGEN, stocks) as pending discs because Balances borrowed `assetMarkResolution` from the Invest discover query (public, unpersisted, gated on Codex trending). The server attaches `imageUrl` to registry ERC-20 holdings from the asset icon resolver (1 h cache; configured memes added to its set); catalog and wallet rows keep their Codex image; the presenter uses `holding.imageUrl` for every source and Balances no longer depends on Invest — Jesse, 2026-09-13.
7. **Display valuation accepts prices up to 24 h old** (`BALANCES_PRICE_MAX_AGE_MS`), carrying `asOf`; older is `price-stale`. The 5-minute rule (`MARKET_PRICE_FRESHNESS_MS`) stays for trade and borrow authorization. Production showed IDRX and low-volume tokens unpriced only because their last Codex trade was older than five minutes — Jesse, 2026-09-13.
8. **`wallet` rows are enriched and priced.** Resolve looks up enumerated contracts outside the registry and the 512 catalog on Codex by contract address (batched; global cache keyed by address, 60 s): liquidity, 24 h volume, image, name/symbol/decimals cross-check. Enriched wallet rows are priced and gated exactly like catalog rows; contracts Codex does not know stay quantity-only with CDP metadata — Jesse, 2026-09-13.
9. **24 h volume is not an admission dependency; the exact-contract liquidity gate is $25k.** Pricing a catalog or enriched `wallet` row requires a fresh exact-contract quote and ≥ $25,000 liquidity (inclusive). 24 h volume no longer gates pricing or Codex catalog membership, and Codex volume is no longer read, so provider volume presence cannot change a row's catalog-vs-wallet identity — Jesse, 2026-09-14 (#470).

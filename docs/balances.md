# Balances: one snapshot, every row, cached on the device

Status: **design locked for implementation** (2026-09-13, after one independent design review). Builds on [home-is-thin](home-is-thin.md) (client architecture, startup gate, "no database caching") and supersedes Q1 Phase A of the [balances inventory](balances-inventory-architecture.md) summary and [portfolio.md](portfolio.md) once the deletion step lands. Universe is the one Jesse locked on [#337](https://github.com/jessepollak/home/issues/337): registry assets plus the top 512 clean Base tokens from Codex.

## What Jesse asked for

1. Balances are cached on the client so they feel instant: reload, tab switch, return-from-background paint from the device, then revalidate.
2. All 512 recognized tokens are first-class everywhere balances appear (Home teaser, Balances, Save), not "nested-Balances-only".
3. Rows look good and identical regardless of which source produced the holding.
4. One backend read with one shape; every feature selects from it.

## What is true today (evidence)

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

`GET /api/balances` is the **display and client-availability** source: what rows to paint, what a user *can* start (Send max, Save deposit max). It is not action authority. Each money action's server `prepare` reads its own pinned-block balances and validates amounts against them (`server/borrowing/prepare.ts:96,119,144` via `/api/borrow` `wallet.*Raw`; `server/savings/prepare.ts:135,201` via `savings/rpc.ts`). Those reads stay exactly as they are. This is two responsibilities, not two sources of truth.

## Design

### 1. One universe

`server/balances/universe.ts` returns the bounded set of assets Home reads, with provenance:

```ts
type UniverseEntry = {
  key: AssetKey;                       // "eip155:8453/native" | `eip155:8453/erc20:${lowercase}`
  kind: "native" | "erc20" | "vault-share";
  source: "registry" | "catalog";      // registry = config/portfolio-assets + vaults; catalog = Codex 512
  id: string;                          // registry id ("usdc", "cbbtc", "morpho-steakhouse-usdc") or `catalog:${address}`
  name: string; symbol: string; decimals: number;
  contractAddress: `0x${string}` | null;
  cashCurrency: FiatCurrencyCode | null;
  imageUrl?: string;                   // catalog only (sanitized https)
  liquidityUsd?: ExactDecimal; volume24Usd?: ExactDecimal;   // catalog only; server-side gate inputs, never on the wire
  underlying?: { key: AssetKey; symbol: "USDC"; decimals: 6 }; // vault-share only
};
```

Registry entries come from `config/portfolio-assets.ts` and `shared/assets/base.ts` (unchanged). Catalog entries come from today's `recognized-catalog.ts` (three Codex pages, 60 s shared cache, registry wins on overlap, symbol-collision exclusion) **plus** a once-per-refresh onchain `decimals()` verification of all 512 (four shared multicalls per 60 s), so the per-user path no longer pays that round trip. Entries whose Codex decimals disagree with the chain are dropped from the universe. The universe is ≈ 25 registry + ≤ 512 catalog contracts and is the only thing the chain reader iterates.

### 2. One chain read

`server/balances/read.ts` reads the whole universe for one owner in one pinned pass through the configured Base RPC (`server/chain/rpc.ts`):

1. `eth_getBlockByNumber("latest")` → `{number, hash, timestamp}`. `eth_chainId` is asserted once per process per resolved URL, not per read.
2. In parallel, all pinned to that block number: `eth_getBalance(owner)`; Multicall3 `aggregate3(allowFailure: true)` of `balanceOf(owner)`:
   - **chunk 0 = registry only** (≈ 25 contracts incl. vault shares, cash first), issued first and never mixed with catalog contracts;
   - chunks 1…n = catalog, 128 per chunk (≈ 4 chunks).
3. One batch: `convertToAssets(shares)` for vault shares with a positive balance **and** a re-read of the pinned block by number. If the hash differs, retry the whole read once; a second mismatch fails the read (client keeps previous data and retries at the next stale window).
4. Any failed chunk (RPC error, non-`success` multicall envelope) is retried once at the same block; a timeout is not retried. After that, its rows are `unavailable`.

Hosted guard: on `VERCEL_ENV ∈ {production, preview}` with `resolveBaseRpcUrl().source === "public-default"` (`hostedRuntimeExpectsManagedBaseRpcUrl`, today uncalled), the reader does **not** touch public RPC for cash: every registry row is `unavailable`, `coverage.registry: "partial"`, and one `portfolio-balance-source` event fires with `reason: "not-configured"`. Locally on `hostClass === "public-base"`, catalog chunks run sequentially (today's behavior) so `bun dev` does not reintroduce #69's `-32016` blanks.

Result: `ReadHolding[]` with `balance: {status: "ready", baseUnits} | {status: "unavailable", baseUnits: null}` for registry entries, and positive-only rows for catalog entries. Successful zero stays `"0"`, never `unavailable`; a failed call is `unavailable`, never `"0"`. Registry rows are always present (Send/Save need "0 available" vs "unavailable"); catalog rows appear only when positive.

This retires **CDP Token Balances** and the configured-ERC-20 recovery stage. Rationale: the fixed allowlist never needed a wallet-enumerating API; the recognized branch already proves Multicall3 on the same RPC every read; a bounded universe makes the read O(universe) instead of O(wallet spam), so the 6,213-token wallet from #337 completes in the same time as an empty one; a single block pin gives every row the same `asOf`. Q1 of the inventory summary chose CDP Token Balances to escape *public* RPC rate limits; that constraint no longer holds (`BASE_RPC_URL` → CDP Node in production) and the hosted guard above enforces it. No hybrid: it would lose the single block and keep 519 LOC to buy a safety property that registry-chunk isolation gives inside one source. home-is-thin's "Keep: … `server/portfolio`" was the money-action reset's scope fence, not a prohibition. Supersedes Q1 Phase A; recorded in `balances-inventory-architecture.md`.

Budget per read: 1 (block) + 1 (getBalance) + ≈ 5 (chunks) + 1 (convert + block re-read) = ≈ 8 requests in ≤ 6-wide bursts; one read per owner per 2 s at most (coalescing below). Verify CDP Node's documented RPS budget once on preview and record it here. Deadline 4 s for the whole read.

### 3. One pricing pass

`server/balances/price.ts` prices only holdings with a positive balance:

- ERC-20 and vault underlying: Codex `getTokenPrices` exact-contract quotes, 25 per batch, via today's `raw-quotes.ts` (45 s cache; ≤ 5 min old counts as fresh, else `stale`).
- ETH: Coinbase exchange-rates ETH quote (today's `fx-coinbase.ts`).
- FX: Coinbase USD→region rates (same module).
- Cash holdings (`cashCurrency !== null`) additionally get `cashValue` in their **own** denomination (USDC in USD, IDRX in IDR) so a USDC row in a DE view still reads in dollars. Server-side bigint math; the client never converts.
- Catalog rows enter the **total** only when they pass the #337 market-quality gate (≥ $100k liquidity, ≥ $10k 24 h volume, fresh price). Below the gate the row shows quantity and `value.reason: "below-market-gate"`.
- `total.status` is computed from **registry** rows only (vault shares included). Catalog rows add value when gated-in and never move status; one dust catalog token cannot flip a wallet to `partial`.

Valuation math is `shared/portfolio/valuation-math.ts` unchanged (bigint rationals, `roundFractionPreservingPositive`). No `Number` on any amount.

### 4. One snapshot (contract v3)

`GET /api/balances?region=XX` → `shared/balances/types.ts` (coordinator-owned; the exact file is the contract):

```ts
type BalancesSnapshot = {
  version: 3;
  owner: { address: `0x${string}`; chainId: 8453 };
  region: RegionId;
  quoteCurrency: FiatCurrencyCode | null;
  block: { number: string; hash: `0x${string}`; timestamp: string };
  fetchedAt: string;
  holdings: Holding[];
  coverage: {
    registry: "complete" | "partial";                   // any registry row unavailable → partial
    catalog: "complete" | "incomplete" | "unavailable"; // Codex page / chunk failed → incomplete; no Codex key → unavailable
  };
  total: {
    status: "complete" | "partial" | "unavailable" | "no-quote-currency";
    value: ExactDecimal | null;
    currency: FiatCurrencyCode | null;
  };
};

type Holding = {
  key: AssetKey; id: string; kind; source; name; symbol; decimals; contractAddress; cashCurrency; imageUrl?;
  underlying?: { key: AssetKey; symbol: "USDC"; decimals: 6 };
  balance: { status: "ready"; baseUnits: string } | { status: "unavailable"; baseUnits: null };
  underlyingBalance?: { status: "ready"; baseUnits: string } | { status: "unavailable"; baseUnits: null };
  value:                                        // in quoteCurrency
    | { status: "priced"; currency: FiatCurrencyCode; amount: ExactDecimal; asOf: string }
    | { status: "unpriced"; reason: "price-unavailable" | "price-stale" | "fx-unavailable" | "below-market-gate" | "no-quote-currency" }
    | { status: "unavailable" };                // balance unavailable
  cashValue?:                                   // cashCurrency !== null only; in the holding's own currency
    | { status: "priced"; currency: FiatCurrencyCode; amount: ExactDecimal }
    | { status: "unpriced"; reason: "price-unavailable" | "price-stale" | "fx-unavailable" }
    | { status: "unavailable" };
};
```

Dropped from the wire: `inventory.scope`, `walletDiscoveryComplete`, `omissions`, `lines`, `prices[]`, `fx`, `nativeEthQuote`, `nativeCashValuations`, `cashBuckets`, `recognized`, liquidity/volume, unit prices. Cash-bucket roles (selected local, canonical USD, the `unsupported` local placeholder) are a rule of region × registry and live in a pure client selector. The response is private (`Cache-Control: private, no-store`, `Vary: Authorization, X-Home-Account-Provider`).

`parseBalancesSnapshot(value, session, region)` verifies **shape and scope only**: owner/chain/region/currency match the verified session, integer base units, registry rows' metadata equals `config/portfolio-assets`, catalog keys disjoint from registry, https image URLs, `priced ⇒ amount`. It does not recompute arithmetic against a same-origin server.

Server-side coalescing, keyed on **owner** for the chain read (region-independent) and on `(owner, region)` for pricing: one in-flight read per owner and a 2 s snapshot TTL per serverless instance, so the 3 s fresh-until-moved poll across two cached regions, focus refetches, and multiple tabs share one chain read. This replaces `fresh-read-limiter.ts` and the `fresh=1` parameter (which only meant "discard the CDP pagination checkpoint"); every read is at `latest`.

Routes: `GET /api/balances` is added. `GET /api/portfolio/valuation` and `GET /api/savings/positions` are deleted in the final step once no client calls them. `GET /api/borrow` is untouched.

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

Anatomy, identical for every source: `[32 px mark] name / secondary … primary`. Cash: `[flag] US dollar … $1,234.56` (from `cashValue`). Priced asset: `[image] Aerodrome / 12.5 AERO … $18.20`. Unpriced: `[image] Foo … 12.5 FOO` (muted). Cash unavailable: `Unavailable` in destructive tone. Loading: skeleton rows from a real `loading` state, not the `"Updating…"` sentinel.

Membership rules (today's, made explicit): cash rows (canonical USD + selected local) always render, including at zero and when `unavailable`; non-cash rows render only with an authoritative positive balance — an `unavailable` non-cash registry row is **hidden** and surfaces through `coverage.registry: "partial"` → total status label, never as a wall of error rows; vault shares are never rows (they count in `total` and appear in Save via `selectVaultPositions`). Ordering: cash (selected local, canonical USD, other cash) → priced by value desc → unpriced by name → dust (< 1 cent) last. The Home teaser is the first four rows of the same order, catalog included. Formatting stays in `shared/formatting` and `valuation-format.ts`.

No 24 h change, no contract addresses, no source labels on rows (ui-direction). Rows are not tappable in this pass (they are not today).

### 7. Actions stay registry-only

Send, Save, Borrow, Trade calldata is issued for registry assets only, exactly as today. Catalog rows are visible everywhere and actionable nowhere. Extending Send to catalog ERC-20s is a separate product decision; nothing here blocks it.

## Sequencing (every integration point stays green)

Additive first, deletions last. No lane deletes something another lane's consumer still imports.

| step | owns | adds | deletes |
|---|---|---|---|
| **B0 contract** (coordinator) | `shared/balances/{types,contract,fixtures}.ts` + tests | v3 types, `parseBalancesSnapshot`, one fixture snapshot (cash positive, ETH positive, registry unpriced, registry unavailable, three vault shares with one positive, three catalog rows: priced / below-gate / price-missing) | — |
| **B1 server** (worker) | `server/balances/**`, `app/api/balances/route.ts`, `server/observability/schema.ts` route enum, `routes.contract.test.ts` entry | universe + catalog decimals check, pinned read with registry chunk 0 + hosted guard + retry, pricing incl. `cashValue`, snapshot assembly, owner-keyed coalescing; route test proves output parses with `parseBalancesSnapshot` | — |
| **B2 client** (worker, against the B0 fixture) | `shared/balances/{select,present}.ts`, `client/balances/**`, `client/home/{balances-panel,home-panel,send-availability,portfolio-home-experience,shell,shell-panels,home-types,home-experience,feature-panels}.tsx`, `client/query/{query-client,after-action}.ts`, `client/account/{cdp-authenticated-transport,cdp-client,cdp-session-lifecycle}` (additive `fetchBalances`), `client/savings/{savings-experience.tsx,portfolio-summary.ts}` (switch to selectors), `client/money-modal` availability plumbing | one hook, selectors, presenter, rows, persistence incl. catalog, after-action meta fix, Save on the shared snapshot | — |
| **B3 proof** (routine-worker, after B1+B2 integrate) | `tests/browser/smoke.pw.ts` fixtures → v3, perf marks | recognized-everywhere smoke, reload-from-cache smoke with catalog rows, one-read-per-region smoke | — |
| **B4 delete** (routine-worker, last) | `server/portfolio/{cdp-token-balances,inventory,inventory-erc20-rpc,inventory-erc20-rpc.live,recognized,recognized-rpc,valuation,valuation-handler,fresh-read-limiter}.ts` + tests, `server/morpho/position-handler.ts`, `createVaultPositionsReader`, `app/api/{portfolio/valuation,savings/positions}`, `shared/portfolio/{contract,valuation-types,present-home-balances,types,valuation-state}.ts`, `client/portfolio/**`, transport `fetchPortfolioValuation`/`fetchSavingsPositions`, `dehydrateOwnerQueries` valuation special case; docs (`portfolio.md` → this file, inventory-doc Q1 note, home-is-thin caching line) | — | ≈ 4,000 LOC |

Keep and move in B1: `recognized-catalog.ts` → `server/balances/catalog.ts`; `inventory-vault-rpc.ts` convert logic → `server/balances/read.ts`. Keep unchanged: `valuation-math.ts`, `valuation-format.ts`, `fx-coinbase.ts`, `raw-quotes.ts`, `server/chain/rpc.ts`, `MoneyTicker`, `BalanceRow`, `CurrencyMark`, asset-mark.

## Acceptance

1. **Instant paint.** Playwright: persist a v3 snapshot with cash + registry + 3 catalog rows → reload → all rows visible before the stubbed `/api/balances` responds; `balances:painted` < budget; no layout shift when the response lands with identical data.
2. **One read.** Network log across Home → Save → Balances → Home shows exactly one `/api/balances` per region per 15 s; zero `/api/portfolio/valuation`, `/api/savings/positions` after B4.
3. **One shape.** After B4, `rg "recognized|cashBuckets|nativeCashValuations|inventory.holdings" apps/web` → 0; the route contract test asserts `holdings[]` is the only balance carrier.
4. **Fail closed.** Table-driven: catalog chunk failure → registry rows untouched, failed catalog rows absent, `coverage.catalog: "incomplete"`; registry chunk failure after retry → those rows `unavailable`, `coverage.registry: "partial"`, cash rows read `Unavailable`, non-cash hidden; Codex down → registry rows `unpriced`, `coverage.catalog: "unavailable"`, total `partial`; RPC down → every registry row `unavailable`, total `unavailable`, never `"0"`; hosted + public-default RPC → registry `unavailable` + one observability event.
5. **Cash denomination.** USDC row in a DE view renders in USD; IDRX row in a US view renders in IDR; the total renders in the region currency.
6. **Consistent rows.** DOM test: a cash row, a priced catalog row, an unpriced registry row, an unavailable cash row render through one `BalanceRow`; snapshot test on `presentBalanceRows` ordering and membership (vault shares absent, zero non-cash absent, catalog present).
7. **Selectors.** Send availability from a fixture with USDC `0`, cbBTC positive, a catalog token positive → exactly `[cbbtc]` with base units; `summarizeSavingsPortfolio(selectVaultPositions(fixture))` matches today's `portfolio-summary.test.ts` expectations.
8. **Persistence.** Owner A persists → reload → catalog rows present before first fetch; owner B → cleared; post-action poll does not flip the query to memory-only.
9. `bun check` green at every step; smoke on preview; Jesse sees his own wallet's 512-universe rows on Home, Balances, and Save without a second spinner.

## Decisions taken (Jesse can veto on the issue)

1. Retire CDP Token Balances for one Multicall3 pass on the configured RPC with registry-chunk isolation and a hosted public-RPC guard (supersedes Q1 Phase A).
2. Persist catalog rows in the device cache (reverses one #337 rule).
3. Catalog rows visible in the Home teaser, Balances, and Save totals; not actionable. Send for catalog ERC-20s is a later, separate decision.

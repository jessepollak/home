# Large-wallet Investments entry

The overview derives its headline directly from the snapshot's investment total. It selects and sorts owned investments once per immutable snapshot, then derives marks and formats amounts only for the visible rows. Revealing more rows does not rebuild the full portfolio presentation. Replacing or clearing the snapshot replaces the memoized selection; there is no global private-snapshot cache.

Balance selectors and presenters reuse English, base-sensitivity collators with the same ordering as the previous `localeCompare` calls. Amount ordering remains exact bigint arithmetic, unpriced and unavailable holdings remain visible, collateral stays grouped, and pagination still reveals 20 rows at a time. The list is progressively revealed, not fully virtualized: after scrolling through many pages its mounted row count can still grow.

## Reproducible CPU comparison

Issue #1555 compared the base `593b1a9` and this change using Bun 1.3.12, five samples per operation on the same machine. The synthetic snapshot uses `buildBalancesSnapshotFixture` with 10,000 wallet holdings: addresses are zero-padded hex indices starting at 100; names are `Holding ${(i * 7919) % n}`; symbols are `T${i}`; each has 18 decimals and `1000000000000000000` units; every value is unpriced with reason `price-unavailable`. No customer data is used.

| Operation | Before median | After median |
| --- | ---: | ---: |
| `selectOwnedInvestments` | 482 ms | 16 ms |
| Full `presentBalances` | 1,100 ms | 136 ms |
| Full group presentation (now via `presentBalances`) | 775 ms | 104 ms |
| Overview preparation: total, selection, 20 marks | Previous three operations total approximately 2,357 ms | 13 ms |

The new overview no longer invokes the two full presenters. The old total is the sum of separate operation medians, not a measured browser interaction. These measurements isolate selector/presenter CPU; they exclude React rendering, browser layout, cache serialization, networking and phone hardware. They neither establish input latency nor sustained 60 fps. Deterministic tests assert equivalent presentation and that expanding the visible window does not traverse the snapshot again; wall-clock thresholds do not belong in unit tests.

## Applying the principle elsewhere

Interaction work should scale with visible content and changed data, not lifetime wallet size. Home now uses `presentHomeBalances`: totals, pending cash-out, breakdown and unsorted investment counts, with no portfolio row formatting. Counts still require linear classification of holdings; this is not a constant-time summary. Cash uses `presentCashTotal` and formats only `selectCash` entries through `presentCashSelection`, retaining the selected holding reference instead of searching the portfolio again for each cash row.

The shell keeps summary and list presentations separate. `useBalancesPresentation`, owned by `client/home/balances-panel.tsx`, builds the full list only while Balances is active and Account settings is closed. Hidden updates produce no full rows; returning derives the current snapshot. The reveal window retains its extent and the existing owner/region-scoped scroll restoration remains authoritative. Revalidation flags alone do not rebuild rows or their topology key. Home summary memoization follows snapshot/status/pending-cash-out changes, with the revalidation flag applied separately. Local snapshot replacement or clearing replaces or clears each presentation; no global owner-data cache is added.

`home/no-full-portfolio-presentation` enforces the production import boundary described in [gates](gates.md#portfolio-presentation-boundary). Focused tests also prevent Home from preparing investment labels/marks, Cash from formatting unrelated investments, and hidden or unchanged-refresh Balances panels from rebuilding rows. Lint does not establish a frame-rate budget.

Single-asset lookup still sorts the full owned list. Activity needs both bounded DOM and bounded history-processing/persistence work; row virtualization alone does not provide the latter. Hidden Cash/Savings background work beyond full-portfolio presentation is unchanged.

### Home and Cash CPU comparison

A second comparison uses the same fixture, runtime and five-sample method above, with the initial Investments/cache change as its baseline. Home compares `presentBalances` against `presentHomeBalances`; Cash compares `presentBalances(...).summary.cash` plus `presentBalances(...).groups.find(cash)` against `presentCashTotal` plus `selectCash(...).map(presentCashSelection)`. These isolate the replaced shared presentation work, excluding the remaining Cash component/savings computations and React/browser work.

| Synthetic assets | Home before | Home after | Cash before | Cash after |
| --- | ---: | ---: | ---: | ---: |
| 100 | 3.92 ms | 0.39 ms | 5.95 ms | 0.16 ms |
| 1,000 | 30.91 ms | 0.87 ms | 31.58 ms | 0.13 ms |
| 10,000 | 135.72 ms | 7.96 ms | 274.45 ms | 0.21 ms |

Use large-wallet fixtures (100, 1,000 and 10,000 assets plus long Activity history) across cold entry, warm navigation, row reveal, background refresh and owner switching. Guard against redundant computation with work-count tests, then measure actual tap/paint, long tasks and frame behavior in a production build on the supported device floor. Do not hide holdings, weaken exact arithmetic or relax owner isolation to hit a timing budget.

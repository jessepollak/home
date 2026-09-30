# Large-wallet investment navigation

The owned-investment list orders and values the full portfolio once when it is needed. Detail entry uses the focused asset selector; it does not determine list position before painting. An experience-local selection retains ordered rows while opening a detail and returning to the same snapshot. Back derives the reveal position from those same rows, which are supplied to the overview without a second sort.

The cache holds one immutable snapshot. A changed snapshot discards the prior selection, including while detail is open; ordering is deferred until the list is requested. Null/loading data clears it. Owner and region replacement therefore cannot reuse prior rows. The existing owner boundary and history/focus restoration remain in charge of navigation. No query, money calculation, wire contract, or global cache changes.

## Regression coverage

`client/investments/investments-experience.test.tsx` uses 100, 1,000 and 10,000 priced catalog holdings to verify zero valuation work for an unopened list, stable row identity and work counts across detail/Back, one selection on a new snapshot, and clearing on null, owner and region changes. These deterministic checks do not impose machine-dependent timing thresholds. Existing overview and browser investment tests cover incremental reveal, quantity precision and row focus restoration.

The existing `perf:budget` default run additionally records 100, 1,000 and 10,000 owned investments with mobile viewport and the harness CPU throttle:

- First Home → Investments entry.
- Cold direct asset entry.
- Header Back from the direct entry, with row focus.
- Warm browser Back to the retained list, with row focus.
- Home refresh through the accessible refresh control, then Investments entry with a changed snapshot.

These measurements are report-only in `results.json` (`wallets`) and `summary.md`; structural gates and existing Activity scenarios retain their existing thresholds. A default run is required; filtered and seeded gate runs skip these additional scenarios. The three standard registry investments plus added catalog assets make the stated owned-investment counts. Counts refer to the owned list, not all cash/vault holdings in the snapshot.

A fast selector or desktop browser run does not establish physical-device tap latency or 60 fps. First list sorting still scales with portfolio size. The first-entry follow-up below profiles and chunks that remaining work.

## Bounded first entry

First entry now publishes the summary immediately and displays the existing list shimmer while an experience-owned selection job runs. The selector removes the redundant wallet-only sort, computes exact sort fractions once per combined row, and indexes available wallet holdings for collateral lookup. Classification is shared with the existing investment selector; the parsed snapshot requires unique holding keys and IDs, so a cash ID cannot collide with a non-cash investment.

Collection, valuation, bounded 128-row sorts, merging and result construction yield between batches. The browser drains batches for a soft 4 ms budget, then posts another MessageChannel task so input and rendering can run. One batch or garbage collection can exceed that budget; it is not a hard frame-time guarantee. Configured, unique Borrow markets still use the existing collateral selector to preserve representative holding and collateral order. No Web Worker, snapshot cloning, new dependency or global private cache is introduced.

A job is cancelled on detail entry, snapshot replacement or unmount. Published rows are guarded by snapshot identity during render; a replacement clears the previous selection. Completed rows remain available for same-snapshot Back. Failed computation shows a retryable unavailable list instead of an empty portfolio. Back waits for rows before restoring holding focus and history scroll; the one-shot observer is removed after restoration, navigation, settings or owner/region scope replacement. It also requires the original list section to remain connected, so a DOM replacement cannot restore focus or scroll before passive-effect cleanup. During a same-scope list refresh, the pending list reserves its last measured height without retaining prior wallet rows or values; a section keyed by owner address and region clears that geometry on replacement.

### Local selector profile

Bun 1.3.12, mixed values generated as `(index * 7919) % 10007 + 1`, scale 4, with the existing large-wallet fixture. Three warmups and eleven measured runs; medians below measure selector CPU execution, without browser scheduling, rendering or network.

| Owned holdings | Prior selector | Cooperative selector | Largest individual batch across measured runs |
| --- | ---: | ---: | ---: |
| 100 | 1.88 ms | 0.52 ms | 0.67 ms |
| 1,000 | 14.29 ms | 5.62 ms | 4.35 ms |
| 10,000 | 195.05 ms | 60.68 ms | 3.74 ms |

Top-k selection would still have to value every holding before knowing the highest-valued first page. Cooperative work therefore addresses the blocking scan as well as sorting, while keeping full-list ordering and deep-link reveal behavior. A worker remains an option if device traces show a remaining problem; these results do not measure worker startup or transfer cost.

The wallet harness now waits until the Home Investments button is visible and enabled before starting first-entry/refreshed-entry timing, and ends only after a holding row is visible and two animation frames have run. This excludes initial button availability and includes actual list readiness; values are not directly comparable to the older header-only metric.

Deterministic tests bound valuation reads per batch and across 100/1,000/10,000 holdings, verify exact large-number and rounding order, and exercise cancellation, owner replacement, computation failure/retry and asynchronous Back focus/scroll. The DOM integration tests explicitly deliver observer callbacks; browser CI remains responsible for real observer delivery and rendering behavior. Physical-device tap latency and 60 fps remain unverified.

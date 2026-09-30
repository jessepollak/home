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

A fast selector or desktop browser run does not establish physical-device tap latency or 60 fps. First list sorting still scales with portfolio size. This change removes duplicate and premature work; further algorithmic changes or worker offloading require profiling the remaining cost.

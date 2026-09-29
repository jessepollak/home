# Large-wallet Investments entry

The overview derives its headline directly from the snapshot's investment total. It selects and sorts owned investments once per immutable snapshot, then derives marks and formats amounts only for the visible rows. Revealing more rows does not rebuild the full portfolio presentation. Replacing or clearing the snapshot replaces the memoized selection; there is no global private-snapshot cache.

Balance selectors and presenters reuse English, base-sensitivity collators with the same ordering as the previous `localeCompare` calls. Amount ordering remains exact bigint arithmetic, unpriced and unavailable holdings remain visible, collateral stays grouped, and pagination still reveals 20 rows at a time. The list is progressively revealed, not fully virtualized: after scrolling through many pages its mounted row count can still grow.

## Reproducible CPU comparison

Issue #1555 compared the base `593b1a9` and this change using Bun 1.3.12, five samples per operation on the same machine. The synthetic snapshot uses `buildBalancesSnapshotFixture` with 10,000 wallet holdings: addresses are zero-padded hex indices starting at 100; names are `Holding ${(i * 7919) % n}`; symbols are `T${i}`; each has 18 decimals and `1000000000000000000` units; every value is unpriced with reason `price-unavailable`. No customer data is used.

| Operation | Before median | After median |
| --- | ---: | ---: |
| `selectOwnedInvestments` | 482 ms | 16 ms |
| Full `presentBalances` | 1,100 ms | 136 ms |
| Full `presentMoneyGroups` | 775 ms | 104 ms |
| Overview preparation: total, selection, 20 marks | Previous three operations total approximately 2,357 ms | 13 ms |

The new overview no longer invokes the two full presenters. The old total is the sum of separate operation medians, not a measured browser interaction. These measurements isolate selector/presenter CPU; they exclude React rendering, browser layout, cache serialization, networking and phone hardware. They neither establish input latency nor sustained 60 fps. Deterministic tests assert equivalent presentation and that expanding the visible window does not traverse the snapshot again; wall-clock thresholds do not belong in unit tests.

## Applying the principle elsewhere

Interaction work should scale with visible content and changed data, not lifetime wallet size. Home still constructs a full balances presentation for its summary. Cash still invokes the full presenter for the cash headline and builds every money group before selecting cash rows. Reused collators help those paths now, but dedicated summary/cash selectors remain separate work. Single-asset lookup still sorts the full owned list. Activity needs both bounded DOM and bounded history-processing/persistence work; row virtualization alone does not provide the latter.

Use large-wallet fixtures (100, 1,000 and 10,000 assets plus long Activity history) across cold entry, warm navigation, row reveal, background refresh and owner switching. Guard against redundant computation with work-count tests, then measure actual tap/paint, long tasks and frame behavior in a production build on the supported device floor. Do not hide holdings, weaken exact arithmetic or relax owner isolation to hit a timing budget.

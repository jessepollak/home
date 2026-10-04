# Portfolio subscriptions and shared positions

The full `useBalances` observer serves Home's refresh indicator and interruption
observation. It must see fetch status, error/data timestamps and provisional
verification recovery. Cash, the Invest asset-position row and the savings APY
label instead use `useBalancesData`: the same owner/region query, parser, retry,
held-state rules and polling, with a narrower public result and notifications.

| Change | Full observer | Data observer |
| --- | --- | --- |
| Background fetch starts or returns identical data | Refresh/observation updates | No query-driven render |
| Balance data changes | Updated snapshot | Updated snapshot |
| Read fails with cached data | Stale snapshot and refresh error | Same stale/error semantics |
| Initial read fails | Error, no invented balance | Same error semantics |
| Provisional read fails | Suppressed failure and verified recovery | Fetch-status notifications retained while provisional failure is cached |
| Owner/sign-out/held-region change | Existing scope rules | Same scope rules |

TanStack's explicit `notifyOnChangeProps` makes this distinction local to the
observer. Query data, network deduplication and persistence remain shared. The
narrow result intentionally does not expose refresh flags or observation
metadata: a consumer needing them must use the full observer. A hidden observer
still receives changed data and errors; this is not a disabled query.

`VaultPositionsProvider`, inside PortfolioHome, shares the holdings-to-vault
positions scan between Cash and the savings APY label. It stores only the current
memoized result within that mounted component. Consumers reuse it only for the
same holdings reference, wallet address and region; standalone or mismatched
consumers derive positions locally. Snapshot freshness still reaches each
consumer independently. A stale-only snapshot wrapper can reuse positions because
positions depend on holdings, not freshness; rate/growth eligibility retains its
own freshness inputs. No derived private data is added to persistent or global
caches. React may discard this performance memo without changing correctness.

## Boundaries and evidence


This does not promise zero component renders: PortfolioHome, account context,
routing and clocks can still render descendants. Existing consumer memoization
and the shared positions result bound the repeated derivation when they do. No
whole-app render, device tap-latency or 60 fps claim follows from hook tests.

Rejected alternatives: a process-global wallet selector cache would add lifetime
and privacy complexity; another state library would duplicate TanStack's existing
observer machinery; disabling hidden queries would risk stale displays; broadly
memoizing the shell would require stabilizing unrelated routing/auth callbacks.
The scoped changes address proven subscription and repeated-selection work.

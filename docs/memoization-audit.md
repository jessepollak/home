# React memoization audit

Issue [#1571](https://github.com/jessepollak/home/issues/1571), following the portfolio work in [#1564](https://github.com/jessepollak/home/pull/1564) and performance investigation [#1118](https://github.com/jessepollak/home/issues/1118). Inventory baseline: `bad3144925a385880709533a5757d0f899bb313b` (2026-09-30 UTC). This is a source audit with targeted work-count tests and a synthetic selector benchmark, not a device frame-rate certification.

## Policy and research

Memoize pure, expensive derivations when the same immutable inputs recur, or stabilize an output whose identity controls expensive downstream work. Keep every reactive dependency. React compares dependencies with `Object.is`; a newly allocated array/object defeats reuse even if its contents match. A cache is disposable and must never carry correctness, authorization, or lifecycle responsibilities. Memoization helps repeated renders, not the initial calculation.

Do not add `useMemo` to cheap scalar expressions or every component. First remove unnecessary work: selecting one asset should not value and sort the entire portfolio. Derive render values directly instead of copying them into state with an Effect. Keep owner boundaries, query keys, stale-state checks and clock dependencies explicit. Component-local memoization does not authorize a global cache of private wallet data.

| Official reference | Applied principle |
| --- | --- |
| [React useMemo](https://react.dev/reference/react/useMemo) | Pure calculation, complete dependencies, stable inputs, measured benefit; performance optimization only. |
| [React memo](https://react.dev/reference/react/memo) | Stable props can skip parent-driven renders; context and local state still trigger renders. |
| [You might not need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | Derive values during render; avoid redundant state and extra render passes. |
| [React Compiler introduction](https://react.dev/learn/react-compiler/introduction) | Compiler memoization is a separate build capability; evaluate adoption with correctness and performance evidence. |
| [React Profiler](https://react.dev/reference/react/Profiler) | Measure render cost with a profiling-enabled build; ordinary production builds do not supply all profiling instrumentation. |
| [Oxlint exhaustive-deps](https://oxc.rs/docs/guide/usage/linter/rules/react/exhaustive-deps) | Reject dependency omissions instead of silencing invalidation. |
| [Oxlint use-memo](https://oxc.rs/docs/guide/usage/linter/rules/react/use-memo.html) and [preserve-manual-memoization](https://oxc.rs/docs/guide/usage/linter/rules/react/preserve-manual-memoization.html) | Check valid memo callbacks and preserve manual dependency contracts. |

React Compiler is not enabled by this change. The baseline Next config and dependencies do not enable it. Compiler-related lint rules do not themselves compile or memoize the app.

## Findings and dispositions

| Surface | Diagnosis | Disposition |
| --- | --- | --- |
| Activity | Paginated history rescanned timestamps on unrelated panel renders. | Memoize the oldest loaded timestamp by transfer-array identity and pending window end. |
| Balance consumers | A refresh failure recreated the stale snapshot object on observer updates, invalidating downstream calculations. | Reuse the stale snapshot while data and failure meaning stay unchanged; preserve held, provisional and owner-scoped behavior. |
| Borrow | Open loans, borrowable assets and trade candidates were repeatedly derived from the same overview. | Memoize these derivations and completeness. Bounded summary calls elsewhere remain. |
| Cash | Fresh authority objects invalidated the existing savings growth anchor on every render. | Stabilize authority by snapshot, owner and freshness; keep time-driven growth updates. |
| Invest discovery | Fresh empty defaults and catalog/search/market arrays defeated stable downstream inputs. | Use one empty default and memoize the filtered results, known assets, catalog and dynamic snapshots. |
| Asset position | Stable holdings were rescanned on unrelated detail renders. | Memoize lookup by holdings, asset id and contract address, retaining stale/unavailable gates. |
| Owned asset detail | Looking up one asset built, valued and sorted the whole investment list. | Filter to the requested key before valuation; memoize the selected row. Preserve wallet/collateral aggregation and absent/zero/unpriced behavior. |
| Savings teaser | A fresh vault-position array invalidated the existing portfolio summary memo. | Memoize positions by snapshot; retain rate freshness deadlines. |
| Chart | Comparing identical point arrays still walked every point. | Add reference fast paths while preserving asset id, range and value comparisons. |
| Home, Cash totals, investment list | Focused presenters and summary memoization already bound repeated work. | Keep existing boundaries; do not restore full-portfolio presentation on summary surfaces. |
| Account, owner fences, money actions | Memoized providers and lifecycle state carry sensitive identity/authority semantics. | Keep ownership contracts; no speculative removal or global caching. |
| Cards, navigation, currency sheet, UI contexts, QR and globe | Existing memoization stabilizes consumer inputs or nontrivial derivations. | Keep existing calculations and complete dependencies; no blanket rewrite. |

## Inventory coverage

The baseline contains 391 tracked `.ts`/`.tsx` files under `apps/web/{app,client,components}`, excluding tests, specs, stories and `explorations`. Excluding `app/dev/ui/page.tsx`, `client/savings/savings-dialog-fixture.tsx`, `client/account/smoke-fixture-provider.tsx` and `client/account/dom-test-harness.ts` leaves 387 production files: 173 TSX and 205 TSX-or-React-import modules. Existing `useMemo` calls, including generic calls, occur in 40 production files (85 calls). This inventory locates review scope; it does not mean every route was profiled in a browser.

The original source pass was supplemented after integrating current main, including Cards, the Cash currency sheet, navigation and chart query-state changes. Files without memoization were checked for repeated collections/derivations and downstream identity boundaries; cheap calculations and lifecycle state were left alone. Existing memo sites are listed below for reproducibility.

| Baseline file relative to `apps/web` | Calls |
| --- | ---: |
| `client/account/cdp-sdk-provider.tsx` | 3 |
| `client/account/cdp-session-lifecycle.tsx` | 1 |
| `client/account/composite-account-provider.tsx` | 3 |
| `client/account/native-base-bridge.tsx` | 2 |
| `client/account/owner-generation-fence.ts` | 1 |
| `client/actions/money-action-outcome.ts` | 1 |
| `client/activity/activity-ledger.tsx` | 5 |
| `client/activity/activity-panel.tsx` | 2 |
| `client/activity/use-activity.ts` | 2 |
| `client/activity/virtual-activity-list.tsx` | 1 |
| `client/balances/pending-cashout.ts` | 2 |
| `client/balances/use-balances.ts` | 1 |
| `client/cards/use-cards.ts` | 2 |
| `client/cash/cash-currency-sheet.tsx` | 1 |
| `client/cash/cash-experience.tsx` | 9 |
| `client/cash/cash-overview.tsx` | 7 |
| `client/funding/funding-experience.tsx` | 1 |
| `client/funding/receive-qr.tsx` | 2 |
| `client/home/balances-panel.tsx` | 2 |
| `client/home/portfolio-home-experience.tsx` | 6 |
| `client/home/shell.tsx` | 3 |
| `client/invest/asset-chart.tsx` | 2 |
| `client/invest/priced-invest-experience.tsx` | 1 |
| `client/invest/use-invest-discover.ts` | 1 |
| `client/invest/use-invest-search.ts` | 2 |
| `client/invest/use-market-prices.ts` | 1 |
| `client/investments/investments-experience.tsx` | 1 |
| `client/investments/investments-overview.tsx` | 2 |
| `client/landing/supported-globe.tsx` | 4 |
| `client/liquid-glass/nav-lens.tsx` | 3 |
| `client/money-modal/money-modal.tsx` | 1 |
| `client/savings/use-savings-rate-label.ts` | 1 |
| `client/time/use-now.ts` | 1 |
| `client/transfers/send-dialog.tsx` | 1 |
| `components/app-chrome.tsx` | 1 |
| `components/primary-navigation.tsx` | 2 |
| `components/ui/coverage-table.tsx` | 1 |
| `components/ui/drawer.tsx` | 1 |
| `components/ui/field.tsx` | 1 |
| `components/ui/toggle-group.tsx` | 1 |

## Guardrails and regression evidence

The existing Oxlint configuration already enforces hooks placement, dependencies, purity, immutability and valid memo callbacks, with warnings failing the production lint command. The new real-config canaries execute that actual configuration and prove that missing dependencies and async memo callbacks fail while complete dependencies and cheap direct expressions pass. No ESLint dependency, parallel config, or blanket "memoize everything" rule is added.

Static rules cannot infer arbitrary function cost or detect every unstable cross-hook identity. Behavioral tests therefore count actual work across unchanged renders and changed inputs: Activity timestamp reads, stale balance snapshot identity, Cash anchor creation, asset holding lookup, owned-detail selection and Savings position reads. Selector tests compare focused rows against full-list rows across collateral, unreadable and unpriced cases, and ensure unrelated valuations are never touched. The previous focused-presenter Oxlint boundary remains intact.

## Synthetic selector benchmark

One warm-up and seven samples per operation, reporting the median in one Bun 1.3.12 process. Each snapshot has the listed number of additional priced catalog holdings; the selected asset is last. The comparison is full `selectOwnedInvestments(snapshot).find(...)` versus focused `selectOwnedInvestment(snapshot, key)` on the same inputs.

| Added catalog holdings | Full list then lookup | Focused lookup |
| ---: | ---: | ---: |
| 100 | 1.184 ms | 0.022 ms |
| 1,000 | 21.689 ms | 0.071 ms |
| 10,000 | 90.455 ms | 0.595 ms |

These are synthetic CPU measurements, not browser interaction latency or FPS. Reproduce from `apps/web`:

```sh
bun -e '
import { buildBalancesSnapshotFixture, walletHolding, priced } from "./shared/balances/fixtures";
import { selectOwnedInvestment, selectOwnedInvestments } from "./shared/balances/owned-investments";
function median(run) {
  run();
  const samples = Array.from({ length: 7 }, () => {
    const start = performance.now(); run(); return performance.now() - start;
  });
  return samples.sort((a, b) => a - b)[3];
}
for (const count of [100, 1000, 10000]) {
  const catalog = Array.from({ length: count }, (_, i) => walletHolding({
    address: `0x${(i + 100).toString(16).padStart(40, "0")}`,
    name: `Token ${i}`, symbol: `T${i}`, decimals: 18,
  }, "1000000000000000000", priced("USD", String(i * 100))));
  const snapshot = buildBalancesSnapshotFixture({ catalog });
  const key = catalog.at(-1).key;
  console.log({ count,
    fullMs: median(() => selectOwnedInvestments(snapshot).find(row => row.key === key)),
    focusedMs: median(() => selectOwnedInvestment(snapshot, key)),
  });
}'
```

## Remaining measurement and recommendations

1. Follow [device performance profiling](device-profiling.md) with production fixtures and a high-activity, high-asset wallet. Measure tap-to-visible feedback, long tasks and frame timing separately; low selector time alone does not prove 60 fps.
2. Profile chart pointer movement and geometry: nearest-point and geometry work can remain O(n). Keep moving time-window and stale-price semantics when optimizing them.
3. Measure subscription fan-out and unnecessary React commits before introducing broader component memoization. Stabilizing producer outputs often helps more consumers than wrapping individual children.
4. Evaluate React Compiler separately against the owner/freshness suites and measured device workloads.

Browser verification remains a named limitation for this audit: the pinned browser preflight was attempted, but Chrome was unavailable and the Chrome-for-Testing download endpoint could not be reached successfully. No live or funded action was performed. Current-head check results and independent review findings belong in the PR Evidence; historical checks are not a substitute for verification after integration.

# Chromium smoke: failure diagnosis and two-minute budget

Measured 2026-10-01 against main `93290a1` ([CI run 36815963017](https://github.com/jessepollak/home/actions/runs/36815963017)) and the balance-cache PR ([CI run 36819334935](https://github.com/jessepollak/home/actions/runs/36819334935)). These are fixture jobs, not hosted-preview or production latency measurements.

## Baseline

| Cost | Main run | Balance-cache PR run |
| --- | ---: | ---: |
| Whole Chromium job | 15m 16s | 12m 28s |
| Checkout, runtimes, dependencies, browser | ~35s | ~49s |
| Playwright step | 14m 38s | 11m 36s |
| Sum of test attempts | 13m 38s | See retained attempt report |
| Playwright startup, admin warm-up and other runner overhead | ~58s | Included in step |
| Retry attempts within main's test sum | ~31s | Included in step |
| Declared cases | 205 | 205 |
| Main outcomes | 195 passed, 2 failed, 8 skipped | 194 passed, 3 flaky, 8 skipped |

The attempt sum is useful because the old suite used one worker. The ~58s residual is not all compilation: it also includes process startup, global setup, scheduling and browser/trace teardown. No production build runs in this job; blaming a build would be incorrect.

| Main test family | Attempt time | Attempts | Assessment |
| --- | ---: | ---: | --- |
| Shell pages | 156s | 49 | Seven-page overlay/account products repeat shared shell behavior. |
| Routing | 92s | 16 | Distinct history, hydration, focus and breakpoint regressions, beyond a smoke gate. |
| Cash | 75s | 16 | Detailed focus, chunk-loading, conversion and keyboard coverage. |
| Admin | 68s | 7 | Two long multi-section boundary journeys plus failed navigation retries. |
| Navigation geometry | 42s | 15 | Layout/gesture regression matrix. |
| Mobile geometry | 36s | 6 | Detailed browser geometry, already separate from logical unit coverage. |
| Feature-map replay | 30s | 20 | Includes a unit-level inventory assertion and eight bookkeeping skips. |
| Remaining families | ~219s | 72 | Money journeys, cache, activity and scrolling behavior. |

## Failures

- **Funding settings:** the authenticated leaf reads cookies through `readOperatorPageDecision` but did not declare `instant = false`. Its layout's opt-out does not opt out descendant segments. A cold local run reproduced Next's blocking-runtime validation error for this leaf. Set the same leaf-level configuration as the other authenticated operator pages; keep cookie verification and authorization on every request. Cold tracing also exposed a separate readiness race: the operator shell refreshes authentication on mount, which can cancel a link navigation clicked before that refresh completes. The test waits for a readiness attribute set after the existing refresh finishes; authorization and refresh behavior are unchanged. With readiness fixed, the cold route response completed successfully in 5.09s, just beyond the generic 5s DOM assertion deadline. This single URL assertion allows 10s for dev compilation within the unchanged 75s suite budget. The existing link-navigation browser test remains in smoke.
- **IDRX funding:** sign-in calls `window.location.replace('/home')`. Seeing `/home` does not mean the replacement document has hydrated. Failed CI traces show Add money clicked, then no sheet and no deposit-method control. The test now waits for the existing `session:verified` client mark before clicking; it still completes the OTP, quote, payment-instruction and receipt journey. The mark is a test readiness precondition, not a new product delay.
- **Varying retry-only failures:** the comparison PR run failed on cold Savings focus, IDRX and hidden Activity polling. These are reported separately from the two persistent failures above. Reducing duplicate cold loads, eliminating continuous video encoding, removing unrelated warm-up and bounding the smoke workload reduces contention. A retry-only pass still fails CI. This change does not claim every detailed regression flake is fixed.

## Changes and coverage

`test:browser-smoke` selects 15 tagged cases. It checks deployment access and rejection, OTP sign-in, shell/history and one balances read, SSR/hydration, cached balances before verification and Borrow navigation, Savings deposit/withdraw review, Cash focus restoration, Buy review through Invest, partial/full Sell review, Send retry/dispatch/reload, IDRX funding through receipt, currency conversion review, immediate Back/Forward scroll preservation, and the operator funding-settings link. Existing unit, story, SQL and PostgreSQL checks continue unchanged.

42 expanded cases are removed:

| Removed coverage | Count | Retained stronger coverage |
| --- | ---: | --- |
| Send overlay repeated once on each shell page | 7 | One representative overlay case plus full Send journey and shell routing/history cases. |
| Add money, Receive, resumed Send and Account repeated across seven parents | 24 | One representative case for each shared overlay; Cash origin/focus, scrolled-close and desktop focus regressions remain. |
| Savings deep-link open/close-only cases | 2 | Prepared deposit/withdraw review and management/focus/late-chunk regressions. |
| Feature-map inventory assertion and manual-disposition skips | 9 | Existing feature-map unit inventory/parser tests; actual surface journeys remain. |

The remaining distinct browser regressions run with `bun run --cwd apps/web test:browser-regression`, including smoke. The **Browser regressions** workflow can run that suite on demand. They no longer run on every PR/main push. This is an explicit tradeoff: a regression outside the selected journeys is found by its unit/story check, a targeted regression run, or manual full regression, rather than every smoke run.

The fast suite uses two workers, no admin global warm-up, one diagnostic retry, failure screenshots and retained failure traces. Traces still record attempted actions and DOM/network evidence; continuous video encoding is removed. CI installs the pinned Chromium headless shell only. Successful runs also retain JSON test timings. The existing required check name remains **Chromium smoke**.

## Runtime budget and remaining options

The first 13-case local CI-mode run passed without retries in 46.0s including Playwright server startup, using a previously compiled local Next dev cache. That is not a cold GitHub-runner result. The final 15-case local run passed without retries in 42.4s, again with the previously compiled local dev cache. A cold-cache run and hosted job measurement belong in PR evidence before claiming the complete-job target achieved.

The target is the complete Chromium job, not all CI or queue time. Playwright has a 75s global timeout in CI smoke; the job checks elapsed time before artifact upload against 110s, leaving 10s for artifact upload and cleanup. A three-minute Actions timeout is only a last-resort kill, not acceptance. Queue time and extreme artifact/upload delay remain outside a deterministic runtime guarantee.

| Option | Expected effect | Decision |
| --- | --- | --- |
| Small essential suite, two workers | Removes most of the ~13m serial workload | Implemented; measure cold hosted runtime. |
| Delete duplicate matrices | Removes ~100s of old full-suite work and repeated flake opportunities | Implemented, with retained behavior mapping above. |
| Install only headless shell; remove video encoding | Less download and per-context recording work | Implemented; no browser-version change. |
| Browser/dependency caches | At most tens of seconds; cache transfer may rival the 6s dependency install | Not necessary for the first measured target; add only if setup dominates hosted results. |
| More workers or sharding the entire suite | ~818s / 2 = 409s before setup; cannot reach two minutes by itself | Keep detailed regressions separate; avoid aggressive CPU contention. |
| Longer retries/global timeouts or accepting flaky passes | Adds delay or turns an intermittent failure green | Not used; one route URL assertion allows measured cold compilation, while suite budget and flaky rejection remain strict. |
| Production build for every smoke job | Better fidelity, but adds a build to the critical path | Keep the existing production-navigation/performance checks for now. |
| Reusable build artifacts or fixture-only Vite entry | Could remove Next cold-compilation variance | Follow-up only if cold hosted smoke misses the budget; preserve a separate Next SSR/auth contract. |

Do not grow smoke by appending every bug fix. Keep a new case at the lowest layer that observes the bug; tag a browser case only for an essential journey or browser-only contract, replacing/consolidating smoke coverage when its budget is full. The runtime budget catches cumulative growth, while the manual suite keeps detailed browser diagnostics available.

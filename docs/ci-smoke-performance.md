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

- **Funding settings:** the authenticated leaf reads cookies through `readOperatorPageDecision` but did not declare `instant = false`. Its layout's opt-out does not opt out descendant segments. A cold local run reproduced Next's blocking-runtime validation error for this leaf. Set the same leaf-level configuration as the other authenticated operator pages; keep cookie verification and authorization on every request. Cold tracing also exposed a separate readiness race: the operator shell refreshes authentication on mount, which can cancel a link navigation clicked before that refresh completes. The test waits for a readiness attribute set after the existing refresh finishes; authorization and refresh behavior are unchanged. With readiness fixed, the cold route response completed successfully in 5.09s, just beyond the generic 5s DOM assertion deadline. Route-arrival assertions use the shared 15s navigation budget in `apps/web/tests/browser/fixtures/navigation-budget.ts` for dev compilation and loaded machines within the unchanged 75s suite budget. The existing link-navigation browser test remains in smoke.
- **IDRX funding:** sign-in calls `window.location.replace('/home')`. Seeing `/home` does not mean the replacement document has hydrated. Failed CI traces show Add money clicked, then no sheet and no deposit-method control. The test now waits for the existing `session:verified` client mark before clicking; it still completes the OTP, quote, payment-instruction and receipt journey. The mark is a test readiness precondition, not a new product delay. The deferred Add money dialog now waits with the shared navigation budget before its method assertion.
- **Varying retry-only failures:** the comparison PR run failed on cold Savings focus, IDRX and hidden Activity polling. These are reported separately from the two persistent failures above. Reducing duplicate cold loads, eliminating continuous video encoding, removing unrelated warm-up and bounding the smoke workload reduces contention. CI retains one diagnostic retry; a retry-only pass no longer fails the required smoke check and instead receives a warning annotation on the failing file and a record in the uploaded timings artifact. Any test that fails after its retry still fails the job, while the on-demand regression command keeps strict `failOnFlakyTests` rejection. This change does not claim every detailed regression flake is fixed.

The signed-in shell exposes `data-hydrated` on its root after mount; the account-settings appearance case waits for it before acting on the radio group, while page-content controls keep their own enabled or dialog readiness.

### Retry-only pass policy

Four required-check failures in 60 runs each reported `0 unexpected, 1 flaky`; the affected runs spanned four unrelated branches, with three failures within 15 minutes. Four different specs failed on focus, scroll and polling timings, with a near-timeout in the same window: the shared loaded runner is the common factor, and the flakes move between specs. The suite has fixed 75-second global and 110-second job budgets, so per-spec or machine-relative budgets would not make the gate deterministic. The required smoke gate therefore accepts retry-only passes with warning annotations and uploaded timing records; tests that fail after their retry still fail the job, and on-demand regression retains strict rejection.

## Changes and coverage

`test:browser-smoke` selects 9 tagged cases. It checks deployment access and rejection, OTP sign-in, Savings deposit review, Buy review through Invest, partial/full Sell review of an exact Base address, Send retry/dispatch/reload, IDRX funding through receipt and the pre-hydration Add money redirect, the mobile account export download, and the operator funding-settings link. Eight additional detailed journeys (Cash focus, conversion, sign-in destination, three-route SSR replay, Savings withdrawal review, immediate scroll/Forward, cached balances/Borrow, and detailed shell/history) remain in the 163-case regression suite. They overlap shared flow primitives or extend the smoke contract into detailed regression coverage. Existing unit, story, SQL and PostgreSQL checks continue unchanged.

42 expanded cases are removed:

| Removed coverage | Count | Retained stronger coverage |
| --- | ---: | --- |
| Send overlay repeated once on each shell page | 7 | One representative overlay case plus full Send journey and shell routing/history cases. |
| Add money, Receive, resumed Send and Account repeated across seven parents | 24 | One representative case for each shared overlay; Cash origin/focus, scrolled-close and desktop focus regressions remain. |
| Savings deep-link open/close-only cases | 2 | Prepared deposit/withdraw review and management/focus/late-chunk regressions. |
| Feature-map inventory assertion and manual-disposition skips | 9 | Existing feature-map unit inventory/parser tests; actual surface journeys remain. |

The remaining distinct browser regressions run with `bun run --cwd apps/web test:browser-regression`, including smoke. The **Browser regressions** workflow can run that suite on demand. They no longer run on every PR/main push. This is an explicit tradeoff: a regression outside the selected journeys is found by its unit/story check, a targeted regression run, or manual full regression, rather than every smoke run.

The hosted 15-case trial exceeded the 75s suite budget. The 7-case selection removed eight detailed/overlapping gate journeys while preserving them in regression; the suite has since grown to the 9 cases above, and the budget decision below supersedes the 75s and 110s figures recorded in this document's earlier history.

The fast suite uses two workers and serial HTTP compilation of `/admin`, `/admin/settings/funding`, and `/cash/savings` before workers start. This avoids concurrent first-navigation compilation; it uses isolated fixture cookies, rejects redirects/non-200 responses, disposes the request context, and remains inside the same global/job budgets. The broad admin browser warm-up is reserved for regression. Smoke keeps one diagnostic retry, failure screenshots and retained failure traces. Traces still record attempted actions and DOM/network evidence; continuous video encoding is removed. CI installs the pinned Chromium headless shell only, using Chromium shared libraries already provided by the Ubuntu hosted image. Successful runs also retain JSON test timings. The existing required check name remains **Chromium smoke**.

## Runtime budget and remaining options

A 9-case isolated empty-cache run passed without retries in **51.9s**, including server startup and serial compilation: funding settings 4.4s, Borrow 10.5s, Savings 3.0s. Hosted trials without serial compilation exposed pending cold RSC requests beyond even 10s URL deadlines. Reducing test count alone did not fix this contention; compiling the two navigation targets before workers removes that competition without excluding the time from the budget. The 9-case hosted trial passed in 57.1s for Playwright and 80s for the complete job, but a slower subsequent runner exceeded the 75s suite cap without a flake. Seven core bank journeys provide more headroom: access, operator settings, funding/sign-in, deposit, Buy, Sell, and Send. Cache-performance and detailed shell/history contracts remain in regression. Final-head hosted measurement belongs in PR evidence before claiming the final target achieved.

The target is the complete Chromium job, not all CI or queue time. Playwright has a 90s global timeout in CI smoke (raised from 75s on 2026-10-02); the job checks elapsed time before artifact upload against 125s, leaving 10s for artifact upload and cleanup. A three-minute Actions timeout is only a last-resort kill, not acceptance. Queue time and extreme artifact/upload delay remain outside a deterministic runtime guarantee.

| Option | Expected effect | Decision |
| --- | --- | --- |
| Small essential suite, two workers | Removes most of the ~13m serial workload | Implemented; measure cold hosted runtime. |
| Serial compilation of three cold navigation targets | Prevents workers racing over Next dev compilation; compile time counts inside the global and job budgets | Implemented; no cross-run cache needed. |
| Delete duplicate matrices | Removes ~100s of old full-suite work and repeated flake opportunities | Implemented, with retained behavior mapping above. |
| Install only headless shell; remove video encoding | Less download and per-context recording work | Implemented; no browser-version change. |
| Avoid redundant apt installation on hosted Ubuntu | First hosted install spent ~49s on apt metadata, unrelated font downloads and graphics-library upgrades; browser download was ~2s | Implemented: use existing shared libraries; missing dependencies still fail browser launch. |
| Browser/dependency caches | At most tens of seconds; cache transfer may rival the 6s dependency install | Not necessary for the first measured target; add only if setup dominates hosted results. |
| Turbopack development cache | 2026-10-14: 13 of 39 runs failed on the 90s timeout with no failing test; passing cold runs took 58–89s. A restored ~800 MB cache (7s download) cut serial compilation from ~20s to ~2s and the suite to 48–67s ([PR #2145](https://github.com/jessepollak/home/pull/2145)). | Implemented: saved on `main` only; restore prefers the same `bun.lock` and falls back to the newest cache so dependency-update PRs are not cold. Each `main` push writes a new entry; old entries leave through the 7-day/10 GB eviction. Watch entry size in the restore log. |
| More workers or sharding the entire suite | ~818s / 2 = 409s before setup; cannot reach two minutes by itself | Keep detailed regressions separate; avoid aggressive CPU contention. |
| Accepting retry-only passes in the required gate | A loaded shared runner no longer reddens a required check for a defect the pull request did not introduce | Adopted for the required smoke gate only; the flaky case is annotated and recorded, a test that fails after its retry still fails the job, and the on-demand regression command keeps strict rejection. |
| Production build for every smoke job | Better fidelity, but adds a build to the critical path | Keep the existing production-navigation/performance checks for now. |
| Reusable build artifacts or fixture-only Vite entry | Could remove Next cold-compilation variance | Follow-up only if cold hosted smoke misses the budget; preserve a separate Next SSR/auth contract. |

## Budget decision (2026-10-14)

**Keep the 90s Playwright `globalTimeout` and the 125s job budget.** The headroom target is a warm-cache median at least 10s under the 90s cap (a rolling median of 80s or less); the measured warm median is 47.5s, 42.5s under the cap. No case is removed, no budget is raised, and the suite is not sharded.

The follow-up that prompted this decision measured nine runs at 57.8–89.2s. Those runs had no Turbopack cache. The cache ([PR #2145](https://github.com/jessepollak/home/pull/2145)) is saved on every `main` push and restored by every later job, which cut the suite from the cap to about 47s. The 90s cap is therefore only close for a job that misses the cache.

| Run | Event | Turbopack cache | Process duration | Budget step (before upload) | Whole job |
| --- | --- | --- | ---: | ---: | ---: |
| 38631757078 | `main` | hit | 43.7s | not logged | 84s |
| 38631731717 | `main` | hit | 52.5s | not logged | 91s |
| 38631389027 | `main` | hit | 53.5s | 83s | 99s |
| 38631230812 | `main` | hit | 65.4s | 92s | 105s |
| 38631213894 | `main` | hit | 43.1s | 66s | 76s |
| 38630677105 | `main` | hit | 46.3s | 68s | 78s |
| 38627850331 | pull request | hit | 47.3s | 73s | 78s |
| 38609989868 | pull request | hit | 47.7s | 78s | 92s |
| 38630427531 | `main` | miss | 53.0s | 69s | 79s |
| 38628601251 | pull request | miss | 87.9s | 109s | 116s |
| 38628143724 | pull request | miss | 85.9s | 107s | 113s |

"Process duration" is the `Smoke totals: … ms elapsed` line; "Budget step" is the `Enforce smoke job budget` output. All eleven runs passed with 9 expected cases, 0 flaky and 0 unexpected.

| Population | Runs | Median process duration | Range | Timeouts at 90s |
| --- | ---: | ---: | ---: | ---: |
| Warm cache (restored from a `main` entry) | 8 | 47.5s | 43.1–65.4s | 0 |
| No cache (this table's three misses plus 34 earlier runs from 17:32–20:07 UTC on 2026-10-14) | 37 | 85.9s | 53.0–90.0s | 9 |

The 34 earlier runs (no cache step existed; run id, process duration): 38629363718 88.4s, 38629056304 88.0s, 38625605182 89.2s, 38625255698 59.6s, 38624118906 90.0s (timeout), 38623865756 71.0s, 38622200409 84.6s, 38621979718 62.2s, 38620450640 88.0s, 38620418312 63.3s, 38619973567 72.5s, 38619079202 87.1s, 38617651077 88.3s, 38616265849 90.0s (timeout), 38615585368 71.2s, 38615141413 90.0s (timeout), 38614883408 70.3s, 38614631880 87.6s, 38613474091 73.8s, 38612872716 82.3s, 38612622059 62.3s, 38612217399 90.0s (timeout), 38611246975 74.8s, 38611105593 90.0s (timeout), 38610962833 90.0s (timeout), 38610869062 90.0s (timeout), 38609899081 85.4s, 38609152882 68.4s, 38609000961 62.2s, 38608652886 88.3s, 38608517157 81.0s, 38608169134 90.0s (timeout), 38608062866 66.3s, 38607547244 90.0s (timeout).

Warm whole-job elapsed was 76–105s (median 87.5s) against the 125s budget. Passing jobs without the cache ran 79–119s. The 9 timeouts were jobs with no failing test.

Revisit when any of these holds, in this order of preference: (1) a rolling median of ten warm runs exceeds 80s, so consolidate or move cases to `test:browser-regression` before raising any budget; (2) the cache stops restoring on pull requests (the `Record Turbopack cache status` step logs `hit|miss` on every non-cancelled run), so fix the cache first; (3) cold runs keep failing after a cache eviction, so shard the suite into two jobs with separate budgets. Raising the timeout is the last option: it hides growth instead of removing it.

| Option | Decision |
| --- | --- |
| Consolidate or trim the nine cases | Rejected for now: the warm median has 42.5s of headroom, and each trimmed case moves a browser-only contract out of the required gate. |
| Raise the global timeout and job budget again | Rejected: warm runs do not need it, and the cap is the signal that cumulative growth is back; a larger cap would let the warm median drift toward it unnoticed. |
| Shard into two jobs with separate budgets | Deferred to trigger (3): doubles the install, browser download and cache restore for a median that is not near the cap. |
| Move more coverage to `test:browser-regression` | Deferred to trigger (1). |

Do not grow smoke by appending every bug fix. Keep a new case at the lowest layer that observes the bug; tag a browser case only for an essential journey or browser-only contract, replacing/consolidating smoke coverage when its budget is full. The runtime budget catches cumulative growth, while the manual suite keeps detailed browser diagnostics available.

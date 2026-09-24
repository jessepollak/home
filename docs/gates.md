# Repository gates

`bun run gates` runs the repository gate unit tests, and `bun check` runs that plus the rest of the checks. All of it runs without provider or funded-wallet secrets. The gates guard six invariants:

- Migrations run before build, so a build cannot ship a schema it never applied.
- No unresolved CSS custom properties, so every referenced token resolves in the theme.
- No comments in CSS or Python under the five product layers beyond a third-party notice header and Python functional lines (shebang, encoding declaration, `# type:`/`# noqa`), so the [comment policy](architecture.md#comment-policy) covers the source formats Oxlint cannot parse.
- Every `process.env` read is declared in `.env.example`, so a clone knows which variables it needs.
- No personal-email literal in the live-login/Gmail helpers, fixture-session helper, `docs`, or `.agents`, so the bot mailbox stays runtime configuration (`HOME_VERIFY_ACCOUNT_EMAIL`) instead of a committed address.
- Custom lint rules are non-vacuous, proven against temporary-mirror fixtures rather than a clean source tree.

The full check suite also covers:

- `bun check` (including Oxlint-only lint with warnings denied, unused suppressions reported, and the Knip production dead-code gate)
- Chromium product smoke
- story tests (`bun run --cwd apps/web test:stories`)
- `bun run gates` (the repository gate unit tests above, including commit provenance; also run inside `bun check`)
- disposable PostgreSQL contracts for actions, funding (including encrypted user-token storage), and balances
- the **Code Connect templates** step in the `bun check` job (`bun run --cwd apps/web figma:connect:parse`), which parses every `*.figma.ts` template offline

On pushes to `main`, the `publish Code Connect` and `sync Figma variables` jobs publish templates and tokens to Figma. They run only when the `FIGMA_ACCESS_TOKEN` secret is set and otherwise skip without failing ([Figma workflow](design-explorations/figma-workflow.md#source-of-truth)).

## Dead-code boundary

The **Dead code (knip)** CI step runs `bun run --cwd apps/web knip`, and `bun check` runs the same production-mode gate. A replacement change deletes the component, hook, or module it replaces in the same PR. New deliberately public exports carry a one-line `/** @public <reason> */` JSDoc. Design-lane non-production code stays inside a `*.stories.*` file or under `**/explorations/**`; temporary deferrals for #686 and #687 are listed explicitly in `apps/web/knip.json`.

## Surface verification boundary

Use the repository-pinned `agent-browser` directly for [fixture and live browser validation](browser-validation.md). The [feature map](../.agents/skills/browser-iteration/feature-map.md) supplies Reach guidance; agents report observed facts and screenshots under PR evidence rules. Playwright remains the only committed automated browser regression layer.

Each surface declares machine-readable **Owned paths**. The `verification-evidence` CI step maps the pull-request diff to those paths and checks the PR's `## Verification` table for every affected surface, its required rung, an evidence pointer, and incidents, plus a `Verified: <surface> rung <n>` or `Not verified: <surface> rung <n> — <reason>` line for each mapped surface at its required rung. Read-only changes require Rung 1, money-client changes require Rung 2, and action/calldata/confirm-step changes on confirm surfaces require Rung 3. The step is soft (`continue-on-error`) while the map is calibrated. A follow-up PR makes it hard after three consecutive mapped pull requests report no false-positive surface or rung; until then, a failure is a required handoff finding but does not block CI.

## Browser-test ladder boundary

The **Playwright rung** and **Test weight** CI steps compare `origin/<BASE_REF>...HEAD` with the pull-request body and title. A positive net count across all `apps/web/tests/browser/**/*.pw.ts` files of added minus removed `test(` or `test.describe(` declaration lines (including nested calls) requires a `Playwright-rung: <rung>` PR-body line, with a rung of `layout`, `scrolling`, `focus`, `history`, `persisted-state`, `media-query`, `hydration`, `dispatch`, or `journey`. Renaming or restructuring existing tests across browser files without a net-new declaration does not trigger the rung. A scoped `fix(...)` title whose added test lines exceed added plus deleted product source lines under `apps/web` requires `Test-weight: <reason>` in the PR body, except when the product line count is zero (not applicable). Test lines include everything under `apps/web/tests/**` and `apps/web/oxlint/tests/**`, any `*.stories.*`, `fixture.*`/`fixtures.*`, or `*.test.mjs` file, and `*.test.ts`, `*.test.tsx`, or `*.pw.ts` files. Product source excludes test/story files but includes non-test source such as `apps/web/live-login.ts`. No status-derivation or amount-parsing path exemption is encoded: there is no unambiguous path convention for those behaviors, so use the reason line when they trigger. The steps check the declaration, not whether a proposed rung or reason is persuasive; review still owns that judgment.

The **Playwright rung** step is hard (no `continue-on-error`): #779 (net zero), #757 (three net-new Playwright tests), and #784 (a file move) supplied three consecutive correct applicable outcomes. **Test weight** remains soft (`continue-on-error`) during calibration; both steps append their own counts and findings to the CI run summary. Test weight becomes hard after three consecutive applicable pull requests report no false-positive test/product count; until then, a weight failure is a required handoff finding but does not block CI. The zero-product exemption and counting verify source as product are calibration changes, not a threshold change. The six `bun run gates` invariants above are unchanged because these checks read PR metadata in CI rather than running in `bun check`.

## Story-test boundary

The **story tests** job runs every Storybook story in headless Chromium through `@storybook/addon-vitest` for every pull request and every push to `main`. It executes each story's `play` function — a failing `play` fails the job — and runs the a11y addon's audit. The audit reports findings rather than failing the job globally (`a11y.test: "todo"`) because owned components carry pre-existing violations that need a product decision; minimal workshop stories that are audit-clean opt into `a11y.test: "error"`. The job is not part of `bun check`, so run `bun run --cwd apps/web test:stories` directly for story or owned-component changes and stop a running `storybook dev` first (shared Storybook Vite cache).

## Fix-commit provenance

The repository gate checks commits after the pull request branch's merge-base with `main`; outside a pull request it checks `HEAD`. Every scoped `fix(...)` subject must name exactly one detector in its commit body with one of these trailers: `Caught-by: lint`, `Caught-by: bot`, `Caught-by: review`, `Caught-by: browser`, or `Caught-by: production`. Identical trailers count once, because a squash merge concatenates every inner commit's body and a multi-commit fix PR repeats the same detector once per commit; two different detectors in one body still fail, as does none. Earlier commits on `main` are grandfathered.

## Caught-by report

`bun run caught-by-report` (or `node scripts/gates/caught-by-report.mjs`) aggregates the `Caught-by` trailers from scoped `fix(...)` commits into a detector report. It defaults to `--since 30.days` on the current branch, accepts `--range <a..b>`, and prints JSON with `--json`. It is a report, not a gate: it always exits 0, so a broken or empty corpus never fails a build.

The report has three parts. **Detectors** counts every scoped fix commit by its `Caught-by` value and shows each detector's share. Identical trailers dedupe to one value (`browser`, `browser` counts as `browser`); a squash-merged body with two or more distinct values counts as `mixed`, which is what multi-commit fix PRs look like on `main`; no trailer counts as `unknown`. Fixes that do not descend from the trailer policy start (`226d2f26`, #709, 2026-09-21) are marked pre-policy and excluded from the detector and scope statistics, with the count stated in the report header. **By scope** breaks the same counts down by the `fix(<scope>)` token. **Rule candidates** lists every `review`, `bot`, and `production` fix with its sha, subject, and files touched; each row is a rule candidate for the gardener to triage under the [rule-first policy](operating-manual.md#delivery-loop), because a `home/*` lint rule could have caught it. The report caps the candidate list at 50 rows with 10 files each and truncates its body at 60,000 characters.

The **caught-by report** CI job writes the pull-request-range report to the run summary, and the **Caught-by weekly** workflow posts the trailing 7-day report as a comment on the open `Caught-by weekly report` issue, creating one when no open issue exists and pinning it when possible. Both are informational; neither fails a build.

## Browser-smoke boundary

The current **Chromium smoke** job runs the per-surface fixture-backed Playwright suite (`apps/web/tests/browser/*.pw.ts`, with shared responses under `fixtures/`) in GitHub Actions for every pull request and every push to `main`. It starts a CI-local fixture server; it does not exercise the hosted Vercel preview deployment.

The Jesse-locked [architecture](architecture.md#quality-bar) targets Playwright smoke on every hosted preview. That hosted-preview smoke target is not implemented yet; current PR/main fixture smoke must not be described as hosted-preview verification.

Deployment configuration, credentials, and production promotion remain operator decisions; a green local or CI run is not funded-wallet or production authorization.

For action changes, review the flow in [Actions](actions.md): server-authored calldata; verified scope; one action ID for provider idempotency; owner-generation fencing; provider and chain status.

## Wave 1 lint contracts

- `jsx-a11y/*` violations are errors, moving missing accessible names, roles, and ARIA contracts into the gate after the a11y-semantics fixes in `61e7e4d5`, `70b6f070`, and `1491b808`.
- `home/no-real-waits` covers unit tests and `*.pw.ts`, rejecting long timers, `Bun.sleep`, Playwright `page`/`frame.waitForTimeout`, promise-wrapped timers, and overlong Testing Library waits. A sleep encodes an unnamed precondition, so the fix is to name and poll that observable state, never to delete the wait or relax the assertion until it passes. The named precondition must be the state the sleep was waiting for, checked by asking what can still be in flight when the naive signal first appears: a balances entry existing, or storage staying unchanged over a brief window, is necessary but not sufficient while a throttled persistence write can still be pending, so the settle window must span `ownerQueryPersistThrottleMs`. This closes the Playwright scope gap identified in Codex PR #641 and the fix-corpus gate-browser-test bucket.
- `home/no-silent-catch` rejects a catch when some path has no observable disposition: empty or comment-only bodies, bare returns, discard-only bodies, outer assignments of only `undefined`, and conditional handling with an unhandled fallthrough path. Explicit return values, non-`undefined` assignments to outer bindings read after the try, throws, approved reporting and recovery calls, collection cleanup such as `pending.delete(key)`, `void reportClientError(...)` reporting calls, promise settlement, and aborts are dispositions. A call to a same-file helper that itself throws, reports, or sets outer state disposes, and a nested `try`/`catch` disposes when every arm returns, throws, or assigns outer state. A `try` whose `finally` block always throws disposes regardless of its `try`/`catch` arms, while a `finally` that only cleans up does not. A catch with no disposition of its own also preserves a disposition when its try assigns an outer `let` or `var` with a non-`undefined` initializer and that retained fallback is read after the try. Fallback-value correctness belongs to `home/no-amount-fallback` and code review; this rule never asks code to be reshaped between `return x` and an outer assignment. Coverage includes `app`, `client`, `components`, `config`, `server`, `shared`, and root `instrumentation*.ts` files. The rule targets the state-and-cache failures represented by `a3efbae2`, `01042089`, and `14465e42`.
- `home/no-self-referential-expectation` rejects an `expect(...)` whose expected value uses an identifier imported from the module the test file names by path convention (`foo.test.ts` names `foo.ts`, and normalized names such as `next-config.test.ts` name `next.config`), imported through a relative path or the `@/` alias. Typed and non-null expressions, array and object values, templates, namespace members, and `index` imports from `.` are covered. Tests must assert a literal or an independently derived value; a same-named constant from another module is not a subject import.
- `home/isolate-instrumentation-calls` covers `app`, `client`, `components`, `config`, `lib`, `server`, `shared`, and `types`, plus root `instrumentation*.ts`, `next.config.ts`, and `proxy.ts`. Potentially failing calls imported from the tracked observability modules must be awaited inside `try/catch` or use `void promise.catch(...)`. The `safeHelpers` boundary contains only helpers whose implementation contains recorder or sink failure, or constructs a handler whose reporting path contains those failures; adding a module to tracking does not make all of its exports safe.
- `home/no-amount-fallback` rejects zero defaults for names ending in the money tokens `amount`, `balance`, `total`, `quantity`, `value`, `assets`, `shares`, `usd`, `fiat`, or `atomic`, including those tokens followed by `BaseUnits`, `Units`, `Wei`, `Wad`, `Atomic`, `Usd`, or `Fiat`. It covers shared formatting, money-modal, balances, and server-action paths, requiring null/unavailable propagation or fail-closed handling after the value-truth fixes in `6e566e44`, `a5781ae7`, and `088e407c`.

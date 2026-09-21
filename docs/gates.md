# Repository gates

`bun run gates` runs the repository gate unit tests, and `bun check` runs that plus the rest of the checks. All of it runs without provider or funded-wallet secrets. The gates guard four invariants:

- Migrations run before build, so a build cannot ship a schema it never applied.
- No unresolved CSS custom properties, so every referenced token resolves in the theme.
- Every `process.env` read is declared in `.env.example`, so a clone knows which variables it needs.
- Custom lint rules are non-vacuous, proven against temporary-mirror fixtures rather than a clean source tree.

The full check suite also covers:

- `bun check` (including Oxlint-only lint with warnings denied and unused suppressions reported)
- Chromium product smoke
- story tests (`bun run --cwd apps/web test:stories`)
- `bun run gates` (the repository gate unit tests above, including commit provenance; also run inside `bun check`)
- disposable PostgreSQL contracts for actions, funding, and balances

## Story-test boundary

The **story tests** job runs every Storybook story in headless Chromium through `@storybook/addon-vitest` for every pull request and every push to `main`. It executes each story's `play` function — a failing `play` fails the job — and runs the a11y addon's audit. The audit reports findings rather than failing the job globally (`a11y.test: "todo"`) because owned components carry pre-existing violations that need a product decision; minimal workshop stories that are audit-clean opt into `a11y.test: "error"`. The job is not part of `bun check`, so run `bun run --cwd apps/web test:stories` directly for story or owned-component changes and stop a running `storybook dev` first (shared Storybook Vite cache).

## Fix-commit provenance

The repository gate checks commits after the pull request branch's merge-base with `main`; outside a pull request it checks `HEAD`. Every scoped `fix(...)` subject must include one of these trailers in its commit body: `Caught-by: lint`, `Caught-by: bot`, `Caught-by: review`, `Caught-by: browser`, or `Caught-by: production`. Earlier commits on `main` are grandfathered.

## Browser-smoke boundary

The current **Chromium smoke** job runs the fixture-backed Playwright suite in GitHub Actions for every pull request and every push to `main`. It starts a CI-local fixture server; it does not exercise the hosted Vercel preview deployment.

The Jesse-locked [architecture](architecture.md#quality-bar) targets Playwright smoke on every hosted preview. That hosted-preview smoke target is not implemented yet; current PR/main fixture smoke must not be described as hosted-preview verification.

Deployment configuration, credentials, and production promotion remain operator decisions; a green local or CI run is not funded-wallet or production authorization.

For action changes, review the flow in [Actions](actions.md): server-authored calldata; verified scope; one action ID for provider idempotency; owner-generation fencing; provider and chain status.

## Wave 1 lint contracts

- `jsx-a11y/*` violations are errors, moving missing accessible names, roles, and ARIA contracts into the gate after the a11y-semantics fixes in `61e7e4d5`, `70b6f070`, and `1491b808`.
- `home/no-real-waits` covers unit tests and `*.pw.ts`, rejecting long timers, `Bun.sleep`, Playwright `page`/`frame.waitForTimeout`, promise-wrapped timers, and overlong Testing Library waits. A sleep encodes an unnamed precondition, so the fix is to name and poll that observable state, never to delete the wait or relax the assertion until it passes. This closes the Playwright scope gap identified in Codex PR #641 and the fix-corpus gate-browser-test bucket.
- `home/no-silent-catch` rejects a catch when some path has no observable disposition: empty or comment-only bodies, bare returns, discard-only bodies, outer assignments of only `undefined`, and conditional handling with an unhandled fallthrough path. Explicit return values, non-`undefined` assignments to outer bindings read after the try, throws, approved reporting and recovery calls, promise settlement, and aborts are dispositions. Fallback-value correctness belongs to `home/no-amount-fallback` and code review; this rule never asks code to be reshaped between `return x` and an outer assignment. Coverage includes `app`, `components`, `config`, `shared`, and root `instrumentation*.ts` files; `client` and `server` are excluded pending #712, which tracks 80 findings across 48 files. The rule targets the state-and-cache failures represented by `a3efbae2`, `01042089`, and `14465e42`.
- `home/isolate-instrumentation-calls` covers `app`, `client`, `components`, `config`, `lib`, `server`, `shared`, and `types`, plus root `instrumentation*.ts`, `next.config.ts`, and `proxy.ts`. Potentially failing calls imported from the tracked observability modules must be awaited inside `try/catch` or use `void promise.catch(...)`. The `safeHelpers` boundary contains only helpers whose implementation contains recorder or sink failure, or constructs a handler whose reporting path contains those failures; adding a module to tracking does not make all of its exports safe.
- `home/no-amount-fallback` rejects zero defaults for names ending in the money tokens `amount`, `balance`, `total`, `quantity`, `value`, `assets`, `shares`, `usd`, `fiat`, or `atomic`, including those tokens followed by `BaseUnits`, `Units`, `Wei`, `Wad`, `Atomic`, `Usd`, or `Fiat`. It covers shared formatting, money-modal, balances, and server-action paths, requiring null/unavailable propagation or fail-closed handling after the value-truth fixes in `6e566e44`, `a5781ae7`, and `088e407c`.

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
- `bun run gates` (the repository gate unit tests above; also run inside `bun check`)
- disposable PostgreSQL contracts for actions, funding, and balances

## Story-test boundary

The **story tests** job runs every Storybook story in headless Chromium through `@storybook/addon-vitest` for every pull request and every push to `main`. It executes each story's `play` function — a failing `play` fails the job — and runs the a11y addon's audit. The audit reports findings rather than failing the job globally (`a11y.test: "todo"`) because owned components carry pre-existing violations that need a product decision; minimal workshop stories that are audit-clean opt into `a11y.test: "error"`. The job is not part of `bun check`, so run `bun run --cwd apps/web test:stories` directly for story or owned-component changes and stop a running `storybook dev` first (shared Storybook Vite cache).

## Browser-smoke boundary

The current **Chromium smoke** job runs the fixture-backed Playwright suite in GitHub Actions for every pull request and every push to `main`. It starts a CI-local fixture server; it does not exercise the hosted Vercel preview deployment.

The Jesse-locked [architecture](architecture.md#quality-bar) targets Playwright smoke on every hosted preview. That hosted-preview smoke target is not implemented yet; current PR/main fixture smoke must not be described as hosted-preview verification.

Deployment configuration, credentials, and production promotion remain operator decisions; a green local or CI run is not funded-wallet or production authorization.

For action changes, review the flow in [Actions](actions.md): server-authored calldata; verified scope; one action ID for provider idempotency; owner-generation fencing; provider and chain status.

## Wave 1 lint contracts

- `jsx-a11y/*` violations are errors, moving missing accessible names, roles, and ARIA contracts into the gate after the a11y-semantics fixes in `61e7e4d5`, `70b6f070`, and `1491b808`.
- `home/no-real-waits` covers unit tests and `*.pw.ts`, rejecting long timers, `Bun.sleep`, Playwright `page`/`frame.waitForTimeout`, promise-wrapped timers, and overlong Testing Library waits; this closes the Playwright scope gap identified in Codex PR #641 and the fix-corpus gate-browser-test bucket.
- `home/no-silent-catch` rejects empty or unhandled catches in the currently clean `app`, `components`, `config`, and `shared` layers; recovery state, typed non-null results, explicit reporting, promise settlement, and cleanup remain valid handling, targeting the state-and-cache failures represented by `a3efbae2`, `01042089`, and `14465e42`.
- `home/isolate-instrumentation-calls` requires potentially failing observability calls to use `try/catch` or `void promise.catch(...)`; helpers whose own tested boundary contains sink failures are explicitly configured as intrinsically safe.
- `home/no-amount-fallback` rejects zero defaults for amount-like names in shared formatting, money-modal, balances, and server-action paths, requiring null/unavailable propagation or fail-closed handling after the value-truth fixes in `6e566e44`, `a5781ae7`, and `088e407c`.

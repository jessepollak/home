# Delivery gates

Repository checks run without provider or funded-wallet secrets. Remaining delivery automation unit tests are part of `bun run gates`:

- `bun check`
- Chromium product smoke
- story tests (`bun run --cwd apps/web test:stories`)
- delivery automation tests (`bun run gates`: repository gate canaries plus PR-metadata algorithms; also run inside `bun check`)
- disposable PostgreSQL contracts for actions, funding, and balances

## Story-test boundary

The **story tests** job runs every Storybook story in headless Chromium through `@storybook/addon-vitest` for every pull request and every push to `main`. It executes each story's `play` function — a failing `play` fails the job — and runs the a11y addon's audit. The audit reports findings rather than failing the job globally (`a11y.test: "todo"`) because owned components carry pre-existing violations that need a product decision; minimal workshop stories that are audit-clean opt into `a11y.test: "error"`. The job is not part of `bun check`, so run `bun run --cwd apps/web test:stories` directly for story or owned-component changes and stop a running `storybook dev` first (shared Storybook Vite cache).

## Browser-smoke boundary

The current **Chromium smoke** job runs the fixture-backed Playwright suite in GitHub Actions for every pull request and every push to `main`. It starts a CI-local fixture server; it does not exercise the hosted Vercel preview deployment.

The Jesse-locked [architecture](architecture.md#quality-bar) targets Playwright smoke on every hosted preview. That hosted-preview smoke target is not implemented yet; current PR/main fixture smoke must not be described as hosted-preview verification.

`main` is the delivery destination. A stacked change is intermediate work, not delivery evidence. Deployment configuration, credentials, and production promotion remain operator decisions; a green local or CI run is not funded-wallet or production authorization.

For action changes, review the flow in [Actions](actions.md): server-authored calldata; verified scope; one action ID for provider idempotency; owner-generation fencing; provider and chain status.

# Delivery gates

Repository checks run without provider or funded-wallet secrets. Remaining delivery automation unit tests are part of `bun run gates`:

- optional `bun run factory:preflight` as a generic secret-free agent/automated-worktree check (pinned repository, `agent/*` branch, and secret-free worktree/ambient environment); the standalone factory uses its own external preflight, and this command does not implement or invoke that queue
- `bun check`
- Chromium product smoke
- delivery automation tests (`bun run gates`: repository gate canaries plus PR-metadata algorithms; also run inside `bun check`)
- disposable PostgreSQL contracts for actions, funding, and balances

## Browser-smoke boundary

The current **Chromium smoke** job runs the fixture-backed Playwright suite in GitHub Actions for every pull request and every push to `main`. It starts a CI-local fixture server; it does not exercise the hosted Vercel preview deployment.

The Jesse-locked [architecture](architecture.md#quality-bar) targets Playwright smoke on every hosted preview. That hosted-preview smoke target is not implemented yet; current PR/main fixture smoke must not be described as hosted-preview verification.

`main` is the delivery destination. A stacked change is intermediate work, not delivery evidence. Deployment configuration, credentials, and production promotion remain operator decisions; a green local or CI run is not funded-wallet or production authorization.

For action changes, review the flow in [Actions](actions.md): server-authored calldata; verified scope; one action ID for provider idempotency; owner-generation fencing; provider and chain status.

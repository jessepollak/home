# Delivery gates

Repository checks run without provider or funded-wallet secrets. Delivery automation unit tests, including factory runner policy, cleanup, and fake-process coverage, are part of `bun run gates`:

- `bun run factory:preflight` before a factory run (pinned repository, `agent/*` branch, and secret-free worktree/ambient environment)
- `bun run factory:run <issue>` for a manually authorized single-issue run; `--dry-run` exercises separate bounded child roles without GitHub mutation, a model call, or durable run evidence
- `bun check`
- Chromium product smoke
- delivery automation tests (`bun run gates`: repository gate canaries plus PR-metadata algorithms; also run inside `bun check`)
- disposable PostgreSQL contracts for actions, funding, and balances

## Browser-smoke boundary

The current **Chromium smoke** job runs the fixture-backed Playwright suite in GitHub Actions for every pull request and every push to `main`. It starts a CI-local fixture server; it does not exercise the hosted Vercel preview deployment.

The Jesse-locked [architecture](architecture.md#quality-bar) targets Playwright smoke on every hosted preview. That hosted-preview smoke target is not implemented yet; current PR/main fixture smoke must not be described as hosted-preview verification.

`main` is the delivery destination. A stacked change is intermediate work, not delivery evidence. Deployment configuration, credentials, and production promotion remain operator decisions; a green local or CI run is not funded-wallet or production authorization.

For action changes, review the flow in [Actions](actions.md): server-authored calldata; verified scope; one action ID for provider idempotency; owner-generation fencing; provider and chain status.

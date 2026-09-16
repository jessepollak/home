# Delivery gates

Repository checks run without provider or funded-wallet secrets:

- `bun run factory:preflight` before a factory run (pinned repository, `agent/*` branch, and secret-free worktree/ambient environment)
- `bun check`
- Chromium product smoke
- delivery automation tests (`bun run gates`: repository gate canaries plus PR-metadata algorithms; also run inside `bun check`)
- disposable PostgreSQL contracts for actions, funding, and balances

`main` is the delivery destination. A stacked change is intermediate work, not delivery evidence. Deployment configuration, credentials, and production promotion remain operator decisions; a green local or CI run is not funded-wallet or production authorization.

For action changes, review the flow in [Actions](actions.md): server-authored calldata; verified scope; one action ID for provider idempotency; owner-generation fencing; provider and chain status.

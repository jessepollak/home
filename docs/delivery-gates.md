# Delivery gates

Repository checks run without provider or funded-wallet secrets:

- `bun check`
- Chromium product smoke
- delivery automation tests
- disposable PostgreSQL contracts for actions and funding

`main` is the delivery destination. A stacked change is intermediate work, not delivery evidence. Deployment configuration, credentials, and production promotion remain operator decisions; a green local or CI run is not funded-wallet or production authorization.

For action changes, review the thin flow in [Home is thin](home-is-thin.md): server-authored calldata; verified scope; one action ID for provider idempotency; owner-generation fencing; provider and chain status.

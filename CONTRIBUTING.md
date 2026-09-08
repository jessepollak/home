# Contributing to Home

Home is a local finance spike, not a production-approved money app. Read this before opening a PR.

## Start here

1. [README](README.md) — how to run `bun dev` / `bun check`.
2. [Build status](docs/build-status.md) — what is delivered and which gates remain.
3. [Wallet runtime](docs/wallet-runtime-spike.md) — prepare → claim → submit → receipt.
4. [Architecture review (2026-09)](docs/architecture-review-2026-09.md) — patterns to keep, risks, **contribution contract**, and first-week slices.

[Technical design](docs/technical-design.md) and [implementation plan](docs/implementation-plan.md) describe the **target** production architecture (Vercel + Neon + webhooks, later `packages/*`). They are not a map of the current tree.

## Local checks

```sh
bun install --frozen-lockfile
bun check
```

Optional, not in CI today:

```sh
bun run --cwd apps/web test:browser-auth
node scripts/probe-money-actions-sqlite.mjs
```

Do not enable live Morpho/CDP SQL smokes or funded-wallet secrets in pull-request CI.

## Rules of thumb

- One feature lane per PR (`apps/web/features/<x>` + `apps/web/server/<x>` + its API route).
- Treat `apps/web/server/money-actions/` as a single-writer zone.
- Never accept client-authored calldata. Never dispatch twice. Never authorize from `?wallet=` or a client user id.
- Local SQLite under `.local/` is not production persistence.

The full checklist is in the [contribution contract](docs/architecture-review-2026-09.md#d-contribution-contract-for-new-engineers).

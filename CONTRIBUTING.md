# Contributing to Home

Home is meant to be cloned, run, and forked first. This file is for focused pull requests and engineer onboarding, not the primary path for operators.

Home is a local finance spike, not a production-approved money app. Read this before opening a PR.

## Start here

1. [README — Get started](README.md#get-started) — how to run `bun dev` / `bun check`.
2. [Build status](docs/build-status.md) — what is delivered and which gates remain.
3. [Wallet runtime](docs/wallet-runtime-spike.md) — prepare → claim → submit → receipt.
4. [Architecture review (2026-09)](docs/architecture-review-2026-09.md) — patterns to keep, risks, **contribution contract**, and first-week slices.
5. [Docs index](docs/README.md) — operate, product intent, and demoted target/archive docs.
6. [Operating manual](docs/operating-manual.md) — agent-team labels, proof bar, Jesse-only merge.

Later, if you are working on hosting: [Vercel deploy](docs/vercel-deploy.md) (bun settings + Neon `DATABASE_URL`). Broader webhooks/`packages/*` ideas stay in [target architecture](docs/target-architecture.md), which is **not** a map of the current tree. The 2026-09-07 two-hour chunk plan is [archived](docs/archive/implementation-plan-2026-09-07.md).

## Local checks

```sh
bun install --frozen-lockfile
bun check
```

Additional focused checks:

```sh
bun run --cwd apps/web test:browser-smoke
MONEY_ACTION_PG_TEST_URL=postgres://... bun test scripts/delivery/tests/postgres-money-action*.test.ts
```

Do not enable live Morpho/CDP SQL smokes or funded-wallet secrets in pull-request CI.

## Rules of thumb

- One feature lane per PR (`apps/web/client/<x>` + `apps/web/server/<x>` + its API route).
- Treat `apps/web/server/money-actions/` as a single-writer zone.
- Never accept client-authored calldata. Never dispatch twice. Never authorize from `?wallet=` or a client user id.
- Money-action persistence requires PostgreSQL/Neon; an unset `DATABASE_URL` fails closed.

The full checklist is in the [contribution contract](docs/architecture-review-2026-09.md#d-contribution-contract-for-new-engineers).

## Agent team & merge policy

The in-repo agent crew (Hannah, Hank, Holly, Hazel, Hope, Hugo, Hunter, j) follows the [operating manual](docs/operating-manual.md). GitHub Issues and labels are the sole intake and execution board for all Home feedback and tasks, including solo checkout work.

**Only Jesse (`jessepollak`) gives the final +1 and merges.** Crew review, including Hannah's eng review, can proceed; merge waits on Jesse. Third-party PRs already required Jesse +1; crew PRs use the same bar.

User-visible PRs need proof in the description: screenshots, before/after, or a short repro. See [UI PR previews](docs/ui-pr-previews.md).

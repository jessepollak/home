# Contributing to Home

Home is meant to be cloned and run first. This guide is for focused pull requests and engineer onboarding.

## Start here

1. [README — Get started](README.md#get-started)
2. [Architecture](docs/architecture.md) — principles, seams, and the thinness test; [Actions](docs/actions.md) and [Balances](docs/balances.md) for subsystem contracts
3. [Browser validation](docs/browser-validation.md) — required before/after iteration and regression-test boundaries for user-visible and core-flow work
4. [Docs index](docs/README.md)
5. [Operating manual](docs/operating-manual.md) — product framing, factory runs, delivery loop, live-money validation, PR evidence, and completion authority

For hosting, see [Vercel deploy](docs/vercel-deploy.md). For a customized operator deployment, see [Fork and extend](docs/fork-and-extend.md).

## Local environment

The [README setup](README.md#install-and-run) bootstraps a fresh clone from the tracked `.env.example`. An ordinary Git worktree does not copy the ignored `apps/web/.env.local`; follow the [AGENTS worktree bootstrap](AGENTS.md#working-in-this-repo) to copy it from the primary checkout only when it is missing, without printing, overwriting, or committing it.

Automated factory runs use isolated environments and never copy or read the operator's `.env.local` or receive provider, database, production, or Vercel credentials.

## App boundaries

Home is one Next.js app in `apps/web`:

| Layer | Owns |
| --- | --- |
| `app/` | Pages, layouts, and thin route adapters |
| `client/` | UI, URL-addressable flows, and query consumers |
| `shared/` | Framework-free contracts, validation, amounts, and presentation utilities |
| `server/` | Verified sessions, provider calls, action records, receipts, and other server-only integrations |
| `components/` | Reusable owned UI components |
| `config/` | Brand, navigation, regions, and asset identities |

The import boundaries are enforced by ESLint: `shared/` cannot import React, Next, Node builtins, or app/client/server/component code; client and component code cannot import `server/`; server code cannot import app, client, or component code. Start server modules with `import "server-only";`. API handlers and clients share versioned parsers and types from `shared/`.

## Local checks

```sh
bun install --frozen-lockfile
bun check
bun run --cwd apps/web test:browser-smoke
```

Do not add provider credentials or funded-wallet checks to pull-request CI.

## Contribution contract

- Keep one feature lane per pull request. Treat action execution and session lifecycle as shared boundaries and coordinate changes to the merge hotspots listed in the [operating manual](docs/operating-manual.md#shared-merge-hotspots).
- The server authors calldata. Never accept browser-authored calldata, a client identity, or a client-supplied wallet as authorization.
- Keep action work to prepare, confirm, one dispatch, then provider/chain evidence. Preserve the owner-generation fence before every provider call and server POST.
- Prefix TanStack Query keys by owner and clear private queries whenever the owner generation changes.
- Identify assets by chain ID plus address, never ticker. Token amounts are `bigint`; exact review facts stay on confirm.
- Preserve the shell frame budget: pointer motion and price ticks use transforms, opacity, motion values, or imperative text writes rather than React state per update.
- Add behavioral tests for regressions that matter, with exact bigint fixtures for amounts. Follow the [test policy](docs/architecture.md#test-policy) for what to test and what to avoid.
- Run `bun check`; run the browser smoke for shell, session, or action-flow changes. Keep live provider and funded-wallet checks out of CI.
- Update the matching current doc in the same change when a delivered, user-visible, or execution contract changes.

## Factory delivery

Jesse files issues on `jessepollak/home` with a kind prefix in the title (`product(...)`, `design(...)`, `feat(...)`, `fix(...)`, `test(...)`, `ops(...)`, `dx(...)`, `docs(...)`, `chore(...)`); adding `factory` means start working on the issue. The factory bot follows the run triggers and delivery loop in the [operating manual](docs/operating-manual.md), marks the issue `factory:working` and then `factory:review` itself, works on `agent/<issue>`, and delivers a normal PR ending with `Closes #<issue>` for implementation or `Refs #<issue>` for design proposals (or an issue comment for `product(...)` research). Any Jesse issue/PR comment or PR review triggers a follow-up; re-adding `factory` triggers a comment-less look-again run.

**Only Jesse (`jessepollak`) gives the final +1 and merges.** User-visible pull requests need proof in the description; see [UI PR previews](docs/ui-pr-previews.md).

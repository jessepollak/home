# Contributing to Home

Home is meant to be cloned and run first. This guide is for focused pull requests and engineer onboarding.

## Start here

1. [README — Get started](README.md#get-started)
2. [Home is thin](docs/home-is-thin.md) — action and client rules
3. [Architecture review](docs/architecture-review-2026-09.md) — current-tree boundaries and contribution contract
4. [Docs index](docs/README.md)
5. [Operating manual](docs/operating-manual.md) — issue labels, proof bar, and merge policy

For hosting, see [Vercel deploy](docs/vercel-deploy.md). For a customized operator deployment, see [Fork and extend](docs/fork-and-extend.md).

## Local checks

```sh
bun install --frozen-lockfile
bun check
bun run --cwd apps/web test:browser-smoke
```

Do not add provider credentials or funded-wallet checks to pull-request CI.

## Rules of thumb

- Keep one feature lane per pull request.
- The server authors calldata; never authorize from a client user ID or query parameter.
- Preserve the owner-generation fence and owner-prefixed TanStack Query keys.
- Token amounts are `bigint`; exact review facts stay on confirm.
- Update the matching current doc when a contract changes.

## Agent team & merge policy

The in-repo agent crew follows the [operating manual](docs/operating-manual.md). GitHub Issues and labels are the sole intake and execution board.

**Only Jesse (`jessepollak`) gives the final +1 and merges.** User-visible pull requests need proof in the description; see [UI PR previews](docs/ui-pr-previews.md).

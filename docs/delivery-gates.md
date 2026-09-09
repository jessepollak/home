# Delivery gates

Status: code-only rollout plan for issue [#112](https://github.com/jessepollak/home/issues/112), September 9, 2026. This change does **not** alter repository rules, Vercel settings, credentials, or deployment triggers.

## Checks in this repository

Pull requests run these untrusted-code checks without provider or funded-wallet secrets:

- `bun check`
- `mocked Chromium auth`
- `Node SQLite probe (Node 22.13.1)`
- `delivery automation tests`
- `real PostgreSQL store contract (PostgreSQL 14)`

`PR destination / Validate pull request destination` uses `pull_request_target`, but has read-only permissions and explicitly checks out `main`; it never checks out or executes the pull request head. The metadata workflow also executes the trusted copy from `main`. Its only write permission is `issues:write`, and the trusted implementation only sends `DELETE` requests for `status:*` labels on the event record.

The browser suite uses mocked SDK/session boundaries. The SQLite probe exercises the local `node:sqlite` claim, shared-bundle, and verified-execution races. The PostgreSQL job runs the reusable production-store contract against isolated schemas in a disposable PostgreSQL 14 service through Bun's built-in SQL client. These checks do not use a live provider, funded wallet, deployment, or persistent production database.

## Destination and label semantics

The normal destination is `main`.

A temporary stack is permitted only when a reviewer with label permission explicitly applies `delivery:stacked`. A stacked pull request:

- may target its named dependency branch;
- stays `status:working` (or has no status label);
- must not carry `status:ready-for-review` or `status:needs-jesse`;
- is an intermediate change, never evidence that the issue is delivered to `main`;
- must be retargeted to `main` and have `delivery:stacked` removed before promotion.

Unlabeled non-`main` destinations fail the destination check. Metadata automation removes delivery-promotion labels from every non-direct destination; it never adds or elevates a status. When an issue or pull request closes (including a merged pull request), automation removes every `status:*` label while preserving `owner:*`, `lane:*`, and unrelated labels. It does not follow closing keywords, patch issue state, or close linked verification issues. Use `Refs #N`, not `Closes #N`, until verification is complete.

The `delivery:stacked` label does not exist at the time this plan was written. Creating it is an explicit repository rollout step, not part of this code change.

## Safe rollout

Jesse or a repository administrator should make these changes only after this PR is merged to `main` and all six check names have appeared on a test pull request.

### 1. GitHub

1. Create label `delivery:stacked` with description: `Reviewed intermediate PR; not delivered to main and not eligible for promotion status`.
2. Open or update a ruleset targeting `main` ([GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
3. Require changes through pull requests; block force pushes and branch deletion.
4. Require these exact checks, selecting GitHub Actions as the expected source where GitHub offers that choice:
   - `bun check`
   - `mocked Chromium auth`
   - `Node SQLite probe (Node 22.13.1)`
   - `delivery automation tests`
   - `real PostgreSQL store contract (PostgreSQL 14)`
   - `Validate pull request destination`
5. Use strict required checks (branch must be current with `main`) unless Jesse explicitly accepts the merge-race risk of loose checks.
6. Confirm the rule applies to administrators, or document the smallest named emergency bypass. Do not leave a broad implicit admin bypass.
7. Rehearse with three fixture PRs: direct-to-`main` passes; accidental non-`main` fails; reviewed `delivery:stacked` passes only as intermediate work and loses any promotion status.

Do not require a check name until a run has emitted it. Renaming a job changes its status-check identity and requires a coordinated settings update.

### 2. Vercel

Verify the connected Home project against these values in Project Settings; do not assume the current dashboard matches repository docs:

- connected repository: `jessepollak/home`;
- Production environment → Branch Tracking: `main` ([Vercel production branch](https://vercel.com/docs/git#production-branch));
- every other branch remains Preview, not Production;
- project Root Directory: repository root;
- Install Command: `bun install --frozen-lockfile`;
- Build Command: `bun run build`;
- Framework: Next.js; output directory left to framework detection;
- Node.js: 22.x, consistent with the repository engine and CI's 22.13.1 probe.

Then add Vercel Deployment Checks for the five CI jobs that also run on pushes to `main`: `bun check`, `mocked Chromium auth`, `Node SQLite probe (Node 22.13.1)`, `delivery automation tests`, and `real PostgreSQL store contract (PostgreSQL 14)`. Vercel documents that Deployment Checks hold production alias promotion until selected checks pass ([Deployment Checks](https://vercel.com/docs/deployment-checks)). Confirm in a non-production rehearsal that a failed check creates a build but does not move the production domain, then confirm a fully green commit promotes automatically.

This plan leaves the existing Git-based deployment trigger intact. Without Vercel Deployment Checks (or a later approved staged-promotion trigger), GitHub merge protection does not prove that the post-merge production build passed CI before alias promotion.

## Decisions required before settings rollout

Jesse must decide and record:

- required approving-review count, accounting for the repository's Jesse-authored PR review limitation;
- whether any administrator bypass is allowed and who owns emergency use;
- whether strict branch freshness is worth the extra reruns;
- whether the current Vercel plan supports Deployment Checks, and which account may force-promote;
- whether verified commits are required for Vercel deployments;
- whether a failed deployment-check rehearsal blocks rollout or triggers a later staged-promotion workflow proposal.

## Explicit gap

The disposable PostgreSQL job proves schema application and store behavior—including concurrent claims—against actual PostgreSQL semantics. It does not exercise the runtime `@neondatabase/serverless` websocket transport, Neon service configuration, multi-region behavior, or production credentials. Keep the in-process fake executor categorized as deterministic adapter coverage, and keep Neon transport acceptance as a separate live-infrastructure gate.

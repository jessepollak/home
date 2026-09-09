# Delivery gates

Status: code-only rollout plan for issue [#112](https://github.com/jessepollak/home/issues/112), September 9, 2026. This change does **not** alter repository rules, Vercel settings, credentials, or deployment triggers.

## Checks in this repository

Pull requests run these untrusted-code checks without provider or funded-wallet secrets:

- `bun check`
- `mocked Chromium auth`
- `Node SQLite probe (Node 22.13.1)`
- `delivery automation tests`
- `real PostgreSQL store contract (PostgreSQL 14)`

The `delivery automation tests` job also runs the scoped TypeScript project at `scripts/delivery/tsconfig.json`, which covers the new Bun PostgreSQL executor and its contract test without changing package metadata.

`PR destination` uses `pull_request_target` and explicitly checks out the trusted policy from `main`; it never checks out or executes the pull request head. Before any API call it validates the event repository, pull request number, 40-hex event head SHA, API configuration, and bounded reconciliation count. It first publishes **`delivery/pr-destination`** as pending on that trusted event head, refetches the live pull request, and also marks any newly observed live head pending before further verification. Success is published only after the current live repository, number, base, labels, state, and head are stable and policy-valid. A failed refresh after success makes one bounded best-effort pending publication so a usable status API does not silently leave that success authoritative. Its only write permission is `statuses:write`; the other permissions are read-only. The workflow job result itself is attached to the `pull_request_target` base SHA and is not exact-head proof. Pull request metadata reads and commit-status writes remain non-atomic.

The metadata workflow also executes the trusted copy from `main`. Before deleting anything, it GETs the current issue or pull request and re-derives cleanup eligibility from the live state, base, and labels. Its only write permission is `issues:write`, and the trusted implementation only sends `DELETE` requests for `status:*` labels on that same record.

The browser suite uses mocked SDK/session boundaries. The SQLite probe exercises the local `node:sqlite` claim, shared-bundle, and verified-execution races. The PostgreSQL job runs the reusable production-store contract against isolated schemas in a disposable PostgreSQL 14 service through Bun's built-in SQL client. These checks do not use a live provider, funded wallet, deployment, or persistent production database.

## Destination and label semantics

The normal destination is `main`.

A temporary stack is permitted only when a reviewer with label permission explicitly applies `delivery:stacked`. A stacked pull request:

- may target its named dependency branch;
- stays `status:working` (or has no status label);
- must not carry `status:ready-for-review` or `status:needs-jesse`;
- is an intermediate change, never evidence that the issue is delivered to `main`;
- must be retargeted to `main` and have `delivery:stacked` removed before promotion.

Unlabeled non-`main` destinations fail the destination check. Metadata automation removes delivery-promotion labels from every current non-direct destination and from every current draft, including a direct-to-`main` draft; it never adds or elevates a status and preserves `status:working`. When a currently closed issue or pull request is processed (including a merged pull request), automation removes every `status:*` label while preserving `owner:*`, `lane:*`, and unrelated labels. A stale close event skips cleanup after reopen, a stale draft event skips promotion-label cleanup after live undraft, and a stale stacked event skips cleanup after retarget to direct `main`. It does not follow closing keywords, patch issue state, or close linked verification issues. Use `Refs #N`, not `Closes #N`, until verification is complete.

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
   - `delivery/pr-destination`
5. Do **not** select `Publish current-head PR destination status` as the destination requirement. That Actions job result is not the exact-head status; require the stable `delivery/pr-destination` commit-status context above.
6. Use strict required checks (branch must be current with `main`) unless Jesse explicitly accepts the merge-race risk of loose checks.
7. Confirm the rule applies to administrators, or document the smallest named emergency bypass. Do not leave a broad implicit admin bypass.
8. Rehearse with fixture PRs: direct-to-`main` passes; accidental non-`main` fails the destination check; reviewed `delivery:stacked` passes only as intermediate work and loses any promotion status. Confirm `delivery/pr-destination` is on the current head and blocks a failing merge into protected `main`. A main-only ruleset does **not** block merges into an unprotected feature branch: there the destination result and label guard are advisory, and Jesse must verify the base before merging. Push a new commit and confirm the old SHA's result is not accepted for the new head; retarget the PR and confirm the same head receives a newly evaluated result for the new base.

Do not require a check name or status context until a run has emitted it. Renaming an Actions job or changing the explicit status context requires a coordinated settings update.

### 2. Vercel

Verify the connected Home project against these values in Project Settings; do not assume the current dashboard matches repository docs:

- connected repository: `jessepollak/home`;
- Production environment → Branch Tracking: `main` ([Vercel production branch](https://vercel.com/docs/git#production-branch));
- every other branch remains Preview, not Production;

Preserve the project's working Root Directory, install/build commands, framework, output directory, and Node configuration. This rollout changes delivery gates, not the monorepo build layout. Record those existing values before rehearsal; resolve any mismatch with [the deployment setup guide](vercel-deploy.md) separately rather than changing a working deployment as part of the gate rollout.

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

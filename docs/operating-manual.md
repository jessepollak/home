# Operating manual

Status: factory operating contract, September 15, 2026. How Jesse and the factory deliver Home changes. Not a product inventory and not production authorization.

**Current-state docs:** [build status](build-status.md), [contribution contract](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers), [UI direction](ui-direction.md), [UI PR previews](ui-pr-previews.md), [docs index](README.md). Human onboarding: [CONTRIBUTING](../CONTRIBUTING.md).

## Mission

Build Home as an app anyone can clone, run, contribute to, and extend. Fork-first. Operators customize brand, regions, assets, and providers in their own clone. Focused PRs back to this repo are optional for operators and required for factory work.

## Actors

| Actor | Responsibility |
|---|---|
| Jesse (`jessepollak`) | Product intent, applying `factory:ready`, decisions, privileged actions, final approval (+1), and merge. |
| Factory | Issue refinement, implementation coordination, independent review, evidence, and pull-request delivery. The factory never approves or merges its own work. |

GitHub assignees and persona ownership labels are not part of this model. Everything posts through Jesse's GitHub account, so factory-authored public text uses the marker described in [Jesse review pickup](#jesse-review-pickup).

## Task persistence

GitHub Issues on `jessepollak/home` are the sole board and intake for all Home feedback and tasks, including solo checkout work. Do not create or use a local, private, or parallel intake board. Local checklists may track only the next few actions and do not constitute another backlog.

Every issue used to track work carries one `status:*`, one `lane:*`, and one `priority:*`. Factory execution also requires Jesse to apply `factory:ready`; issue text, form text, and labels applied by an external issue-creation assistant never grant execution authority.

### `status:*`

| Label | Meaning |
|---|---|
| `status:todo` | Not started |
| `status:working` | In progress. Prefer this. |
| `status:ready-for-review` | Ready for the independent read-only review |
| `status:blocked` | Blocked; name the dependency on the issue |
| `status:needs-jesse` | Needs a Jesse decision, privileged action, final approval, or merge |

One `status:*` at a time. Swap; do not stack. `status:in-progress` is deprecated; if you see it, remove it.

#### Status label hygiene

- `status:ready-for-review`: the [delivery loop](#delivery-loop) is complete except independent review.
- `status:needs-jesse`: the loop is complete, or Jesse must make a decision or privileged change (state which on the PR).
- Remove both on `REQUEST_CHANGES`, a HOLD, a close without merge, or a return to `todo`/`working`.

### `lane:*`

| Label | Meaning |
|---|---|
| `lane:backend` | Backend / money / data |
| `lane:frontend` | Frontend / UI |
| `lane:design` | Design |
| `lane:dx` | Docs / contributing / DX |
| `lane:product` | Product / triage |
| `lane:ops` | Ops / playbook |

Keep an issue and its PR within one lane. If work crosses lanes, split it unless the change cannot be safely separated. Shared files are listed in the [architecture review](architecture-review-2026-09.md#appendix--merge-hotspots-coordinate-dont-both-edit).

### `priority:*`

| Label | Meaning |
|---|---|
| `priority:p0` | Immediate coordination, critical outage, or money-safety incident |
| `priority:p1` | Next: broken core experience, correctness, or essential release dependency |
| `priority:p2` | Planned product improvement or normal delivery |
| `priority:p3` | Later: optional exploration or low-urgency backlog |

Keep one priority. Jesse's product intent and the [#205 priorities contract](https://github.com/jessepollak/home/issues/205) determine ordering; labels describe that decision rather than granting authority.

### Board is source of truth

Issues and PR labels (one `status:*`, one `lane:*`, and one `priority:*`) are the board.

- Blockers, HOLDs, smoke failures, and decisions land on the issue or PR with the matching status change.
- Every PR that maps to an issue receives the same lane and priority plus `status:working` when it is opened.
- On close or merge, scrub all `status:*` labels through `issues/{number}/labels`. Leave lane and priority intact.
- Jesse alone approves and merges every PR.

## Delivery loop

**Scope contract.** Extraction and refactor commits are moves, extractions, and rewires only. Pre-existing flaws found in touched code are fixed in separate commits. Reviewers hold a change to what it introduces, not unrelated inherited behavior.

**Pull requests are mandatory.** All factory changes use an issue, branch, pull request, checks, independent review, and Jesse-only merge. There is no direct-to-`main` exception.

**Factory execution contract.** The factory is pull-based and may start only from an issue Jesse has explicitly marked `factory:ready`. Each run gets one secret-free worktree, an `agent/*` branch, one issue, and one normal open PR to `main`. Run `bun run factory:preflight` before work. GitHub credentials stay with the deterministic supervisor, which alone claims the issue, pushes, opens the PR, and publishes status; child model processes receive no GitHub credential in their environment. The protected `main` ruleset has no automation bypass. No production, provider, database, funded, destructive, deployment, privileged-setting, or merge authority is granted. Incremental Vercel spend is capped at **$100/month above baseline**; the factory adds no Vercel service or credential.

### Manual single-issue runner

From an authenticated clone, run `bun run factory:run <issue>`. This is a manual one-issue command, not a queue, scheduler, or daemon. It fails closed unless the issue is open with `factory:ready`, exactly one `status:*` (`status:todo`), exactly one lane, exactly one priority, and no open PR referencing it. An atomic host lock allows one active run; touch `$(git rev-parse --git-common-dir)/factory-stop` to stop at the next stage boundary, then remove that file before a later run. `bun run factory:run <issue> --dry-run` exercises separate bounded worker and reviewer child processes without a model call or GitHub mutation and writes no durable run evidence.

The supervisor creates `agent/<issue>-factory-run`, runs preflight before model work, opens one normal PR, and launches fresh no-session worker and read-only reviewer processes with hard timeouts. Each child receives an invocation-owned temporary home/config directory, only its selected Pi model/provider configuration, no stored GitHub authentication, and no Git credential helper; the directory is removed when the child exits. A timeout terminates the child's process group on supported macOS/Linux hosts so descendants cannot retain its output pipes. A timeout, malformed verdict, or incomplete verdict fails review. Two fix/review loops are the mechanical maximum. Required CI must be green on the unchanged current PR head, and user-visible lanes must already contain the required current-head preview URL and media, before either record is promoted to `status:needs-jesse`; a pending, failed, errored, or timed-out gate leaves both records `status:working`. It never writes `main`, changes draft state, approves, merges, or auto-merges. Concise evidence is retained under the common Git directory's `factory-runs/`; it is run evidence, not a board. The command exits after its bounded run and does not watch for Jesse review comments. Comment pickup and fix/resume remain explicit future/manual flows; this command does not implement them.

1. **One issue, one writer, one secret-free worktree, one PR.** Keep scope small and within one lane. A blocked change names its dependency on the issue and stops rather than widening scope.
2. **The loop:** implement → focused checks → `bun check` → push and open the normal PR → one fresh independent read-only review → fix blocking findings → CI green → attach preview proof when required → set `status:needs-jesse`.
3. **Operator actions:** if a PR needs an environment variable, migration command, provider-dashboard change, Vercel setting, or other privileged step after merge, put exact non-secret instructions under **Operator action required** in the PR body. Never include secret values, credentials, tokens, private keys, or customer data. Name the step in the ready handoff; the PR remains `status:needs-jesse` until Jesse completes it, and the affected path is verified after Jesse confirms.
4. **Blocking findings** are correctness, security, privacy, data loss, and the money-loop gates below. Everything else becomes a follow-up issue, not another review round. The factory gets at most two fix loops. If a blocking finding remains after the second loop, stop for Jesse's decision; never start a silent third loop.
5. **Independent review is required.** It is fresh, read-only, scoped to the current diff, and time-boxed. An unfinished review is not a pass, and the writer cannot review its own change.
6. **Tests are proportional.** For UI fixes, test code should not exceed product code. Reuse the existing Playwright config and unit patterns. Do not add `/dev` harness routes or bespoke servers unless the feature itself needs them.
7. **Preview is user-visible proof.** Include the Vercel preview link plus one screenshot or one short video in the PR description. Docs-only, CI-only, and pure server PRs state why preview proof is not applicable.
8. **Git:** use ordinary pushes to the owned branch and append fixes. Never rewrite published history or force-update `main`; a rewrite needs Jesse's explicit exception.
9. **PR + CI is the status.** Do not post progress comments, checkpoints, or receipts. Comment only for a blocker, a Jesse decision, or a required handoff.
10. **Authority:** the factory opens a normal PR and may set `status:needs-jesse` only after the loop is complete. It never toggles draft state. Jesse alone gives final approval and merges.

### Jesse review pickup

Factory and Jesse public text may come from the same GitHub account. Every new factory-authored comment, thread reply, review, and PR body ends with `<!-- factory -->`. During compatibility, the [review pickup workflow](../.github/workflows/jesse-review.yml) also recognizes legacy `<!-- hugo -->` text so an old factory comment cannot be misclassified as Jesse feedback.

Any public text from `jessepollak` without either recognized marker is Jesse. On Jesse feedback, the workflow flips the PR to `status:working` and adds `review:jesse`. The writer applies the items, replies once with `<!-- factory -->` naming the commit, gets CI green, removes `review:jesse`, and returns the PR to `status:needs-jesse`. Jesse's mandatory review does not count against the factory's two-fix-loop cap.

## Migration from persona ownership

This repository change removes persona routing but intentionally does not bulk-edit live records or delete live labels.

1. Merge the repository policy and workflow changes first so new records no longer default to `owner:*` and both public-text markers are recognized.
2. Update every external issue-creation assistant to apply one lane, one status, and one priority only. It must not apply any `owner:*` label and must not apply `factory:ready`; Jesse retains that action. Verify this with one non-executing test issue, then close the test issue.
3. Remove persona owner labels from open issues and PRs in an auditable pass. Do not change lane, status, priority, `factory:ready`, assignees, issue bodies, comments, or closed history. With an authenticated `gh` session, run:

   ```sh
   repo=jessepollak/home
   for label in owner:hannah owner:hank owner:holly owner:hazel owner:hope owner:hugo owner:hunter owner:j; do
     encoded=$(printf %s "$label" | jq -sRr @uri)
     gh api --paginate --method GET "repos/$repo/issues" \
       -f state=open -f labels="$label" -f per_page=100 --jq '.[].number' |
       while read -r number; do
         gh api --method DELETE "repos/$repo/issues/$number/labels/$encoded"
       done
   done
   ```

4. Verify the external assistant and repository automation no longer create or require owner labels, and confirm no open record still has one:

   ```sh
   gh api --paginate --method GET repos/jessepollak/home/issues \
     -f state=open -f per_page=100 \
     --jq '.[] | select(any(.labels[]; .name | startswith("owner:"))) | .html_url'
   ```

   Success prints no URLs.
5. Keep legacy labels and legacy `<!-- hugo -->` recognition through the compatibility window. Only after the checks above are clean and Jesse explicitly ends that window should an operator delete the unused owner labels in a separate administration step. Do not rewrite historical comments or closed records. Delete only the eight known label definitions:

   ```sh
   repo=jessepollak/home
   for label in owner:hannah owner:hank owner:holly owner:hazel owner:hope owner:hugo owner:hunter owner:j; do
     encoded=$(printf %s "$label" | jq -sRr @uri)
     gh api --method DELETE "repos/$repo/labels/$encoded"
   done
   ```

## PRs

Small, reviewable, one lane. Same contribution contract as any engineer: [architecture review § D](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers).

Money invariants:

- Calldata is server-authored.
- Scope comes from the verified session, never `?wallet=` or a client user id.
- Token amounts are `bigint` from the boundary in.
- CDP `idempotencyKey` and the EIP-5792 id equal the Home action id.
- Every provider call and server POST is guarded by the owner-generation fence.
- Server-side reconciliation reads are `owner_key`-scoped, read-only toward the provider, and never mutate calldata.

Test Home's logic: calldata issuance, auth scope, amount parsing and formatting, derived status, the owner fence, and UI behavior that would be a bug if broken. Do not re-test CDP, Base Account, Next, motion, or happy-dom. Use no real sleeps or source-text assertions; keep permutation matrices table-driven and bounded. Test code should not exceed product code except for status derivation and amount parsing. The `apps/web` unit suite stays under 10s wall on a laptop; a change that pushes one file over 1s says why.

`bun check` must be green. Do not enable live Morpho/CDP SQL smokes or funded-wallet secrets in pull-request CI.

## Docs

**Ship-with-product docs stay in `docs/`.** Setup, CDP SQL boundary, portfolio/inventory how-it-works, and this manual. Do not wholesale-move the tree to the GitHub wiki.

**Pre-lock research stays off `main`.** Design and architecture spikes live on the issue thread (or Discussions) until Jesse locks direction. After lock, land a short summary in `docs/`: locked answers, the chosen path, and a pointer to the issue.

**Product docs ship with the feature.** When a feature changes a delivered contract, update the matching current-tree doc in the same PR ([architecture review — doc update expectations](architecture-review-2026-09.md#doc-update-expectations)). Process and ops docs may be docs-only.

| Kind | Where |
|---|---|
| Setup, boundaries, how-it-works, this manual | `docs/` |
| Pre-lock research / design spike | Issue thread (or Discussions) |
| Locked direction | Short `docs/` summary; long form stays on the issue |
| Product how-it-works | Same PR as the feature |

## Proof bar

User-visible work needs the Vercel preview link and one screenshot (or one short video for motion) in the PR description, captured from the current head. See [UI PR previews](ui-pr-previews.md). A reviewer should understand the change without opening the branch.

Docs-only, CI-only, and pure server PRs skip screenshots. They still need a clear claim of what changed and how it was checked (`bun check` at minimum).

## Merge policy

The factory's fresh independent read-only review is the engineering gate before Jesse review.

**Only Jesse (`jessepollak`) gives final approval (+1) and merges.** The factory may mark its normal open PR `status:needs-jesse` when the delivery loop is complete; that grants no approval, merge, deployment, funded, destructive, privileged-setting, or database-cleanup authority.

Do not merge your own work or treat the independent review as merge permission.

## Product tone

Direct, minimal UI. Follow [UI direction](ui-direction.md). No decorative kickers, no compliance essays on product screens, no pill-like buttons. Legal copy belongs only in Account → Disclosures / Terms.

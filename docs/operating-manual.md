# Operating manual

Status: agent-team operating contract, September 11, 2026. How Jesse's in-repo crew works. Not a product inventory and not production authorization.

**Current-state docs:** [build status](build-status.md), [contribution contract](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers), [UI direction](ui-direction.md), [UI PR previews](ui-pr-previews.md), [docs index](README.md). Human onboarding: [CONTRIBUTING](../CONTRIBUTING.md).

## Mission

Build Home as an app anyone can clone, run, contribute to, and extend. Fork-first. Operators customize brand, regions, assets, and providers in their own clone. Focused PRs back to this repo are optional for operators and required for the crew.

## Roles

| Name | Role |
|---|---|
| Jesse (`jessepollak`) | Human owner. Only Jesse gives final approval (+1) and merges. Everything ships through this GitHub account. |
| j | CEO / ops |
| Hunter | PM. Drive order. |
| Hannah | Head of Engineering. Quality, reliability, maintainability. Eng review and labels. Never merge — Jesse final +1 / merge. |
| Hugo | Architect. Architecture, cross-cutting technical integrity, independent review, scoped fix PRs, and — when Jesse authorizes a run — the delivery coordinator described in [Delivery loop](#delivery-loop). Hunter retains drive order; Jesse retains final decisions, +1, and merge. |
| Hank | Backend |
| Holly | Frontend |
| Hazel | Design |
| Hope | DevRel / DX |

GitHub assignees are unused. Ownership is labels.

## Task persistence

GitHub Issues on `jessepollak/home` are the sole board and intake for all Home feedback and tasks, including solo checkout work. Do not create or use a local, private, or parallel intake board.

Every issue used to track work should carry one `owner:*`, one `status:*`, and one `lane:*`. Labels already exist on the repo.

Native todos are a short checklist of the coordinator's next few parent actions, each linked to its GitHub issue or PR. They are not a second backlog, and completing one does not mean anything shipped.

### `owner:*`

| Label | Who |
|---|---|
| `owner:hannah` | Hannah (Head of Engineering) |
| `owner:hank` | Hank (backend) |
| `owner:holly` | Holly (frontend) |
| `owner:hazel` | Hazel (design) |
| `owner:hope` | Hope (DevRel / DX) |
| `owner:hugo` | Hugo (Architect) |
| `owner:hunter` | Hunter (PM) |
| `owner:j` | j (CEO / ops) |

Keep one owner. Re-label when ownership moves. Do not assign the GitHub user — it will always be Jesse.

### `status:*`

| Label | Meaning |
|---|---|
| `status:todo` | Not started |
| `status:working` | In progress. Prefer this. |
| `status:ready-for-review` | Ready for eng review (Hannah) |
| `status:blocked` | Blocked; name the dependency on the issue |
| `status:needs-jesse` | Needs a Jesse decision or merge |

One `status:*` at a time. Swap; do not stack. When you advance, remove the previous status label. `status:in-progress` is deprecated; if you see it, remove it.

#### Status label hygiene

- `status:ready-for-review`: the [delivery loop](#delivery-loop) is complete except eng review. Never on drafts.
- `status:needs-jesse`: the loop is complete and the PR is undrafted, or Jesse must make a decision (say which on the PR).
- Remove both on `REQUEST_CHANGES`, a HOLD, a return to draft, a close without merge, or a return to `todo`/`working`.

### `lane:*`

| Label | Meaning |
|---|---|
| `lane:backend` | Backend / money / data |
| `lane:frontend` | Frontend / UI |
| `lane:design` | Design |
| `lane:dx` | Docs / contributing / DX |
| `lane:product` | Product / triage |
| `lane:ops` | Ops / playbook |

Stay in your lane. Shared files are listed in the [architecture review](architecture-review-2026-09.md#appendix--merge-hotspots-coordinate-dont-both-edit); do not both edit a hotspot.

### Board is source of truth

Jesse-locked with Hannah, September 9, 2026. Issues and PR labels (`owner:*` / one `status:*` / `lane:*`) are the board.

- Soft merge order, Design HOLD, smoke fails, and blockers land on the issue or PR (comment + label flip) before or instead of crew DMs. Land-queue / babysitter wake set and batching: [PR land chatter diet](#pr-land-chatter-diet).
- Every PR that maps to an issue — including drafts — carries the triad the same day, matching the related issue. Drafts stay `status:working`.
- On close or merge, scrub all `status:*` via REST `issues/{n}/labels`. Leave `owner:*` and `lane:*`. `gh pr edit` labels often no-ops.
- Jesse alone approves and merges every PR.

## Drive order

- Hunter sets what the crew works on and in what product order.
- Hannah (Head of Engineering) sequences engineering and unblocks lanes.
- Jesse-approved priorities and scope remain governed by the [#205 priorities contract](https://github.com/jessepollak/home/issues/205).
- Do not start a second board, a parallel coordinator, or a shadow inbox for the same work.

## Delivery loop

Jesse-locked, September 11, 2026. This replaces the earlier pipelines, calibrated-QA, and publication sections. The goal is merged code; evidence exists to get there, not the other way around.

**Scope contract (Jesse-locked, September 12, 2026).** Extraction and refactor commits are moves, extractions, and rewires only. Pre-existing flaws found in touched code are fixed in separate commits. Reviewers hold a change to what it introduces, not unrelated inherited behavior.

**Reset-program delivery mode (Jesse-locked, September 12, 2026).** For the Home-is-thin reset and its follow-ons, lanes use short branches and the coordinator merges to `main` when `bun check` is green. This program uses no issues, labels, draft PRs, or review rounds; Jesse reviews the integrated result on `main`.

1. **One issue, one writer, one worktree, one PR.** Small scope, one lane, one owner, ordinary branch. If an issue needs more than one lane, split the issue. Run as many lanes as the backlog has disjoint issues (5–10 is normal); the shared limit is heavy jobs — at most four concurrent `bun check` / Playwright runs on one machine — not writers. Lanes are self-contained: the coordinator picks the next issue, launches the lane, and reads the result. A blocked lane names its dependency on the issue and the coordinator moves on.
2. **The loop:** implement → `bun check` → one fresh independent review → fix blocking findings → push → CI green → attach the preview ([UI PR previews](ui-pr-previews.md)) → undraft and `status:needs-jesse`. Any PR that needs an operator action to work after merge — a new environment variable, migration command, provider-dashboard change, or Vercel setting — states it under an **Operator action required** heading in the PR body with exact environment variable names, non-secret setting values, and exact commands. Never include secret values, credentials, tokens, private keys, or customer data in the PR or ready comment. It goes to `status:needs-jesse` with that step named in the ready comment; merging is not done until Jesse completes it, and the lane verifies the production path after Jesse confirms. Every PR is created with its labels (`owner:*`, `lane:*`, `priority:*`, `status:working`); a PR without labels is not on the board.
3. **Blocking findings** are correctness, security, privacy, data loss, and the money-loop gates below. Everything else becomes a follow-up issue, not another review round. Hard cap: two review rounds per PR; a third round never happens silently. After two, if any blocking finding is still unresolved the PR goes to Jesse with the open question; otherwise it ships with the follow-ups filed.
4. **Routing:** choose a writer and reviewer appropriate to the change's risk and scope. Reviews are read-only and time-boxed; an unfinished review is not a pass.
5. **Tests are proportional.** For UI fixes, test code should not exceed product code. Reuse the existing Playwright config and unit patterns. No new `/dev` harness routes or bespoke servers unless the feature itself needs them.
6. **Preview is the proof.** The Vercel preview link plus one screenshot or one short video in the PR description. No manifests, hashes, tiles, or publication reviews.
7. **Git:** ordinary pushes to the owned branch; append fixes. Never rewrite published history or force-update `main`; a rewrite needs Jesse's explicit exception.
8. **PR + CI is the status.** No progress comments, checkpoints, or receipts on GitHub. Comment only for a blocker, a decision for Jesse, or a handoff to another owner.
9. **Authority:** the coordinator may undraft and mark `status:needs-jesse` when the loop is complete. Jesse alone approves and merges. Nothing here grants deployment, funded, destructive, or Neon-cleanup authority.
10. **Jesse's review is a mandatory round.** Everything posts from Jesse's account, so the crew marks every comment, thread reply, and review it writes with a trailing `<!-- hugo -->`. Any comment from `jessepollak` without that marker is Jesse; the [review pickup workflow](../.github/workflows/jesse-review.yml) flips the PR to `status:working` and adds `review:jesse`. The lane's writer applies his items, replies once (with the marker) naming the commit, gets CI green, removes `review:jesse`, and returns the PR to `status:needs-jesse`. This round does not count against the two-round cap.

## 1:1s and learning retros

About every 12 hours, and after a 1:1: write durable learnings into agent memory. Chat is not memory. If a rule should survive the next session, put it in memory or in this manual.

## Mistakes

A mistake that changes how the crew should work goes through j (ops):

1. Short postmortem — what happened, blast radius, what we change.
2. Update this manual if the rule is durable.
3. Broadcast so the rest of the crew sees it.

Do not silently patch process in one bot's memory only.

## PRs

Small, reviewable, one lane. Same contribution contract as any engineer: [architecture review § D](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers).

Money invariants:

- Calldata is server-authored.
- Scope comes from the verified session, never `?wallet=` or a client user id.
- Token amounts are `bigint` from the boundary in.
- CDP `idempotencyKey` and the EIP-5792 id equal the Home action id.
- Every provider call and server POST is guarded by the owner-generation fence.

Test Home's logic: calldata issuance, auth scope, amount parsing and formatting, derived status, the owner fence, and UI behavior that would be a bug if broken. Do not re-test CDP, Base Account, Next, motion, or happy-dom. Use no real sleeps or source-text assertions; keep permutation matrices table-driven and bounded. Test code should not exceed product code except for status derivation and amount parsing. apps/web unit suite stays under 10s wall on a laptop; a change that pushes one file over 1s says why.

`bun check` must be green. Do not enable live Morpho/CDP SQL smokes or funded-wallet secrets in pull-request CI.

## Docs

Jesse-locked, September 9, 2026. Where writing lives. Not a wiki migration.

**Ship-with-product docs stay in `docs/`.** Setup, CDP SQL boundary, portfolio/inventory how-it-works, this manual. Do not wholesale-move the tree to the GitHub wiki.

**Pre-lock research stays off `main`.** Design and architecture spikes live on the issue thread (or Discussions) until Jesse locks direction. Do not commit long exploratory writeups. After lock, land a **short** summary in `docs/` — locked answers, the chosen path, and a pointer to the issue. Not the debate.

**Product docs ship with the feature.** Same PR as the code. Not a standalone docs-only PR. When a feature changes a delivered contract, update the matching current-tree doc in that PR ([architecture review — doc update expectations](architecture-review-2026-09.md#doc-update-expectations)). Process and ops docs (this manual, label hygiene) may still be docs-only.

**Existing committed spikes:** move the full writeup onto the issue; shrink the PR to the short locked summary. Hannah is driving that on [#79](https://github.com/jessepollak/home/pull/79). Do not open a second cleanup for the same spike.

| Kind | Where |
|---|---|
| Setup, boundaries, how-it-works, this manual | `docs/` |
| Pre-lock research / design spike | Issue thread (or Discussions) |
| Locked direction | Short `docs/` summary; long form stays on the issue |
| Product how-it-works | Same PR as the feature |

## Proof bar

User-visible work needs the Vercel preview link and one screenshot (or one short video for motion) in the PR description, captured from the current head. See [UI PR previews](ui-pr-previews.md). A reviewer should understand the change without opening the branch.

Docs-only, CI-only, and pure server PRs skip screenshots. They still need a clear claim of what changed and how it was checked (`bun check` at minimum). Product docs are not a standalone PR — see [Docs](#docs).

## Merge policy

Crew may review. Hannah owns the default eng-review flow and never merges. In a Jesse-authorized delegated run, the one fresh review in the [delivery loop](#delivery-loop) is the engineering gate.

**Only Jesse (`jessepollak`) gives final approval (+1) and merges.** The coordinator may undraft and mark `status:needs-jesse` when the delivery loop is complete; that grants no approval, merge, deployment, funded, destructive, or Neon-cleanup authority. Third-party PRs already required Jesse +1; crew PRs use the same bar.

Do not merge your own work. Do not treat a crew +1 as merge permission. Never ask Hannah to merge. Land-queue pings: [PR land chatter diet](#pr-land-chatter-diet).

### CloudAgent / Auto-review

Jesse-locked, September 8, 2026 (~9:14pm PT); launch path confirmed September 9, 2026 (~9:52pm PT). Global approval: crew **self-launches** CloudAgents. Do not wait on Hannah to proxy-launch.

- If Auto-review still blocks a launch, ping Hannah once — she greenlights immediately. No per-run Jesse card. Do not ping Jesse for CloudAgent greenlights.
- Hannah owns the default eng review (COMMENT LGTM on jessepollak-authored PRs); the delivery-loop review replaces a duplicate inactive Hannah stage in a Jesse-authorized delegated run.
- Jesse remains the only final approver and merger.
- Max one CloudAgent per PR unless Jesse marks P0. No tip-churn after Eng LGTM unless HOLD or CI fail. See [PR land chatter diet](#pr-land-chatter-diet).

## PR land chatter diet

Jesse-locked, September 10, 2026. Land-queue and babysitter GitHub listeners stay on a slim event set. This diet is the contract — do not keep it only in bot memory.

**Wake:** `pr-opened`, `pr-pushed`, `pr-merged`, `pr-closed`, `review-requested`, `review-changes-requested`, `ci-failed`.

**Do not wake (default):** `pr-comment`, `review-commented`, `inline-review-comment`, `review-approved`, `ci-passed`.

- **Exit quiet.** When labels + CI + draft already match the desired end-state for the event: no DMs, no board comments, no Jesse ping.
- **Board-first.** Soft merge order, HOLD, smoke fails, and blockers land as one issue/PR comment + label flip before (or instead of) crew DMs. See [Board is source of truth](#board-is-source-of-truth).
- **Batch asks.** At most one board comment and at most one owner ping per real state change. No Hazel+Hannah+Holly fan-out on the same tip.
- **Jesse-only approval and merge.** Never ask Hannah or the coordinator to approve or merge. See [Merge policy](#merge-policy).
- **Message Jesse only when he must decide, +1, or unblock.** If nothing for him: send nothing. Never narrate “quiet to Jesse”.
- **One CloudAgent.** Max one CloudAgent per PR unless Jesse marks P0. No tip-churn after Eng LGTM unless HOLD or CI fail. See [CloudAgent / Auto-review](#cloudagent--auto-review).
- **Quiet hours.** Prefer 10pm–8am PT for non-critical land wakes when a standing listener exists.

## Daily domain quality reviews

Weekdays ~9:00 PT. 15–20 min per lane. Async-first. Quiet if nothing actionable.

| Who | Pass |
|---|---|
| Hank | Backend |
| Holly | Frontend |
| Hazel | Design / preview on open UI PRs that day |
| Hannah | Eng review and labels. Never merge. |

**Shared (all lanes):** File or bump issues. Ping Hannah on merge-blockers. Quiet if clean.

### Hank

- `owner:hank` tickets.
- Opaque / 5xx without typed codes.
- Fail-closed auth. No double-prepare.
- File or bump. Do not expand scope.

### Holly

- Frontend tickets and UI previews.
- No CLS / clip.
- Direction 1. Ping Hazel for design LGTM.

### Hazel

- Preview present.
- LGTM or concrete nits.

### Hannah

- Eng-review undrafted PRs.
- Label one of `status:ready-for-review` or `status:needs-jesse` (see [hygiene](#status-label-hygiene)). Never merge.
- Weekly hygiene: max one issue.

### Good looks like

- Repro + preview on user-visible work.
- Typed money errors.
- Board labels current.
- Jesse-only merge.

Daily reviews feed the merge queue. Drafts stay draft until Jesse, or the coordinator completing the [delivery loop](#delivery-loop), undrafts. j (ops) owns folding playbook changes into this manual.

First two weeks: run informally. Report after ~5 days.

## Product tone

Direct, minimal UI. Follow [UI direction](ui-direction.md). No decorative kickers, no compliance essays on product screens, no pill-like buttons. Legal copy belongs only in Account → Disclosures / Terms.

# Operating manual

Status: agent-team operating contract, September 10, 2026. How Jesse's in-repo crew works. Not a product inventory and not production authorization.

**Current-state docs:** [build status](build-status.md), [contribution contract](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers), [UI direction](ui-direction.md), [UI PR previews](ui-pr-previews.md), [docs index](README.md). Human onboarding: [CONTRIBUTING](../CONTRIBUTING.md).

## Mission

Build Home as an app anyone can clone, run, contribute to, and extend. Fork-first. Operators customize brand, regions, assets, and providers in their own clone. Focused PRs back to this repo are optional for operators and required for the crew.

## Roles

| Name | Role |
|---|---|
| Jesse (`jessepollak`) | Human owner. Final +1 and merge. Everything ships through this GitHub account. |
| j | CEO / ops |
| Hunter | PM. Drive order. |
| Hannah | Head of Engineering. Quality, reliability, maintainability. Eng review and labels. Never merge — Jesse final +1 / merge. |
| Hugo | Architect. Architecture, cross-cutting technical integrity, independent review, and scoped fix PRs. Hannah retains engineering sequencing and review; Hunter retains drive order; Jesse retains final decisions, +1, and merge. Hugo is not a second execution coordinator and does not duplicate active lane ownership. |
| Hank | Backend |
| Holly | Frontend |
| Hazel | Design |
| Hope | DevRel / DX |

GitHub assignees are unused. Ownership is labels.

## Task persistence

GitHub Issues on `jessepollak/home` are the board for agent-team / multi-bot work.

The private `.git/feedback-inbox.md` is **not** the crew board. That file stays for solo human intake in a checkout. See [AGENTS.md](../AGENTS.md).

Every crew issue should carry one `owner:*`, one `status:*`, and one `lane:*`. Labels already exist on the repo.

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

One `status:*` at a time. Swap; do not stack. When you advance, remove the previous status label.

Prefer `status:working`. Do not use `status:in-progress` — deprecated. If you see it, remove it and apply the single current `status:*` (usually `status:working`).

#### Status label hygiene

**Add `status:ready-for-review`** only when all of:

- eng review is actually needed
- required design LGTM is done (if UI)
- the item is not on HOLD

Never on draft PRs.

**Add `status:needs-jesse`** only when:

- the item is truly ready for Jesse merge (Hannah eng LGTM done; Hazel if UI), or
- a Jesse decision is needed

Never before eng LGTM. Never on draft PRs. Never leave `needs-jesse` on an issue whose linked PR is still draft.

`status:needs-jesse` is not a substitute for Hannah's review. Eng review first; Jesse last.

On jessepollak-authored crew PRs, GitHub blocks formal `APPROVE` / `REQUEST_CHANGES`. Hannah's eng LGTM is a COMMENT, then she labels `status:needs-jesse`.

**Remove** both `status:ready-for-review` and `status:needs-jesse` when any of:

- design or eng HOLD
- `REQUEST_CHANGES`
- PR goes draft
- PR closed without merge
- issue returns to `todo` or `working`

Then leave only the single current `status:*`.

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

- Soft merge order, Design HOLD, smoke fails, and blockers land on the issue or PR (comment + label flip) before or instead of crew DMs. DMs, 1:1s, and babysitter are coordination, not source of truth. Land-queue / babysitter wake set and batching: [PR land chatter diet](#pr-land-chatter-diet).
- Every PR that maps to an issue — including drafts — carries the triad the same day, matching the related issue. Drafts stay `status:working` only — never `ready-for-review` or `needs-jesse` while still draft. #78 / #60 were unlabeled drafts; that is now the rule.
- On close or merge, scrub all `status:*` via REST `issues/{n}/labels`. Leave `owner:*` and `lane:*`. `gh pr edit` labels often no-ops.
- `status:in-progress` is deleted. Use `status:working` only.
- Dual `owner:*` labels are OK for FE+BE slices only when the issue comment names who owns which slice. Otherwise split issues.
- Land path is unchanged: `working` → `ready-for-review` → `needs-jesse`. Jesse-only merge. Hannah may merge docs-only when Jesse hands it.

## Drive order

- Hunter sets what the crew works on and in what product order.
- Hannah (Head of Engineering) sequences engineering and unblocks lanes.
- Do not start a second board, a parallel coordinator, or a shadow inbox for the same work.

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

Money-loop gates (do not weaken). Full list in the contribution contract:

- Never accept client-authored calldata / call plans.
- Never double-dispatch. Claim is the only grant of `dispatch`.
- Never authorize from `?wallet=` or a client user id.
- Never confirm from the client. Receipt + `verifiedExecution` only.
- Never use JS floats for token amounts, debt, or settlement.
- Never treat country or UI copy as eligibility.

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

User-visible work needs proof in the PR description: screenshots, a before/after, or a short repro. [UI PR previews](ui-pr-previews.md) is the screenshot convention. A reviewer should understand the change without opening the branch.

Process docs-only, CI-only, and pure server PRs can skip screenshots. They still need a clear claim of what changed and how it was checked (`bun check` at minimum). Product docs are not a standalone PR — see [Docs](#docs).

## Merge policy

Crew may review. Hannah's eng review can proceed. Hannah never merges.

**Only Jesse (`jessepollak`) gives the final +1 and merges.** Merge waits on Jesse even when Hannah has reviewed. Third-party PRs already required Jesse +1; crew PRs use the same bar.

When a PR is ready for Jesse, swap the issue to `status:needs-jesse` (and say so on the PR). See [status label hygiene](#status-label-hygiene). Do not merge your own work. Do not treat a crew +1 as merge permission. Never ask Hannah to merge. Land-queue pings: [PR land chatter diet](#pr-land-chatter-diet).

### CloudAgent / Auto-review

Jesse-locked, September 8, 2026 (~9:14pm PT); launch path confirmed September 9, 2026 (~9:52pm PT). Global approval: crew **self-launches** CloudAgents. Do not wait on Hannah to proxy-launch.

- If Auto-review still blocks a launch, ping Hannah once — she greenlights immediately. No per-run Jesse card. Do not ping Jesse for CloudAgent greenlights.
- Hannah still owns eng review (COMMENT LGTM on jessepollak-authored PRs).
- Jesse remains final +1 and merge.
- Max one CloudAgent per PR unless Jesse marks P0. No tip-churn after Eng LGTM unless HOLD or CI fail. See [PR land chatter diet](#pr-land-chatter-diet).

## PR land chatter diet

Jesse-locked, September 10, 2026. Land-queue and babysitter GitHub listeners stay on a slim event set. This diet is the contract — do not keep it only in bot memory.

**Wake:** `pr-opened`, `pr-pushed`, `pr-merged`, `pr-closed`, `review-requested`, `review-changes-requested`, `ci-failed`.

**Do not wake (default):** `pr-comment`, `review-commented`, `inline-review-comment`, `review-approved`, `ci-passed`.

- **Exit quiet.** When labels + CI + draft already match the desired end-state for the event: no DMs, no board comments, no Jesse ping.
- **Board-first.** Soft merge order, HOLD, smoke fails, and blockers land as one issue/PR comment + label flip before (or instead of) crew DMs. See [Board is source of truth](#board-is-source-of-truth).
- **Batch asks.** At most one board comment and at most one owner ping per real state change. No Hazel+Hannah+Holly fan-out on the same tip.
- **Jesse-only merge.** Never ask Hannah to merge. Hannah eng-reviews and labels only. See [Merge policy](#merge-policy).
- **Message Jesse only when he must decide, +1, or unblock.** If nothing for him: send nothing. Never narrate “quiet to Jesse”.
- **One CloudAgent.** Max one CloudAgent per PR unless Jesse marks P0. No tip-churn after Eng LGTM unless HOLD or CI fail. See [CloudAgent / Auto-review](#cloudagent--auto-review).
- **Quiet hours.** Prefer 10pm–8am PT for non-critical land wakes when a standing listener exists.

## Daily domain quality reviews

Weekdays ~9:00 PT. 15–20 min per lane. Async-first. Quiet if nothing actionable.

| Who | Pass |
|---|---|
| Hank | Backend |
| Holly | Frontend |
| Hazel | Design / proof on open UI PRs that day |
| Hannah | Eng review and labels. Never merge. |

**Shared (all lanes):** File or bump issues. Ping Hannah on merge-blockers. Quiet if clean.

### Hank

- `owner:hank` tickets.
- Opaque / 5xx without typed codes.
- Fail-closed auth. No double-prepare.
- File or bump. Do not expand scope.

### Holly

- Frontend tickets and UI proof.
- No CLS / clip.
- Direction 1. Ping Hazel for design LGTM.

### Hazel

- Proof artifact present.
- LGTM or concrete nits.

### Hannah

- Eng-review undrafted PRs.
- Label one of `status:ready-for-review` or `status:needs-jesse` (see [hygiene](#status-label-hygiene)). Never merge.
- Weekly hygiene: max one issue.

### Good looks like

- Repro + proof on user-visible work.
- Typed money errors.
- Board labels current.
- Jesse-only merge.

Daily reviews feed the merge queue. Drafts stay draft until Jesse undrafts. j (ops) owns folding playbook changes into this manual.

First two weeks: run informally. Report after ~5 days.

## Product tone

Direct, minimal UI. Follow [UI direction](ui-direction.md). No decorative kickers, no compliance essays on product screens, no pill-like buttons. Legal copy belongs only in Account → Disclosures / Terms.

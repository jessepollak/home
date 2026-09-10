# Operating manual

Status: agent-team operating contract, September 10, 2026. How Jesse's in-repo crew works. Not a product inventory and not production authorization.

**Current-state docs:** [build status](build-status.md), [contribution contract](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers), [UI direction](ui-direction.md), [UI PR previews](ui-pr-previews.md), [docs index](README.md). Human onboarding: [CONTRIBUTING](../CONTRIBUTING.md).

## Mission

Build Home as an app anyone can clone, run, contribute to, and extend. Fork-first. Operators customize brand, regions, assets, and providers in their own clone. Focused PRs back to this repo are optional for operators and required for the crew.

## Roles

| Name | Role |
|---|---|
| Jesse (`jessepollak`) | Human owner. Only Jesse gives final approval (+1) and merges. The scoped coordinator undraft exception is in [Continuous issue pipelines](#continuous-issue-pipelines); deployment remains separately authorized. Everything ships through this GitHub account. |
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

GitHub Issues on `jessepollak/home` are the sole board and intake for all Home feedback and tasks, including solo checkout work. Do not create or use a local, private, or parallel intake board.

Every issue used to track work should carry one `owner:*`, one `status:*`, and one `lane:*`. Labels already exist on the repo.

### Session execution checklist

Use native todos as a short checklist of the coordinator's next 3–5 parent actions, not as another issue backlog. Link each action to its existing GitHub issue or PR; new work, priorities, ownership, blockers, and delivery status belong on GitHub first.

- Name the next action, such as "Publish #157 proof" or "Review #215 handoff," rather than copying an entire feature ticket. Keep exactly one action `in_progress` while the parent is working; this reflects parent attention, not the number of parallel agents.
- Mark an action in progress before starting it and complete it immediately after its stated result is verified. Failed or partial actions stay open with the blocker recorded on GitHub. Completing a checklist action does not imply the issue shipped, merged, or passed live acceptance.
- Track child execution in the agent fleet by run ID. Keep only recovery pointers, candidate refs, evidence paths, and next actions in the checkpoint; do not duplicate the fleet or long-term backlog in todos.
- Reconcile the checklist at handoffs and before yielding or compacting. Remove superseded entries only after their remaining work has a durable GitHub pointer; replace stale umbrella tasks with the next concrete parent action.

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
- required design LGTM is done (if UI), after reviewing published exact-tip proof under [UI PR previews](ui-pr-previews.md)
- the item is not on HOLD

For UI PRs, every head-changing push requires fresh After/ready-state capture, republication, a new immutable per-capture manifest, and renewed proof review before this advancement.

Never on draft PRs.

**Add `status:needs-jesse`** only when:

- the item is truly ready for Jesse merge (required engineering review done; Hazel if UI), after the required UI proof review, or
- a Jesse decision is needed; this decision escalation is allowed without visual-proof gating

For readiness to merge, never before the required engineering review and never while the PR remains draft. A decision escalation may use `status:needs-jesse` without engineering review or visual proof, including for an otherwise completed draft awaiting Jesse's explicit undraft decision outside a coordinator-authorized run. In that draft exception, the issue and PR must name the decision and state that the draft is not merge-ready; swap to the single truthful next status after Jesse decides.

`status:needs-jesse` is not a substitute for required engineering review. In the default crew flow, Hannah's eng LGTM is a COMMENT on jessepollak-authored PRs before she labels `status:needs-jesse`. In a Jesse-authorized delegated run, fresh exact-head Astra engineering review is the engineering gate; no separate inactive Hannah stage is required. The coordinator may undraft and mark `status:needs-jesse` only after every scoped publication gate in [Continuous issue pipelines](#continuous-issue-pipelines) passes.

**Remove** both `status:ready-for-review` and `status:needs-jesse` when any of:

- design or eng HOLD
- `REQUEST_CHANGES`
- PR goes draft, unless an otherwise completed draft is truthfully using decision-only `status:needs-jesse` for Jesse's explicit undraft decision outside a coordinator-authorized run
- a head-changing push invalidates published After/ready-state proof; remove `status:ready-for-review` or merge-ready `status:needs-jesse` until fresh capture, republication, a new immutable per-capture manifest, and renewed proof review, but do not remove a truthful decision-only `status:needs-jesse` for lack of visual proof
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
- Every PR that maps to an issue — including drafts — carries the triad the same day, matching the related issue. Drafts stay `status:working` and never claim `ready-for-review` or merge-ready `needs-jesse`. The exceptions are an otherwise completed draft truthfully labeled decision-only `status:needs-jesse` while awaiting Jesse's explicit undraft decision outside a coordinator-authorized run, and a coordinator undraft performed only after the scoped gates below pass. A decision-only draft must say it is not merge-ready. #78 / #60 were unlabeled drafts; same-day triad labeling remains the rule.
- On close or merge, scrub all `status:*` via REST `issues/{n}/labels`. Leave `owner:*` and `lane:*`. `gh pr edit` labels often no-ops.
- `status:in-progress` is deleted. Use `status:working` only.
- Dual `owner:*` labels are OK for FE+BE slices only when the issue comment names who owns which slice. Otherwise split issues.
- Default land path is `working` → `ready-for-review` → `needs-jesse`. A Jesse-authorized delegated run may use the scoped coordinator publication path below without a duplicate inactive Hannah stage. Jesse alone approves and merges every PR.

## Drive order

- Hunter sets what the crew works on and in what product order.
- Hannah (Head of Engineering) sequences engineering and unblocks lanes.
- Jesse-approved priorities and scope remain governed by the [#205 priorities contract](https://github.com/jessepollak/home/issues/205).
- Do not start a second board, a parallel coordinator, or a shadow inbox for the same work.

## Continuous issue pipelines

For a parallel push that Jesse has explicitly approved and scoped for that run, Hugo — in the existing Architect role — performs run-specific execution coordination. This does not create a standing or parallel coordinator and does not change Hunter's drive order, Hannah's standing engineering sequencing role, the #205 priorities contract, or Jesse's final approval and merge authority. Fresh exact-head Astra engineering review supplies the engineering gate for this delegated run; no separate inactive Hannah stage is required. GitHub Issues and PRs remain the [sole board](#board-is-source-of-truth); do not create a parallel intake queue, backlog, or shadow inbox. The [session checklist](#session-execution-checklist) tracks only current parent actions. The coordinator owns requirements, dependency barriers, environment provisioning, handoff disposition, integration, destination validation, and the narrowly gated publication action below.

Start with six engineering issue lanes and up to eight pooled executing children. These are ceilings, not quotas: never start work merely to fill capacity. Each issue lane owns scope through implementation, review/proof, correction, and delivery; writers and reviewers consume pooled capacity rather than becoming separate lanes. Cap concurrent writers at four and heavy build/browser jobs at two while retaining review/proof capacity. CI watchers are not workers. Scale only to eight lanes and ten children after measured occupancy, handoff, review, backlog, and resource thresholds support it. Jesse-ready PRs enter his approval queue.

- Use one writer per worktree. Before dispatch, record on the issue: scope, file ownership, parent/base and head SHA, acceptance checks, required review, destination, and next owner.
- Service each actionable completed delivery or integration handoff as soon as it becomes actionable: integrate and validate it at the destination, assign a concrete correction, or record an explicit truthful blocker with the current owner and a named observable resumption condition. Disposition or closure alone is not service, and deferral without that blocker and resumption condition is prohibited. After servicing the handoff, advance its lane and dispatch the next independent eligible work within the ceilings. Do not wait for all lanes, siblings, or handoffs to finish, and do not create a global wait-for-all barrier; unrelated active or non-actionable handoffs do not block rolling dispatch. Never bypass hotspot/dependency exclusions or replenish to a quota.
- A paused lane must retain its board status and name the dependency, current owner, retained candidate/ref, next action, and observable trigger that resumes work. A vague HOLD or idle worker is not a paused-state record.
- Before initial work, review, or integration, verify the exact-head checkout, dependencies, and required live URL, then deterministically check the recorded parent SHA and candidate SHA, required CI and merge state, relevant issue/PR thread, published attachment identity and hashes, and current labels. Routine follow-up with unchanged head and accepted evidence is metadata-delta-only: inspect only what changed since the accepted state; do not restart broad audits or recapture unchanged accepted evidence. After interruption or a state-changing event, recheck the affected exact records plus retained runs, supervisor requests, refs, and environments.
- The coordinator may undraft a PR and mark `status:needs-jesse` only after Sol integration, fresh exact-head Astra engineering review, current CI, and every applicable proof, design, security, platform, provider, and dependency gate pass. Target publication of the ready PR state and `status:needs-jesse` within `<=5 minutes` of the last required gate passing. The target never bypasses a gate; if missed, record a named truthful blocker, current owner, and observable resumption trigger.
- Keep premerge gate completion, the coordinator's authorized undraft/`status:needs-jesse` publication, Jesse's approval/merge actions, any separately authorized deployment action, postdeployment validation, and production-incident closure as separate handoffs. The [#219](https://github.com/jessepollak/home/issues/219) / [#211](https://github.com/jessepollak/home/issues/211) pattern does not allow a merge-ready fix or merge to stand in for deployed recovery and observed incident closure.
- Supervisor requests are blocking; service them through the bridge before continuing. Time-box review questions, but never convert incomplete review into approval. Publish HOLDs promptly when a candidate is unsafe or incomplete.
- After two consecutive related unresolved lifecycle or state-machine correction rounds, pause further correction fan-out for that issue and consolidate one invariant matrix covering transitions, failure cases, ownership, evidence, and terminal conditions; then assign one coherent writer against that matrix. Independent lanes continue. This is not a review-count limit or permission to accept unresolved defects.
- Jesse alone approves and merges. This delegation grants no deployment, funded, destructive, or Neon-cleanup authority. Retain candidate refs, worktrees, manifests, and evidence until integration, delivery, and any required incident closure settle; funded activity always requires separate explicit confirmation.

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

User-visible work needs final-head live proof in the PR description. [UI PR previews](ui-pr-previews.md) is the authoritative capture, provenance, publication, and review convention. A reviewer should understand the change without opening the branch. Every head-changing push requires fresh After/ready-state capture, republication as new attachments, a new immutable per-capture manifest accessible from the PR, and renewed proof review before a UI PR advances to `status:ready-for-review` or `status:needs-jesse` for merge. Truthful Before captures may retain older provenance. `status:blocked` and `status:needs-jesse` for a Jesse decision remain available without visual-proof gating.

Process docs-only, CI-only, and pure server PRs can skip screenshots. They still need a clear claim of what changed and how it was checked (`bun check` at minimum). Product docs are not a standalone PR — see [Docs](#docs).

## Merge policy

Crew may review. Hannah owns the default eng-review flow and never merges. In a Jesse-authorized delegated run, fresh exact-head Astra engineering review satisfies that gate without a separate inactive Hannah stage.

**Only Jesse (`jessepollak`) gives final approval (+1) and merges.** The coordinator may undraft only under the scoped gates in [Continuous issue pipelines](#continuous-issue-pipelines). That exception grants no approval, merge, deployment, funded, destructive, or Neon-cleanup authority. Third-party PRs already required Jesse +1; crew PRs use the same bar.

When a PR is ready for Jesse, swap the issue to `status:needs-jesse` (and say so on the PR); in the authorized delegated run, the coordinator performs that publication under the scoped gates and timing target. See [status label hygiene](#status-label-hygiene). Do not merge your own work. Do not treat a crew +1 as merge permission. Never ask Hannah to merge. Land-queue pings: [PR land chatter diet](#pr-land-chatter-diet).

### CloudAgent / Auto-review

Jesse-locked, September 8, 2026 (~9:14pm PT); launch path confirmed September 9, 2026 (~9:52pm PT). Global approval: crew **self-launches** CloudAgents. Do not wait on Hannah to proxy-launch.

- If Auto-review still blocks a launch, ping Hannah once — she greenlights immediately. No per-run Jesse card. Do not ping Jesse for CloudAgent greenlights.
- Hannah owns the default eng review (COMMENT LGTM on jessepollak-authored PRs); fresh exact-head Astra review replaces a duplicate inactive Hannah stage in a Jesse-authorized delegated run.
- Jesse remains the only final approver and merger.
- Max one CloudAgent per PR unless Jesse marks P0. No tip-churn after Eng LGTM unless HOLD or CI fail. See [PR land chatter diet](#pr-land-chatter-diet).

## PR land chatter diet

Jesse-locked, September 10, 2026. Land-queue and babysitter GitHub listeners stay on a slim event set. This diet is the contract — do not keep it only in bot memory.

**Wake:** `pr-opened`, `pr-pushed`, `pr-merged`, `pr-closed`, `review-requested`, `review-changes-requested`, `ci-failed`.

**Do not wake (default):** `pr-comment`, `review-commented`, `inline-review-comment`, `review-approved`, `ci-passed`.

- **Exit quiet.** When labels + CI + draft already match the desired end-state for the event: no DMs, no board comments, no Jesse ping.
- **Board-first.** Soft merge order, HOLD, smoke fails, and blockers land as one issue/PR comment + label flip before (or instead of) crew DMs. See [Board is source of truth](#board-is-source-of-truth).
- **Batch asks.** At most one board comment and at most one owner ping per real state change. No Hazel+Hannah+Holly fan-out on the same tip.
- **Jesse-only approval and merge.** Never ask Hannah or the coordinator to approve or merge. Hannah handles the default eng-review flow; Astra handles the authorized delegated run's fresh exact-head review. See [Merge policy](#merge-policy).
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

Daily reviews feed the merge queue. Drafts stay draft until Jesse, or a coordinator acting under the narrow authorized gates above, undrafts. j (ops) owns folding playbook changes into this manual.

First two weeks: run informally. Report after ~5 days.

## Product tone

Direct, minimal UI. Follow [UI direction](ui-direction.md). No decorative kickers, no compliance essays on product screens, no pill-like buttons. Legal copy belongs only in Account → Disclosures / Terms.

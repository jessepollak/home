# Home delivery in GitHub

The strategy owns scope. Issues own delivery state, decisions, and evidence. The private user-owned [Home Project](https://github.com/users/jessepollak/projects/1) visualizes those same issues. Setup and activation are tracked in [#564](https://github.com/jessepollak/home/issues/564).

## Workstream index

| Workstream | Parent |
| --- | --- |
| Money in/out | [#565](https://github.com/jessepollak/home/issues/565) |
| Save and spend | [#566](https://github.com/jessepollak/home/issues/566) |
| Invest | [#567](https://github.com/jessepollak/home/issues/567) |
| Credit | [#395](https://github.com/jessepollak/home/issues/395) |
| Operator platform | [#568](https://github.com/jessepollak/home/issues/568) |
| Identity and account | [#569](https://github.com/jessepollak/home/issues/569) |
| Design and experience | [#207](https://github.com/jessepollak/home/issues/207) |
| Engineering, security, and privacy | [#570](https://github.com/jessepollak/home/issues/570) |

Credit and Design reuse existing programs. Their historical bodies need reconciliation against the strategy before implementation: Credit's initial cbBTC sequence does not limit the final cb-asset scope; old design proposals do not override the current design system. Body updates were not made during setup.

Use native sub-issues for delivery work, preserving existing hierarchy when it is already useful. An intermediate program such as #15 can sit beneath a workstream. A child has one primary workstream; cross-cutting dependencies are links. The selected native edges and MVP membership below have been audited; other checklist links remain proposals, not automatic release scope.

## Filing an issue

This is the canonical creation contract; `AGENTS.md` points here. Decide placement before creating, then attach hierarchy and Project membership deliberately.

1. **Search and reuse.** Search open and closed issues — text, labels, milestone, and existing hierarchy — before creating. Update the issue that already tracks the work; do not duplicate it or start a parallel board.
2. **Choose the primary workstream and nearest useful parent before creating.** Pick one of the eight [Workstream index](#workstream-index) roots, then choose the nearest useful parent in that workstream: either the root itself or an intermediate program such as #15 when it is the right container.
3. **Create with labels, not routing.** One `status:*`, one `lane:*`, one `priority:*`. No `owner:*` labels, no GitHub assignee routing, no `factory:ready` — only Jesse applies that label; agents and external creation assistants never do. If Jesse directly requests creation in an interactive session, the issue body is Jesse-directed and does not receive `<!-- factory -->`.
4. **Establish the native parent edge.** Attach the issue to that parent through GitHub's native parent/sub-issue relation. A body mention, checklist link, or "related to" reference does not create hierarchy.
5. **Ensure Home Project membership.** Add the issue to the [Home Project](https://github.com/users/jessepollak/projects/1), or confirm it arrived through native auto-add or the repository sync. Membership is verified, not assumed.
6. **Keep dependencies as links.** Cross-cutting and blocking dependencies stay ordinary issue links or named dependencies; only the primary workstream ancestor is a native parent.
7. **Verify source state immediately.** Through the API, confirm the native parent, Project membership, and exactly one `status:*`/`lane:*`/`priority:*`. API verification is required; Project UI confirmation is optional.
8. **Verify derived fields after reconciliation.** The derived **Delivery status**, **Workstream**, and **Level** fields are synchronized from issue state, labels, and the native parent chain, so they can lag source state by up to one hourly interval — an issue can be opened before its native parent is attached. Confirm them after the next hourly reconciliation or an authorized manual reconciliation. Never hand-edit a derived field as the remedy: fix the source (parent edge, labels, state) and let reconciliation repair it ([sync operation and recovery](#sync-operation-and-recovery)). The Project's built-in `Status` field is intentionally unused, and hand-edited derived values are not source state.
9. **Parentless is limited to the configured roots.** Only the eight [Workstream index](#workstream-index) roots may have no native parent. The sync policy validates that the checked-in configuration contains exactly eight roots; it does not repair a parentless non-root issue, which remains unclassified until its native edge is fixed. Intermediate programs and tracking containers need a native parent under a configured root, and delivery issues get no exception — an absent parent is otherwise an unfiled hierarchy edge. Changing the configured root set is not an ordinary filing choice: it requires reviewed updates to this guide, `scripts/delivery/home-project-config.json`, the eight-root sync policy, and the Project's **Workstream** options as applicable.

Membership and mentions are not hierarchy. An issue that sits in the Home Project and links its workstream only in prose is mis-filed: it has no native parent, sub-issue progress rollups exclude it, and the derived Workstream stays empty until the native edge exists. Creating that edge is the recovery step.

## Views

Use one **Home MVP** repository milestone for agreed release work. Keep later work visible outside that milestone.

| Saved view | Layout and selection | Answers |
| --- | --- | --- |
| MVP overview | Table of the eight parents; show sub-issue progress and status | How is each workstream progressing? |
| Delivery | Board of MVP delivery issues; columns by Delivery status, swimlanes by Workstream | What is moving and blocked? |
| Needs Jesse | Table filtered to `status:needs-jesse`; priority and decision links | What needs a decision or merge? |
| Ready for factory | MVP delivery issues with `factory:ready` and `status:todo` | Which issues are candidates for the supervisor? |

The factory view is not an eligibility check. The supervisor still validates owner authorship, issue state, required labels, and linked open PRs. Current and legacy attribution markers in an issue body neither grant nor deny eligibility. Parent issues are tracking containers, not runnable tasks.

Use native fields for title, labels, milestone, linked PRs, parent, and sub-issue progress. Add only three derived fields: **Delivery status**, **Workstream**, and **Level** (Workstream or Delivery). Display priority labels initially; add a derived sortable field only if needed. Completion counts show task progress, not proof that money journeys work.

## One-way synchronization contract

The reviewed repository sync is implemented under #564, the administrative backfill is verified, and the workflow is merged on `main`. `HOME_PROJECT_TOKEN` is provisioned in the protected `home-project` Actions environment, and successful issue-triggered and manual runs were observed on 2026-09-16; the scheduled hourly run is not yet verified. The Project's built-in `Status` field is intentionally unused; only the three Home-derived fields below are synchronized.

| Issue state | Delivery status |
| --- | --- |
| Open, `status:todo` | Todo |
| Open, `status:working` | Working |
| Open, `status:ready-for-review` | Independent review |
| Open, `status:needs-jesse` | Needs Jesse |
| Open, `status:blocked` | Blocked |
| Closed, completed | Done |
| Closed, not planned or duplicate | Not planned |
| Missing/conflicting labels or unknown close reason | Needs triage |

Closed state takes precedence. Derive Workstream from the nearest ancestor in the index, and Level from membership in the eight roots. Unclassified items stay visible for triage. Read current state before every update; retries must be idempotent. A board drag never changes issue labels, scope, or execution permission and is corrected by reconciliation.

Trigger reconciliation on issue creation, label/state changes, milestone changes, and hierarchy changes where supported; use a periodic full reconciliation to repair missed events. Backfill existing issues explicitly. Native auto-add can collect new matching issues but does not replace initial backfill or custom-field synchronization. Keep PRs linked to issues rather than duplicating every PR as a delivery card.

Run ongoing Project writes only in the dedicated default-branch workflow's protected `home-project` environment with `HOME_PROJECT_TOKEN`; the default repository GITHUB_TOKEN cannot access this user Project. GitHub [does not support fine-grained PAT access to user-owned Projects](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). Provision a dedicated, expiring classic PAT with `project` scope only: this repository is public and the sync does not write repository data. Do not grant `repo` or `public_repo` merely for public issue reads. The `project` scope inherently reaches the user's Projects, not only Home; mitigate that platform limit with expiration, the dedicated environment restricted exactly to `main`, and the checked-in Project/field allowlist. The dedicated-token execution path now runs from that protected environment; only the scheduled hourly path remains unverified.

The environment and its token are provisioned. Keep the token step-local: never copy it into app `.env` files, factory workers, untrusted PR workflows, artifacts, or repository-wide secrets. The workflow checks out trusted `main`, installs no dependencies, and never executes issue content. Project, field, option, milestone, repository, and root IDs are non-secret configuration. For the reviewed one-time administrative backfill, the authenticated parent uses `gh api graphql` as the transport without extracting its keyring credential, exporting it to workers, or uploading its broader OAuth token to Actions.

## Activation checklist

1. Find an existing Home Project/milestone before creating either. Create or reuse the user-owned Project, link this repository, and select visibility deliberately.
2. Create/reuse Home MVP and apply it to the eight parents and audited release issues. Review Credit and Design's broader historical children individually.
3. Establish native parent/sub-issue relationships without displacing existing parents blindly. Add the selected issues to the Project and backfill derived fields.
4. Create the four saved views above. Keep Not planned out of normal delivery columns and retain a triage table/filter.
5. Implement the synchronization contract in a reviewed PR; configure authorized credentials separately. Test status change, block/unblock, close/reopen, parent change, malformed labels, repeat reconciliation, and lack of any label/permission mutation.
6. Confirm both UI and API report the same state. Link the live Project in this document, the repository README, and #564. Record sync health and a manual recovery command in the implementation PR before closing setup.

The private Project, Home MVP milestone, four populated saved views, and protected `home-project` environment exist. API verification on 2026-09-16 found **81 Issue items** with all three derived fields matching an independent source-state calculation. A repeat reconciliation reported 81 unchanged issues and zero planned additions, updates, or clears.

The initial live pass saw 69 candidates, added 59 items, and updated 193 fields. The next snapshot contained 12 additional items with blank fields; the cause of that membership change was not established. A second pass filled those 36 fields without adding items. These are observed mutation counts, not counts inferred from dry-run totals.

A recovery check deliberately changed only #564's derived Project status from Working to Todo. Reconciliation restored Working with one field update and 80 unchanged issues; the issue's state and labels were identical before and after. Independent verification again found all 81 items correct. This proves administrative stale-field recovery, not hosted event delivery.

Saved-view API results matched independently computed item sets: [MVP overview](https://github.com/users/jessepollak/projects/1/views/1) **8**, [Delivery](https://github.com/users/jessepollak/projects/1/views/2) **40**, [Needs Jesse](https://github.com/users/jessepollak/projects/1/views/3) **7**, and [Ready for factory](https://github.com/users/jessepollak/projects/1/views/4) **7**. Counts are a dated snapshot, not fixed acceptance targets. Delivery uses `milestone:"Home MVP" Level:Delivery -delivery-status:"Not planned"`, with Workstream swimlanes and Delivery status columns. The API accepts the hyphenated field key; quoting the field name produced an empty view and was corrected.

The implementation passed independent review, 19 focused tests, clean-environment factory preflight, frozen-lockfile installation, and `bun check`. Token provisioning and the authorized merge are complete: successful dedicated-token issue-event and manual runs were observed on 2026-09-16. Browser rendering and the scheduled hourly hosted run remain unverified; do not infer scheduled-sync health from the triggered runs.

### Native hierarchy and milestone audit

The parent audit verified 54 new or reused native parent edges, preserved five existing #15→#54–#58 edges outside MVP, and assigned 48 issues to Home MVP: the eight indexed roots and these 40 delivery issues:

`#294 #512 #551 #552 #553 #554 #555 #556 #557 #541 #558 #563 #396 #397 #456 #457 #436 #420 #529 #94 #399 #400 #401 #461 #532 #533 #534 #535 #536 #509 #510 #511 #448 #447 #446 #389 #380 #355 #365 #371`.

Scope exclusions and unresolved evidence are deliberate:

- #15 is broad historical research; #54–#58 remain outside MVP. #558 retains #15 as its intermediate parent.
- #44 is a historical locked-UI trading fix, not proof of the full two-account investment scope.
- #254–#258 and #347 are historical design migrations; #419 is a visual enhancement, not an established release gate.
- #516, #366, #499, and #559 are nonblocking maintenance/test follow-ups; #564 is Project operations, not a release feature.
- #568 has no bounded audited delivery children yet.
- #436 is closed/completed, but its body still says Peer onramp is unimplemented and staging/written-confirmation gates are pending. Its MVP membership records required scope, **not completion proof**; this audit did not reopen it or change authorization.
- Historical Credit and Design bodies do not supersede the current strategy. Unselected open issues remain discoverable without guessing their workstream or MVP membership.

This is a hierarchy/membership audit, not an exhaustive implementation audit. It changed no issue authorization or delivery-state labels.

### Sync operation and recovery

Native issue events reconcile creation, reopen/close, labels, and milestone changes. An hourly full reconciliation repairs missed events and native hierarchy changes, for which Actions has no dependable issue trigger. Every run reads current issue state, labels, parent chain, Project membership, and field values before idempotent writes. It may add repository Issue items and set or clear only `Delivery status`, `Workstream`, and `Level`; it never changes issue labels, state, hierarchy, milestone, permissions, or authentication, and it skips pull requests and drafts.

Source reads and Project writes are not atomic: issue metadata can change between them. The next event or hourly reconciliation repairs that race; there is no compare-and-swap guarantee. Verify final values independently rather than treating successful mutation IDs or planned-field counters as source-state proof.

The default manual dispatch is a dry run and is rejected from refs other than `main`. After reviewing its output, an operator may dispatch with dry run disabled for backfill/recovery. In an approved ephemeral operator context where `HOME_PROJECT_TOKEN` has already been securely injected, the equivalent direct commands are:

```sh
node scripts/delivery/sync-home-project.mjs --dry-run
node scripts/delivery/sync-home-project.mjs
```

Do not place token literals in commands or shell history, save them in files/profiles, or extract the local `gh` keyring credential. An authorized parent can instead use a reviewed `gh api graphql` transport for one-time administration without exporting any token. `bun run project:sync:dry-run` and `bun run project:sync` are aliases for the dedicated-token CLI. Follow any backfill with a dry run reporting no planned changes, an independent source-to-field check, and a comparison of Project UI and API state. Record which checks actually ran on #564; API verification alone is not browser UI or hosted-workflow proof.

## Agent handoff

Pick an authorized issue, read its workstream and relevant strategy section, inspect the gap, and follow the operating manual. Update issue labels and evidence as work changes. Product/design decisions belong in the issue; long-lived scope changes belong in strategy PRs. Agents can read the same issue hierarchy and labels through the API without interpreting a screenshot of the board.

References: [Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects), [built-in workflows](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations), [Actions automation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions).

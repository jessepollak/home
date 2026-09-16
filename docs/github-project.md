# Home delivery in GitHub

The strategy owns scope. Issues own delivery state, decisions, and evidence. One GitHub Project named **Home** visualizes those same issues. Setup is tracked in [#564](https://github.com/jessepollak/home/issues/564).

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

Use native sub-issues for delivery work, preserving existing hierarchy when it is already useful. An intermediate program such as #15 can sit beneath a workstream. A child has one primary workstream; cross-cutting dependencies are links. Checklist links currently in parent bodies are proposed associations, not completed native hierarchy. Audit them before assigning MVP membership; not every historical program child necessarily blocks MVP.

## Views

Use one **Home MVP** repository milestone for agreed release work. Keep later work visible outside that milestone.

| Saved view | Layout and selection | Answers |
| --- | --- | --- |
| MVP overview | Table of the eight parents; show sub-issue progress and status | How is each workstream progressing? |
| Delivery | Board of MVP delivery issues; columns by Delivery status, swimlanes by Workstream | What is moving and blocked? |
| Needs Jesse | Table filtered to `status:needs-jesse`; priority and decision links | What needs a decision or merge? |
| Ready for factory | MVP delivery issues with `factory:ready` and `status:todo` | Which issues are candidates for the supervisor? |

The factory view is not an eligibility check. The supervisor still validates human authorship, markers, linked PRs, and every existing intake rule. Factory-authored parent issues are tracking containers, not runnable tasks.

Use native fields for title, labels, milestone, linked PRs, parent, and sub-issue progress. Add only three derived fields: **Delivery status**, **Workstream**, and **Level** (Workstream or Delivery). Display priority labels initially; add a derived sortable field only if needed. Completion counts show task progress, not proof that money journeys work.

## One-way synchronization contract

Implement under #564 after confirming Project access. This document specifies the sync; it is not deployed automation.

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

Run Project writes in a separately authorized supervisor/Actions context with narrowly scoped Project credentials; the default repository GITHUB_TOKEN cannot access Projects. Never expose Project credentials to factory workers or untrusted PR workflows. Do not execute issue text. Store project/field IDs in repository configuration, not secrets; keep credentials in the approved secret store.

## Activation checklist

1. Find an existing Home Project/milestone before creating either. Create or reuse the user-owned Project, link this repository, and select visibility deliberately.
2. Create/reuse Home MVP and apply it to the eight parents and audited release issues. Review Credit and Design's broader historical children individually.
3. Establish native parent/sub-issue relationships without displacing existing parents blindly. Add the selected issues to the Project and backfill derived fields.
4. Create the four saved views above. Keep Not planned out of normal delivery columns and retain a triage table/filter.
5. Implement the synchronization contract in a reviewed PR; configure authorized credentials separately. Test status change, block/unblock, close/reopen, parent change, malformed labels, repeat reconciliation, and lack of any label/permission mutation.
6. Confirm both UI and API report the same state. Link the live Project in this document, the repository README, and #564. Record sync health and a manual recovery command in the implementation PR before closing setup.

Current setup has issue links and documentation only. Project creation, milestone assignment, native hierarchy, saved views, and synchronization remain pending because the available connector does not expose those mutations.

## Agent handoff

Pick an authorized issue, read its workstream and relevant strategy section, inspect the gap, and follow the operating manual. Update issue labels and evidence as work changes. Product/design decisions belong in the issue; long-lived scope changes belong in strategy PRs. Agents can read the same issue hierarchy and labels through the API without interpreting a screenshot of the board.

References: [Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects), [built-in workflows](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations), [Actions automation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions).

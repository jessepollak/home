# Work sizing

How to scope an issue, when to file another one, and how to handle debt so that work lands instead of waiting in conflict. [Product strategy](product-strategy.md#5-delivery-order) and the [product frame](prd-template.md) decide *what* to build; this page decides how the work is cut and sequenced.

## The constraint

Main takes dozens of merges a day and one person approves them. An open pull request that touches a busy file for more than about a day conflicts, however good the code is, and every repair makes it longer-lived. Size work to how quickly it can merge, not to how small it looks.

The failure this page exists to prevent: one change split into sibling issues that run at the same time against the same foundation. Examples: query-factory reads in three PRs, balance and Activity contract validation in two, a currency registry and its first expansion in two, all open together. Each sibling repairs against every other sibling's intermediate state. Small PRs in *different* areas were not the problem; small PRs in the *same* area were.

## Areas

An area is a set of paths that concurrent changes cannot safely share. Every issue that edits an area names it in its body with one line, `Area: <name>`. More than one line is allowed; none means the change touches no area.

| Area | Paths |
| --- | --- |
| `shell` | `apps/web/client/home/shell*`, the shell layout and page route files under `apps/web/app/` |
| `query-cache` | `apps/web/client/query/`, owner-scoped cache and restored-cache code |
| `session` | `apps/web/client/account/cdp-session-lifecycle.tsx`, `apps/web/client/account/cdp-money-action-execution.ts` |
| `money-actions` | `apps/web/server/actions/`, `apps/web/server/money-actions/` |
| `assets` | `apps/web/config/portfolio-assets.ts`, `apps/web/shared/savings/config.ts`, the cash currency registry |
| `operator-settings` | `apps/web/server/operator-settings/`, `apps/web/app/admin/` |

These are the [shared merge hotspots](operating-manual.md#shared-merge-hotspots) grouped by what changes together. Add an area when the same paths show up in two conflicting PRs; remove one when its paths stop colliding.

**One open change per area.** At most one open issue-in-progress or unmerged PR edits an area at a time. The next issue in that area carries `Depends on #<current>` and waits. Independent areas run fully in parallel. Additive files that the area already owns one-per-entry (for example a new feature-map surface file) do not count as editing the area.

## Sizing an issue

Size an issue to one owner and one reviewable merge, not to a line or file count.

- **A migration or cross-cutting refactor is one issue with one owner**, however many files it touches. That owner either lands it as one PR opened and merged within a day, or as a sequence of PRs where each merges before the next opens. It is never split into sibling issues that run in parallel.
- **Split only along area lines or customer outcomes.** Two changes in different areas with no dependency are two issues. Two changes in the same area are one issue, or two issues joined by `Depends on`.
- **A foundation and its first consumer are ordered, not parallel.** The expansion issue says `Depends on #<foundation>`.
- **Mechanical changes are done in one pass.** Renames, codemods and "move every read to X" land together, rather than being sampled across several PRs that each leave the tree half-migrated.

Before filing or starting an issue, check open issues and PRs for the same area. If one exists, add to it (comment, or amend its scope with Jesse's agreement), depend on it, or wait. Do not open a parallel one.

## Stale branches

A PR that has needed conflict repair three times, or has been open for three days in an area that has since moved, is redone rather than repaired again: close it, keep the branch as a reference, and redo the change in one pass on current main. A redo on a fresh base is usually faster than another repair, and it gets reviewed for behaviour instead of for merge resolution.

## Debt

Debt found while working is handled in this order:

1. **Fix it in the current change** when it lives in files the change already edits and the fix does not widen the review.
2. **Ratchet it** when it is countable: a lint rule, a baseline that may only shrink, or a gate. A ratchet replaces an issue per occurrence. See [gates](gates.md) and the [rule-first policy](operating-manual.md#delivery-loop).
3. **Append it to the area's debt issue**, `chore(<area>): pay down <area> debt`, one open issue per area. Add a checklist line naming the path and the problem. Do not file a new issue per finding.
4. **Otherwise drop it.** A style preference, a hypothetical, or a nit no reviewer would block on is not an issue.

A debt issue is worked as one change in its area, like a migration.

## Filing follow-up issues

A follow-up is filed only when all of these hold:

- it is a distinct customer outcome, or a verified defect outside the current diff;
- no open issue already covers it or its area (otherwise comment there);
- it names its `Area:` lines and its ordering (`Depends on #<n>`) relative to open work in that area;
- it states acceptance that can be checked.

Everything else goes in the PR description under **Not verified / risk**, into the area's debt issue, or nowhere. Deferred review findings of low severity join the area's debt issue rather than a new one. A follow-up in an area with an open change is not queued until that change merges.

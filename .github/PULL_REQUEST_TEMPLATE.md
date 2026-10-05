## What changes

| | Summary |
| --- | --- |
| **Before** | What happens today, in plain words. |
| **After** | What happens once this merges. |
| **Who notices** | users / developers (name the command, job, or file) / operators / nobody (refactor) |
| **Your call** | none |
| **Risk** | none |

<!-- Write for someone who has not read the issue or the diff. Name the concrete thing that changes (screen, route, command, CI job, table) and describe behavior, not mechanics. At most 200 words; keep each cell on one line. Your call: a choice you made that Jesse might reverse, else "none"; an unmet required verification rung, a skipped Real money check, or a pending operator action always goes here as "approve without …". Risk: the one thing most likely to go wrong, else "none"; known gaps belong in the area's debt issue, not here. No edge-case catalogs, review-pass names, head/rung jargon, or history. Rewrite on every push. Use only this template's `## ` sections; add `## State transitions` only for a lifecycle change. -->

## Preview

<!-- User-visible work: Vercel preview link and EVERY retained screenshot/clip as GitHub user-attachments in one compact table. Label state and CSS-pixel viewport. A before/after pair is ONE row: base in the Before column, current head in the After column, at matching state, data, viewport, and appearance; never put Before and After on separate rows. A change to an existing surface always pairs at least its primary state. When Before adds nothing (a new surface or additional states), replace the Before and After columns with a single Evidence column. No screenshot cap. Only labels and media here; put browser observations, limitations, cleanup, and review findings in Evidence. Put `story:<story-id>` in each row's Board cell when a story shows that state (— when none does); CI turns it into a direct link on the current Storybook deployment and keeps the Review board link below pointed at those stories. Otherwise write N/A: docs-only / CI-only / pure server. -->

<!-- review-links:start -->
<!-- review-links:end -->

| State + viewport | Board | Before | After |
| --- | --- | --- | --- |
| Changed state — 390×844 CSS px | `story:<story-id>` | PR base attachment | PR head attachment |

<details><summary>Evidence</summary>

## Verification

| surface | rung reached | evidence pointer | incidents |
| --- | --- | --- | --- |
| N/A | 0 | N/A | none |

<!-- Add a row for each mapped surface and a Verified: <surface> rung <n> or Not verified: <surface> rung <n> — <reason> line. Keep browser observations, console/errors, exact fixture cleanup, and limitations here. -->

## Test plan

- [ ] `bun check` / CI green
- [ ] Smoke the changed surface (or N/A — say why)

<!-- List commands with their result, plus one line per manual check. Do not enumerate the cases the tests cover. -->

Failure-cases: <tested>/<dependency calls>
<!-- Count money-path external reads and writes the diff adds or touches, and how many have a rejection, timeout, or partial-result test; see the test policy's "Choose the case, then the layer". Use N/A: <reason> only for docs-only and CI-only PRs. -->
<!-- Scoped fix(...) PRs: add one visible `Caught-by: <lint|unit|bot|review|browser|production>` line outside comments and fenced code. Identical repeats count once; different detectors fail CI. -->
<!-- Optional for new Playwright declarations: Playwright-rung: <layout|scrolling|focus|history|persisted-state|media-query|hydration|dispatch|journey> -->

## Review

Review: <n> findings fixed, none open
<!-- Add a Severity | Evidence | Judgment / action table only for findings that are declined, deferred, or still open. Fixed findings are counted, not listed. -->

## Real money

<!-- Money-moving work: report authorized live checks and safe evidence; use exactly "Real money: not tested" only for a required rung blocked by bot balance, review amount/recipient, or missing account anchor, and name the bound. Before live checks state network, asset, maximum loss, destination/control assumptions, expected balances, privacy, retry, and stop conditions. No secrets, payment details, customer data, or raw provider payloads. Otherwise N/A. -->

## Operator action required

<!-- If needed, give exact variable names, non-secret settings, commands, and verification; never secret values. Otherwise N/A. -->

</details>

<!-- Last line for feat/fix/test/ops/dx/docs/chore (scoped or not): Closes #<issue> (or Fixes/Resolves), or replace the placeholder with No issue: <reason>. For design/product proposals use Refs #<issue>. Write this outside comments and fenced code. -->
Closes #

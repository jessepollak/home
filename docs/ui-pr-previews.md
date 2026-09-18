# UI PR previews

Status: v2, Jesse-locked September 11, 2026. Replaces the v1 exact-tip manifest convention. Operator convention for showing a user-visible UI change in a pull request. Not a CI gate and not a production claim.

## When

PRs that change user-visible UI or core flows. Skip docs-only, CI-only, and pure server PRs.

## What

The **Vercel preview link** (posted automatically on every PR) is the primary proof. Add to the PR description:

- **Non-motion UI:** retain screenshots that help review the changed route on the current head; ~390px is the default mobile viewport. The comparison is adaptive, not a fixed before/after matrix.
- **Motion / animation:** retain a short video or GIF (roughly 30 seconds or less) when stills cannot show the transition — timing, interruption, or gesture reversal.

Put every retained screenshot or clip directly in the PR description as a GitHub attachment in one compact Markdown table. Each row label describes the visible state and viewport. Choose the adaptive form that carries useful evidence.

When the pre-change baseline materially improves judgment, use a paired comparison. Pair identical state, data, and CSS-pixel viewport; **After is the current PR head**:

| State + viewport | Before | After |
|---|---|---|
| Save review — 390×844 CSS px | GitHub screenshot attachment of the PR base | GitHub screenshot attachment of the current PR head |

When Before adds no information, use current-head evidence only instead of filling empty comparison cells:

| State + viewport | Evidence |
|---|---|
| Save review — 390×844 CSS px | GitHub screenshot attachment |
| Withdrawal recovery — desktop 1440×900 | GitHub clip attachment |

Do not commit media or upload only one representative from a larger retained set. The tables present evidence you retained; they do not require capturing a screenshot matrix.

Capture the live implementation in a real browser — preview, production, or localhost on the PR head. Design comps, empty scaffolds, and unlabeled `/dev` harness shots are not proof. If you push new UI changes after capturing, replace the screenshot; do not keep stale ones.

When Storybook is useful for design review, add optional **Before / Proposed / Implemented** references inside this same Preview section; do not create a manifest, duplicate approval fields, or another evidence system.

- **Before:** the current Home behavior when it helps, with state/data and CSS-pixel viewport.
- **Proposed:** the Storybook commit, commit-specific deployment URL, direct manager and canvas URLs, selected capture, and concise observable criteria. “Commit-specific” means later pushes cannot silently change the reviewed artifact. Label it unreviewed until Jesse leaves an actual [unmarked GitHub comment or review](operating-manual.md#jesse-review-pickup) tied to that revision. A concrete approval reference includes that Jesse link and all of the preceding fields; factory review or an unreviewed proposal is never approval.
- **Implemented:** current-head proof of the same production component in Home at matching state/data/viewport, captured and exercised with the [agent-browser contract](browser-validation.md). Record mode, route, viewport, exercised path, recovery and Back behavior, final semantic state, browser console/error results, and the exact owned fixture-server cleanup result.

Include the relevant failure/recovery path. For motion, include the short clip required above; when reduced motion applies, record the stable story target plus real browser media emulation, exact browser/device/viewport coverage, and the observed reduced behavior. A story name or viewport setting does not prove reduced-motion behavior.

Keep an accepted Proposed reference immutable as design history. If its component, fixture, or behavior changes before review, replace its commit, deployment links, and capture and return it to unreviewed when the observable proposal changed materially. After any implementation UI change, refresh Implemented media and agent-browser evidence against the current PR head; refresh Before when the compared baseline changed.

Storybook proves only the fixture-backed component scenario it renders. It does not replace Home browser verification, Safari or physical-keyboard checks, Next routing/history, app-level scroll/focus/Back behavior, or wallet/provider verification. State every unperformed check precisely.

### Review findings

Keep findings separate from the screenshot tables. When a user-visible PR records review findings, publish them in their own table:

| Severity | Evidence | Judgment / action |
|---|---|---|
| major | Recovery CTA is obscured in the PR-head screenshot; `file:line` identifies the owned component | Fix before approval |
| minor | Press state reads slow in the motion clip at 0:02 | Follow-up issue, or accept with reason |

Severity is `blocker`, `major`, or `minor`. A taste-only note without concrete user or coherence impact is non-blocking and does not gate the PR. Evidence cells name the observed issue and cite retained media, code, console results, or an existing issue; this is the findings presentation, not a second evidence system.

## How

Attach from the CLI (GitHub CLI 2.100 or newer; `gh pr edit --help` lists `--attach`) so the file lands as a GitHub `user-attachments` asset and renders inline:

```bash
gh pr edit <n> --repo jessepollak/home --attach './after.png#Home after: quiet hero'
gh pr edit <n> --repo jessepollak/home --attach ./motion.webm
```

Or paste/drop the files into the PR description in the browser. Either way, every screenshot or clip retained as PR evidence must appear in the compact table with a descriptive state/viewport label. Bare links, `cursor.com/artifacts` URLs (they expire), committed PNGs under `docs/pr-previews/`, and an unlabeled attachment set are not accepted.

Stills render at a readable width with `<img src="https://github.com/user-attachments/assets/<id>" width="390" />`. Videos render as a player from their bare URL on its own line.

## Not required

Immutable manifests, SHA-256 hashes, tile sets, per-state screenshot matrices, publication plans, or separate proof reviews. Behavioral states belong in tests, not screenshots.

## Done

A reviewer can open the PR, click the Vercel preview, and see every retained screenshot or clip inline with a descriptive label that matches the described change; any recorded review findings are separate from that media.

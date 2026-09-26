# UI PR previews

Status: v2, Jesse-locked September 11, 2026. Replaces the v1 exact-tip manifest convention. Operator convention for showing a user-visible UI change in a pull request. Not a CI gate and not a production claim.

## When

PRs that change user-visible UI or core flows. Skip docs-only, CI-only, and pure server PRs.

## What

Keep `## Preview` visible after the short `## Review` brief. For design work, start it with the direct [Storybook review board](design-system.md#review-boards) link on the PR's Storybook preview. Keep the Home **Vercel preview link** (posted automatically on every PR) as the primary implementation proof. Add to Preview:

- **Non-motion UI:** retain screenshots that help review the changed route on the current head; ~390px is the default mobile viewport. The comparison is adaptive, not a fixed before/after matrix.
- **Motion / animation:** retain a short video or GIF (roughly 30 seconds or less) when stills cannot show the transition — timing, interruption, or gesture reversal.

Put every retained screenshot or clip directly in Preview as a GitHub attachment in one compact Markdown table. Each row label describes the visible state and CSS-pixel viewport. There is no screenshot cap; choose the adaptive form that carries useful evidence. Keep only labels, the link, and media here; browser observations, limitations, cleanup, and findings belong in the collapsed Evidence section.

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

Use the [review-board workflow](design-system.md#review-boards) for design proposals and selection. Add **Before / Proposed / Implemented** media references inside this same Preview section when useful; record approval links and observed facts in Evidence. A review board manifest is for arranging stories, not a second approval or screenshot-evidence system.

- **Before:** the current Home behavior when it helps, with state/data and CSS-pixel viewport.
- **Proposed:** show the selected Storybook capture with state/viewport label here. In Evidence, record the Storybook commit, commit-specific deployment URL, direct board and story URLs, observable criteria, and whether Jesse has reviewed it. “Commit-specific” means later pushes cannot silently change the reviewed artifact. An approval reference includes Jesse's selection recorded on the issue or PR with the board URL tied to that revision; factory review or an unreviewed proposal is never approval.
- **Implemented:** current-head media of the same production component in Home at matching state/data/viewport, captured and exercised with the [agent-browser contract](browser-validation.md). Record mode, route, viewport, exercised path, recovery and Back behavior, final semantic state, browser console/error results, and the exact owned fixture-server cleanup result in Evidence.

Run the workshop loop for a journey-level proposal, and record its terminal result in the PR:

1. **Discover** owned components and their documented props with the MCP docs tools (`docs-list`, `docs-show`, `stories-find-by-component`) instead of re-inventing them.
2. **Compose** or refresh the journey story under `apps/web/stories/journeys/` from production components with MSW-backed existing request boundaries.
3. **Run story tests** with the MCP `test-run` tool (`bun run --cwd apps/web test:stories`); a failing `play` fails the run, and the a11y audit reports what it finds. In Evidence, give counts/commands and any a11y finding; do not describe a failing run as green.
4. **Capture proof** of the rendered canvas at the proposal's CSS-pixel viewport (390×844 for mobile) with the pinned `agent-browser`.

The loop produces the review evidence above; it does not replace the `agent-browser` Home verification an implemented change still needs.

Include the relevant failure/recovery path. For motion, include the short clip required above; when reduced motion applies, record the stable story target plus real browser media emulation, exact browser/device/viewport coverage, and the observed reduced behavior. A story name or viewport setting does not prove reduced-motion behavior. If the proposal also includes a Figma motion frame, follow [Figma workflow](design-explorations/figma-workflow.md#motion-frames).

Keep an accepted Proposed reference immutable as design history. If its component, fixture, or behavior changes before review, replace its commit, deployment links, and capture and return it to unreviewed when the observable proposal changed materially. After any implementation UI change, refresh Implemented media and agent-browser evidence against the current PR head; refresh Before when the compared baseline changed.

Storybook proves only the fixture-backed component scenario it renders. It does not replace Home browser verification, Safari or physical-keyboard checks, Next routing/history, app-level scroll/focus/Back behavior, or wallet/provider verification. State every unperformed check precisely.

### Review findings

Keep findings separate from the screenshot tables. When a user-visible PR records review findings, publish them in their own table inside Evidence, not Preview:

| Severity | Evidence | Judgment / action |
|---|---|---|
| major | Recovery CTA is obscured in the PR-head screenshot; `file:line` identifies the owned component | Fix before approval |
| minor | Press state reads slow in the motion clip at 0:02 | Follow-up issue, or accept with reason |

Severity is `blocker`, `major`, or `minor` for actionable defects. Review against the [issue's design scope](../.agents/skills/design-engineering/SKILL.md#follow-the-issue-scope) and acceptance criteria:

- **Maintenance:** unsupported stylistic preference does not block a bounded fix; correctness, accessibility and coherence findings need concrete evidence.
- **Exploration:** visual quality is the work under review. Assess the proposal against the brief; compare alternatives only when requested and name unresolved visual choices; technical readiness does not satisfy an art-direction brief. When requested, show neutral comparisons before critic rankings or authorship. Do not convert the critic's favorite into an accepted design.
- **Adoption:** compare against Jesse's selected revision at matching state/data/viewport, explain material differences, and resolve unintended divergence before claiming fidelity. Record actual integration and interaction coverage.

Keep candidate strengths/tradeoffs separate from defect severity. Jesse owns selection and approval. Evidence cells name the observed issue and cite retained media, code, console results, or an existing issue; this is the findings presentation, not a second evidence system.

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

A reviewer can open the PR, click the Vercel preview, and see every retained screenshot or clip inline with a descriptive label that matches the described change; any recorded review findings are separate from that media. A design or library handoff PR also links its coverage table under [design handoff coverage](operating-manual.md#design-handoff-coverage), and review checks it.

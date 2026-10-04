# UI PR previews

Status: v2, Jesse-locked September 11, 2026. Replaces the v1 exact-tip manifest convention. Operator convention for showing a user-visible UI change in a pull request. Not a CI gate and not a production claim.

## When

PRs that change user-visible UI or core flows. Skip docs-only, CI-only, and pure server PRs.

## What

Keep `## Preview` visible after the short `## What changes` brief. Its first line is the managed **Review board** link on the PR's current Storybook deployment (see [Storybook links](#storybook-links)). Keep the Home **Vercel preview link** (posted automatically on every PR) as the primary implementation proof. Add to Preview:

- **Non-motion UI:** retain screenshots that help review the changed route on the current head; ~390px is the default mobile viewport. The comparison is adaptive, not a fixed before/after matrix.
- **Motion / animation:** retain a short video or GIF (roughly 30 seconds or less) when stills cannot show the transition — timing, interruption, or gesture reversal.

Put every retained screenshot or clip directly in Preview as a GitHub attachment in one compact Markdown table. Each row label describes the visible state and CSS-pixel viewport. There is no screenshot cap; choose the adaptive form that carries useful evidence. Keep only labels, the link, and media here; browser observations, limitations, cleanup, and findings belong in the collapsed Evidence section.

When the pre-change baseline materially improves judgment, use a paired comparison. Pair identical state, data, and CSS-pixel viewport in one row, with Before and After as side-by-side columns, never as separate rows; **After is the current PR head**:

| State + viewport | Board | Before | After |
|---|---|---|---|
| Save review — 390×844 CSS px | `story:journeys-savings-deposit--deposit` | GitHub screenshot attachment of the PR base | GitHub screenshot attachment of the current PR head |

When Before adds no information, use current-head evidence only instead of filling empty comparison cells:

| State + viewport | Board | Evidence |
|---|---|---|
| Save review — 390×844 CSS px | `story:journeys-savings-deposit--deposit` | GitHub screenshot attachment |
| Withdrawal recovery — desktop 1440×900 | — | GitHub clip attachment |

Do not commit media or upload only one representative from a larger retained set. The tables present evidence you retained; they do not require capturing a screenshot matrix.

Capture the live implementation in a real browser — preview, production, or localhost on the PR head. Design comps, empty scaffolds, and unlabeled `/dev` harness shots are not proof. If you push new UI changes after capturing, replace the screenshot; do not keep stale ones.

Use the [review-board workflow](design-system/component-workshop.md#review-boards) for design proposals and selection. Add **Before / Proposed / Implemented** media references inside this same Preview section when useful; record approval links and observed facts in Evidence. A review board manifest is for arranging stories, not a second approval or screenshot-evidence system.

- **Before:** the current Home behavior when it helps, with state/data and CSS-pixel viewport.
- **Proposed:** show the selected Storybook capture with state/viewport label here. In Evidence, record the Storybook commit, commit-specific deployment URL, direct board and story URLs, observable criteria, and whether Jesse has reviewed it. “Commit-specific” means later pushes cannot silently change the reviewed artifact. An approval reference includes Jesse's selection recorded on the issue or PR with the board URL tied to that revision; factory review or an unreviewed proposal is never approval.
- **Implemented:** current-head media of the same production component in Home at matching state/data/viewport, captured and exercised with the [agent-browser contract](browser-validation.md). Record mode, route, viewport, exercised path, recovery and Back behavior, final semantic state, browser console/error results, and the exact owned fixture-server cleanup result in Evidence.

Run the workshop loop for a journey-level proposal, and record its terminal result in the PR:

1. **Discover** owned components and their documented props with the MCP docs tools (`docs-list`, `docs-show`, `stories-find-by-component`) instead of re-inventing them.
2. **Compose** or refresh the journey story under `apps/web/stories/journeys/` from production components with MSW-backed existing request boundaries.
3. **Run story tests** with the MCP `test-run` tool (`bun run --cwd apps/web test:stories`); a failing `play` fails the run, and the a11y audit reports what it finds. In Evidence, give counts/commands and any a11y finding; do not describe a failing run as green.
4. **Capture proof** of the rendered canvas at the proposal's CSS-pixel viewport (390×844 for mobile) with the pinned `agent-browser`.

The loop produces the review evidence above; it does not replace the `agent-browser` Home verification an implemented change still needs.

Include the relevant failure/recovery path. For motion, include the short clip required above; when reduced motion applies, record the stable story target plus real browser media emulation, exact browser/device/viewport coverage, and the observed reduced behavior. A story name or viewport setting does not prove reduced-motion behavior.

Keep an accepted Proposed reference immutable as design history. If its component, fixture, or behavior changes before review, replace its commit, deployment links, and capture and return it to unreviewed when the observable proposal changed materially. After any implementation UI change, refresh Implemented media and agent-browser evidence against the current PR head; refresh Before when the compared baseline changed.

Storybook proves only the fixture-backed component scenario it renders. It does not replace Home browser verification, Safari or physical-keyboard checks, Next routing/history, app-level scroll/focus/Back behavior, or wallet/provider verification. State every unperformed check precisely.

### Storybook links

Every Preview link into Storybook is generated for the current head, so Jesse lands on what the PR asks him to review. The author declares only which stories matter:

- Put `story:<story-id>` (inline code) in a row's **Board** cell when a Storybook story shows that state; use `—` when none does. Story IDs come from the MCP docs tools or the Storybook URL (`?path=/story/<story-id>`).
- Keep the empty `<!-- review-links:start -->` / `<!-- review-links:end -->` block from the template at the top of Preview. The generator fills it with one **Review board** link when a story is declared or the insertion rule applies.
- For a curated board, put its frame link (`id=review-boards--<board>&frame=<frame>`, any link text) in the Board cell or the managed block's `[Review board](…)` line instead; the generator keeps the board, frame, and link text and refreshes only the deployment.

The **Storybook review links** workflow runs when the Storybook preview deployment for the PR head succeeds and whenever the PR body is edited. It rewrites each `story:` token into a `[Board](…)` link that opens that story's frame on the **Changes** board, and points the top link at the first declared story. Every Changes-board link carries `focus=<story-id>,…`, so the board opens with a **Review** section holding the declared stories in row order, followed by the other stories the diff touched. Links are pinned to the commit-specific deployment and its `rev`, and are refreshed on every push; never hand-edit them. The workflow runs its script from the default branch, edits nothing outside Preview, and warns instead of failing. Preview the rewrite locally with `bun run --cwd apps/web review:links <pr>` (`--write` applies it).

Without declared stories, the top Changes-board link appears for design PRs or PRs changing `apps/web/components/**` or story files; an existing Storybook top link is also kept and refreshed. The Changes board lists stories whose own files changed first and stories matched only through shared `components/ui/**` primitives last. Declare stories whenever the PR has a specific state to review.

### Review findings

Keep findings separate from the screenshot tables, inside Evidence, not Preview. Count fixed findings in one `Review:` line; list only declined, deferred, or open findings in their own table:

| Severity | Evidence | Judgment / action |
|---|---|---|
| major | Recovery CTA is obscured in the PR-head screenshot; `file:line` identifies the owned component | Open: blocks approval |
| minor | Press state reads slow in the motion clip at 0:02 | Deferred to the area's debt issue, or declined with reason |

Severity is `blocker`, `major`, or `minor` for actionable defects. Review against the [issue's design scope](../.agents/skills/design-engineering/SKILL.md#follow-the-issue-scope) and acceptance criteria:

- **Maintenance:** unsupported stylistic preference does not block a bounded fix; correctness, accessibility and coherence findings need concrete evidence.
- **Exploration:** visual quality is the work under review. Assess the proposal against the brief; compare alternatives only when requested and name unresolved visual choices; technical readiness does not satisfy an art-direction brief. When requested, show neutral comparisons before critic rankings or authorship. Do not convert the critic's favorite into an accepted design.
- **Adoption:** compare against Jesse's selected revision at matching state/data/viewport, explain material differences, and resolve unintended divergence before claiming fidelity. Record actual integration and interaction coverage.

Keep candidate strengths/tradeoffs separate from defect severity. Jesse owns selection and approval. Evidence cells name the observed issue and cite retained media, code, console results, or an existing issue; this is the findings presentation, not a second evidence system.

## How

### Recording clips

Use `bun run clip` for retained motion evidence. **Chromium** is the default (390×844 CSS px); **WebKit** checks Safari-engine layout and motion at phone size; **Android** checks Chrome on an actual phone or emulator. WebKit is **not real iOS Safari**: no Safari toolbars, safe areas, software keyboard or iOS scrolling. Real Mobile Safari / Simulator capture remains [#1927](https://github.com/jessepollak/home/issues/1927). Labels report the CSS viewport measured at start, not the video’s pixel dimensions.

```bash
bun run clip start --target chromium --session pr-motion --url "http://127.0.0.1:${HOME_FIXTURE_PORT:-3199}/home"
bun run clip ab --session pr-motion -- snapshot
bun run clip ab --session pr-motion -- click @ref
bun run clip stop --session pr-motion --out /tmp/pr-motion.mp4
```

One-time setup: run `bun run worktree:bootstrap`, install FFmpeg (`ffmpeg` and `ffprobe` on PATH), and install Chromium with `bun run ab -- install`. Start the [credential-free fixture server](browser-validation.md#fixture-session-on-port-3199); initialize its fixture browser in the same session before recording when signed-in data is needed. Use `--viewport 1440x900` for desktop Chromium.

Chromium clips require headless mode; start rejects `AGENT_BROWSER_HEADED=true`. While recording, `clip ab` rejects `record`, `close`, `set viewport` and browser-target flag overrides: the clip session owns capture, geometry and cleanup.

For WebKit, install the pinned engine with `bun run --cwd apps/web playwright install webkit`, then start `bun run clip start --target webkit --session pr-webkit --fixture send` against the running fixture server. `--fixture send|savings-deposit|savings-withdraw` seeds the shared signed-in fixtures and opens `/home` on `HOME_FIXTURE_PORT` (default 3199); `--url` can select another loopback HTTP fixture origin. Without `--fixture`, `--url` works as for Chromium. `--device "<Playwright device name>"` defaults to **iPhone 15**, the newest base iPhone in Playwright 1.55.0 (393×659 CSS px); only touch-enabled mobile WebKit profiles are accepted, and invalid names list the registry's valid choices. Video size is set to the exact CSS viewport, then upscaled 2× at stop. The label is `WebKit <version> (Playwright iPhone 15 profile) 393×659 CSS px`. `--remote`, `--keep-status-bar` and viewport overrides are unsupported.

WebKit’s `clip ab` subset is `open|goto <url>`, `click <selector>`, `fill|type <selector> <text>`, `press <key>`, `hover <selector>`, `scroll|swipe <up|down> [px]`, `wait <ms|selector>`, `wait --fn <js>`, `eval <js>`, `snapshot`, `screenshot <path>` and `get url|title`. Use CSS, `text=…` or `role=button[name="…"]` selectors (for example, `clip ab --session pr-webkit -- click 'role=button[name="Send"]'`), not `@eN` refs. `snapshot` is the body’s ARIA snapshot. Both `scroll` and `swipe` perform a scripted smooth scroll of the document or largest scrollable ancestor at the viewport center and wait until its scroll position settles. `scroll` defaults to 500 CSS px; `swipe` defaults to 65% of the viewport height. Neither emits native touch gestures or reproduces iOS momentum. Other commands, extra flags and arguments starting with `--` fail explicitly, except the supported `wait --fn` syntax.

Playwright 1.55’s WebKit captures at CSS resolution and rounds requested video dimensions down to even pixels (393×659 records 392×658). Stop requires exactly those even-rounded CSS dimensions and fails on padding or any other mismatch. Normalization uses Lanczos to upscale to 2× the original CSS viewport with even dimensions and square pixels (393×659 outputs 786×1318); no calibration marker or crop is needed. Upscaling does not add Retina detail.

For Android, install [Android platform tools](device-profiling.md#automated-runs), enable USB debugging and authorize the connection (or boot an emulator). `ANDROID_HOME` selects the SDK. Start with `--target android --url <fixture-url>`; the single physical device is preferred over emulators. Select explicitly with `--serial <serial>` or `--device <model-or-AVD-name>` when needed. The recorder holds the shared device lock, forwards Chrome CDP and reverses the fixture port. Physical phones accept localhost HTTP fixture URLs only: no live or personal sessions. Notifications are silenced with Do Not Disturb before full-screen capture and its exact prior mode is restored afterward; recording refuses to proceed if that cannot be done. Pending notifications and an already-open notification shade can still appear despite Do Not Disturb; clear pending notifications and pull the shade closed before recording. Android clips crop the system status bar using display insets measured at start, preserving Chrome’s toolbar and page; missing or mismatched geometry fails loudly, with `--keep-status-bar` at start as the explicit opt-out for phones and emulators. Android has a three-minute recording cap; retain short clips (roughly 30 seconds or less).

Physical recordings open and pin a new fixture tab. Pre-existing targets are grandfathered without inspecting their page content, activating them, navigating them or closing them; only counts are logged. Tab-management commands and session-wide browser mutations are unavailable while recording. Leaving the fixture origin, opening a new off-origin page, losing the fixture foreground, or an early recorder exit aborts and discards the clip. Cleanup closes only the recording's own tab. Non-ready devices produce an authorization/reconnection warning instead of silently disappearing from selection.

The guard snapshots both target enumeration and discovery events before opening the session tab; Android discovery can include additional tab-model targets absent from enumeration. Recording begins only after the new session tab has loaded the fixture origin and is visible. Its startup empty/about:blank transition is allowed, not a new-tab page or an off-origin redirect. Once armed, target URL events and the session page's visibility-change events latch failures, including a switch that returns before the next poll. Local target/visibility checks also run between worker iterations (a minimum 100 ms wait plus command time). Visibility events depend on the page's JavaScript and CDP delivery: a switch whose event is missed and whose entire duration falls between polls remains a residual gap, not a proven continuous foreground guarantee.

To use a separate remote checkout, export `HOME_CLIP_REMOTE` (SSH destination) and `HOME_CLIP_REMOTE_DIR` (checkout directory) in your operator shell, then add `--remote` to **start**. That checkout needs the same dependency/browser pin, Bun, FFmpeg and device setup. Loopback fixture URLs use an owned reverse SSH tunnel; **ab** and **stop** automatically use the recorded remote target and copy the MP4 back to the local `--out`. Do not publish device serials or private runner locations.

Each remote session owns one SSH ControlMaster and a socket inside its private session directory, with `ControlPersist=no`; the pin check, status polling, driving and copy share it. Cleanup closes that master without stopping unrelated SSH connections. A destination must permit a fresh authenticated SSH connection, not merely have a still-open unrelated master; failures before SSH key exchange can come from the configured proxy/network path and do not prove a recorder failure or server connection-rate limit.

Stop writes H.264 MP4 at 30 fps with square pixels and prints pixel dimensions plus a ready-to-paste Preview-table label. Chromium inserts a temporary solid calibration marker at capture start, measures its recorded width rather than predicting geometry from the browser window, restores horizontal proportions when needed, and crops the blank strip. The calibration lead-in is trimmed; missing or inconsistent marker frames fail instead of producing an unverified clip. The DPR2 viewport is validated before recording.

Sessions expire after ten minutes by default; set `--max-age <seconds>` at start to change that limit. Android also stops before its three-minute recording cap. A dropped remote tunnel aborts the session. Stop, failed driving commands and Ctrl-C clean up owned recording/browser processes, tunnels, device mappings and session state. Private, owner-verified recovery state survives failed cleanup; `bun run clip cleanup --session <name>` also recovers an interrupted start. The fixture server remains yours to stop with its helper.

If the remote becomes unreachable, local tunnels still stop and failed remote cleanup keeps private recovery state. Once reachable, run `bun run clip cleanup --session <name>` to finish cleanup; Android’s remote recorder also has its own cap/cleanup guard. Device state is snapshotted before changes so recovery can restore the prior Do Not Disturb mode.

### Attaching evidence

Attach from the CLI (GitHub CLI 2.100 or newer; `gh pr edit --help` lists `--attach`) so the file lands as a GitHub `user-attachments` asset and renders inline:

```bash
gh pr edit <n> --repo jessepollak/home --attach './after.png#Home after: quiet hero'
gh pr edit <n> --repo jessepollak/home --attach ./motion.mp4
```

Or paste/drop the files into the PR description in the browser. Either way, every screenshot or clip retained as PR evidence must appear in the compact table with a descriptive state/viewport label. Bare links, `cursor.com/artifacts` URLs (they expire), committed PNGs under `docs/pr-previews/`, and an unlabeled attachment set are not accepted.

Stills render at a readable width with `<img src="https://github.com/user-attachments/assets/<id>" width="390" />`. Videos render as a player from their bare URL on its own line.

## Not required

Immutable manifests, SHA-256 hashes, tile sets, per-state screenshot matrices, publication plans, or separate proof reviews. Behavioral states belong in tests, not screenshots.

## Done

A reviewer can open the PR, click the Vercel preview, and see every retained screenshot or clip inline with a descriptive label that matches the described change; the Review board link and each row's Board link open the declared story on the current head's Storybook deployment. Any recorded review findings are separate from that media. A design or library handoff PR also links its coverage table under [design handoff coverage](operating-manual.md#design-handoff-coverage), and review checks it.

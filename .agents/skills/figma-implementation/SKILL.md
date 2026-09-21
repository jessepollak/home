---
name: figma-implementation
description: Use for any Figma-driven implementation or audit in Home — a frame, a component, or a whole page. Triggers on "implement this design", "match Figma", a figma.com link tied to implementation, or "audit this screen against Figma". Requires the mux-gateway Figma MCP server for Pass 1. Supersedes eyeballing screenshots; code stays the source of truth for shipped UI.
license: MIT
metadata:
  adapted-for: jessepollak/home
  adaptation: Home's Storybook proposal surface, tokens, components, thresholds and evidence rules replace upstream defaults
---

# Figma implementation for Home

A measurable gate between an accepted Figma frame and the code that ships it: three passes, one artifact per pass, and two gates that produce numbers instead of opinions.

Invoked from the design lane. `.agents/skills/design-engineering/SKILL.md` is the craft standard; `docs/design-system.md`, `docs/ui-pr-previews.md`, `docs/browser-validation.md`, `AGENTS.md` and Jesse's approval authority all still win. This skill adds measurement, not scope: it never authorizes a design-system migration, a dependency, or a privileged action.

## Core rules (every pass, every mode)

1. **Compute, don't eyeball.** Every size, gap and radius comes from metadata math (`x`/`y`/`w`/`h`) or an auto-layout value (`itemSpacing`, padding) — or, better, from the DOM measure gate. Never read a value off a screenshot.
2. **Audit before coding, on disk.** Each pass writes its artifact before the next pass starts: `inventory.md` → `audit.md` + `audit.spec.json` → `verification/<section>.json`. No file means the pass did not happen, and long sessions compact — the files are the memory.
3. **Measure before claiming done.** "Done" is `measure.mjs` with zero named failures, `diff.mjs` under target, the matrix checklist recorded, and `verification/<section>.json` written. Two screenshots that look alike cannot show a 4px offset or weight 500-vs-600.
4. **Code is the source of truth for shipped UI; Figma is the source of truth for a proposal.** Home draws the line in [UI direction](../../../docs/ui-direction.md) and the design-engineering skill: a frame that redraws a shipped surface does not get to regress behaviour or copy. Divergence is triaged (`fix-figma`, `fix-code`, `product-decision`, `intentional-keep`) — never implemented silently.
5. **An accepted proposal requires a story.** Home renders proposals as stories next to the production component that owns them (`docs/design-system.md`), never as `/dev` harness routes or separately styled copies. A proposal with no story has no review surface and no diff target.
6. **Download, don't draw.** Icons and marks come from Figma asset URLs or the existing owned asset (`apps/web/public/…`, `components/currency-mark.tsx`); never hand-write SVG path data, never retype colours out of a vector.
7. **Behaviour parity is as binding as visual parity.** When a frame replaces an existing component, inventory its handlers, states, copy affordances, prop contract and tests first; "silent" is not a decision.
8. **Read-only Figma, secret-safe tooling.** Nothing in this skill writes to a Figma file. `FIGMA_ACCESS_TOKEN` is read from the environment only and never printed, echoed into a report, or committed.
9. **Never commit pixels.** Verification PNGs live in `/tmp/figma-verify/<task>/`; the one committed exception is nothing — PR media goes to the GitHub PR body (or a `.factory/` path, which is gitignored).

## Mode router

| Situation | Do |
| --- | --- |
| One frame, page or component | Passes 1–3 below |
| Whole file, many screens | Pass 1 does not stop at the target node: enumerate the page first (Mode B of the upstream skill), then run passes 2–3 per section |
| Extracting tokens, typography, states | Read [references/verification.md](references/verification.md) before Pass 2 |
| Any verification step, thresholds, artifact shape | Read [references/verification.md](references/verification.md) before Pass 3 |
| The MCP gateway is not reachable from this agent | `figma-export.mjs --tree` prints the REST node subtree with the same geometry/style payload; record in `inventory.md` that Map used the documented REST fallback |

## Pass 1 — Map

1. `get_metadata` on the whole file (mux-gateway MCP, `server_id: "figma"`): pages only. **A stale empty page listed here is normal** — the real page may be published later under a new id. Confirm against the component inventory before trusting a page list.
2. `get_metadata` for the page, then the target node. Metadata carries only `id`/`name`/`type`/`x`/`y`/`w`/`h`: derive layout direction, gaps and padding from child positions, and prefer `get_design_context` for auto-layout values.
3. `get_design_context` for the target section (and `get_variable_defs` only when token names are ambiguous). Keep each response small; if it truncates, read the persisted file rather than re-fetching children.
4. Write `docs/design/<task>/inventory.md`: file + page + version, the page skeleton, every section and screen frame with node id/size, the target section's node tree 2–3 levels deep, and the computed geometry table (gaps and offsets derived from metadata).
5. Hygiene pass: flag non-auto-layout frames, `Group N` names, detached frames that duplicate a component, and vector-export artefacts. Those rows are low-trust; say so in the file.

**Gate:** `inventory.md` exists and every visible node of the target section appears in it.

## Pass 2 — Analyze

1. Build the property table in `docs/design/<task>/audit.md`: layout, sizing, spacing, background/border, typography, icon size and inset, and states per element — Figma value, shipped code value, verdict.
2. Write `docs/design/<task>/audit.spec.json`: the machine-readable subset that `measure.mjs`, `capture.mjs` and `diff.mjs` all consume (schema in [references/verification.md](references/verification.md)). One file drives measure, capture and diff so the three gates cannot drift apart.
3. Apply Home's token rule against `apps/web/app/globals.css`: when a project token resolves within 2px or one shade of the Figma value, use the token and record the deviation. Emit a literal only when no token or owned variant exists — and then note why. Token-owned colours are asserted at their *resolved token value*, with the Figma raw value recorded beside them.
4. Triage every string and datum: `real-copy` (implement verbatim), `placeholder` (never implement), `product-decision` (needs Jesse; do not guess). A frame's money amount is presentation data — it is never baked into a fixture to make a diff match.
5. Inventory behaviour parity when the frame touches a shipped component: DOM contract, handlers, activation, tones, truncation, empty/loading/error branches, a11y affordances (`aria-label`, `sr-only`), and the tests that must stay green.
6. Map every Figma component to `apps/web/components/ui/*` or the owning client component: reuse / extend / build. Read Code Connect mappings when they exist; if the mapping set is empty (companion work not landed), write **"unavailable"** and author the mapping table by hand — never invent a mapping.
7. Identify the box mapping: which DOM box each axis of the Figma frame corresponds to (`frameSize` in the spec). Figma pads *inside* a frame, the DOM pads inside the border box, and an owned component often supplies horizontal padding the Figma composition keeps outside the row.

**Gate:** `audit.md` and `audit.spec.json` exist; every inventory row has properties, a triage class, and a mapping decision.

## Pass 3 — Implement & verify

1. Implement from the audit file — re-read it per section. Use mapped components with explicit variants, not restyled copies.
2. **Measure gate first** (DOM, no pixels):
   ```bash
   node .agents/skills/figma-implementation/scripts/measure.mjs \
     --spec docs/design/<task>/audit.spec.json \
     --base http://127.0.0.1:6006 --out /tmp/figma-verify/<task>/measure.json
   ```
   Fix every named failure it reports. This is the only gate that catches an unknown CVA variant (renders zero classes without a type error) or a Tailwind utility that generated no CSS.
3. **Diff gate second** (pixels):
   ```bash
   node .agents/skills/figma-implementation/scripts/figma-export.mjs \
     --spec docs/design/<task>/audit.spec.json --dims --out /tmp/figma-verify/<task>/ref.png
   node .agents/skills/figma-implementation/scripts/capture.mjs \
     --spec docs/design/<task>/audit.spec.json --base http://127.0.0.1:6006 \
     --viewport 390x844 --out /tmp/figma-verify/<task>/actual.png \
     --report /tmp/figma-verify/<task>/capture.json
   node .agents/skills/figma-implementation/scripts/diff.mjs \
     --ref /tmp/figma-verify/<task>/ref.png --actual /tmp/figma-verify/<task>/actual.png \
     --out /tmp/figma-verify/<task> --spec docs/design/<task>/audit.spec.json
   ```
   Read the heatmap, form **one** hypothesis, apply **one** fix, re-run. Maximum five iterations; if the percentage rises twice in a row, revert and subdivide or escalate with the heatmap. Targets and tolerances are documented, not tuned per run.
4. **Matrix pass** (checklist, never pixel-diffed) at 390×844 plus the existing story viewports 320×568 and 1280×800, plus dark when the surface is theme-sensitive: nothing overflows or clips, truncation behaves, the anatomy survives, token collisions are absent. Capture with `--box border --crop none`.
5. **Story tests + a11y** for the story that renders the frame:
   ```bash
   bun run --cwd apps/web test:stories     # stop a running storybook dev first
   ```
   Every story's `play` function and the `@storybook/addon-a11y` audit execute; `a11y.test: "todo"` reports findings instead of failing the job. Record what was actually reported — a green run is not an a11y claim.
6. Write `docs/design/<task>/verification/<section>.json` (shape in [references/verification.md](references/verification.md)) with the real numbers, the residual reasons, and `pass: false` whenever a gate failed. A failing row is a finding with a direction — it is never rounded up to a pass, and the target is never relaxed to make it green.

**Gate:** the section has a `verification/<section>.json`; `pass: true` means every gate passed, otherwise each failure names its finding and direction.

## Red flags — stop if you catch yourself thinking…

| Excuse | Reality |
| --- | --- |
| "The design-context JSX is close enough, I'll adapt it directly" | It is a representation, not code. No audit table means wrong tokens and missed states. |
| "I can read that gap off the screenshot" | You cannot. Compute it, then let the measure gate confirm it. |
| "The screenshots look the same, ship it" | Screenshots cannot show a 4px offset or weight 500-vs-600. Run both gates. |
| "Figma says `$12.34`, so the fixture should say `$12.34`" | That is presentation data. Baking mock data into a fixture manufactures a pass. |
| "Code is truth, so I'll fix the code to match the frame" | No. Shipped UI is authoritative unless Jesse accepts the frame; triage and report. |
| "Type-check passed, the variants are fine" | Type debt hides invalid variants. The measure gate is the check. |
| "I'll build a `/dev` harness route to see it" | Home renders proposals as stories; a harness route is uncommittable scaffolding and not a review surface. |
| "The diff fails because of fonts, so I'll lower the target" | Record the pct, the target and the residual reason. The tolerance exists to be documented, not bent. |
| "I'll commit the before/after PNGs so the diff is reviewable" | PNGs stay in `/tmp`; the PR body or a gitignored `.factory/media/` path carries the heatmap. |
| "No mobile frame, so mobile is out of scope" | The matrix pass is mandatory and code-owned. |

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/measure.mjs` | Executes `audit.spec.json` against the live Storybook canvas and reports named property failures. Run first. |
| `scripts/figma-export.mjs` | Exports the frame PNG at scale 1 from the Figma REST images endpoint with `FIGMA_ACCESS_TOKEN` (never printed); `--dims` prints the frame size, `--tree` dumps the node subtree for offline Map/Audit. |
| `scripts/capture.mjs` | Element screenshot of the story at the frame's size, dpr 1, animations off, clock frozen, `--box border\|padding\|content`, optional `--crop`, and a JSON report. |
| `scripts/diff.mjs` | Pixel diff with a heatmap, a per-pixel threshold and an image-level target; documents the platform font/AA tolerance. |

Tests for the pure spec/measurement comparison and diff-threshold logic live in `tests/` and run inside `bun run gates` (and therefore `bun check`).

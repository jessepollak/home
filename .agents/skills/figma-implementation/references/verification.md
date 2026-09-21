# Verification reference — gates, thresholds, artifacts

Load this before Pass 3. Commands run from the worktree root; every script lives under `.agents/skills/figma-implementation/scripts/`.

## 0. Environment

The gates need a Storybook dev server and Playwright:

```bash
STORYBOOK_PORT=7101 bun run --cwd apps/web storybook   # canvas: http://127.0.0.1:<port>
```

- The canvas URL for story `<id>` is `<base>/iframe.html?id=<id>&viewMode=story` (the same direct links `docs/design-system.md` documents for review). `measure.mjs` and `capture.mjs` build it from `--base` + the story id.
- Playwright is not a workspace-root dependency. The scripts resolve `@playwright/test` through `apps/web/package.json` (`scripts/lib/browser.mjs`), so run `bun install --frozen-lockfile` in the worktree first. The skill adds no dependency of its own.
- In a worktree whose `node_modules` is a symlink to another checkout, `bun run --cwd apps/web test:stories` fails with "Failed to fetch dynamically imported module … setup-file.js" because the vitest browser server refuses to serve files outside the worktree root. Replace the symlink with a local install (`unlink node_modules && bun install --frozen-lockfile`) before running story tests; it is a `node_modules`-only change.
- `FIGMA_ACCESS_TOKEN` is read from the environment by `figma-export.mjs` only. Never print it, never pass it as an argument, never write it into a report or the spec.
- All gates are read-only against Figma. Nothing here may modify a Figma file.

## 1. What gets committed

| Artifact | Location | Committed? |
| --- | --- | --- |
| `inventory.md`, `audit.md`, `audit.spec.json`, `verification/<section>.json` | `docs/design/<task>/` | yes — text only |
| Reference/actual/heatmap PNGs, `diff.json`, `measure.json`, capture reports | `/tmp/figma-verify/<task>/` | no |
| Heatmap for a PR body | `.factory/media/<task>-heatmap.png` (gitignored) or a GitHub attachment | no |
| `/dev` harness routes, mock pages, mock app-router wiring | — | never |

A PNG under `docs/` is a review defect. Attach the comparison image to the PR instead.

## 2. `audit.spec.json` schema

One file drives measure, capture and diff.

```jsonc
{
  "task": "balances-panel-row",
  "story": "pilot-financial-row--normal",     // or "url": "<full canvas URL>"
  "viewport": "390x844",                       // story review viewport
  "frame": {
    "fileKey": "…", "nodeId": "5:165", "name": "HomeBalanceRowView / US dollar",
    "width": 326, "height": 56,                // absoluteBoundingBox
    "url": "https://www.figma.com/design/…?node-id=5-165",
    "lastModified": "2026-09-21T02:48:35Z"
  },
  "frameSelector": "[data-balance-list] > li > [data-slot=item]",
  "frameBox": "content",                       // origin for element offsets: border | content
  "frameSize": { "width": "contentWidth", "height": "paddingHeight" },
  "capture": { "selector": "…", "box": "padding", "crop": "12,0,324,56" },
  "diff": { "target": 2, "threshold": 0.1, "crop": "0,0,324,56", "masks": ["x,y,w,h"] },
  "elements": [
    {
      "name": "label",                         // unique; appears in every report
      "selector": "[data-slot=item-content] [data-slot=item-title]",
      "rect": { "width": 69, "height": 20, "left": 44, "right": 0, "top": 18, "contentWidth": 326, "paddingHeight": 56 },
      "gapToNext": 12,                         // px to nextElementSibling; "direction": "h" | "v" overrides inference
      "styles": { "fontSize": "16px", "fontWeight": "400", "color": "#171717", "backgroundColor": "#ffffff" },
      "tolerance": 1,                          // px, default 1; applies to rect, gap and px-valued styles
      "figma": { "nodeId": "5:177" },          // provenance only
      "notes": "why this expectation, and which finding it maps to"
    }
  ],
  "acceptedDeviations": [ { "property": "color", "figma": "#171717", "code": "oklch(0.145 0 0)", "reason": "token rule" } ]
}
```

Coordinates: `left`/`top` are offsets from the frame element's box origin (per `frameBox`); `right`/`bottom` are insets from that box's right/bottom edge. Without `frameSelector`, `left`/`top` are page-relative and `right`/`bottom` viewport-relative. `contentWidth`/`contentHeight`/`paddingWidth`/`paddingHeight` are the element's own box ladder.

Box mapping (the part that bites): a Figma auto-layout frame pads *inside* the frame, so a frame's height usually equals the DOM **padding box** height, while its width often equals the DOM **content box** width when the owned component supplies horizontal padding the Figma composition keeps outside the row. `frameSize` names each axis explicitly; the measure gate prints the full ladder so the mapping is visible in the evidence.

Rules: expectations come from Figma after the token rule, never from the DOM you just measured. Token-owned colours are asserted at their resolved token value with the Figma raw value beside them. Mock data is never asserted.

## 3. Gate A — DOM measurement

```bash
node .agents/skills/figma-implementation/scripts/measure.mjs \
  --spec docs/design/<task>/audit.spec.json \
  [--base http://127.0.0.1:6006] [--story <id>] [--url <canvas-url>] \
  [--viewport 390x844] [--ls key=value ...] [--dark] \
  [--fonts "SF Pro Text"] [--font-check] [--settle 1200] \
  --out /tmp/figma-verify/<task>/measure.json
```

Output is one `PASS <element>` line or `FAIL <element> <prop>: expected <e> got <a>` per failure, a `FRAME` line with the mapped boxes and deltas, a `BOXES` ladder, a `FONT` line per element, and the JSON report. Exit 0 = every audited property matched; exit 1 = named failures; exit 2 = bad invocation.

This gate is first because it is exact: it catches an unknown CVA variant (styling silently absent), a Tailwind utility that generated no CSS, an off-by-2px gap, a wrong weight, and a colour that drifted — with no image noise to argue about.

## 4. Gate B — pixel diff

```bash
# 1) reference at scale=1 (REST, no MCP budget)
node .agents/skills/figma-implementation/scripts/figma-export.mjs \
  --spec docs/design/<task>/audit.spec.json --dims --out /tmp/figma-verify/<task>/ref.png

# 2) actual: element shot at the frame's size, dpr 1
node .agents/skills/figma-implementation/scripts/capture.mjs \
  --spec docs/design/<task>/audit.spec.json --base http://127.0.0.1:6006 \
  --viewport 390x844 --out /tmp/figma-verify/<task>/actual.png \
  --report /tmp/figma-verify/<task>/capture.json

# 3) diff
node .agents/skills/figma-implementation/scripts/diff.mjs \
  --ref /tmp/figma-verify/<task>/ref.png --actual /tmp/figma-verify/<task>/actual.png \
  --out /tmp/figma-verify/<task> --spec docs/design/<task>/audit.spec.json
```

### Thresholds (fixed defaults; do not tune per run)

| Parameter | Value | Meaning |
| --- | --- | --- |
| `--threshold` | 0.1 | per-pixel tolerance: the **maximum channel difference** divided by 255. Pixels at or below it are ignored (drawn yellow in the heatmap) |
| `--target` | 2 | image-level gate for text-bearing sections |
| `--target` | 0.5 | chrome-only sections (no glyphs) |

`0%` is unattainable whenever text is present: Figma rasterises with its own renderer, the capture rasterises the platform font stack (`--font-sans` is `ui-sans-serif, system-ui, …`). Glyph edges therefore differ pixel by pixel even when the design matches. There is deliberately no anti-aliasing exclusion pass — text edges are exactly where two rasterizers disagree, and pretending otherwise hides real differences. Set the tolerance once per section type and record it; never lower a target to make a run green.

### Dimensional rules

- The capture must be 1:1 with CSS pixels: `--viewport` = the frame's size (or the story's review viewport) and dpr 1. `capture.mjs` reads the PNG header back and warns if the shot is not the size it asked for.
- If dims differ, `diff.mjs` **refuses** and prints the suggested shared crop. Never resample by hand. Fix the export/capture, or crop explicitly.
- `--crop x,y,w,h` applies to **both** images and exists for one real case: a hug-width Figma component frame against a stretch-width DOM row. The shared box is the comparable region; the delta is recorded in the verification JSON, not tuned away.
- `--mask x,y,w,h` blackens the same rect on both already-cropped images for genuinely unmockable regions. Mask coordinates are relative to the compared output box; record every mask.
- The heatmap legend: red = counted difference, yellow = inside the per-pixel threshold, gray = reference luma at 40%.

### Loop discipline

Read the heatmap, locate the largest cluster, map it to an element, form **one** hypothesis, apply **one** fix, re-run. Maximum five iterations per section; if the pct rises twice in a row, revert the last edit and subdivide the section or escalate with the heatmap. Diff per section element, never per whole page.

## 5. Gate C — matrix pass (checklist, never pixel-diffed)

```bash
for vp in 320x568 390x844 1280x800; do
  node .agents/skills/figma-implementation/scripts/capture.mjs \
    --spec docs/design/<task>/audit.spec.json --base http://127.0.0.1:6006 \
    --viewport $vp --box border --crop none \
    --out /tmp/figma-verify/<task>/matrix-$vp.png --report /tmp/figma-verify/<task>/capture-$vp.json
done
# dark, when the surface is theme-sensitive
node .agents/skills/figma-implementation/scripts/capture.mjs --spec … --viewport 390x844 \
  --box border --crop none --dark --out /tmp/figma-verify/<task>/matrix-dark.png
```

390×844 is the product's mobile review composition; 320×568 and 1280×800 are the existing Storybook viewports and act as containment and desktop checks. Per cell record: element box, overflow (`scrollWidth > clientWidth`), truncation behaviour, anatomy, legibility, and token collisions (a hover state that resolves to the resting background is a bug even though both use the right token). `--hover` captures a hover state; `--dark` adds the `.dark` class for app-managed themes.

## 6. Story tests and a11y

```bash
bun run --cwd apps/web test:stories      # stop storybook dev first — shared Vite cache
```

Every story in headless Chromium: `play` functions execute and the `@storybook/addon-a11y` audit runs with the repository default `a11y.test: "todo"` (findings are reported, not failing). A green run proves the stories render, the play functions pass and the audit executed — it is not an a11y clearance and it is not Home browser verification. Record exactly what the reporter printed; detailed addon findings live in the Storybook test UI.

## 7. `verification/<section>.json`

```jsonc
{
  "section": "balances-row",
  "story": "pilot-financial-row--normal",
  "nodeId": "5:165",
  "captureEnvironment": { "viewport": "390x844", "dpr": 1, "storybook": "…", "browser": "…", "resolvedFontFamily": "…" },
  "measure": { "pass": false, "failures": 6, "report": "/tmp/…/measure.json",
               "failed": [ { "element": "label", "prop": "fontSize", "expected": "16px", "actual": "14px", "finding": "F1" } ],
               "frameBoxes": { "border": "350x58", "padding": "348x56", "content": "324x32" } },
  "diff": { "pass": false, "pct": 9.171, "target": 2, "threshold": 0.1, "crop": "0,0,324,56",
            "diffPixels": 1664, "totalPixels": 18144, "heatmap": ".factory/media/<task>-heatmap.png",
            "residualReasons": ["…"] },
  "matrix": { "390x844": { "result": "pass", "element": "350x58", "overflow": [] } },
  "a11y": { "command": "bun run --cwd apps/web test:stories", "result": "pass", "findings": "…" },
  "behaviorParity": { "result": "pass", "note": "…" },
  "findings": [ { "id": "F1", "summary": "…", "direction": "fix-figma" } ],
  "pass": false,
  "passReason": "why the honest verdict is what it is"
}
```

`pass: true` requires zero measure failures, the diff under target, and a recorded matrix. Otherwise the file records the exact pct, the target, the residual reasons and the finding each failure maps to. A fabricated pass is worse than a red gate: the point of the skill is that the numbers are trustworthy.

## 8. Degradation modes

| Situation | Do |
| --- | --- |
| The mux-gateway MCP tools are unreachable from this agent | Use `figma-export.mjs --tree --node <id> --depth 4` (REST) for the same geometry/style payload, and say so in `inventory.md`. Map's primary path stays MCP. |
| `get_design_context` truncates | Read the persisted tool output file; re-fetch only single children as a last resort. |
| Code Connect has no mappings yet | Write "unavailable", author the mapping table by hand, and do not invent a mapping. |
| A frame exists only as a detached copy of a component | Treat it as low-trust, cross-check against the component set and the code, and add it to the designer punch-list. |
| The story host does not reproduce the app host | Correct the story to compose the real shell frame (`shellContentFrameClassName`, `CardContent inset="list"`), never to tune values toward the frame. Small story-only host fixes are allowed; mock-data or typography changes to force a pass are not. |
| Fonts are missing in the capture | Expect a phantom 20–40% diff. Pass `--fonts`/`--font-check` when the story should render a specific family, and record the resolved family in the report either way. |

## 9. Upstream provenance

Methodology adapted from the third-party `figma-pixel-perfect` skill held in the operator inbox; the scripts, thresholds, home-specific calibration and component mappings here are re-implemented for Home and own their behaviour. Company-specific calibration and design-system mappings from that source were deliberately not carried over.

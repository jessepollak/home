---
name: style-drift
description: Find and fix off-token radius, shadow, type, motion and state usage in Home product code through owned component variants; use before or after touching a Home product surface.
---

# Style drift

## When to use

Use before or after touching a Home product surface, or when reviewing a treatment
that differs from Home's foundations. Keep the audit within the assigned surface;
do not turn an advisory report into an unrelated cleanup.

## Find

1. Run `bun run --cwd apps/web design:drift`.
2. Read [Design spec](../../../docs/design-system/spec.md) and the matching
   foundation table before deciding whether a value fits its role. Follow
   [Theme](../../../docs/design-system/theme.md) for values and component contracts.
3. Inspect each reported token at its owner. Treat “State usage to review” as
   review candidates, not automatic violations. Use the shared Library foundation
   scanner and usage tallies; do not add a second scanner.

## Fix

- Fix at the owning component: add or adjust a `components/ui` variant, or use the
  role utility. Preserve behavior, accessibility and the assigned surface's scope.
- Never pass appearance classes to owned components (`home/no-restyle`). Never
  add per-use appearance classes, lint suppressions or allowlist entries.
- Use the radius, elevation and type role assigned in the matching foundation
  table instead of choosing a visually similar raw value.
- Use the motion tokens. Keep tuned local curves only where
  [Theme → Motion](../../../docs/design-system/theme.md#motion) records them;
  preserve reduced-motion behavior.
- Use the [Interaction states contract](../../../docs/design-system/theme.md#interaction-states)
  for hover/highlight, pressed, focus-visible, disabled and selected treatments.
- If the system lacks a treatment, extend the owned variant and record the
  decision in the matching design-system contract; do not work around the owner.
- Follow [Styling guards](../../../docs/design-system/styling-guards.md).

## Keep the ratchet

`home/no-raw-style-utilities` enforces the shadow, arbitrary-radius, duration and
easing families in product code, plus status color, spinner and pulse utilities
and spinner icons outside [owned status components](../../../docs/gates.md#styling-guards).
The checked-in baseline is shrink-only and its `families` inventory is preserved.
Run `bun run style-drift:shrink` from the repository root only after removing
occurrences; never use it to admit new drift or raise a baseline count.

## Verify

1. Re-run `bun run --cwd apps/web design:drift` and inspect the affected entries.
2. Run `bun run --cwd apps/web lint`.
3. Run `node scripts/gates/style-drift.mjs` from the repository root.
4. For a user-visible fix, follow the
   [design-engineering skill](../design-engineering/SKILL.md), including its
   applicable render proof and browser-validation requirements. A report or a
   passing lint command is not visual proof.

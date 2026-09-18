---
name: review-animations
description: Perform a read-only motion review of a named Home diff, component, or route. Use only when animation review is explicitly requested.
disable-model-invocation: true
license: MIT
metadata:
  source: https://github.com/emilkowalski/skills/tree/85e8e2363b713506e1d5b6e07a0eb2da66be1bc3/skills/review-animations
  adapted-for: jessepollak/home
  adaptation: Read-only Home review with locked motion and proof rules
---

# Review Home animations

Review only the named motion surface. Do not edit code or widen into a general UI review. Home's `AGENTS.md`, `docs/ui-direction.md`, `docs/architecture.md`, and `docs/operating-manual.md` override this skill.

## Evidence first

1. Read the relevant implementation, styles, tests, and diff.
2. Identify the user action, frequency, purpose, normal final state, and reduced-motion final state.
3. Check existing issues before recommending follow-up work.
4. Follow `docs/browser-validation.md` and use the repository-pinned `agent-browser` on the current preview for interactive motion proof. Playwright is authoritative only as the committed automated browser layer. Static inspection can prove code structure, not timing feel or real-device behavior.

## Review bar

- **Justification:** Motion provides feedback, spatial continuity, state indication, or prevents a jarring change. Decorative movement on frequently read financial surfaces is a finding.
- **Budgets:** Tabs are at most 180ms, chips at most 120ms, and CTA press feedback at most 100ms. Other UI motion stays similarly short and optical.
- **Reduced motion:** `prefers-reduced-motion: reduce` settles instantly. Smooth scrolling becomes `auto`; opacity or color fallbacks do not retain a duration.
- **Properties:** Prefer `transform` and `opacity`; flag `transition: all`, accidental layout animation, and `scale(0)` entrances.
- **Physicality:** Trigger-anchored content uses the Base UI transform origin. Enter and exit paths remain coherent.
- **Interruptibility:** Repeated actions retarget cleanly. Gesture motion preserves continuity; keyframes do not restart a rapid interaction from zero.
- **Input:** Hover motion is capability-gated. Keyboard use, focus, semantics, and touch hit targets remain intact.
- **Architecture:** Reuse the existing design system and Motion dependency. Do not recommend another UI system or runtime.
- **Tests:** Ask for a test only at the layer chosen by `docs/browser-validation.md`; zero new Playwright is normal. Keep it proportional and avoid testing Motion itself.

## Severity

- **Blocker:** accessibility, correctness, unusable interaction, or a regression against instant reduced motion.
- **Major:** unjustified/sluggish motion, broken interruption, or expensive properties likely to harm interaction.
- **Minor:** supported craft improvement that is concrete but not release-blocking.

## Output

List findings first, highest severity first, as `severity — file:line — evidence — smallest remedy — proof`. Then give one verdict: `block`, `pass with follow-up`, or `pass`. Separate what code proves from the `agent-browser` mode/route/viewport/path, committed Playwright coverage, and operator checks. Report “no valid finding” when appropriate; do not invent work to justify the review.

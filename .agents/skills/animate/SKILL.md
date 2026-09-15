---
name: animate
description: Implement motion only when a Home task explicitly introduces or materially changes an animation or transition. Do not use for ordinary UI work or read-only review.
license: MIT
metadata:
  source: https://github.com/emilkowalski/skills/tree/85e8e2363b713506e1d5b6e07a0eb2da66be1bc3/skills/animate
  adapted-for: jessepollak/home
  adaptation: Home rules, tooling, authority, and proof replace upstream defaults
---

# Animate Home UI

Implement the smallest purposeful motion within the assigned task. Home's `AGENTS.md`, `docs/ui-direction.md`, `docs/architecture.md`, and `docs/operating-manual.md` always win.

## Boundaries

- Stay inside the requested feature and existing Home design system. Do not change dependencies, introduce a second component system, or create demo routes.
- Motion is optional. Prefer an instant state change when motion has no clear purpose or the action is frequent.
- Home's limits are authoritative: tabs at most 180ms, chips at most 120ms, and CTA press feedback at most 100ms. Other motion should be comparably short and optical.
- `prefers-reduced-motion: reduce` means instant: duration `0`, no smooth scrolling, and no fallback fade.
- Use existing components, variants, tokens, and Base UI transform-origin contracts. Do not create a parallel easing or duration vocabulary for one change.
- Tests cover Home behavior, not Motion or browser internals. Keep test code proportional; use existing Playwright for browser behavior.

## Decision sequence

1. **Gate the motion.** Name its purpose: feedback, spatial continuity, state indication, or preventing a jarring change. If none applies, do not animate.
2. **Check frequency and content.** Repeated navigation and keyboard actions should be instant or nearly imperceptible. Never move financial data merely for decoration.
3. **Choose the cheapest existing tool.** Prefer an existing CSS transition for simple state changes; use the repository's Motion dependency only for layout, exit, gesture, or spring behavior that CSS cannot express clearly.
4. **Choose safe properties.** Prefer `transform` and `opacity`. Avoid layout animation unless the component's behavior requires it. Never use `transition: all` or enter from `scale(0)`.
5. **Set timing from Home.** Movement on screen normally eases in and out; entrances and exits normally ease out. Reuse a nearby established curve rather than inventing one.
6. **Make interaction motion interruptible.** Rapidly repeated actions must retarget from their current state rather than restart a keyframe sequence.
7. **Ship instant reduced motion and capability-gated hover** with the change.

## Implementation checks

- The animation preserves focus, hit targets, semantics, and the final readable state.
- Trigger-anchored Base UI content uses its provided transform origin; dialogs remain centered.
- Touch users receive press feedback without relying on hover.
- Smooth scrolling has an `auto` reduced-motion path.
- A complex or feel-dependent result is verified in the existing preview. Real-device feel checks are recorded as operator actions, never claimed from emulation.

## Report

State the purpose, tool, properties, timing, reduced-motion behavior, validation run, and any operator feel check. If the gate rejects motion, report that outcome without manufacturing an implementation.

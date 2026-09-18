---
name: mobile-native
description: Implement or review mobile-web interaction and layout for a named Home surface, such as a bottom bar, sheet, touch gesture, viewport, safe area, or software-keyboard flow. Do not use for general responsive styling.
license: MIT
metadata:
  source: https://github.com/emilkowalski/skills/tree/85e8e2363b713506e1d5b6e07a0eb2da66be1bc3/skills/mobile-native
  adapted-for: jessepollak/home
  adaptation: Home mobile-web scope, existing Playwright, and operator device checks
---

# Mobile-native Home UI

Apply the smallest platform-correct change to the named mobile-web surface. Home's `AGENTS.md`, `docs/ui-direction.md`, `docs/architecture.md`, and `docs/operating-manual.md` always win.

## Boundaries

- Use CSS capabilities and existing components before JavaScript: media queries, `dvh`/`svh`, `env()`, and `touch-action` rather than device detection.
- Touch and mouse can coexist. Gate behavior by `(hover)` and `(pointer)`, not user agent or width guesses.
- Never disable zoom. Preserve selectable content, browser navigation, focus, and native scrolling unless the named control must own a gesture.
- Keep reduced motion instant and Home timing within `docs/ui-direction.md` limits.
- Follow `docs/browser-validation.md`: the repository-pinned `agent-browser` is required for interactive iteration and proof before and after editing. Playwright remains the sole authoritative committed automated browser layer; use its existing configuration only when the permanent-test ladder calls for a browser assertion.
- A real-device check is an operator action. State exactly what iOS or Android behavior remains unverified; do not claim an `agent-browser` viewport or emulation proves it.

## Review sequence

1. Use the Home browser-iteration skill and repository-pinned `agent-browser` to trace the interaction at a narrow viewport, including focus, software keyboard, scrolling, back navigation, and final state.
2. Inspect the viewport export and global styles before proposing local work.
3. Check each applicable platform contract:
   - edge-to-edge content pairs `viewport-fit=cover` with safe-area padding on fixed chrome;
   - app-height surfaces use dynamic viewport units; stable first-screen marketing uses small viewport units;
   - inputs remain at least 16px where iOS focus zoom applies and expose the appropriate input mode;
   - touch controls meet Home's accessible hit-target conventions and provide immediate active feedback;
   - hover-only effects are capability-gated;
   - gesture surfaces declare only the axes they own with `touch-action`;
   - nested scroll containers avoid accidental scroll chaining without blocking ordinary page scroll;
   - control text may suppress selection, but addresses, errors, and other content remain selectable;
   - fixed bottom UI and dialogs remain reachable with safe areas and the software keyboard.
4. Verify URL-addressable shell and browser-back behavior from `docs/architecture.md`; do not replace native history with local-only state.
5. Check existing tests and issues before asking for new work.

## Proof

Use `agent-browser` to prove no horizontal overflow, visible and reachable primary controls, correct focus destination, usable back behavior, and a stable final state with reduced motion. Add durable assertions only at the layer selected by `docs/browser-validation.md`; do not assert browser implementation details. Keep tests proportional to the product change.

## Report

For each supported finding give `severity — file:line — observed risk — smallest remedy — automated proof — operator device check`. Distinguish code-confirmed defects from hypotheses. If implementing, report the exact declarations or component behavior changed. If no concrete finding survives code and issue verification, say so.

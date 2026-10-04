---
name: mobile-native
description: Implement or review mobile-web interaction and layout for a named Home surface, such as a bottom bar, sheet, touch gesture, viewport, safe area, or software-keyboard flow. Do not use for general responsive styling.
license: MIT
metadata:
  source: https://github.com/emilkowalski/skills/tree/85e8e2363b713506e1d5b6e07a0eb2da66be1bc3/skills/mobile-native
  adapted-for: jessepollak/home
  adaptation: Home mobile-web scope, existing Playwright, device checks, and a condensed symptom reference
---

# Mobile-native Home UI

Apply the smallest platform-correct change to the named mobile-web surface. Home's `AGENTS.md`, `docs/ui-direction.md`, `docs/architecture.md`, and `docs/operating-manual.md` always win.

## Boundaries

- Use CSS capabilities and existing components before JavaScript: media queries, `dvh`/`svh`, `env()`, and `touch-action` rather than device detection.
- Touch and mouse can coexist. Gate behavior by `(hover)` and `(pointer)`, not user agent or width guesses.
- Never disable zoom. Preserve selectable content, browser navigation, focus, and native scrolling unless the named control must own a gesture.
- Keep reduced-motion behavior and Home timing within the `docs/ui-direction.md` limits.
- Follow `docs/browser-validation.md`: the repository-pinned `agent-browser` is required for interactive iteration and proof before and after editing. Playwright remains the sole authoritative committed automated browser layer; use its existing configuration only when the permanent-test ladder calls for a browser assertion.
- A real-device check is an operator action unless the runner exposes an Android device under [the real Android device contract](../../../docs/browser-validation.md#real-android-device); then run the Android Chrome check yourself and report iOS/Safari as unverified. Never claim an emulated viewport proves real-device behavior.

## Review sequence

1. Use the Home browser-iteration skill and repository-pinned `agent-browser` to trace the interaction at a narrow viewport, including focus, software keyboard, scrolling, back navigation, and final state.
2. Inspect the `viewport` export in `apps/web/app/layout.tsx` (if any) and `apps/web/app/globals.css` before proposing local work.
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

## Reference

Match the observed symptom, confirm the cause in code, and apply the fix only where its reason applies.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Hover state sticks after a tap | Touch fakes `:hover` until the next tap elsewhere | Gate hover styles behind `@media (hover: hover) and (pointer: fine)`; give touch an `:active` state instead |
| Gray or blue flash on tap | Mobile browsers paint a tap highlight on clickable elements | Tailwind v4 preflight already sets `-webkit-tap-highlight-color: transparent` on `html`; confirm every tappable control has its own `:active` state |
| Bottom-pinned UI sits under the URL bar | `100vh` is the largest viewport, with browser chrome collapsed | `100dvh` for app shells, drawers and pinned UI; `100svh` for stable first screens |
| Page zooms into a focused input and stays zoomed | iOS zooms inputs under 16px | 16px minimum where `(pointer: coarse)` applies; never `maximum-scale` or `user-scalable=no` |
| Wrong keyboard or return key | Missing input hints | `inputmode="decimal"` for amounts, `inputmode="numeric"` for codes, `enterkeyhint`, and `autocapitalize="none"`/`autocorrect="off"` on codes and addresses |
| Taps feel late | Double-tap-zoom delay, or feedback only on `click` | `touch-action: manipulation`, already on interactive elements in `apps/web/app/globals.css`; press feedback on `:active` or `pointerdown` at 100–160ms ease-out using existing motion tokens |
| Scrolling a sheet or list moves the page behind it | Scroll chains to the document at the container's edge | `overscroll-behavior: contain` on the inner scroller; never a `touchmove` + `preventDefault()` listener |
| Content under the notch or home indicator, or insets read as zero | `env(safe-area-inset-*)` is `0` without `viewport-fit=cover` | Add `viewportFit: "cover"` to the Next.js `viewport` export in `apps/web/app/layout.tsx` (create it if absent), then pad fixed chrome with `env(safe-area-inset-*, 0px)` |
| Long-press selects a control's label or opens a callout | Control text is selectable | `user-select: none` and `-webkit-touch-callout: none` on controls only; addresses, amounts, errors and links that are content stay selectable |
| Swipe carousel jitters the page vertically | The browser cannot tell which axis the element owns | `touch-action` names what the browser keeps: `pan-y` on a horizontal gesture, `none` only where the element owns every axis; prefer native `scroll-snap` over a custom gesture |
| Keyboard covers a bottom-pinned input on Android | Android Chrome resizes only the visual viewport by default | Home measures the keyboard as `innerHeight` minus the visual viewport (`apps/web/components/visual-viewport.ts`, used by the drawer and primary navigation); keep the default resize behavior unless that measurement changes in the same PR |
| Text grows in landscape | Mobile font inflation | Tailwind v4 preflight already sets `-webkit-text-size-adjust: 100%`; do not override it |
| Status bar color mismatches the theme | One static `theme-color` | Home updates the tag on theme change in `apps/web/client/appearance/`; change `appearanceThemeColors`, not the meta tag |

Home-specific cautions:

- Home owns pull-to-refresh (`apps/web/components/ui/pull-to-refresh.tsx`). Do not add `overscroll-behavior: none` to `html` or `body` without proving that surface still works.
- Do not apply `user-select: none` to every link or to `body`; scope it to controls.

Never ship: disabled zoom, ungated `:hover`, `100vh` on app height, `touchmove` + `preventDefault()` to stop overscroll, `touch-action: none` on content the user must scroll past, safe-area insets without `viewport-fit=cover`, user-agent touch detection, or a mobile fix declared done from emulation alone.

## Proof

Use `agent-browser` to prove no horizontal overflow, visible and reachable primary controls, correct focus destination, usable back behavior, and a stable final state with reduced motion. Add durable assertions only at the layer selected by `docs/browser-validation.md`; do not assert browser implementation details. Keep tests proportional to the product change.

## Report

For each supported finding give `severity — file:line — observed risk — smallest remedy — automated proof — device check (agent-run Android Chrome or operator action)`. Distinguish code-confirmed defects from hypotheses and state which iOS or Android behavior remains unverified. If implementing, report the exact declarations or component behavior changed. If no concrete finding survives code and issue verification, say so.

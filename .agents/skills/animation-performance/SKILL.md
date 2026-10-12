---
name: animation-performance
description: Diagnose or prevent dropped frames in a named Home animation or transition — janky, choppy, or stuttering motion, choosing which property to animate, CSS versus Motion on performance grounds, or reaching for `will-change`. Not for choosing whether to animate, easing, or duration (use animate) or for a whole motion review (use review-animations).
license: MIT
metadata:
  source: https://github.com/emilkowalski/skills/tree/2d228630ba1446365f614a108cb8252f1feda202/skills/animation-performance
  adapted-for: jessepollak/home
  adaptation: Home motion policy, Motion dependency, agent-browser and device-profiling proof replace upstream defaults
---

# Home animation performance

Make the scoped motion finish every frame. This lens does not decide whether motion should exist or how it should feel; [animate](../animate/SKILL.md) and [design-engineering](../design-engineering/SKILL.md#motion) own that policy and win on conflict. Diagnose first; edit only when the assignment includes the fix, and stay inside its surface.

## Rules

1. **`transform` and `opacity` by default.** Anything else needs a stated reason, even when the expensive property seems fine on a fast machine.
2. **Name the cause before changing code.** Every proposed fix names one cause from the diagnosis list. "Added `will-change`, seems smoother" is not a diagnosis.
3. **The budget is a mid-range phone at 120Hz: about 8ms per frame.** A developer laptop hides most of these problems. Say which findings are verified from code and which need a recording.
4. **List transitioned properties explicitly.** Never `transition: all` or Tailwind `transition-all`; it animates whatever changes next, including layout.
5. **Correctness beats best-effort acceleration.** The browser may decline to accelerate; which properties you animate is what you control. Keep `translateY(100%)` for elements of unknown size.

## Symptoms

| Symptom | First suspect | Usual fix |
| --- | --- | --- |
| Stutters while growing, shrinking, or moving | `width`, `height`, `padding`, `margin`, `top`, `left` | `scale()` or `translate()` |
| Choppy shadow change | Animated `box-shadow` repaints every frame | Crossfade a pseudo-element's `opacity`; `filter: drop-shadow()` only as a Safari-tested fallback |
| Show/hide snaps | `display` / `visibility` swap with no transition | Transition `opacity`, then keep a discrete `display: none` or `hidden` end state so collapsed layout is preserved |
| Jank only during navigation, fetching, or hydration | Main-thread animation competing with page work | CSS transition or WAAPI |
| Motion `x`/`y`/`scale` drops frames during page work | Independent transform values run on the main thread | Full `transform` string (not combinable with `layout` or drag) |
| Hand-rolled animation drops frames | React state set per frame | Write to `ref.current.style` or a motion value |
| Drag or `transform` slows as content grows | Animated inherited CSS custom property recalculates descendants | Set `transform` on the element directly |
| Blur transition lags, especially Safari | Large animated `filter: blur()` | Keep it small (2–5px softens a crossfade; stay well under 20px) and measure in Safari |
| Glass surface lags | Animated `backdrop-filter` value or the area behind it | Keep the backdrop blur static; fade the element's `opacity` instead |
| Unexpected properties animate | `transition: all` / `transition-all` | Name the properties |
| 1px shift at the start or end | Layer promotion mid-animation | `will-change: transform` on that element, only once observed |

## Cost tiers

| Tier | Properties | Notes |
| --- | --- | --- |
| Composite | `transform`, `opacity` | Reliably cheap and accelerated. |
| Sometimes composited | `filter`, `clip-path` | Engine-dependent; measure, and verify in WebKit before relying on it. |
| Paint | `box-shadow`, `border-radius`, `color`, `background-color` | Redraws every frame; browser compositing of `background-color` is still partial. |
| Layout | size, padding, margin, inset, `border-width` | Can re-lay-out neighbours every frame; a sidebar's `margin-left` moves the whole page. |

A layout animation on a small absolutely positioned element may not drop frames. Where a `scale()` or `translate()` version is visually equivalent, choose it: it cannot regress on a slower device. It is not equivalent when descendants such as text would distort under `scale()`, or when surrounding content must reflow around the changing size or position, since transforms leave document flow unchanged; keep the layout animation short and measured, or restructure (for example, scale a background layer while content crossfades).

## Where it runs

- CSS transitions, keyframes, and WAAPI can run off the main thread for accelerated properties. `requestAnimationFrame` loops and Motion's independent transforms always run on it.
- Motion (`motion` in `apps/web/package.json`) is eligible for acceleration only when animating the full `transform` string, `opacity`, or supported filters; its imperative `animate()` can hand these off to WAAPI. Keep the readable `x`/`y` shorthands by default; switch only when the motion must survive a busy main thread.
- Watch motion that plays while the page is busy: route changes, tab indicators during navigation, sheets opening alongside a fetch, anything during hydration. A shared-layout (`layoutId`) indicator running during navigation is the classic failure; a CSS transition fixes it.
- JavaScript animation is not forbidden. Use CSS for simple motion and anything that plays during heavy work; use Motion for springs, exit, shared layout, and gestures CSS cannot express, per [animate](../animate/SKILL.md).
- In React, animation libraries run outside render. Look for `setState` inside `requestAnimationFrame`, `pointermove`, `scroll`, or drag handlers.

## `will-change`

It is the last step, not the first. Browsers already promote elements animating `transform` or `opacity`, and every promoted layer costs GPU memory. Add it only to the animating element after seeing a shift or measuring dropped frames, never to `*` or large containers. Its legitimate use is an expensive paint such as a small blurred or filtered layer.

## Workflow

1. **Inventory.** For each animation in scope record element, driver (CSS, WAAPI, Motion component, rAF), the properties it actually animates after expanding `transition-all` and Motion shorthands, and what else plays during it.
2. **Diagnose in order:** layout properties, then paint properties (`box-shadow`, `border-radius`) that are easy to miss; coincidence with navigation, fetching, or hydration; per-frame React renders; degradation as content grows; animated custom properties directly or via Motion shorthands; animated blur above 20px; only then a layer-promotion shift.
3. **Measure, not feel.** Follow [browser validation](../../../docs/browser-validation.md) with the pinned `bun run ab --` and the worktree's distinct `--session`: `trace start` / `trace stop <path>` for dropped frames and long tasks, and `react renders start` / `stop` (session opened with `--enable react-devtools`) for per-frame renders. Keep traces outside the repository. Desktop CPU throttling models a slow CPU, not a weak GPU or small memory budget; phone acceptance uses [device performance profiling](../../../docs/device-profiling.md), and simulator or emulator numbers are never physical-device evidence.
4. **Fix the named cause** with the smallest change that preserves Home's timing, reduced-motion path, focus, and final state, then re-measure the same interaction.

## Report

One entry per finding, ordered by cost (layout before paint, busy main thread before idle):

```
**[Element]** `apps/web/…/file.tsx:42`
Cause: [one cause from the diagnosis list]
Before: `transition-all duration-200` (animates padding → layout)
After: `transition-transform duration-200` with `scale(0.97)`
Verified: code | agent-browser trace | device-profiling run | needs device recording
```

Never claim smoothness from a fast machine or a check that was not performed.

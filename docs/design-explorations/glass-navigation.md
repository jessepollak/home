# Glass navigation exploration

Status: **Selected: CSS glass (owner, PR review 2026-09-26), resized and adopted in PrimaryNavigation mobile layout** for [#1036](https://github.com/jessepollak/home/issues/1036). The liquid candidate was not adopted. Review the production journey on `review-boards--glass-navigation`.

## Scope

The exploration asked whether Home's mobile bottom navigation should become a floating translucent capsule, and which rendering approach should carry it. Home / Invest destinations, nested-panel selection (Cash, Your money, Borrow and Activity keep Home selected) and the desktop top bar are unchanged.

The prototype compared current, CSS glass and liquid glass using a fixture-backed shell. Production now renders one `PrimaryNavigation` and one set of Home/Invest buttons, with a CSS glass capsule below 1024px and the desktop rail from 1024px. Journey inventory: [mobile navigation stories](../design-system/stories/glass-navigation.md).

## Shared design

- **Geometry:** a capsule centred at 12rem (192px) wide, max-width `calc(100% - 2rem)`, 3.75rem (60px) tall, 0.25rem padding, fully rounded, with two 3.25rem (52px) tabs (≥44px targets). Icon above label.
- **Safe area:** the bottom offset is `max(calc(var(--shell-safe-area-bottom) - 0.875rem), 0.75rem)`: 12px without a home indicator and 20px with a 34px one, so the capsule sits in the indicator zone instead of stacking a full inset beneath it.
- **Clearance:** the scroll region reserves the 3.75rem capsule height, offset and 1rem of `padding-block-end` and `scroll-padding-block-end`. Story tests assert that the final row ends above the capsule.
- **Scroll boundary:** the authenticated `main` owns scrolling. The document must not expose persistent empty space below the app, and it must not carry the fixed capsule away from the viewport. Browser tests check this once Home has loaded. [#1088](https://github.com/jessepollak/home/issues/1088) owns the functional fix, and follow-up 6 records what was measured. Physical toolbar and keyboard checks are in follow-up 2.
- **Toolbar transitions:** the signed-in shell is `100svh` tall, but fixed elements follow the current viewport bottom. When mobile browser chrome collapses, the capsule and the toast viewport add `--shell-viewport-overhang` (`100dvh - 100svh`) to their bottom offset. This keeps them on the shell's bottom edge, the same edge the content clearance is measured from. Both render only inside that shell, so the overhang is defined on `:root` from first paint, with no `:has()` anchor above the feed. Where `dvh` is unsupported, it stays 0.
- **Selection:** a single persistent pill translates between tabs with a spring (`visualDuration` 0.16s, bounce 0.1), so rapid taps retarget from the current position. It follows inline direction in RTL. The selected tab uses a primary icon and a foreground label; unselected tabs use foreground at 70%.
- **Press:** the tab content compresses to 95% immediately and releases over 140ms.
- **Reduced motion:** the pill jumps, and press and hide transforms are removed.
- **Material fallbacks:** without `backdrop-filter` (prefixed or unprefixed), with `prefers-reduced-transparency: reduce`, or in the journey's forced fallback, the capsule is opaque `--popover` with a `--border` rim. Forced colours use system colours. No liquid layer ships.
- **Layering:** the capsule sits below sheets and dialogs. The money sheet covers it, and the sheet's modal focus removes it from the accessibility tree.
- **Keyboard:** the capsule fades out and becomes inert only while an editable field inside the content has focus and the visual viewport shows the keyboard covering the bottom. With a hardware keyboard or a dismissed keyboard, the nav stays available. Money inputs live in sheets, which cover the capsule.

## Package evaluation: `simple-liquid-glass` 5.3.0 (historical; not adopted)

Checked 2026-09-26 from the npm registry, the GitHub API and the published tarball.

| Question | Finding |
| --- | --- |
| Release and maintenance | 5.3.0 published 2026-09-09; seven releases on 8–9 September after nine in June and none in July–August. 16 stars, 0 open issues, 2 contributors, last commit 2026-09-13; 2,289 downloads in the week to 24 September. |
| License | MIT; vendored MIT code from samasante/liquid-glass, @ybouane/liquidglass and html-to-image. |
| React 19 / SSR | Peer range includes React 19. No `"use client"` directive in the entries. Server rendering with React 19.2.8 produced identical markup twice without errors. A Next production build and hydration were not tested. |
| Added bundle (minified, gzip) | `LiquidGlass`: 33,344 B. With `LiquidGlassScene`: 42,605 B. The CSS candidate adds no new dependency; Motion (already shipped by Home) is 41,742 B on its own for comparison. Measured as standalone esbuild bundles, not Next chunks. |
| Rendering lifecycle | The scene clones HTML sections into SVG `foreignObject` snapshots (html-to-image), then samples them per lens in WebGL. Mutations, resizes and load/input events mark sections dirty; captures run one at a time at least 120ms apart, and dirty recaptures wait 180ms after the change. Each visible surface owns a WebGL context. |
| Cleanup | Offscreen surfaces release WebGL through an IntersectionObserver; unmount destroys GPU objects, cancels animation frames and removes listeners. The scene's animation-frame loop runs continuously while mounted and idles without targets. Snapshot cache defaults to 64 MiB. |
| Renderer choice | iOS is detected from the user agent plus touch points and gets WebGL automatically; other browsers use SVG or CSS blur unless `renderer="webgl"`. |
| Accessibility settings | Reduced motion lowers quality; no `prefers-reduced-transparency` handling was found, so the story's CSS hides the layer itself. |

## Prototype evidence (historical)

Device coverage:

- **Desktop Chromium (headless) 154:** agent-browser 0.38.1 at 390×844 CSS px (DPR 2) and 1440×900. Mobile layout emulation only, without touch.
- **iOS Simulator:** iPhone 17 Pro, iOS 26.2, Mobile Safari 26.2, in a Safari tab. This is real WebKit and the library's iOS path, but not device GPU, touch or display timing.
- **Unavailable:** a physical iPhone, the installed PWA (standalone) mode, 120Hz feel, thermals and battery. Real `env(safe-area-inset-bottom)` was not exercised because the Storybook frame does not set `viewport-fit=cover`; the home-indicator stories simulate a 34px inset. The software keyboard did not appear in the simulator, because its hardware keyboard was connected.

### Visual

- **CSS glass:** renders the same in Chromium and iOS Safari, with a crisp pill, rim and labels in light and dark. Content under the capsule reads as a soft blur.
- **Liquid glass, iOS:** the library reports `webgl · ios-webgl · low` and refracts the content beneath, which shows as blurred dark text and green amounts behind the labels.
- **Liquid glass, Chromium:** the default is the SVG path; WebGL runs only when forced.
- **Fixed during review:**
  - The liquid scene captured the navigation itself, which drew a ghost of the icon and label; the navigation is now excluded from capture.
  - The library's layers painted over the pill; the material is now isolated beneath it.
  - Unselected labels were too faint over busy content; the tint rose to 78% and unselected text to foreground/70.

### Motion and frame pacing

Headless Chromium throttles animation frames (p95 about 133ms even for the unchanged current bar), so the scripted rAF sampling measures the harness, not the candidates. No frame-pacing or jank claim is made from it, and CPU throttling was unavailable. In the recorded clips the pill retargets during four rapid taps without restarting or overshooting in either candidate, and reduced motion snaps it.

### Capture cost and freshness (liquid glass)

- **After a panel switch:** in the iOS Simulator clip, the refraction layer shows no new content for about 1–1.5s (the 2 fps frame sampling bounds the precision), then shows the new page.
- **Live data:** balance changes trigger recaptures. Headless Chromium recorded 2 long tasks totalling 227ms over 10s of fixture balance updates, against none for the CSS candidate.
- **Time to first WebGL frame:** 9.0s in headless Chromium with forced WebGL. This is not representative of a phone.
- **Nested scrolling:** the library samples window scroll, while Home scrolls inside `main`. A story that calls `refreshBackdrop()` on `main` scroll produced pixel-identical results to the default in the Chromium probe. Whether the refracted image tracks Home's own scrolling is unverified, and the captures do not prove it matches.
- **Theme and styles:** changes outside the captured subtree need an explicit refresh.

### Fallback

In the original comparison, opaque fallback, blur-only liquid fallback, forced colours and reduced transparency kept labels legible. The liquid cases were not adopted; the current board covers only CSS glass.

## Owner selection and adoption

The owner selected CSS glass and requested standard iOS tab-bar proportions in PR review on 2026-09-26. The candidate now ships in the single production `PrimaryNavigation`; the liquid dependency and exploration components were removed. Below 1024px the nav is fixed and centred with 192px width, 60px height, 52px tab targets, 22px icons, 10px labels, 4px padding, and the safe-area-aware clearance described above. At 1024px and wider the desktop rail replaces it; the former top strip was removed. A physical iPhone check and Safari-tab safe-area support remain deferred.

## Follow-ups

Coverage lives in [glass-navigation/follow-ups](glass-navigation/follow-ups/), one file per follow-up. Follow-up 1 is implemented; 2 and 5 are deferred to Jesse; 3 is rejected by owner selection; 4 is covered by PR #1075; 6 tracks scroll-boundary validation with #1088.

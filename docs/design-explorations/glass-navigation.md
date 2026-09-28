# Glass navigation exploration

Status: **Adopted in the PrimaryNavigation mobile layout** for [#1036](https://github.com/jessepollak/home/issues/1036): the CSS glass capsule, plus a lazy-loaded liquid lens for the selection pill in every engine and backdrop refraction at the capsule rim in Chromium. See [Liquid material](#liquid-material). The owner first selected CSS glass on 2026-09-26 and reopened liquid glass on 2026-09-27 with a no-DOM-capture approach. Review the production journey on `review-boards--glass-navigation`.

## Scope

The exploration asked whether Home's mobile bottom navigation should become a floating translucent capsule, and which rendering approach should carry it. Home / Invest destinations, nested-panel selection (Cash, Your money, Borrow and Activity keep Home selected) and the desktop top bar are unchanged.

The prototype compared current, CSS glass and liquid glass using a fixture-backed shell. Production now renders one `PrimaryNavigation` and one set of Home/Invest buttons, with a CSS glass capsule below 1024px and the desktop rail from 1024px. Journey inventory: [mobile navigation stories](../design-system/stories/glass-navigation.md).

## Shared design

- **Geometry:** a capsule centred at 12rem (192px) wide, max-width `calc(100% - 2rem)`, 3.875rem (62px) tall, 0.25rem padding, fully rounded, with two 92×54px tabs (≥44px targets) and a pill the size of one tab. Icon above label: a 26px lucide icon box (about 23px of ink at the default stroke), no CSS gap, and an 11px semibold label with `tracking-tighter` on a 14px line. That makes the visual icon-to-label gap about 5px and the icon-plus-label block about 36px, optically centred. `components/primary-navigation-tab.ts` holds these content metrics for both the real tabs and the lens copy.
- **Native reference:** measured from an iOS 26 Photos tab bar on a 402pt iPhone 17 Pro (±2%): capsule 191×62, pill 96×53 at a 4 inset, glyphs about 23–25 tall, label cap height 7.7 ("Collections" 54 wide), visual gap 4.6–5.5, block 36–38, 22 from the bottom edge. Native tab slots overlap: each tab's content is centred 52pt from its outer edge, so the pill is 96 wide but travels only 88. Home deliberately keeps equal halves, with the pill as wide as a tab and travelling its own width. This keeps the lens, mask-hole and RTL math one-to-one, at a cost of about 4pt of pill width.
- **Safe area:** the bottom offset is `max(calc(var(--shell-safe-area-bottom) - 0.75rem), 0.75rem)`: 12px without a home indicator and 22px with a 34px one, so the capsule sits in the indicator zone instead of stacking a full inset beneath it.
- **Clearance:** the scroll region reserves the capsule height (`--spacing-shell-mobile-navigation`, 3.875rem), the offset, and 1rem of `padding-block-end` and `scroll-padding-block-end`. Story tests assert that the final row ends above the capsule.
- **Scroll boundary:** the authenticated `main` owns scrolling. The document must not expose persistent empty space below the app, and it must not carry the fixed capsule away from the viewport. Browser tests check this once Home has loaded. [#1088](https://github.com/jessepollak/home/issues/1088) owns the functional fix, and follow-up 6 records what was measured. Physical toolbar and keyboard checks are in follow-up 2.
- **Toolbar transitions:** the signed-in shell is `100svh` tall, but fixed elements follow the current viewport bottom. When mobile browser chrome collapses, the capsule and the toast viewport add `--shell-viewport-overhang` (`100dvh - 100svh`) to their bottom offset. This keeps them on the shell's bottom edge, the same edge the content clearance is measured from. Both render only inside that shell, so the overhang is defined on `:root` from first paint, with no `:has()` anchor above the feed. Where `dvh` is unsupported, it stays 0.
- **Selection:** a single persistent pill translates between tabs. Every per-frame motion is a `transform` animation, so it runs on the compositor and keeps its full duration while the main thread renders the next panel. The lens travels over 400ms with `cubic-bezier(.25, .25, .15, 1.2)`, a fit to within 2% of a spring with 0.8 damping. It reaches half way at about 90ms, overshoots by about 2.5px near 300ms, and settles at 400ms. `linear()` springs are not used, because WebKit runs a `linear()` transition on the main thread; a probe stalled under a busy main thread, while the same `cubic-bezier` transition and a keyframed spring kept moving. The fallback pill keeps its 180ms `cubic-bezier(.25, 1.15, .35, 1)` transition. A new tap retargets from the current position. It follows inline direction in RTL. The selected tab uses a primary icon and a foreground label; unselected tabs use foreground at 70%.
- **Press:** without the lens, the tab content compresses to 95% immediately and releases over 140ms. With the lens mounted, a primary pointer down on either tab lifts the glass instead: the nav gets `data-lens-pressed`, and the window eases out to 114% about its centre over 180ms with `cubic-bezier(.2, 0, 0, 1)`. It magnifies its content, stays inside the capsule vertically, and overflows it by about 2.5px at the outer end. Release waits until the press has lasted at least 120ms. The window then settles back over 450ms with `cubic-bezier(.35, .75, 0, 1.25)`, dipping to about 99% before it rests. While the lens travels, a keyframe animation also stretches the window along the travel axis. It follows the spring's speed, peaking at +8% wide and −3% tall about 60ms in and returning to rest by 240ms. The fallback pill has no lift. Drag-to-select is not implemented. Taps, keyboard activation, focus and scrolling go through the real buttons unchanged. A pointer cancel, such as a scroll that starts on the nav, releases the lift. So does a pointer end anywhere in the document, even when a handler stops its propagation, and so does the window losing focus or the page becoming hidden.
- **Reduced motion:** the pill and lens jump, and press, lift, stretch and hide transforms are removed. Switching to reduced motion mid-travel cancels the running animations, so the lens lands on the selected tab.
- **Material fallbacks:** without `backdrop-filter` (prefixed or unprefixed), with `prefers-reduced-transparency: reduce`, or in the journey's forced fallback, the capsule is opaque `--popover` with a `--border` rim, and the liquid layer never loads. Forced colours use system colours and also skip the liquid layer.
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

## Liquid material

Adopted 2026-09-27 on the owner's direction to reopen liquid glass. Nothing captures the DOM and nothing uses WebGL. The technique follows Aave's [Building glass for the web](https://aave.com/design/building-glass-for-the-web): an SVG `feDisplacementMap` bends the element's own painted content.

- **Capsule (all engines, CSS only):** a masked gradient rim lit from the top, an inner glow and shade for thickness, a three-layer floating shadow, and a see-through tint that deepens toward the labels: 34% to 46% `--background` in light and 44% to 58% `--secondary` in dark, over `blur(4px) saturate(180%)` (dark adds `brightness(.9)`). Page content stays recognisable as softened shapes and colour under the capsule, as in native iOS 26; at 6px of blur or more, text under it disappears. Unselected icons and labels use foreground/90, and the selected tab is set apart by the primary icon and the pill. The capsule and both lens layers take these colours from `components/primary-navigation-tab.ts`. Over the busy activity list, the 5th-percentile worst case for the 11px labels is at least 4.5:1 in light and dark. The capsule keeps a single `backdrop-filter`.
- **Selection lens (all engines):** once the page is idle after hydration, `import()` loads `apps/web/client/liquid-glass/nav-lens.tsx`. While it is mounted, the real buttons stay the only interactive and accessible surface, but their content is transparent; the lens draws every visible tab in two `aria-hidden`, inert layers. The unselected layer is a tab-sized carrier that translates with the lens. Inside it, a static SVG mask cuts a pill-shaped hole 1.5px larger than the lens at the carrier's origin, and a counter-translated copy of both tabs sits in unselected styling. Because a mask moves with its element, the hole follows the lens without animating the mask. The lens window translates the same way, and a filtered, counter-translated copy of the tabs in selected styling sits inside it, under `filter: url(#…)`. Selected and unselected styling therefore come purely from position. No layer swaps and no colour flips under the lens, and neither layer shows a double image in any engine. The carrier, the window and both copies transition `transform` with one duration and easing from the same style change. Lift and stretch are separate nested `transform` layers on the window, and the hole layer applies the same lift and stretch. The copy inside the hole applies their inverses, so it stays within 0.25px of its rest position while the hole tracks the scaled window. Stretch is a Web Animations keyframe started when the target changes, and no script runs per frame. The displacement map stays fixed while the pill travels.
- **Rim refraction (Chromium only):** when `navigator.userAgentData.brands` includes `Chromium`, the lens module also puts a capsule-sized displacement filter into the capsule's single `backdrop-filter`. Page content bends across a band about 22px wide inside the capsule edge, peaking at 12px of inward displacement at the edge, and a frosted core fades in beyond it without a seam. The core uses the same 4px blur and the same tint as the other engines, so the rim path is no denser than theirs. WebKit and Firefox parse `url()` in `backdrop-filter` but do not render displacement, so they keep the frosted capsule. So does Chromium in an insecure context, which has no `userAgentData`.
- **Maps:** `lens-map.ts` generates the displacement and specular maps from a convex bezel profile and Snell refraction. The rim instead passes a `falloff` exponent that eases travel from its full thickness at the edge to zero at the bezel, so content compresses gradually and text stays readable. It computes one quadrant and mirrors it. Maps are regenerated only when size or DPR changes, each regeneration gets a fresh filter id because WebKit caches filter output by id, and a four-entry cache bounds the stored data URLs. `feImage` receives an explicit region, and the filtered element carries a transform for WebKit.
- **Gating:** `lens-gate.ts` mounts the lens only in the capsule layout below 1024px, with `backdrop-filter` support, and without reduced transparency or forced colours. It reacts to media changes. With reduced motion, the lens snaps into place.
- **Cost:** the lazy chunk is about 4.5 KB gzip and is absent from the shell route's initial JS. The gate adds about 50 B to the initial JS. Scrolling runs no JS for the effect.
- **Evidence and limits:** Playwright Chromium, WebKit and Firefox screenshots at rest and mid-travel, plus pixel diffs showing WebKit and Firefox unchanged by rim refraction. A physical iPhone, the installed PWA, and Android Chrome GPU cost were not measured.

## Owner selection and adoption

Historical selection (2026-09-26): the owner selected CSS glass and requested standard iOS tab-bar proportions; the liquid dependency and exploration components were removed. The current production `PrimaryNavigation` adds the owned liquid lens described above. Below 1024px the nav is fixed and centred with a 192px width, 62px height, 54px tab targets, 26px icon boxes, 11px semibold labels, 4px padding, and the safe-area-aware clearance described above. At 1024px and wider the desktop rail replaces it; the former top strip was removed. A physical iPhone check and Safari-tab safe-area support remain deferred.

## Follow-ups

Coverage lives in [glass-navigation/follow-ups](glass-navigation/follow-ups/), one file per follow-up. Follow-up 1 is implemented; 2 and 5 are deferred to Jesse; 3 is implemented with the owned lens described in [Liquid material](#liquid-material) instead of the rejected package; 4 is covered by PR #1075; 6 tracks scroll-boundary validation with #1088.

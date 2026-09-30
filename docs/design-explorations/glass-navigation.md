# Glass navigation exploration

Status: **Adopted in the PrimaryNavigation mobile layout** for [#1036](https://github.com/jessepollak/home/issues/1036): the CSS glass capsule, plus a lazy-loaded liquid lens for the selection pill in every engine and backdrop refraction at the capsule rim in Chromium. See [Liquid material](#liquid-material). The owner first selected CSS glass on 2026-09-26 and reopened liquid glass on 2026-09-27 with a no-DOM-capture approach. Review the production journey on `review-boards--glass-navigation`.

## Scope

The exploration asked whether Home's mobile bottom navigation should become a floating translucent capsule, and which rendering approach should carry it. Home / Invest destinations, nested-panel selection (Cash, Your money, Borrow and Activity keep Home selected) and the desktop top bar are unchanged.

The prototype compared current, CSS glass and liquid glass using a fixture-backed shell. Production now renders one `PrimaryNavigation` and one set of Home/Invest buttons, with a CSS glass capsule below 1024px and the desktop rail from 1024px. Journey inventory: [mobile navigation stories](../design-system/stories/glass-navigation.md).

## Shared design

- **Geometry:** a capsule centred at 12rem (192px) wide, max-width `calc(100% - 2rem)`, 3.875rem (62px) tall, 0.25rem padding, fully rounded, with two 92×54px tabs (≥44px targets) and a pill the size of one tab. Icon above label: a 26px lucide icon box (about 23px of ink at the default stroke), no CSS gap, and an 11px semibold label with `tracking-tighter` on a 14px line. That makes the visual icon-to-label gap about 5px and the icon-plus-label block about 36px, optically centred. `components/primary-navigation-tab.ts` holds these content metrics for both the real tabs and the lens copy.
- **Native reference:** measured from an iOS 26 Photos tab bar on a 402pt iPhone 17 Pro (±2%): capsule 191×62, pill 96×53 at a 4 inset, glyphs about 23–25 tall, label cap height 7.7 ("Collections" 54 wide), visual gap 4.6–5.5, block 36–38, 22 from the bottom edge. Native tab slots overlap: each tab's content is centred 52pt from its outer edge, so the pill is 96 wide but travels only 88. Home deliberately keeps equal halves, with the pill as wide as a tab and travelling its own width. This keeps the lens, mask-hole and RTL math one-to-one, at a cost of about 4pt of pill width.
- **Safe area:** the bottom offset is `max(calc(var(--shell-safe-area-bottom) - 0.75rem), 0.75rem)`: 12px without a home indicator and 22px with a 34px one, so the capsule sits in the indicator zone instead of stacking a full inset beneath it.
- **Clearance:** the scroll region reserves the capsule height (`--spacing-shell-mobile-navigation`, 3.875rem), the offset, and 1rem of `padding-block-end` and `scroll-padding-block-end`. Browser tests assert that the final row ends above the capsule.
- **Scroll boundary:** the shell scrolls the document (the authenticated `main` is not a scroll container). The document must not expose persistent empty space below the app, and it must not carry the fixed capsule away from the viewport. Browser tests check this once Home has loaded. [#1088](https://github.com/jessepollak/home/issues/1088) owns the functional fix, and follow-up 6 records what was measured. Physical toolbar and keyboard checks are in follow-up 2.
- **Toolbar transitions:** the signed-in shell is at minimum `100svh` tall; content extends the document past the viewport while the fixed capsule and toast follow the current viewport bottom. When mobile browser chrome collapses, the capsule and the toast viewport add `--shell-viewport-overhang` (`100dvh - 100svh`) to their bottom offset. This keeps them on the shell's bottom edge, the same edge the content clearance is measured from. Both render only inside that shell, so the overhang is defined on `:root` from first paint, with no `:has()` anchor above the feed. Where `dvh` is unsupported, it stays 0.
- **Selection:** pointerdown on another tab lifts the lens over its origin for 34ms, then glides it to the pressed tab; a drag then follows the finger to the tab under it, and releasing over a tab selects it through its real button. Non-pointer navigation (keyboard activation or a programmatic tab change) travels unlifted in 180ms with `cubic-bezier(.2, 0, 0, 1)`. While lifted, travel takes 300ms with `cubic-bezier(.35, .9, .3, 1.15)`: the lens reaches the tab at about 150ms, overshoots it by about 4px, and settles by 300ms, fitted to the native Photos tab bar at 30fps. During lifted travel a 300ms compositor keyframe stretches the whole lens (body, selected copy, clip and mask hole together) to 1.14× width and 0.93× height at the glide midpoint, relaxes it on landing with a slight counter-squash, and counter-scales the unselected copy so it never distorts; a new target retargets the lens from its current position, and RTL follows inline direction. The fallback pill travels in 180ms with `cubic-bezier(.25, 1.15, .35, 1)`. The selected tab uses a primary icon and a foreground label; unselected tabs use foreground at 90%.
- **Press:** with the lens mounted, primary pointerdown lifts the lens: its body grows to 1.25× width and 1.3× height in 100ms, while its content magnifies 1.08× on a sibling layer. The lifted state is clear glass with a bright rim. A tap plays the whole lift, glide and landing even when the finger lifts first; the lens settles its body, magnifier and tint in about 180ms after it lands, or on release after a longer hold. A tap released off its tab returns the lens at once. The capsule owns its touches (`touch-action: none`), so the tab bar never scrolls the page: vertical movement keeps the lens lifted and following horizontally, release within 24px above, below or beside the bar selects the nearest tab, and release farther away cancels back. Pointerdown records the intended tab at once, so navigation elsewhere during the 34ms lift drops the lift. After a confirmed tap the lens holds the tapped tab until the navigation commits, and abandons it only on a new press, navigation elsewhere, window blur, a hidden page, or after 3 seconds; a release that no click confirms returns after 600ms. Pointer cancel, lost pointer capture, window blur or a hidden page releases the lift and restores the selected tab. Without the lens, tab content compresses to 95% on press and releases over 140ms. The real buttons remain the interaction and focus targets.
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
- **Unavailable:** a physical iPhone, the installed PWA (standalone) mode, 120Hz feel, thermals and battery. Real `env(safe-area-inset-bottom)` was not exercised because the Storybook frame does not set `viewport-fit=cover`; the prototype's home-indicator stories simulated a 34px inset. The software keyboard did not appear in the simulator, because its hardware keyboard was connected.

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
- **Selection lens (all engines):** once the page is idle after hydration, `import()` loads `apps/web/client/liquid-glass/nav-lens.tsx`. While mounted, the real buttons remain the only interactive and accessible surface, but their content is transparent; the lens draws both tabs in two `aria-hidden`, inert sibling layers. A translated unselected carrier holds a counter-translated copy at its original size behind a pill-shaped mask hole; that copy is never scaled, and while the glide stretches the hole it is counter-scaled so its net scale stays 1. The lens window travels alongside it, and a filtered, counter-translated selected copy sits beneath a matching clip mask. The selected and unselected masks are exactly complementary, including when the lens lifts: the hole and clip switch together to the same enlarged pill shape. The glass body scales independently of the sibling content magnifier (1.08× on press), so magnification cannot distort the unselected copy. Selection styling comes from position rather than layer swaps or colour flips; the displacement map stays fixed while the lens travels.
- **Rim refraction (Chromium only):** when `navigator.userAgentData.brands` includes `Chromium`, the lens module also puts a capsule-sized displacement filter into the capsule's single `backdrop-filter`. Page content bends across a band about 22px wide inside the capsule edge, peaking at 12px of inward displacement at the edge, and a frosted core fades in beyond it without a seam. The core uses the same 4px blur and the same tint as the other engines, so the rim path is no denser than theirs. WebKit and Firefox parse `url()` in `backdrop-filter` but do not render displacement, so they keep the frosted capsule. So does Chromium in an insecure context, which has no `userAgentData`.
- **Maps:** `lens-map.ts` generates the displacement and specular maps from a convex bezel profile and Snell refraction. The rim instead passes a `falloff` exponent that eases travel from its full thickness at the edge to zero at the bezel, so content compresses gradually and text stays readable. It computes one quadrant and mirrors it. Maps are regenerated only when size or DPR changes, each regeneration gets a fresh filter id because WebKit caches filter output by id, and a four-entry cache bounds the stored data URLs. `feImage` receives an explicit region, and the filtered element carries a transform for WebKit.
- **Gating:** `lens-gate.ts` mounts the lens only in the capsule layout below 1024px, with `backdrop-filter` support, and without reduced transparency or forced colours. It reacts to media changes. With reduced motion, the lens snaps into place.
- **Cost:** the lazy lens chunk is 5,358 B gzip in the production Next build, under its 8,192 B (8 KiB) budget, and absent from the shell route's initial JS. The gate adds about 50 B to the initial JS. Scrolling does not recompute the lens maps or refraction; pointer movement and release update the lens position independently of main-content scrolling.
- **Evidence and limits:** Playwright Chromium, WebKit and Firefox screenshots at rest and mid-travel, plus pixel diffs showing WebKit and Firefox unchanged by rim refraction. A physical iPhone, the installed PWA, and Android Chrome GPU cost were not measured.

## Owner selection and adoption

Historical selection (2026-09-26): the owner selected CSS glass and requested standard iOS tab-bar proportions; the liquid dependency and exploration components were removed. The owner later requested native-like press dynamics for the owned liquid lens. The design-engineering skill's ≤180ms tab-motion limit applies to non-pointer navigation, whose unlifted 180ms travel stays within it; press and drag have their own direct-manipulation timing. The current production `PrimaryNavigation` adds the owned lens described above. Below 1024px the nav is fixed and centred with a 192px width, 62px height, 54px tab targets, 26px icon boxes, 11px semibold labels, 4px padding, and the safe-area-aware clearance described above. At 1024px and wider the desktop rail replaces it; the former top strip was removed. A physical iPhone check and Safari-tab safe-area support remain deferred.

## Follow-ups

Coverage lives in [glass-navigation/follow-ups](glass-navigation/follow-ups/), one file per follow-up. Follow-up 1 is implemented; 2 and 5 are deferred to Jesse; 3 is implemented with the owned lens described in [Liquid material](#liquid-material) instead of the rejected package; 4 is covered by PR #1075; 6 tracks scroll-boundary validation with #1088.

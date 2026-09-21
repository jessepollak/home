# Home mark assets and observed interaction

These assets are used only by `components/home-mark.tsx` and its CSS module.
They are not covered by the repository's MIT license; their original notices
and applicable permissions remain in force. No font outlines were modified.

## Base Sans Medium — authorized use, not an open-source license

- Local file: `BaseSans-Medium.woff` (unaltered upstream bytes).
- Source: https://www.base.org/_next/static/media/BaseSans_Medium-s.p.0y3wgpi50avhg.woff
- SHA-256: `6877483ebcc1fb5e7b59541898d906c2aa2528bccc8f94288e2075dc5cc58628`
- Embedded copyright/license metadata: **Under License AllCaps © 2025 AllCaps**.
- Embedded version: **Version 1.000**. Face: Base Sans Medium, weight 500.
- Home's user explicitly confirmed permission to use Base Sans twice before
  this implementation. This records that authorization, not a new license
  grant to third parties. Public availability alone is not permission, and
  this file is not relicensed under MIT, OFL, or another open-source license.

## Doto — SIL Open Font License 1.1

- Local file: `Doto.ttf` (unaltered upstream bytes).
- Source: https://www.base.org/_next/static/media/doto-s.p.0qhxi54t13661.ttf
- SHA-256: `5295d677cf5d30e762b1b39011bdb2d2b689e8536efb2d88dca9c137a22bd61a`
- Copyright 2024-2024 The Doto Project Authors (https://github.com/oliverlalan/Doto).
- Full license and copyright notice: [`Doto-OFL.txt`](./Doto-OFL.txt).
- Embedded version: Version 1.000; variable axes ROND 0–100 (default 0),
  wght 100–900 (default 900). The CSS intentionally matches the live face's
  missing weight-range descriptor and requests 700 on the glyph layer.

## Motion and artwork reference

Observed at https://www.base.org/ in Chrome 152.0.7977.83, 1440×1000 DPR 1;
reference manifest timestamp: 2026-09-08T03:30:02.882Z.

- Header source: https://www.base.org/_next/static/chunks/0b0lr9h18sjpl.js
  (functions R, q, W); SHA-256
  `43046758ac12da4ab63bd4cf0a3064298c6741b89731350cc0e4dc9c570ad7b0`.
- Motion source: https://www.base.org/_next/static/chunks/0~8wwgjopvxac.js;
  SHA-256 `2279b00e8c0d27461757834aee2e5ba65c65f1ef42e735680d1d94a3d5a6ed7e`.
- Styles: https://www.base.org/_next/static/chunks/0975ms3eei7fn.css and
  https://www.base.org/_next/static/chunks/11bxwl4579fos.css.
- The intermediate 664×218 SVG's immutable stepped path is the observed
  block/ascender fragment, reused as an explicit **h ascender adaptation**.
  It is not an upstream h-specific glyph or a path morph. Attribution here
  does not assert that Base's source/artwork carries an MIT license.
- Final h/o/m/e are individual natural Base Sans glyphs, not stretched b/a/s/e.
  Doto also uses its actual lowercase h/o/m/e. Home's wider advance requires
  an 82px expanded hitbox; the reserved desktop width stays 123.15625px.
  The shell's compact title-adjacent variant uses the collapsed 30.333333px
  footprint and keeps the animated expansion disabled.
- Entry/exit use Motion's sequence/spring implementation, exact authored raw
  extents 2.3/1.901 normalized to 1600/1200ms. The noninterruptible sequence,
  queued-exit rapid-reentry quirk, and reduced-motion transform snapping with
  timed opacity are intentionally retained. Motion is pinned to 13.2.0 in
  the app manifest and resolved in the lockfile; this is not a claim that
  the reference site's package version was publicly identified.
- Mobile uses the measured static 24px square inside a 44px accessible target
  (an intentional touch-target adaptation). Focus does not reveal letters.

All fonts are served locally. No runtime webfont or reference-site request is
made by the component. Visual acceptance compares the observed interaction,
not a claim of pixel-identical branding between the words “base” and “home”.

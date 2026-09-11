# Local DM Sans + DM Mono assets

DM Sans remains the proportional UI family. Its bundled faces do **not** implement OpenType `tnum`; `font-variant-numeric: tabular-nums` cannot give them equal-width digits. Amount and row-value explicitly use **DM Mono Medium (500)** as a numeric companion, applied to the whole formatted string, not per-character markup. Both families are opt-in and SIL Open Font License 1.1 licensed.

## Sources and licenses

DM Sans: unmodified variable WOFF2s from [googlefonts/dm-fonts](https://github.com/googlefonts/dm-fonts/tree/d0520ba03bd780f5dccb3024854463d44f699b78/Sans/fonts/webfonts), pinned at `d0520ba03bd780f5dccb3024854463d44f699b78` (the source commit recorded by Google Fonts' DM Sans metadata).

- `Sans/fonts/webfonts/DMSans[opsz,wght].woff2` → `dm-sans.woff2`
- `Sans/fonts/webfonts/DMSans-Italic[opsz,wght].woff2` → `dm-sans-italic.woff2`
- `Sans/OFL.txt` → `OFL.txt` (only line endings/trailing whitespace normalized)

Both expose weight 100–1000 and optical size 9–40. The Next adapter uses `display: swap`, local Arial metric adjustment, and a system sans-serif fallback.

DM Mono is maintained in a **separate upstream repository**; the pinned dm-fonts tree has no Mono assets. Its source is [googlefonts/dm-mono](https://github.com/googlefonts/dm-mono/tree/57fadabfb200a77de2812540026c249dc3013077), pinned at `57fadabfb200a77de2812540026c249dc3013077` (Google Fonts' DM Mono source metadata):

- `exports/DMMono-Medium.ttf` → `dm-mono-medium.ttf` (unmodified 50,360-byte upstream TTF; no conversion, subsetting, or renaming of internal font names)
- The upstream [README license](https://github.com/googlefonts/dm-mono/blob/57fadabfb200a77de2812540026c249dc3013077/README.md#license) and embedded font license identify OFL 1.1. That source tree has no standalone license file, so `DM-Mono-OFL.txt` is the matching copyright/license from [google/fonts `ofl/dmmono/OFL.txt`](https://github.com/google/fonts/blob/d0623a232f5b64f5e1963dc88c66d7de8f25f872/ofl/dmmono/OFL.txt), pinned at `d0623a232f5b64f5e1963dc88c66d7de8f25f872` (only line endings/trailing whitespace normalized).

DM Mono is a static, normal 500 face, not a variable font. Its monospaced glyph metrics provide equal-width ASCII digits without a `tnum` feature. The Next adapter uses `display: swap` and a system monospace stack, with **no** generated Arial/Times fallback. Retain **both** exported OFL files when redistributing.

No network font provider is needed at build or runtime. Other frameworks can register the explicitly exported assets themselves; the core never registers a font. `--home-ui-font-family` resolves DM Sans or system sans-serif; `--home-ui-font-numeric` resolves DM Mono or `--home-ui-font-numeric-fallback` (ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, Courier New, monospace). The fallback catalog control switches both tokens, not only prose. A missing numeric font never intentionally falls back to proportional DM Sans.

## Hashes and measured coverage

SHA-256 (repository files; license text normalized as above):

```text
e80dcae1d6cec824ed44daa671795d742f5c9ad8d50f7774bd0418eb44bfd4e1  dm-sans.woff2
b86afcd6982355b627b0168dc055635829ecd8e74a30b391473a2d5e8add1544  dm-sans-italic.woff2
7ec15e79c59bc14b86436a17e5eb7926b46cbcaeb08e1a7e6c110b415e6eb2a2  OFL.txt
fd327daf461db87b44a87def475d251bf03b997f7c07d9680592d75dbbfaad0b  dm-mono-medium.ttf
f5898de81851415b71431c1a8ea527c88a4e79caeb23936483428d2e911af40c  DM-Mono-OFL.txt
```

fontTools 4.60.2 `cmap` / `hmtx` / GSUB / GPOS inspection:

| Face | Encoded characters | ASCII digit advance widths (font units) | Catalog currencies covered |
| --- | ---: | --- | --- |
| DM Sans normal/italic | 403 each | Proportional; normal default `1`: 342, `8`: 604, `0`: 656; no `tnum` | `$ € £ ¥ ₹ ₺` |
| DM Mono Medium | 381 | All `0`–`9`: **600** at 1000 units/em; fixed pitch, no `tnum` needed | `$ € £ ¥` |

DM Sans lacks `₦ ₩ ₱ ₫ ₴ ₿`; DM Mono additionally lacks `₹ ₺`. Neither face covers the catalog's Arabic (`العربية`) or Japanese (`日本語`) specimens. Missing glyphs use device font fallback; neither coverage nor tabular alignment across unsupported currencies/scripts is guaranteed. `tabular-nums` on numeric roles is only a request to any supporting fallback, not a claim about DM Sans or universal coverage. The browser suite waits for font load, checks actual painted families, and measures `111111` / `888888` / `000000` in both numeric roles against proportional DM Sans body text. HomeMark's Base Sans/Doto assets remain separate and unchanged.

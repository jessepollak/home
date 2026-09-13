# App-local fonts

Home ships these files locally under the SIL Open Font License 1.1.

- `dm-sans.woff2` is the unmodified DM Sans variable normal face from `googlefonts/dm-fonts` commit `d0520ba03bd780f5dccb3024854463d44f699b78` (`Sans/fonts/webfonts/DMSans[opsz,wght].woff2`).
- `dm-mono-medium.woff2` is DM Mono Medium from `googlefonts/dm-mono` commit `57fadabfb200a77de2812540026c249dc3013077` (`exports/DMMono-Medium.ttf`), converted without subsetting by:
  `bunx wawoff2 packages/ui/fonts/dm-mono-medium.ttf apps/web/app/fonts/dm-mono-medium.woff2`
- `OFL.txt` and `DM-Mono-OFL.txt` are the corresponding license files copied from `packages/ui/fonts/`.

SHA-256 of shipped files:

```text
e80dcae1d6cec824ed44daa671795d742f5c9ad8d50f7774bd0418eb44bfd4e1  dm-sans.woff2
d07d18cc4694bedf6479e61afc1414918b9ff364198a2a5bb04c14b75c5b34b2  dm-mono-medium.woff2
7ec15e79c59bc14b86436a17e5eb7926b46cbcaeb08e1a7e6c110b415e6eb2a2  OFL.txt
f5898de81851415b71431c1a8ea527c88a4e79caeb23936483428d2e911af40c  DM-Mono-OFL.txt
```

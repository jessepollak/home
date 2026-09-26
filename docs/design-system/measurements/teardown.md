# UI teardown measurements

Next.js 16 does not print a First Load JS column. `/dashboard` initial JS is the byte sum of production build-manifest root files and unique dashboard client-reference chunks.

| Measure | Before (`6943504`) | After teardown |
| --- | ---: | ---: |
| `/dashboard` initial JS | 1,045,544 B | 1,267,179 B |
| Total `.next/static` CSS | 182,923 B | 136,036 B |
| Web test wall time | 3.18 s | 4.32 s |
| Shell client chunk, gzip | 119,307 B | 185,189 B |
| All client JS, gzip | 854,662 B | 929,100 B |

The JS growth (+8.7 % gzipped) is the Base UI runtime — Drawer, Select, Field, Toast, Tabs, ToggleGroup, `useRender`, floating-ui — replacing the hand-rolled sheet physics, toast queue, and Radix Select. It landed in the shell's main client chunk because `MoneyModal` was imported statically. The CSS drop (−26 %) is the BEM sheet, the alias layer, and most CSS Modules leaving.

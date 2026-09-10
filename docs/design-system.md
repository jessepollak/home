# Home UI foundation

[#207](https://github.com/jessepollak/home/issues/207) F1 adds a **private, source-exported** React package and isolated catalog. It does not migrate production Home, close #207, replace MoneyModal, or introduce financial behavior. `apps/web` and HomeMark’s Base Sans/Doto fonts are unchanged.

## Consume

`@home/ui` exports `Text`, `Heading`, `Button`, and `IconButton`; matching `/text`, `/button`, `/icon-button` subpaths are explicit. `/icons` supplies four context-free Phosphor SSR icons (Plus, X, ArrowRight, Check). React/ReactDOM are peers; consumers use the same React 19.2.8 installation. There is no blanket client boundary, provider, reset, font registration, or CSS import in the core JavaScript entry.

```tsx
import { Heading, Text, Button, IconButton } from "@home/ui";
import { PlusIcon } from "@home/ui/icons";

<Heading level={2} textStyle="section-title">Examples</Heading>
<Text as="p" textStyle="amount">$1,234,567.89</Text>
<Button type="button" variant="secondary">Continue</Button>
<IconButton icon={PlusIcon} aria-label="Add example" />
```

`as` / `level` set semantics independently from `textStyle`. Amount/row-value roles alone use **DM Mono Medium (500)** for equal-width ASCII digits across the whole caller-formatted string. Normal UI remains **DM Sans**, whose bundled fonts have proportional digits and no OpenType `tnum` support. Button preserves native props/ref, defaults to `type="button"`, and supports primary/secondary/quiet. `loading` preserves the name and label geometry, sets `aria-busy`, and **natively disables activation**. The caller owns async work, announcements, pending/confirmed state, and recovery; these controls do not execute or interpret money actions. `aria-pressed` is the native toggle state, not a transaction state. IconButton requires a non-blank action name and hides 20/24px artwork from assistive technology inside a minimum 44px target.

Import CSS explicitly once, at the consumer’s styling entry. Components work with tokens + styles without Tailwind. For Tailwind v4, the app owns its single Tailwind/reset import and scans package source (paths below are for the catalog):

```css
@import "tailwindcss" source(".");
@import "@home/ui/tokens.css";
@import "@home/ui/tailwind.css";
@import "@home/ui/styles.css";
@source "../../../packages/ui/src";
```

Tokens use `--home-ui-*`. Component rules are scoped; the Tailwind adapter is separate. `isolate` is a package-only utility exercised by positive **and negative** source-scan tests. Token values are foundation candidates, not authority to retime modals or alter production surfaces.

In Next, add `transpilePackages: ["@home/ui"]`, import `{ dmSans, dmMono }` from `@home/ui/next-font` in the root layout, and apply both variable classes to `<html>`: `className={[dmSans.variable, dmMono.variable].join(" ")}`. The opt-in adapter bundles local DM Sans variable WOFF2 normal/italic and an unmodified upstream DM Mono Medium static TTF. Both use `display: swap`; the adapter is not exported by the core barrel.

`--home-ui-font-family` selects DM Sans with a sans-serif fallback. **`--home-ui-font-numeric`** selects DM Mono with `--home-ui-font-numeric-fallback` (a system monospace stack); its Next adapter deliberately disables generated Arial/Times metric fallback. The Tailwind adapter exposes `font-home-ui-numeric`. With no font adapter, these same tokens use system sans-serif / monospace respectively. Other frameworks can explicitly register `/fonts/dm-sans.woff2`, `/fonts/dm-sans-italic.woff2`, and `/fonts/dm-mono-medium.ttf`, setting `--home-ui-font-dm-sans` / `--home-ui-font-dm-mono` to their registered family plus appropriate fallback, or overriding the semantic family tokens. Retain `/fonts/OFL.txt` **and** `/fonts/DM-Mono-OFL.txt`.

[Font provenance, licenses, hashes, and measured coverage](../packages/ui/fonts/README.md) pin both upstream DM projects. DM Mono covers `$ € £ ¥`, not `₹ ₦ ₩ ₱ ₫ ₴ ₺ ₿` or the catalog's Arabic/Japanese. Those glyphs use device fallback; coverage and alignment for unsupported currencies/scripts are not guaranteed. Numeric `tabular-nums` requests are not a claim of an unsupported DM Sans feature.

## Run and validate

```sh
bun install --frozen-lockfile
bun run dev:design-system                 # http://127.0.0.1:3100/
bun run --cwd packages/ui test
bun run --cwd apps/design-system test
bun run lint
bun run typecheck
bun check                                # tests/lint/types for all 3; builds both apps
bunx playwright install chromium          # once, when a browser slot is available
bun run test:browser:design-system        # uses the already-built production catalog
# If port 3100 is occupied, use the same catalog-only override for dev/start/tests:
HOME_DESIGN_SYSTEM_PORT=3110 bun run test:browser:design-system
```

Package source is compiled through the catalog’s production build, not a second distribution/bundled React. Root builds run web then catalog sequentially. The catalog build also checks production CSS, package-only class emission, all three emitted font hashes and the static numeric face, and nonblank prerendered content. Browser checks remain an explicit separate gate (as with web’s browser-auth suite); root `bun check` does not install or launch Chromium.

The catalog’s native controls deterministically select disabled/loading/pressed, fallback, specimen width, and 100/200% **text-only** size. Focus uses the real button/ref; keyboard Tab/Enter remains the portable focus-visible check. Reduced motion follows the browser/device preference. Browser tests exercise actual 320px, 390px, and desktop viewports, 200% text, names/targets/keyboard/native disabled behavior, font failure for all three files, reduced motion, and axe. Post-load browser regressions measure `111111`, `888888`, and `000000` at equal widths in both amount and row-value, confirm DM Sans body digits remain proportional, and inspect actual painted families (DM Mono versus device glyph fallback). No wallet SDK, credentials, live balances, or transaction calls are involved.

**F1 pre-push gate:** full `bun check`, production-browser checks, and exact-head Astra engineering/visual review remain required for the candidate being reviewed. Final-head screenshots/recording, immutable proof publication, and applicable design clearance are separate, still-required gates; localhost availability is not a hosted deployment. A hosted preview needs separate authorization/provisioning. Do not adopt into production until its surface owner releases the seam; do not copy catalog specimens into production instead of consuming the shared exports.

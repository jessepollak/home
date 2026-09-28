# Mobile navigation — liquid glass

Storybook group: `Journeys/Mobile navigation` (`journeys-mobile-navigation`). Review board: `review-boards--glass-navigation`.

- Default routes: `journeys-mobile-navigation--home-light`, `--home-dark`, `--invest`, `--nested-cash`, `--nested-investments`, `--nested-your-money`.
- Scroll and safe area: `--last-row`, `--home-indicator`, `--activity-under-capsule`, `--action-toast`.
- Interactions and accessibility: `--rapid-taps`, `--reduced-motion`, `--rtl`, `--long-labels`, `--opaque-fallback`, `--deposit-sheet`, `--account-keyboard`, `--narrow-320`.
- Balance states: `--loading`, `--empty`, `--partial`, `--failed`.
- Wide layout: `--tablet-1023` (capsule at the widest mobile width). The desktop rail from 1024px is in `PrimaryNavigation` stories.

All use production `PrimaryNavigation` with one Home/Invest button set and fixture-backed Home, Invest, Your money, Cash, Activity, and Account surfaces. `--home-light` asserts that the lazy liquid lens mounts, stays `aria-hidden` and inert, and settles at rest. In Chromium it also asserts that rim refraction is active. `--opaque-fallback` stubs missing `backdrop-filter` support and asserts that neither the lens nor rim refraction mounts. The fallback story scopes an opaque-material override inside the story only. The material and its engine differences are described in [the exploration](../../design-explorations/glass-navigation.md#liquid-material).

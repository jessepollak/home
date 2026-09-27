# Mobile navigation — adopted CSS glass

Storybook group: `Journeys/Mobile navigation` (`journeys-mobile-navigation`). Review board: `review-boards--glass-navigation`.

- Default routes: `journeys-mobile-navigation--home-light`, `--home-dark`, `--invest`, `--nested-cash`, `--nested-investments`, `--nested-your-money`.
- Scroll and safe area: `--last-row`, `--home-indicator`, `--activity-under-capsule`, `--action-toast`.
- Interactions and accessibility: `--rapid-taps`, `--reduced-motion`, `--rtl`, `--long-labels`, `--opaque-fallback`, `--deposit-sheet`, `--account-keyboard`, `--narrow-320`.
- Balance states: `--loading`, `--empty`, `--partial`, `--failed`.
- Wide layout: `--desktop-1440` (unchanged top strip).

All use production `PrimaryNavigation` with one Home/Invest button set and fixture-backed Home, Invest, Your money, Cash, Activity, and Account surfaces. The fallback story scopes an opaque-material override inside the story only. The historical candidate comparison and package evaluation remain in [the exploration](../../design-explorations/glass-navigation.md); liquid glass was not adopted.

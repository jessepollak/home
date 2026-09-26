### `coverage`
- **Entry context**: coverage · `/coverage` · public · none · goto `/coverage` (also `/coverage.csv`).

- **Live**: read-only
- **Owned paths**: `apps/web/app/coverage/**`, `apps/web/client/coverage/**`, `apps/web/config/coverage.ts`, `apps/web/components/ui/coverage-table.tsx`
- **Reach**:
  1. `goto "/coverage"`
  2. `expect "Local money coverage"`
- **Notes**: Exercise the Search textbox and the four comboboxes `1:1 onramp`, `Portfolio`, `Integrated`, `Sort`, plus the `sort` query parameter when validating filters.
- **Expect**: `Local money coverage | Home` title; coverage table rows (components/ui/coverage-table.tsx); combobox font ≥16px on mobile/landscape (tests/browser/mobile-geometry.pw.ts).
- **States**: filtered-empty result reports `Showing 0 of <total> countries and territories.` and an empty coverage table.
- **Evidence**: screenshot (390×844 and 844×390); DOM snapshot; console/errors.
- **Owned by**: `apps/web/app/coverage/page.tsx`, `apps/web/client/coverage/`, `apps/web/config/coverage.ts`.
- **Unknowns**: none; filters are `Search`, `1:1 onramp`, `Portfolio`, `Integrated`, and `Sort`.

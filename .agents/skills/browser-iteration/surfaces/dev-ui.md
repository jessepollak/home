### `dev-ui`
- **Entry context**: coverage/dev · `/dev/ui` · public only when `HOME_PLAYWRIGHT_SMOKE=1` or dev (app/dev/ui/page.tsx) · `HOME_PLAYWRIGHT_SMOKE=1` · goto `/dev/ui`.

- **Live**: read-only
- **Owned paths**: `apps/web/app/dev/ui/**`, `apps/web/components/ui/**`
- **Reach**: Run with `HOME_PLAYWRIGHT_SMOKE=1` or in development, go to `/dev/ui`, and otherwise expect `notFound()` (404).
- **Verify**: manual
- **Expect**: `Home UI theme` heading; swatch grid; `Stock type scale` card; `Buttons` section with `Primary`/`Outline`/`Destructive` (app/dev/ui/page.tsx).
- **States**: enabled vs 404.
- **Evidence**: screenshot; DOM snapshot.
- **Owned by**: `apps/web/app/dev/ui/page.tsx`.
- **Unknowns**: none.

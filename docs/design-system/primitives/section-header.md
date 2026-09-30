# Section header

- `SectionHeader` in `apps/web/components/section-header.tsx` has a `section` and a `group` variant.
- `section` renders a `CardTitle` heading with a configurable `aria-level` and an optional `CardAction`. The discover shelf passes its existing "See all ›" button through the action slot, so that header's markup and accessible name are unchanged.
- `group` renders a muted uppercase label with an optional foreground subtotal figure, and is what the balances panel uses for each money group. A complete or partial subtotal is a `MoneyTicker` inheriting the figure slot's foreground color (partial carries the visible muted `Partial balance` label and does not animate); an unavailable subtotal renders `—` with the screen-reader text `Unavailable`.
- `HomeSectionHeading` in `apps/web/client/home/home-overview.tsx` uses a plain `h2` that this primitive deliberately does not replace; compare their Storybook stories.

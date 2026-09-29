# Section header

- `SectionHeader` in `apps/web/components/section-header.tsx` has a `section` and a `group` variant.
- `section` renders a `CardTitle` heading with a configurable `aria-level` and an optional `CardAction`. The discover shelf passes its existing "See all ›" button through the action slot, so that header's markup and accessible name are unchanged.
- `group` renders an uppercase label with an optional `MoneyTicker` subtotal, and is what the balances panel uses for each money group.
- `HomeSectionHeading` in `apps/web/client/home/home-overview.tsx` uses a plain `h2` that this primitive deliberately does not replace; compare their Storybook stories.

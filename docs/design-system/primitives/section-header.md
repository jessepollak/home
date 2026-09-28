# Section header

- `SectionHeader` in `apps/web/components/section-header.tsx` has a `section` and a `group` variant.
- `section` renders a `CardTitle` heading with a configurable `aria-level` and an optional `CardAction`. The discover shelf passes its existing "See all ›" button through the action slot, so that header's markup and accessible name are unchanged. Figma `SectionHeader`, node `12:33`.
- `group` renders an uppercase label with an optional `MoneyTicker` subtotal, and is what the balances panel uses for each money group. Figma `MoneyGroupHeader`, node `12:39`.
- Figma `SectionHeader` `12:33` is mapped to `HomeSectionHeading` in `apps/web/client/home/home-overview.tsx`, whose plain `h2` this primitive deliberately does not replace.

# Primary navigation

- `PrimaryNavigation` in `apps/web/components/primary-navigation.tsx`.
- Review `TabBar` and `TabItem` in the relevant Storybook stories.

- The tab bar and desktop rail use client-side Next navigation for Home and Invest; the active tab and the Home back chevron follow the pathname through `parseShellLocation`. `/cash`, `/cash/savings`, `/activity`, `/borrow`, and `/investments` live under the same `(shell)` layout, so a warm tap paints from the prefetched route and client query cache without waiting for a network response. One shell-level hook owns document scroll restoration through the history entry (`history.scrollRestoration = "manual"`); Investments separately remembers its incremental visible-row count per history entry so Back can remount a deep holding. Legacy `/balances/*` redirects to Cash or Investments and is not a navigation surface.

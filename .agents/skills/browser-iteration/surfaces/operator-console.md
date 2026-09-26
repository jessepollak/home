### `operator-console`
- **Entry context**: operator · `/admin`, `/admin/{customers,support,growth,money,settings,audit}` · signed native Home operator session · operator allowlist and signed native session (browser admin.pw.ts) · goto `/admin`.

- **Live**: read-only (operator authorization required)
- **Owned paths**: `apps/web/app/admin/**`, `apps/web/components/ui/rail-nav.tsx`, `apps/web/config/operator-navigation.ts`
- **Reach**: On a configured operator test session, `goto "/admin"`, `expect "Overview"`; fixture-session alone cannot grant operator access.
- **Verify**: manual
- **Expect**: Overview has Needs attention then Business, each with an unavailable line; sidebar links to Customers, Support, Growth, Money, Settings and Audit log, each with a matching heading and unavailable line. Current link has `aria-current="page"`; at 390px Sections opens the drawer, navigation closes it and restores menu focus. Signed-out requests redirect to sign-in; non-operator requests redirect to `/home`.
- **States**: loading skeleton; error with `Try again`; `/admin/nope` and nested unknown paths are uncached 404s showing `Page not found` and `Back to Overview`, with no current link.
- **Evidence**: desktop and 390px screenshot, DOM snapshot, console/errors, keyboard and RTL navigation check.
- **Owned by**: `apps/web/app/admin/`, `apps/web/components/ui/rail-nav.tsx`, `apps/web/config/operator-navigation.ts`.
- **Unknowns**: regular fixture sessions cannot access operator routes; use the signed test-session pattern in `tests/browser/admin.pw.ts`, not customer fixtures.

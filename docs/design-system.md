# UI system

Home is a shadcn app using the Base UI preset. The migration history and owner decisions are recorded in [issue #347](https://github.com/jessepollak/home/issues/347).

## Components

Owned component copies live in `apps/web/components/ui`. Product code composes those wrappers instead of importing Base UI primitives directly.

Add a component (uses the pinned `shadcn` CLI in `apps/web`):

```sh
cd apps/web
bunx shadcn add <name>
```

Review every generated copy before committing it. Stock Tailwind scale utilities are allowed; replace hex/rgba, arbitrary-pixel, and raw palette classes with semantic tokens.

## Component workshop

Storybook is a credential-free development and review workshop for Home's production components. From the repository root, install and run it without `apps/web/.env.local`, provider keys, a wallet, or a database:

```sh
bun install --frozen-lockfile
bun run --cwd apps/web storybook
```

The server listens on `127.0.0.1:6006`. Build the same workshop statically with:

```sh
bun run --cwd apps/web build-storybook
```

The generated `apps/web/storybook-static/` directory is ignored and must not be committed. A successful static build does not replace `bun check`; both remain required for a Storybook change.

Keep `*.stories.tsx` beside the production surface under `apps/web/components/**` or `apps/web/client/**`. A story imports the component Home uses rather than a separately styled copy, and composes the real card, list, shell, and provider constraints needed by that surface. Prefer the component's natural typed props and injected action functions; use provider fixtures or MSW only at an existing external-request boundary. The current MSW worker starts only through Storybook's global loader. Its file lives under `.storybook/static`, never `public`, and production modules may not import Storybook, stories, or MSW. Keep story-only fixtures inside a `*.stories.*` or `.storybook/**` path so the production-isolation gate can enforce that boundary.

Fixtures use fixed balances, clock values, and presentation regions. Each story resets the shared query client and owns cleanup for mutable or deferred state. Unexpected requests fail visibly; only known Storybook/Vite assets are bypassed. Never let a story fall through to a Home, provider, database, wallet, or other live service. Use the 390 CSS-pixel viewport as the representative mobile review composition; narrower widths such as 320px are safety checks for viewport containment, not the product's definition of mobile.

Every story meta has an explicit stable `id`; keep its meaningful export name stable once it is referenced. For story ID `<id>`, use these deployment-relative direct links:

- manager: `/?path=/story/<id>`
- canvas: `/iframe.html?id=<id>&viewMode=story`

The pilot inventory is:

- Financial row: `pilot-financial-row--normal`, `pilot-financial-row--loading`, `pilot-financial-row--unavailable-value`, `pilot-financial-row--long-label-large-amount`
- Savings money dialog: `pilot-savings-money-dialog--amount-entry`, `pilot-savings-money-dialog--validation-failure`, `pilot-savings-money-dialog--review`, `pilot-savings-money-dialog--pending`, `pilot-savings-money-dialog--failure-recovery`, `pilot-savings-money-dialog--back-and-cancel`, `pilot-savings-money-dialog--reduced-motion-reference`
- Savings screen: `pilot-savings-experience--funded`, `pilot-savings-experience--verified-empty`, `pilot-savings-experience--loading`, `pilot-savings-experience--unavailable-partial`, `pilot-savings-experience--long-localized-content`

The built `index.json` is the durable discoverability source when this inventory grows. An intentional ID or export rename must update direct links and review evidence in the same change.

Storybook can prove that a production component renders and supports fixture-backed component interactions under deterministic states and review viewports. Stories and play functions are review scenarios, not permanent browser tests or approval by themselves. Storybook cannot prove Home's Next routing/history, app-level scrolling or focus restoration, browser Back integration, wallet/provider behavior, physical keyboard behavior, or Safari behavior. Verify the integrated component in Home under the [browser-validation contract](browser-validation.md), and record media and limitations under [UI PR previews](ui-pr-previews.md).

### Capability-state proposal

Issue #635 defines a closed, provider-independent presentation taxonomy. It does not infer provider acceptance, authorize access, or replace feature-owned status and owner fences. Until Jesse reviews the proposal, consuming Fund, Save, Invest, Borrow, Card, and Account screens remain unchanged.

| Semantic state | Meaning | Allowed action |
| --- | --- | --- |
| `available` | The feature's authoritative checks say it can be used now. | `open` |
| `sign-in-required` | Home needs a signed-in owner before it can check or use the feature. | `sign-in` |
| `verification-start` | An authoritative capability check requires identity verification that has not started. | `start-verification` |
| `verification-pending` | Verification was submitted and is still in review. | `resume-verification` only when a valid handoff exists; otherwise no action |
| `verification-rejected` | Verification needs additional customer input. | `retry-verification` or `resume-verification`, according to the authoritative recovery route |
| `unavailable-in-country` | The selected country is ineligible for the feature. | none |
| `not-yet-in-home` | Home does not offer the product, independent of country or provider health. | none |
| `temporarily-unavailable` | A normally reachable check or feature failed and retry is safe. | `retry` |
| `configuration-unavailable` | This Home deployment has not configured the feature. | none on the customer surface |

`apps/web/components/capability-state.tsx` is the production-usable proposal for tile, row, detail CTA, and Account placements. It rejects action/state combinations outside this table. Callers own the authoritative state, action callback, translated copy, privacy boundary, and owner reset. The component owns only consistent presentation. Its Storybook ID is `proposal-capability-states`, with scenarios for every state and placement, long copy, 200% text, and reduced-motion review.

Current-copy inventory motivating the proposal:

- Fund uses “Funding methods are unavailable,” open-deposit/provider-setup failures, and “Sign in and verify a Base account” in different layers; the last phrase collapses authentication and verification.
- Save distinguishes stale/partial balances and temporary vault failures, but “Savings unavailable,” “Savings rate unavailable,” and “APY unavailable” use the same word for different scopes.
- Invest uses “Asset unavailable,” “category unavailable right now,” and “Unavailable” shelf labels without distinguishing product absence from a temporary market-data failure.
- Borrow distinguishes sign-in and retry in its detail surface, but “Bitcoin borrowing unavailable,” “Borrow is unavailable,” and per-market disabled reasons do not share one cause label.
- Account already distinguishes unconfigured sign-in from provider failure, while session validation and sign-out recovery use separate “unavailable” and retry language. Account has no shared capability verification row yet.

For #621, reserve these semantic message IDs; do not add them to translation catalogs until the proposal is accepted:

| State | Message IDs |
| --- | --- |
| available | `capability.state.available.title`, `.description`, `.action.open` |
| sign-in required | `capability.state.sign_in_required.title`, `.description`, `.action.sign_in` |
| verification start | `capability.state.verification_start.title`, `.description`, `.action.start` |
| verification pending | `capability.state.verification_pending.title`, `.description`, `.action.resume` |
| verification rejected | `capability.state.verification_rejected.title`, `.description`, `.action.retry`, `.action.resume` |
| unavailable in country | `capability.state.unavailable_in_country.title`, `.description` |
| not yet in Home | `capability.state.not_yet_in_home.title`, `.description` |
| temporarily unavailable | `capability.state.temporarily_unavailable.title`, `.description`, `.action.retry` |
| configuration unavailable | `capability.state.configuration_unavailable.title`, `.description` |

Provider name, provider status code, authoritative acceptance, country code, selected capability, log fields, and action kind remain structural data, not translated strings.

## Theme

`apps/web/app/globals.css` uses shadcn's stock neutral theme generated by the `base-nova` preset. Home overrides only `--primary`/`--ring` with Base blue (`#0052ff`), `--primary-foreground` with white, and `--radius` with `0.25rem`. `--market-gain` and `--market-loss` remain while their current chart consumers exist.

Use the stock system sans and monospace stacks: there is no `next/font` setup or font asset directory. Money and other aligned numbers use `tabular-nums`; monospace is reserved for addresses, hashes, and code. Use the stock Tailwind type scale and component spacing.

Country selection and searchable asset selection use the `Combobox`; its value truncates by default. Simple non-searchable pickers use Base UI `Select`. Financial rows stay on `Item`; do not introduce Data Table on mobile.

Use the owned component contracts rather than restyling their slots:
- `ItemMedia variant="avatar"` owns the standard circular row media. `ItemTitle` accepts `tone` and `numeric`; `ItemDescription` accepts `lines={1 | 2 | "none"}`.
- `CardContent inset="list"` owns list-card horizontal insets; put screen-specific flow spacing on a plain inner wrapper.
- `Button variant="navigation"` owns primary-navigation presentation, and `size="inline"` is for small actions embedded in prose.
- `Input variant="otp" | "code"` owns verification-code and monospace input typography. `InputGroupInput` forwards the same variant.
- `Switch` is the semantic on/off control. Drawer surface, title, header, footer, safe-area, shadow, and immediate-motion treatment are owned defaults.

## Rules

1. Style components and product surfaces with Tailwind utilities. ESLint bans hex/rgba, arbitrary-pixel, and raw palette classes; use semantic tokens instead. Keep utilities inline at the product use site: ESLint (`tailwind-policy/no-detached-class-constants`) follows identifiers in `className` and `cn()` to local static class-string constants and rejects them. Reusable presentation belongs in owned component variants; dynamic composition (ternaries, templates, props, `cva()`) stays allowed.
2. Raw `@base-ui/react` imports are allowed only in `apps/web/components/ui`.
3. Raw `button`, `input`, and `select` elements outside `components/ui` are banned except for the shrinking audited allowlist. Use the owned wrappers.
4. `@shadcn/lint` rejects restyling of owned UI components in product code. Callers may use layout classes; reusable presentation belongs in variants or explicit component contracts.

## Home-owned product pieces

- `apps/web/components/money-ticker.tsx` preserves exact already-formatted money strings and animates them with `@number-flow/react`.
- `apps/web/lib/haptic.ts` contains the small product haptic boundary.
- `apps/web/client/money-modal` owns amount entry, numpad, asset selection, review, and confirmation steps; its shell is the owned shadcn Drawer wrapper.

These stay app-local because they encode Home product behavior, not general-purpose primitives.

## Testing

Keep tests for Home behavior: exact amounts, dispatch counts, owner fences, routing, cancellation, focus restoration, and other failures that would affect users or money. Follow the [test policy](architecture.md#test-policy) for what not to test. The owner checks presentation manually; Home has no screenshot baselines.

## Teardown measurements

Next.js 16 does not print a First Load JS column. `/dashboard` initial JS is the byte sum of production build-manifest root files and unique dashboard client-reference chunks.

| Measure | Before (`6943504`) | After teardown |
| --- | ---: | ---: |
| `/dashboard` initial JS | 1,045,544 B | 1,267,179 B |
| Total `.next/static` CSS | 182,923 B | 136,036 B |
| Web test wall time | 3.18 s | 4.32 s |
| Shell client chunk, gzip | 119,307 B | 185,189 B |
| All client JS, gzip | 854,662 B | 929,100 B |

The JS growth (+8.7 % gzipped) is the Base UI runtime — Drawer, Select, Field, Toast, Tabs, ToggleGroup, `useRender`, floating-ui — replacing the hand-rolled sheet physics, toast queue, and Radix Select. It lands in the shell's main client chunk because `MoneyModal` is imported statically. Two follow-ups can recover most of it: `motion` is now imported only by `components/home-mark.tsx` and can be dropped or lazy-loaded, and the Drawer-backed money sheets can be `next/dynamic`-loaded on first open, the same deferral wave 4 applied to the wallet SDK. The CSS drop (−26 %) is the BEM sheet, the alias layer, and most CSS Modules leaving.

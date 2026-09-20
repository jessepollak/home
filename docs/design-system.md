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

## Reference journey proposal (#654)

Status: **unapproved proposed design** awaiting Jesse's review ([issue #654](https://github.com/jessepollak/home/issues/654)). It changes no production route, token, shell, or `MoneyModal` behavior; production adoption is a separate dependent issue, and the current `displayTotal` ("Total balance") hero is unchanged until then. The proposal lives beside the Home surfaces in `apps/web/client/home/reference-journey/`:

- `reference-position.ts` — production-intended presentation model: net position from explicit complete/partial/loading/unavailable cash, saved, and debt slices. Verified zero debt is omitted; a missing slice is named and never rendered as zero or a complete total. It follows [#634's selected Net position contract](https://github.com/jessepollak/home/issues/634) without relabelling production `displayTotal`.
- `reference-home.tsx` — `ReferenceHomeComposition` with the explicit `ledger` (recommended Option A) and `tiles` (Option B) composition variants.
- `reference-save.tsx` — `ReferenceSaveComposition` with the same `ledger` / `tiles` variants over the selected vault.
- `reference-journey.tsx` — the connected fixture journey (Home → Save → existing deposit amount → review → pending/result → return, plus Activity → transaction detail → back).
- `reference-fixtures.ts` — the shared fixture set. It imports no Storybook, MSW, or provider code; stories and focused behavior tests import the same values so the two option comparisons cannot drift apart.

Direct story links (manager / canvas): `reference-home` (`/?path=/story/reference-home--ledger-first`, `/iframe.html?id=reference-home--ledger-first&viewMode=story`), `reference-save` (`/?path=/story/reference-save--ledger-first`), and `reference-journey` (`/?path=/story/reference-journey--funded-journey`). The built `index.json` remains the durable source when these grow. A rename must update these links and the review evidence in the same change.

Fixture limits, stated plainly: the comparisons and journey simulate navigation and dispatch with component state and injected fixture money-action functions. They are not proof of Next routing/history, browser Back, provider or wallet behavior, real balances, or money execution. `Add money`, `Send`, `Cash out`, `Borrow`, `Your money`, `Withdraw`, and `Invest` are reference intents that keep their existing production flows and are labeled unwired when activated. A fixture deposit only moves balances when the injected result is `confirmed`; `submitted`, `pending`, and `unknown` record the action and leave balances unchanged, and the 18-decimal share preview is scaled from the exact USDC amount rather than string-padded.

Known limitations recorded for review, not accepted as complete:

- **Inherited financial-row context can truncate** at narrow widths or 200% root text because production `HomeBalanceRowView` / `ActivityRow` keep names, dates, and action titles on one line; row titles retain full timestamps where available, and transaction detail shows the full date and action facts. The proposal-owned Home/Save rows wrap without overlap, but production-row adoption needs a separate shared-row decision.
- **200% text** was exercised in Chrome at a 390px viewport by setting the root text size to 200%; the reference content wraps/stacks without overlap. Browser/OS zoom and physical-device text scaling remain unverified.
- **Reduced motion** was exercised in Chrome with `prefers-reduced-motion: reduce`; all reference money tickers reported animation disabled and the rendered stories had no accessibility violations. Safari remains unverified.
- **Routing, history, Back, provider, and wallet behavior** are fixture-level only; the connected journey's `Back` returns to the reference Home view and does not exercise browser history.
- Story play assertions prove the fixture scenarios they render; they do not replace the focused behavior tests, `Home` browser validation, or an independent review.

### Source-only inventory and rollout map

Reachable surfaces at this revision, from source inspection only (no live run):

| Surface | Entry | Main component | Existing story | State gaps | Current owner / proposal input |
| --- | --- | --- | --- | --- | --- |
| Home | `/home` | `client/home/home-panel.tsx` in `shell.tsx` | none (only `pilot-financial-row`) | hero/actions/ledger composition and its loading, empty, partial states | #654 reference; #634 / PR #648 money semantics; #638 / PR #653 shell input |
| Your money / Balances | Home "See all" or group "More", `/balances/<group>` | `client/home/balances-panel.tsx` | `pilot-financial-row` | page-level states | #634 / PR #648 presentation input |
| Save | Save row/tile, `/save` | `client/savings/savings-experience.tsx` | `pilot-savings-experience` | funded/empty/partial/loading/long-copy already covered | #654 reference; existing Save production source retained |
| Deposit / Withdraw sheet | Save actions | `client/savings/savings-actions.tsx` + `client/money-modal/**` | `pilot-savings-money-dialog` | covered, including reduced motion | #654 fixture journey; coordinate #529 / #534 before shared-sheet changes |
| Borrow | Borrow tile, `/borrow` | `client/borrowing/borrowing-experience.tsx` | none | no story; out of this proposal's scope | #634 / PR #648 accounting input; no #654 rollout |
| Activity | Activity card / "See all", `/activity` | `client/activity/activity-panel.tsx`, details via `components/transaction-details.tsx` | none (tests only) | no story; the journey covers row → detail → back | #637 / PR #652 taxonomy/detail input |
| Invest | bottom navigation, `/invest/<asset>` or `/invest/<shelf>` | `client/invest/priced-invest-experience.tsx` | none | no story; out of this proposal's scope | source-only inventory; no #654 rollout |
| Account / settings | header account control | `client/account/account-settings.tsx`, `account-screen.tsx` | none | no story; #638 owns Account destinations | #638 / PR #653 |
| Add money | Home primary action | `client/funding/funding-actions.tsx` | none | no story; #638 shell language only | #638 / PR #653 shell input |
| Send / cash out | Home action | `client/transfers/transfer-actions.tsx` | none | no story; #638 owns the Cash out placement decision | #638 / PR #653; coordinate #529 pending behavior |

Rollout map for the dependent implementation issue:

1. Jesse selects or refines one reference composition from the stories above.
2. The implementation leaf maps the live `BalancesPresentation` and savings summary into the selected composition's props; it does not add a second accounting model.
3. Adopt #634's Net position headline in the production hero as part of that leaf — not here — while keeping the existing exact values, combined APY, completeness, and identity semantics.
4. Keep `HomeShell` routing/history, `MoneyModal` behavior, global tokens, and the owned wrappers unchanged unless that issue contains an explicitly approved narrow seam.
5. Treat Borrow, Invest, Account, and the #638 Cash out decision as separate follow-ups.

Non-goals: no new route, dependency, font or icon migration, provider call, or demo route; no fixtures in production code paths.

## Theme

`apps/web/app/globals.css` uses shadcn's stock neutral theme generated by the `base-nova` preset. Home overrides only `--primary`/`--ring` with Base blue (`#0052ff`), `--primary-foreground` with white, and `--radius` with `0.25rem`. `--market-gain` and `--market-loss` remain while their current chart consumers exist.

Use the stock system sans and monospace stacks: there is no `next/font` setup or font asset directory. Money and other aligned numbers use `tabular-nums`; monospace is reserved for addresses, hashes, and code. Use the stock Tailwind type scale and component spacing.

Country selection and searchable asset selection use the `Combobox`; its value truncates by default. Simple non-searchable pickers use Base UI `Select`. Financial rows stay on `Item`; do not introduce Data Table on mobile.

Use the owned component contracts rather than restyling their slots:
- `ItemMedia variant="avatar"` owns the standard circular row media. `ItemTitle` accepts `tone` and `numeric`; `ItemDescription` accepts `lines={1 | 2}`.
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

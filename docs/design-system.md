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

The pinned `shadcn` CLI's own composition rules are installed as the committed [shadcn skill](../../.agents/skills/shadcn/SKILL.md) (`bunx skills add shadcn/ui --skill shadcn -a universal --copy -y`, recorded in `skills-lock.json`). Its `rules/` files are the source of composition guidance — starting from existing owned components and variants instead of hand-rolling UI. Home's own rules below still win where they are stricter. Its component names are not Home's owned inventory: `NativeSelect`, `Textarea`, and `Tabs` have no copy under `apps/web/components/ui`, so add the owned component with the CLI before composing it.

## Component workshop

Follow the [issue's design scope](../.agents/skills/design-engineering/SKILL.md#follow-the-issue-scope); default to implementation within the current system. The production-component instructions below govern maintenance, journey validation and adoption. An explicitly scoped exploration may use local candidate presentation in a clearly labeled `Explorations/` story group, reusing financial fixtures and behavior where practical. Story-only candidates stay in that group rather than joining the `UI/<Component>` owned inventory. It is not a second production UI system. Preserve production isolation, enforced repository rules and required checks; document the boundary and stop at the task's review checkpoint. Do not exhaustively harden every candidate before selection.

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

### MCP workshop tools

`apps/web/.storybook/main.ts` registers `@storybook/addon-a11y`, `@storybook/addon-vitest`, and `@storybook/addon-mcp`, and sets `features.componentsManifest: true` — the Storybook 10.6 feature key, kept explicit rather than inferred from the addon's preset — alongside the `features.experimentalComponentsManifest: true` alias that issue #660 names. While the workshop runs, the MCP server answers at `http://127.0.0.1:$STORYBOOK_PORT/mcp` and exposes `docs-list`, `docs-show`, `docs-show-story`, `stories-find-by-component`, `stories-preview`, and `test-run`. The repository-root `.mcp.json` registers that endpoint as `storybook` with the literal `${STORYBOOK_PORT}` placeholder, so export the port in an interactive shell before starting the workshop (`export STORYBOOK_PORT=6006`; the factory sets it per slot) and start Storybook before relying on the tools.

Discover before composing: `docs-list` lists every component the manifest knows, which includes every owned `apps/web/components/ui` module (each has a minimal workshop story beside it) and the pilot and journey surfaces. `docs-show <id>` returns documented props and story usage, and `stories-find-by-component` maps any source file to the story IDs that render it. Do not restate component props from memory or invent a parallel component.

### Journey stories

Page-level flows live under `apps/web/stories/journeys/<flow>.stories.tsx`. A journey composes the real screen from production components, serves each existing external request with `msw-storybook-addon` handlers (`parameters.msw.handlers`), and walks the flow in a `play` function that asserts observable results, not implementation details. The reference journey is `journeys-savings-deposit--deposit`: it loads vault metadata over the production `/api/savings/vaults` fetch, selects a vault, prepares a deposit, and dispatches the exact prepared action.

### Story tests

`@storybook/addon-vitest` runs every story in headless Chromium through the workshop's own Vite pipeline:

```sh
bun run --cwd apps/web test:stories
```

The same run is available through the MCP `test-run` tool and the workshop's test widget. A failing `play` function fails the run, and the a11y addon audits every story. `a11y.test` is `"todo"` (report, do not fail) globally because owned components carry pre-existing violations that need a product decision — the `ItemMedia variant="avatar"` initials contrast (4.34:1), the money-modal asset-picker controls' missing accessible names, and the destructive `AlertDescription` contrast (4.49:1). Minimal workshop stories that pass the audit set `a11y: { test: "error" }` so a new violation in those components fails the run. The Storybook manager and the test runner share a Vite dependency cache, so stop a running `storybook dev` before a full `test:stories` run.

Keep `*.stories.tsx` beside the production surface under `apps/web/components/**` or `apps/web/client/**`. A story imports the component Home uses rather than a separately styled copy, and composes the real card, list, shell, and provider constraints needed by that surface. Prefer the component's natural typed props and injected action functions; use provider fixtures or MSW only at an existing external-request boundary. The current MSW worker starts only through Storybook's global loader. Its file lives under `.storybook/static`, never `public`, and production modules may not import Storybook, stories, or MSW. Keep story-only fixtures inside a `*.stories.*` or `.storybook/**` path so the production-isolation gate can enforce that boundary.

Fixtures use fixed balances, clock values, and presentation regions. Each story resets the shared query client and owns cleanup for mutable or deferred state. Unexpected requests fail visibly; only known Storybook/Vite assets are bypassed. Never let a story fall through to a Home, provider, database, wallet, or other live service. Use the 390 CSS-pixel viewport as the representative mobile review composition; narrower widths such as 320px are safety checks for viewport containment, not the product's definition of mobile.

Every story meta has an explicit stable `id`; keep its meaningful export name stable once it is referenced. For story ID `<id>`, use these deployment-relative direct links:

- manager: `/?path=/story/<id>`
- canvas: `/iframe.html?id=<id>&viewMode=story`

The pilot inventory is:

- Financial row: `pilot-financial-row--normal`, `pilot-financial-row--loading`, `pilot-financial-row--unavailable-value`, `pilot-financial-row--long-label-large-amount`, `pilot-financial-row--issue-example-quantities`
- Shared finance rows: `pilot-finance-rows--asset-rows-large-local-currency`, `pilot-finance-rows--actionable-rows-chevron`
- Savings money dialog: `pilot-savings-money-dialog--amount-entry`, `pilot-savings-money-dialog--validation-failure`, `pilot-savings-money-dialog--review`, `pilot-savings-money-dialog--pending`, `pilot-savings-money-dialog--failure-recovery`, `pilot-savings-money-dialog--back-and-cancel`, `pilot-savings-money-dialog--reduced-motion-reference`
- Savings screen: `pilot-savings-experience--funded`, `pilot-savings-experience--verified-empty`, `pilot-savings-experience--loading`, `pilot-savings-experience--unavailable-partial`, `pilot-savings-experience--long-localized-content`

Every owned `apps/web/components/ui` module also has a minimal workshop story (`UI/<Component>`) so the MCP manifest exposes the owned inventory rather than only the pilot surfaces, plus the journey inventory `journeys-savings-deposit--deposit`. The built `index.json` and the MCP `docs-list` output are the durable discoverability sources when this inventory grows. An intentional ID or export rename must update direct links and review evidence in the same change.

Storybook can prove that a production component renders and supports fixture-backed component interactions under deterministic states and review viewports. Stories and play functions are review scenarios, not permanent browser tests or approval by themselves. Storybook cannot prove Home's Next routing/history, app-level scrolling or focus restoration, browser Back integration, wallet/provider behavior, physical keyboard behavior, or Safari behavior. Verify the integrated component in Home under the [browser-validation contract](browser-validation.md), and record media and limitations under [UI PR previews](ui-pr-previews.md).

## Theme

The shared sheet spring uses the owned motion contract; its stiffness targets an approximately 350 ms critical settle across a full-height sheet, with damping chosen to prevent overshoot. Home mark enter and exit sequences are not interruptible or reentrant by design, matching the reference interaction exactly.

This section describes the implemented system and maintenance defaults. [UI direction](ui-direction.md#sources-and-status) records exploration and acceptance status; production defaults do not freeze the visual choices of an explicitly scoped experiment.

`apps/web/app/globals.css` uses shadcn's stock neutral theme generated by the `base-nova` preset. Home overrides only `--primary`/`--ring` with Base blue (`#0052ff`), `--primary-foreground` with white, and `--radius` with `0.25rem`. `--market-gain` and `--market-loss` remain while their current chart consumers exist. `--payout-*` brand tokens and their `-foreground` pairs stay in `:root` only: payout brand marks keep their brand colors in both themes.

Use the stock system sans and monospace stacks: there is no `next/font` setup or font asset directory. Money and other aligned numbers use `tabular-nums`; monospace is reserved for addresses, hashes, and code. Use the stock Tailwind type scale and component spacing.

Country selection and searchable asset selection use the `Combobox`; its value truncates by default. Simple non-searchable pickers use Base UI `Select`. Financial rows stay on `Item`; do not introduce Data Table on mobile.

Use the owned component contracts rather than restyling their slots:
- `ItemMedia variant="avatar"` owns the standard circular row media. `ItemTitle` accepts `tone` and `numeric`; `ItemDescription` accepts `lines={1 | 2}`.
- `CardContent inset="list"` owns list-card horizontal insets; put screen-specific flow spacing on a plain inner wrapper.
- `Button variant="navigation"` owns primary-navigation presentation, and `size="inline"` is for small actions embedded in prose.
- `Button press="standard" | "icon" | "none"` owns press feedback: standard actions compress on pointer/touch-down, icon-only controls compress deliberately more, and `none` keeps wide rows, navigation, product tiles, and link-like text still as whole surfaces. Every variant mirrors its hover treatment in `active:` and reduced motion drops every press transform while keeping those color cues.
- `Input variant="otp" | "code"` owns verification-code and monospace input typography. `InputGroupInput` forwards the same variant.
- `PayoutMark variant="cashapp" | "zelle" | "monzo" | "revolut" | "fallback" | "count"` owns circular payout-mark geometry, typography, and semantic brand colors.
- `Switch` is the semantic on/off control. Drawer surface, title, header, footer, safe-area, shadow, and immediate-motion treatment are owned defaults.

## Rules

1. Style components and product surfaces with Tailwind utilities. Oxlint bans hex/rgba, arbitrary-pixel, and raw palette classes; use semantic tokens instead. Keep utilities inline at the product use site: the Home Oxlint rule `home/no-detached-class-constants` follows identifiers and static object/array lookups in `className` and `cn()` to local static class strings and rejects them. Unknown aggregate keys are rejected only when every reachable value is a non-empty static class string; dynamic data and predicate-only roles stay allowed. Reusable presentation belongs in owned component variants; dynamic composition (ternaries, templates, props, `cva()`) stays allowed.
2. Raw `@base-ui/react` imports are allowed only in `apps/web/components/ui`.
3. Raw `button`, `input`, and `select` elements outside `components/ui` are banned except for the shrinking audited allowlist. Use the owned wrappers.
4. `home/no-restyle` checks literal class tokens on `className` passed to a directly imported `components/ui` component (alias or relative import) in product code. It permits tokens with layout prefixes, and rejects other literal tokens as appearance changes. Dynamic expressions without literal tokens and classes on non-owned components are outside this rule; reusable presentation belongs in variants or explicit component contracts.

## Home-owned product pieces

- `apps/web/components/ui/payout-mark.tsx` owns payout brand-mark presentation; product code supplies only the platform-derived glyph and variant.
- `apps/web/components/money-ticker.tsx` preserves exact already-formatted money strings and animates them with `@number-flow/react`.
- `apps/web/client/money-modal/amount.tsx` owns the money-key haptic boundary (`triggerKeyHaptic`), guarded by reduced-motion and user-activation checks.
- `apps/web/client/money-modal` owns amount entry, numpad, asset selection, review, and confirmation steps; its shell is the owned shadcn Drawer wrapper.

These stay app-local because they encode Home product behavior, not general-purpose primitives.

## Testing

Keep tests for Home behavior: exact amounts, dispatch counts, owner fences, routing, cancellation, focus restoration, and other failures that would affect users or money. Follow the [test policy](architecture.md#test-policy) for what not to test. The owner checks presentation manually; Home has no screenshot baselines.

`bun run --cwd apps/web test:stories` is the story-interaction gate: it runs every story's `play` function and the a11y audit in headless Chromium. It runs in CI as the **story tests** job and is not part of `bun check`, so run it with `agent-browser` proof when a change touches stories or owned components.

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

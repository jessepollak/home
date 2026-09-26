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

Follow the [issue's design scope](../.agents/skills/design-engineering/SKILL.md#follow-the-issue-scope); default to implementation within the current system. The production-component instructions below govern maintenance, journey validation and adoption. An explicitly scoped exploration may use local candidate presentation in a clearly labeled `Explorations/` story group, reusing financial fixtures and behavior where practical. Keep the proposal thin: compose owned `components/ui` variants and existing feature components, and drive candidate states with static fixtures and args rather than duplicate shells or flow logic. Story-only candidates stay in that group rather than joining the `UI/<Component>` owned inventory. It is not a second production UI system. Preserve production isolation, enforced repository rules and required checks; document the boundary and stop at the task's review checkpoint. Do not exhaustively harden every candidate before selection.

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

### Review boards

A review board is a Storybook story arranging live story canvases; it is not part of the production application. The automatic **Changes in this PR** board shows only indexed stories this build changed: changed story files or stories matching changed source files, using the PR number when known. Curated manifests in `apps/web/stories/review/boards/` hold story IDs, viewports, sections and review metadata; register their stories in `review-boards.stories.tsx`. Missing stories (and empty sections) are hidden, and a missing before story is omitted without hiding its after frame. Build Storybook to check the current index. Storybook injects `STORYBOOK_REVIEW_REPO`, `STORYBOOK_REVIEW_PR`, `STORYBOOK_REVIEW_CHANGED_FILES`, and `STORYBOOK_REVIEW_ADDED_FILES` alongside revision/deployment/branch; unavailable change data sends the manager's Review board link to Savings and displays an unavailable-data message on Changes.

The board URL keeps Storybook `id` and `viewMode` plus `frame` (selected frame), `side` (`after`, `before`, or `both`), `rev` (build revision), and `deployment` (build host). Desktop opens on a fitted canvas with separate outline (`[`) and inspector (`]`) toggles. The outline lists frames with size and change pills; selecting a frame there also fits it. Scroll pans, Shift+scroll pans horizontally, ⌘/Ctrl+scroll or pinch zooms at the pointer, and Space+drag or middle-drag pans. Click selects and fits a frame; double-click, Enter, or Interact enters its live iframe; Esc exits interaction. `+`/`-` zoom, `0` resets, `1` fits the board, `2`/`F` fits the selected frame, and arrow keys pan. ⌘K (Ctrl+K elsewhere) opens the command palette, and `?` opens keyboard shortcuts. The header chip links to the PR when PR information is available and shows status when its status request succeeds. Mobile shows one live frame at a time with a grouped journey picker, Previous/Next actions, and a full-width interactive view. The runtime is design-lane code under `apps/web/stories/review/explorations/board/` and is imported only by review stories, never production bundles.

Open the board on the PR's commit-specific Storybook preview deployment, whose URL is unique to one build; the branch preview alias moves with later pushes. Review comments use the Vercel Comments toolbar on previews. On load the board writes the build's `rev` and `deployment` into its URL, so a comment's page URL records the revision it was made on, and each frame is covered by an element carrying `data-review-frame` and `data-review-story` for comments to anchor to. Opening that URL on a newer build shows a banner linking back to the reviewed deployment. To recover a comment's context, run `bun run --cwd apps/web review:context '<comment page URL>'` (`--json` for machine output). It prints the board, frame, story, viewport, notes, story source (after `build-storybook`), story and board links on the reviewed deployment, and whether the story or manifest changed between the reviewed revision and `HEAD`. Comments stay in Vercel. Record dispositions on the GitHub issue or PR.

### MCP workshop tools

`apps/web/.storybook/main.ts` registers `@storybook/addon-a11y`, `@storybook/addon-vitest`, and `@storybook/addon-mcp`, and sets `features.componentsManifest: true` — the Storybook 10.6 feature key, kept explicit rather than inferred from the addon's preset — alongside the `features.experimentalComponentsManifest: true` alias that issue #660 names. While the workshop runs, the MCP server answers at `http://127.0.0.1:$STORYBOOK_PORT/mcp` and exposes `docs-list`, `docs-show`, `docs-show-story`, `stories-find-by-component`, `stories-preview`, and `test-run`. The repository-root `.mcp.json` registers that endpoint as `storybook` with the literal `${STORYBOOK_PORT}` placeholder, so export the port in an interactive shell before starting the workshop (`export STORYBOOK_PORT=6006`; the factory sets it per slot) and start Storybook before relying on the tools.

Discover before composing: `docs-list` lists every component the manifest knows, which includes every owned `apps/web/components/ui` module (each has a minimal workshop story beside it) and the pilot and journey surfaces. `docs-show <id>` returns documented props and story usage, and `stories-find-by-component` maps any source file to the story IDs that render it. Do not restate component props from memory or invent a parallel component.

### Figma link

Storybook and the [Home Figma file](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home) share one mapping, [`apps/web/figma-components.json`](../apps/web/figma-components.json). `@storybook/addon-designs` shows the mapped Figma node in each listed story's Design panel. Code Connect template files (`*.figma.ts` under `client/explorations/code-connect/` and `components/explorations/code-connect/`) show the real component in Figma Dev Mode. `apps/web/scripts/figma-variables.mjs` pushes the `globals.css` tokens into the `Home tokens` variables. Run these from `apps/web`:

```sh
bun run figma:connect:parse          # offline template check (CI step)
bun run figma:variables:dry-run      # print the token plan; writes nothing
bun run figma:connect:publish        # needs FIGMA_ACCESS_TOKEN (code_connect:write)
bun run figma:variables              # needs FIGMA_ACCESS_TOKEN (file_variables:read/write)
```

CI publishes both on pushes to `main` when the `FIGMA_ACCESS_TOKEN` secret is set. Source-of-truth rules and the scopes live in [Figma workflow](design-explorations/figma-workflow.md#source-of-truth).

### Journey stories

Page-level flows live under `apps/web/stories/journeys/<flow>.stories.tsx`. A journey composes the real screen from production components, serves each existing external request with `msw-storybook-addon` handlers (`parameters.msw.handlers`), and walks the flow in a `play` function that asserts observable results, not implementation details. The reference journey is `journeys-savings-deposit--deposit`: it loads vault metadata over the production `/api/savings/vaults` fetch, selects a vault, prepares a deposit, and dispatches the exact prepared action.

### Story tests

`@storybook/addon-vitest` runs every story in headless Chromium through the workshop's own Vite pipeline:

```sh
bun run --cwd apps/web test:stories
```

The same run is available through the MCP `test-run` tool and the workshop's test widget. A failing `play` function fails the run, and the a11y addon audits every story. `a11y.test` is `"todo"` (report, do not fail) globally because owned components carry pre-existing violations that need a product decision — the `ItemMedia variant="avatar"` initials contrast (4.34:1) and the money-modal asset-picker controls' missing accessible names. Minimal workshop stories that pass the audit set `a11y: { test: "error" }` so a new violation in those components fails the run. The Storybook manager and the test runner share a Vite dependency cache, so stop a running `storybook dev` before a full `test:stories` run.

Keep `*.stories.tsx` beside the production surface under `apps/web/components/**` or `apps/web/client/**`. A story imports the component Home uses rather than a separately styled copy, and composes the real card, list, shell, and provider constraints needed by that surface. Prefer the component's natural typed props and injected action functions; use provider fixtures or MSW only at an existing external-request boundary. The current MSW worker starts only through Storybook's global loader. Its file lives under `.storybook/static`, never `public`, and production modules may not import Storybook, stories, or MSW. Keep story-only fixtures inside a `*.stories.*` or `.storybook/**` path so the production-isolation gate can enforce that boundary.

Fixtures use fixed balances, clock values, and presentation regions. Each story resets the shared query client and owns cleanup for mutable or deferred state. Unexpected requests fail visibly; only known Storybook/Vite assets are bypassed. Never let a story fall through to a Home, provider, database, wallet, or other live service. Use the 390 CSS-pixel viewport as the representative mobile review composition; narrower widths such as 320px are safety checks for viewport containment, not the product's definition of mobile.

Every story meta has an explicit stable `id`; keep its meaningful export name stable once it is referenced. For story ID `<id>`, use these deployment-relative direct links:

- manager: `/?path=/story/<id>`
- canvas: `/iframe.html?id=<id>&viewMode=story`

The pilot inventory is:

- Financial row: `pilot-financial-row--normal`, `pilot-financial-row--loading`, `pilot-financial-row--unavailable-value`, `pilot-financial-row--long-label-large-amount`, `pilot-financial-row--issue-example-quantities`
- Shared finance rows: `pilot-finance-rows--asset-rows-large-local-currency`, `pilot-finance-rows--actionable-rows-chevron`
- Finance row retry and load errors: `ui-finance-rows-retry--alignment-and-retry`, `ui-finance-rows-retry--narrow-enlarged-text`, `ui-finance-rows-retry--rtl-slot`, `ui-load-error--card`, `ui-load-error--inline-button`. FinanceRow centres lone values beside two-line labels, title-aligns two two-line sides, and reserves the chevron column for a separately focusable 44px read-retry control. `LoadErrorCard` and `LoadRetryButton` use an in-flow 44px outline retry for failed reads, never for money-action recovery.
- Home overview (Figma `Home — final` and `Home states`): `home-overview--funded`, `home-overview--keyboard-order`, `home-overview--activity-detail-return`, `home-overview--no-borrow-position`, `home-overview--empty`, `home-overview--loading`, `home-overview--partial-balances`, `home-overview--partial-borrow-position`, `home-overview--activity-error`, `home-overview--no-country`
- Savings money dialog: `pilot-savings-money-dialog--amount-entry`, `pilot-savings-money-dialog--amount-exceeds-available`, `pilot-savings-money-dialog--withdraw-nothing-saved`, `pilot-savings-money-dialog--review`, `pilot-savings-money-dialog--submitting`, `pilot-savings-money-dialog--failed`, `pilot-savings-money-dialog--back-and-cancel`, `pilot-savings-money-dialog--reduced-motion-reference`
- Savings screen: `pilot-savings-experience--funded`, `pilot-savings-experience--verified-empty`, `pilot-savings-experience--loading`, `pilot-savings-experience--unavailable-partial`, `pilot-savings-experience--long-localized-content`
- Explorations (#638, unreviewed): Home `explorations-regional-home--us`, `explorations-regional-home--mobile-navigation-stays-visible`, `explorations-regional-home--mobile-navigation-safe-area`, `explorations-regional-home--brazil`, `explorations-regional-home--nigeria`, `explorations-regional-home--indonesia`, `explorations-regional-home--loading`, `explorations-regional-home--empty`, `explorations-regional-home--partial-balances`, `explorations-regional-home--activity-error`, `explorations-regional-home--cash-out-pending`, `explorations-regional-home--german-320`, `explorations-regional-home--french-200-text`, `explorations-regional-home--rtl`, `explorations-regional-home--keyboard-focus`, `explorations-regional-home--reduced-motion`, `explorations-regional-home--desktop`, `explorations-regional-home--desktop-loading`; sheets `explorations-regional-money-sheets--add-money-us`, `explorations-regional-money-sheets--add-money-brazil`, `explorations-regional-money-sheets--add-money-nigeria`, `explorations-regional-money-sheets--add-money-indonesia`, `explorations-regional-money-sheets--cash-out-us`, `explorations-regional-money-sheets--cash-out-unavailable`, `explorations-regional-money-sheets--cash-out-unavailable-brazil`, `explorations-regional-money-sheets--cash-out-unavailable-indonesia`, `explorations-regional-money-sheets--cash-out-review-desktop`, `explorations-regional-money-sheets--cash-out-review-desktop-short`; Account `explorations-regional-preferences--first-use-aligned-defaults`, `explorations-regional-preferences--currency-picker-open`, `explorations-regional-preferences--country-change-preserves-explicit-choices`, `explorations-regional-preferences--explicit-currency-matches-new-country-default`, `explorations-regional-preferences--return-to-country-default`, `explorations-regional-preferences--administrator`, `explorations-regional-preferences--german-320`, `explorations-regional-preferences--rtl`, `explorations-regional-preferences--desktop`.

The unreviewed Activity ledger proposal uses `proposal-activity-ledger--mixed-chronology`, `proposal-activity-ledger--detail-funding-needs-you`, and `journeys-activity-ledger--pending-to-detail-and-back` (full inventory in [Activity ledger proposal](activity-ledger-design.md)).

The unreviewed Borrow overview proposal uses `explorations-borrow-overview--multiple-loans`, `explorations-borrow-overview--alternative-b-multiple-loans`, `explorations-borrow-overview--management-sheet-open`, and `journeys-borrow-overview--repay-review-cancel-back` (full inventory in [Borrow overview proposal](borrow-overview-design.md)).

Every owned `apps/web/components/ui` module also has a minimal workshop story (`UI/<Component>`) so the MCP manifest exposes the owned inventory rather than only the pilot surfaces, plus the journey inventory `journeys-savings-deposit--deposit`. The unwired, unapproved Card proposal lives in the `Explorations/Card` group (`explorations-card--*`, [#636](https://github.com/jessepollak/home/issues/636)) until selection. The built `index.json` and the MCP `docs-list` output are the durable discoverability sources when this inventory grows. An intentional ID or export rename must update direct links and review evidence in the same change.

Storybook can prove that a production component renders and supports fixture-backed component interactions under deterministic states and review viewports. Stories and play functions are review scenarios, not permanent browser tests or approval by themselves. Storybook cannot prove Home's Next routing/history, app-level scrolling or focus restoration, browser Back integration, wallet/provider behavior, physical keyboard behavior, or Safari behavior. Verify the integrated component in Home under the [browser-validation contract](browser-validation.md), and record media and limitations under [UI PR previews](ui-pr-previews.md).

## Theme

The shared sheet spring uses the owned motion contract; its stiffness targets an approximately 350 ms critical settle across a full-height sheet, with damping chosen to prevent overshoot. Home mark enter and exit sequences are not interruptible or reentrant by design, matching the reference interaction exactly.

This section describes the implemented system and maintenance defaults. [UI direction](ui-direction.md#sources-and-status) records exploration and acceptance status; production defaults do not freeze the visual choices of an explicitly scoped experiment.

`apps/web/app/globals.css` uses shadcn's stock neutral theme generated by the `base-nova` preset. Home overrides `--primary`/`--ring` with Base blue (`#0052ff`), `--primary-foreground` with white, `--radius` with `0.25rem`, and `--destructive` with the reviewed softer red (`#c8372d` Light). Semantic status tokens are `--market-gain` / `--market-loss` for money-in and price-change text, `--warning` for warning titles, icons and the pending status dot, and `--chart-gain` / `--chart-loss` / `--chart-baseline` for price-chart lines and the dotted range-open baseline; each has a `@theme` colour and a separately checked Dark value. Status colour stays on an Alert or Toast's title and icon; body copy and actions stay `foreground`. `--payout-*` brand tokens and their `-foreground` pairs stay in `:root` only: payout brand marks keep their brand colors in both themes.

Use the stock system sans and monospace stacks: there is no `next/font` setup or font asset directory. Money and other aligned numbers use `tabular-nums`; monospace is reserved for addresses, hashes, and code. Use the stock Tailwind type scale and component spacing.

Country selection and searchable asset selection use the `Combobox`; its value truncates by default. Simple non-searchable pickers use Base UI `Select`. Financial rows stay on `Item`; do not introduce Data Table on mobile.

Use the owned component contracts rather than restyling their slots:
- `ItemMedia variant="avatar"` owns the standard circular row media. `ItemTitle` accepts `tone` (`default | muted | primary | gain | destructive`) and `numeric`; `ItemDescription` accepts `lines={1 | 2}` (one line truncates with an ellipsis) and `size="xs"` for a 12 px value context under a row value.
- `CardContent inset="list"` owns list-card horizontal insets; put screen-specific flow spacing on a plain inner wrapper.
- Grouped money rows (review summary, transaction receipt) use `Card variant="flush"` with `CardContent inset="list"`; rows inside carry `px-3` and no dividers.
- `Button variant="navigation"` owns primary-navigation presentation, and `size="inline"` is for small actions embedded in prose.
- `Button variant="balance-segment"` and `variant="balance-legend"` (with the matching sizes) own the Total balance allocation selection: segments keep their proportional width and gain only a vertical hit area, dim when another category is selected and grow in height when selected; legend buttons carry keyboard focus and `aria-pressed`, and switch to semibold foreground text with no background when selected. Both use `data-selected="true"`, and reduced motion drops the transition.
- `Button press="standard" | "icon" | "none"` owns press feedback: standard actions compress on pointer/touch-down, icon-only controls compress deliberately more, and `none` keeps wide rows, navigation, and link-like text still as whole surfaces. Every variant mirrors its hover treatment in `active:` and reduced motion drops every press transform while keeping those color cues.
- `Button size="touch"` is the 44px-minimum touch target for primary mobile actions; it wraps long labels instead of clipping. Use it instead of `h-11` overrides.
- `InputOTP` / `InputOTPGroup` / `InputOTPSlot` own one-box-per-digit verification with a single accessible input. `Input variant="code"` owns monospace input typography; `InputGroupInput` forwards the same variant.
- `PayoutMark variant="cashapp" | "zelle" | "monzo" | "revolut" | "fallback" | "count"` owns circular payout-mark geometry, typography, and semantic brand colors.
- `Button loading` owns the submitting state: it keeps the label and focus, adds `aria-busy` and a leading spinner, and ignores presses. `MoneyConfirmFooter submitting` applies it to the confirm primary.
- `ResultHeader outcome="success" | "pending" | "failed" | "unknown"` owns the money result header, and `StatusSteps` / `StatusStep status="complete" | "current" | "upcoming" | "failed"` own real transfer stages. Money flows compose them through `MoneyResult` / `MoneyResultFooter`; `unknown` never offers a retry. Use StatusStep, not Progress, for transfers.
- `Switch` is the semantic on/off control. Drawer surface, title, header, footer, safe-area, shadow, and immediate-motion treatment are owned defaults.
- `RadioGroup` is the mutually exclusive choice control for funding/payout choices confirmed by a separate action; direct-action rows stay `Item`/`Button`.
- `CopyableValue presentation="reveal"` shows a one-line condensed address; its `Popover` exposes the complete selectable address and a Copy button on review and Account surfaces.
- `Popover` owns small anchored disclosures, such as the Home header status; its content needs an accessible name (`aria-label`). `Skeleton` owns the loading tone (foreground at 10%, Figma `color/alpha/foreground-10`), which stays visible on both cards and the muted page.

## Rules

1. Style components and product surfaces with Tailwind utilities. Oxlint bans hex/rgba, arbitrary-pixel, and raw palette classes; use semantic tokens instead. Keep utilities inline at the product use site: the Home Oxlint rule `home/no-detached-class-constants` follows identifiers and static object/array lookups in `className` and `cn()` to local static class strings and rejects them. Unknown aggregate keys are rejected only when every reachable value is a non-empty static class string; dynamic data and predicate-only roles stay allowed. Reusable presentation belongs in owned component variants; dynamic composition (ternaries, templates, props, `cva()`) stays allowed.
2. Raw `@base-ui/react` imports are allowed only in `apps/web/components/ui`.
3. Raw `button`, `input`, and `select` elements outside `components/ui` are banned except for the shrinking audited allowlist. Use the owned wrappers.
4. `home/no-restyle` checks literal class tokens on `className` passed to a directly imported `components/ui` component (alias or relative import) in product code. It permits tokens with layout prefixes, and rejects other literal tokens as appearance changes. Dynamic expressions without literal tokens and classes on non-owned components are outside this rule; reusable presentation belongs in variants or explicit component contracts.

## Home-owned product pieces

- `apps/web/components/ui/payout-mark.tsx` owns payout brand-mark presentation; product code supplies only the platform-derived glyph and variant.
- `apps/web/components/money-ticker.tsx` preserves exact already-formatted money strings and animates them with `@number-flow/react`.
- `apps/web/client/money-modal` owns amount entry, asset selection, review, and confirmation steps; its shell is the owned shadcn Drawer wrapper.
  - Amount entry is a native `inputMode="decimal"` field that keeps amounts as exact decimal strings. Home draws no keypad.
  - The money sheet passes `keyboardAware` to `Drawer`, which wraps Base UI's `Drawer.VirtualKeyboardProvider`. The sheet and its footer follow `--drawer-keyboard-inset`, so Continue stays above the software keyboard. Nothing else listens to the visual viewport.
- Shell entry points never import a Drawer-backed sheet statically. They mount it through `deferSheet` (`client/money-modal/deferred-sheet.tsx`), preload it on the trigger's pointer-down, and idle-preload the Home primary actions (Send, Add money) once the account is verified, so Base UI Drawer and the sheet flows stay out of the shell's initial chunks.
- Keep Drawer-backed sheets mounted while driving `open`, and clear caller state only from the close-complete callback so exit motion runs. `deferSheet` stages a sheet that mounts already open through one closed render so entrance motion runs on first, preloaded, and repeat opens; a keyed replacement of an already-open sheet (an account-boundary remount) stays open without replaying its entrance. Reserve `immediate` for reduced motion and privacy drops (Send owner change).
- A confirm step renders `MoneyConfirmFooter` with its prepared action, never a bare `MoneyModalFooter`. Only the primary control carries `data-money-action-id` (`MONEY_ACTION_ID_ATTRIBUTE` in `shared/money-actions`), and only while that action is unexpired. Agents must check this marker with `agent-browser get attr @ref data-money-action-id` before any click.

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

The JS growth (+8.7 % gzipped) is the Base UI runtime — Drawer, Select, Field, Toast, Tabs, ToggleGroup, `useRender`, floating-ui — replacing the hand-rolled sheet physics, toast queue, and Radix Select. It landed in the shell's main client chunk because `MoneyModal` was imported statically. The CSS drop (−26 %) is the BEM sheet, the alias layer, and most CSS Modules leaving.

### Sheet and motion deferral ([#368](https://github.com/jessepollak/home/issues/368))

After [#804](https://github.com/jessepollak/home/pull/804) the shell renders at `/[...shell]` (`/dashboard` only redirects to `/home`), so the same method measures that route: build-manifest root files plus unique `[...shell]/page` client-reference chunks, gzip level 9.

| Measure | `main` (`e76eaf7`) | Deferred sheets, no `motion` |
| --- | ---: | ---: |
| Shell initial JS | 1,825,853 B | 1,478,491 B |
| Shell initial JS, gzip | 581,802 B | 474,715 B |
| Largest initial chunk, gzip | 194,189 B | 71,647 B |
| All client JS, gzip | 1,195,060 B | 1,187,792 B |

The Drawer-backed sheets (Send, Add money, Save, Borrow, transaction details, and sign-in) load through `deferSheet`; `motion` loads only when a pointer first enters the full Home mark, and the navigation indicator is a CSS transform. Base UI Combobox and floating-ui still reach the initial path through Account settings' `CountrySelect`, and `@adraffy/ens-normalize` through `client/transfers` → `shared/transfers/recipient-name`.

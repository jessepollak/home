# Design spec

Read this first before changing any user-visible surface. [Theme](theme.md) owns values and component contracts; this page is a role lookup, not a second policy.
Continue with [rules](rules.md), [styling guards](styling-guards.md), [components](components.md), [enforced gates](../gates.md#styling-guards), and [design engineering](../../.agents/skills/design-engineering/SKILL.md).

## Foundations

### Color and appearance

[Source and values](theme.md#appearance), including the theme introduction's semantic colors.

| Role / surface | Utility or token spellings | Where it applies |
| --- | --- | --- |
| Light / Dark | `--background`, `--foreground` | Shared tokens in `:root` (Light) and `.dark` (Dark) |
| Page | `--muted` | Page behind raised surfaces |
| Raised surfaces | `--background`, `--card`, `--popover` | Headers, cards, sheets and popovers |
| Text | `--foreground` | Body copy and actions |
| Primary | `--primary`, `--primary-foreground` | Base-blue primary tone and its text pair |
| Focus | `--ring` | Neutral-ink focus treatment |
| Destructive | `--destructive` | Reviewed destructive tone |
| Market gain / loss | `--market-gain`, `--market-loss` | Money-in, price-change text and chart line |
| Warning | `--warning` | Warning titles, icons and pending status dot |
| Coverage status | `bg-status-positive`, `bg-status-caution`, `bg-status-negative` | Coverage traffic dots |
| Payout brands | `--payout-*`, `--payout-*-foreground` | Payout brand marks in both themes |
| Pending cash-out | `--balance-bar-pending-cash-out` | Home allocation bar and legend |

### Type roles

[Source and values](theme.md#type-roles).

| Role | Utility or token spellings | Where it applies |
| --- | --- | --- |
| Amount | `text-4xl font-semibold leading-none tabular-nums` | Balances and confirm summaries |
| Heading | `text-base font-semibold` | Card, Drawer, Popover, Result and Feature intro titles |
| Body | `text-sm` | Descriptions and message text; fields use `text-base` below `md` |
| Label | `text-sm font-medium` | Buttons, toggles, row titles and field labels |
| Metadata | `text-xs text-muted-foreground` | Captions and compact descriptions; badges add `font-medium` |
| Numeric | `tabular-nums` | Aligned or changing numbers |
| Mono | `font-mono text-sm` | Addresses, hashes and code |

### Radius

[Source and values](theme.md#radius).

| Role / surface | Utility or token spellings | Where it applies |
| --- | --- | --- |
| Controls | `rounded-lg` | Buttons, fields, picker triggers/items, Toggle, OTP, Input Group and Skeleton |
| Rows / cards | `rounded-xl` | Card, standalone Item, Alert, Empty and support messages |
| Popups | `rounded-xl` | Popover, picker lists, coverage preview and Toast |
| Sheets | `rounded-2xl` | Drawer and desktop money sheet |
| Pills / avatars | `rounded-full` | Badge, Switch, Progress, rail/tab buttons, search, avatars and status marks |
| Nested marks | `rounded-sm` | Input Group buttons, Kbd, Item images, segmented choices and inline/balance buttons |

### Elevation

[Source and values](theme.md#elevation).

| Role | Utility or token spellings | Where it applies |
| --- | --- | --- |
| Raised | `shadow-raised` / `--elevation-raised` | Card, refresh indicator, Switch thumb and conversation scroll button |
| Floating | `shadow-floating` / `--elevation-floating` | Popover, picker lists and coverage preview |
| Overlay | `shadow-overlay` / `--elevation-overlay` | Drawer |
| Toast | `shadow-toast` / `--elevation-toast` | Toast |

### Motion

[Source and values](theme.md#motion), including owned sheet and Home mark contracts.

| Role | Utility or token spellings | Where it applies |
| --- | --- | --- |
| Fast | `duration-fast` / `--motion-duration-fast` | Exits, press feedback and small popup close |
| Base | `duration-base` / `--motion-duration-base` | Hover, fades and popup enter |
| Moderate | `--motion-duration-moderate` | Tab-lens travel and pill movement |
| Slow | `--motion-duration-slow` | Search morph and keyboard follow |
| Standard | `ease-standard` / `--motion-ease-standard` | State changes |
| Enter | `ease-enter` / `--motion-ease-enter` | Decelerate in |
| Exit | `ease-exit` / `--motion-ease-exit` | Accelerate out |
| Emphasized | `--motion-ease-emphasized` | Lens travel |
| Reduced motion | `--motion-duration-*` | Shared duration collapse |

### Interaction states

[Source and values](theme.md#interaction-states).

| Role / state | Utility or token spellings | Where it applies |
| --- | --- | --- |
| Hover / highlight | `bg-state-hover` | Neutral controls and pointer/keyboard menu highlight |
| Pressed | `active:bg-state-pressed` | Neutral controls while held |
| Focus-visible | `border-ring`, `ring-ring/50` | Focus border and ring; inset on flush rows |
| Disabled | `opacity-50` | Disabled controls over their rest fill |
| Selected | `bg-state-pressed` | Neutral pressed, expanded or selected controls |
| Field hover | `hover:border-input-hover` | Input, Textarea, Input Group and picker triggers |

## Status texture

| Texture | Color | Mark | Motion | Placement and copy | Component | Story |
| --- | --- | --- | --- | --- | --- | --- |
| Settled | foreground; gain only for money-in amounts | none | none | No status text, freshness timestamp or "as of" | `components/finance-rows.tsx` | `ui-finance-rows--balance` |
| Working | muted | small muted spinner, not primary; a static clock in reduced motion | the spinner only | No status label on rows; short muted context (for example "Arriving in ~2 min"); toast on start. Also covers an outcome Home cannot confirm yet, until there is a reason to believe the customer must act (then Needs you) | `components/finance-rows.tsx` | `ui-finance-rows--working` |
| Needs you | warning icon, foreground copy | warning icon replaces the row chevron | none | Persists until resolved; one verb-first action; the only texture that interrupts | `components/finance-rows.tsx` | `ui-finance-rows--needs-you` |
| Can't load | as selected in #2045 | as selected in #2045 | none | Replaces the partial, stale and `—` treatments; best-known values otherwise stay as they are (#2045) | `components/load-error.tsx` | `ui-load-error--cant-load` |
| Failed, recoverable | destructive title and icon; body foreground | CircleX | none | Honest cause, one way back, no automatic retry | `components/load-error.tsx` | `ui-load-error--failed` |
| Done | foreground check; gain for money-in | CircleCheck | one toast | Sheet closes; toast auto-dismisses and stays dismissed after refresh | `components/ui/toast.tsx` | `ui-toast--success` |
| Loading | skeleton tone | none | shimmer shaped like the loaded layout; none in reduced motion | No spinner swap, no loading prose, no blank gap | `components/ui/skeleton.tsx` | `ui-skeleton--stack` |

- One owner per texture: `StatusMark` / `statusTextClass` in `components/ui/status-texture.tsx`. Presenters return a texture name; owned components render it.
- Product code never picks a status color, icon or animation.
- At most one loud texture per surface (Needs you > Failed > the rest); the header status icon summarizes the rest.
- Numbers animate only when complete and settled.
- Working is a small muted spinner on rows; an outcome Home cannot confirm yet is Working, not its own state.
- Can't load mark and color are pending the #2045 selection; use the placeholder muted CircleAlert until then.
- Partial chrome is removed: show best-known balances with no partial chrome.

## Templates

| Template | Structure | Component | Story |
| --- | --- | --- | --- |
| Destination | Hero (amount first) → one action row → named sections → rows. Home keeps its desktop money + Activity grid; other destinations use the 40rem column. | `planned: PR 3` | `planned: PR 3` |
| Row | mark · label/context · value/context · one trailing slot (chevron, needs-you icon, or one secondary action) | `components/finance-rows.tsx` | `ui-finance-rows--working` |
| Facts | muted label left, numeric value right | `components/management-facts.tsx` | `borrowing-borrow-overview--management-sheet-open` |
| Money flow | MoneyModal → amount → MoneyConfirmSummary (actionable facts only) → Done texture | `client/money-modal/money-modal.tsx`, `client/money-modal/confirm-summary.tsx` | `funding-cancel--awaiting-payment`, `money-modal-confirm-summary--send-review` |
| First use | FeatureIntro, no zero balance | `components/ui/feature-intro.tsx` | `ui-feature-intro--card-not-issued` |
| Detail | sheet from row | `client/invest/explorations/asset-sheet.tsx` | `invest-asset-sheet--rows-open-sheet` |

- Detail opens as a sheet from its row by default; full page only where a sheet cannot hold the task. The mini asset sheet above is the exploration #2119 selects from; its adoption is separate.
- Every money flow ends by closing the sheet and showing a toast; failures stay in the sheet with their way back. Success and still-pending outcomes close with a toast.
- Close-and-toast and the Destination template land in PR 3 of #2121, which names `Area: shell`; the Money flow references above are existing building blocks, not completed close-and-toast adoption.

## Owned surface roles

From [Radius](theme.md#radius), [Elevation](theme.md#elevation) and [Type roles](theme.md#type-roles). “—” means no assignment in those tables, not an instruction to remove a component's treatment.

| Owned surface group | Radius step | Elevation | Type role |
| --- | --- | --- | --- |
| Controls: Button, Toggle, picker triggers/items, OTP | `rounded-lg` | — | Label; Body for field text |
| Controls: Input, Textarea, Input Group | `rounded-lg` | — | Body; Label for labels; Mono for code |
| Controls: Skeleton | `rounded-lg` | — | — |
| Rows / cards: Card | `rounded-xl` | Raised | Heading, Body; Label for row titles; Metadata for captions |
| Rows / cards: standalone Item, Alert, Empty, support messages | `rounded-xl` | — | Label for row titles; Body for messages/descriptions; Metadata for captions |
| Popups: Popover, Select/Combobox lists, coverage preview | `rounded-xl` | Floating | Heading for Popover title; Label for items; Body for descriptions |
| Popups: Toast | `rounded-xl` | Toast | Body for message text |
| Sheets: Drawer, desktop money sheet | `rounded-2xl` | Overlay for Drawer | Heading, Body; Amount for confirm summaries |
| Pills / avatars: Badge, Switch, Progress, rail/tab buttons, search, avatars, status marks | `rounded-full` | Raised for Switch thumb | Metadata for badges; Label for buttons; Body for field text |
| Marks: Input Group buttons, Kbd, Item images, segmented choices, inline/balance buttons | `rounded-sm` | — | Label for buttons/choices; Mono for code |

## Do / Don't

- **Do** begin with [owned components](components.md) and their [contracts](theme.md#type-roles).
- **Do** use the [appearance review](theme.md#appearance) and [motion contracts](theme.md#motion).
- **Do** follow the [design-engineering working sequence](../../.agents/skills/design-engineering/SKILL.md#working-sequence).
- **Don't** bypass [component styling rules](rules.md) or [styling guards](styling-guards.md); consult the [enforced gates](../gates.md#styling-guards).

## Declared tokens

`scripts/gates/design-spec.mjs` keeps this block exact, counting names declared in a rule body and names registered with `@property`; a token change updates it in the same change.

<!-- design-spec:tokens:start -->
--accent
--accent-foreground
--background
--balance-bar-cash
--balance-bar-investments
--balance-bar-pending-cash-out
--balance-cash
--balance-investments
--balance-savings
--border
--card
--card-foreground
--color-accent
--color-accent-foreground
--color-background
--color-border
--color-card
--color-card-foreground
--color-destructive
--color-foreground
--color-input
--color-input-hover
--color-market-gain
--color-market-loss
--color-muted
--color-muted-foreground
--color-overlay
--color-payout-cashapp
--color-payout-cashapp-foreground
--color-payout-monzo
--color-payout-monzo-foreground
--color-payout-revolut
--color-payout-revolut-foreground
--color-payout-zelle
--color-payout-zelle-foreground
--color-popover
--color-popover-foreground
--color-primary
--color-primary-foreground
--color-ring
--color-secondary
--color-secondary-foreground
--color-state-hover
--color-state-pressed
--color-status-caution
--color-status-negative
--color-status-positive
--color-warning
--destructive
--ease-enter
--ease-exit
--ease-standard
--elevation-floating
--elevation-overlay
--elevation-raised
--elevation-ring
--elevation-ring-strong
--elevation-toast
--font-mono
--font-sans
--foreground
--globe-land
--globe-sphere-light
--globe-sphere-shade
--input
--input-hover
--market-gain
--market-loss
--motion-duration-base
--motion-duration-fast
--motion-duration-moderate
--motion-duration-slow
--motion-ease-emphasized
--motion-ease-enter
--motion-ease-exit
--motion-ease-standard
--muted
--muted-foreground
--overlay
--payout-cashapp
--payout-cashapp-foreground
--payout-monzo
--payout-monzo-foreground
--payout-revolut
--payout-revolut-foreground
--payout-zelle
--payout-zelle-foreground
--popover
--popover-foreground
--primary
--primary-foreground
--radius
--radius-2xl
--radius-lg
--radius-md
--radius-sm
--radius-xl
--ring
--secondary
--secondary-foreground
--shadow-floating
--shadow-overlay
--shadow-raised
--shadow-toast
--shell-bottom-control-offset
--shell-navigation-clearance
--shell-navigation-offset
--shell-safe-area-bottom
--shell-viewport-inset-bottom
--shell-viewport-keyboard-height
--shell-viewport-pan
--spacing-hairline
--spacing-shell-header-avatar
--spacing-shell-header-control
--spacing-shell-mobile-navigation
--spacing-shell-search-field
--state-hover
--state-pressed
--status-caution
--status-negative
--status-positive
--transition-duration-base
--transition-duration-fast
--warning
<!-- design-spec:tokens:end -->

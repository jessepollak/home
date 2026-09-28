# Gap matrix

Frequently revised component entries live in [component notes](components/), one file per component. Older unchanged rows remain below; add new components as files instead of appending to these tables.

Columns:
- **Code** is whether an owned implementation exists in `apps/web`.
- **Figma** is the node after this pass.
- **MVP** is whether Home needs the item for the MVP surfaces (Home, Save, Invest, Borrow, Fund/Send, Activity, Account).
- **P** is priority: P0 is needed by the next screens, P1 by the MVP, and P2 later.

## Primitives (shadcn base-nova on Base UI)

| Item | Code | Figma | MVP | Base UI underneath | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| Button | yes | `12:27` variant × size × state (57 variants) | yes | Button | `components/ui/button.tsx` | P0 |
| Badge | yes | `158:1841` variant | yes | useRender | `components/ui/badge.tsx` | P0 |
| Item | yes | `161:1818` variant × size + hover/focus (code has no disabled state) | yes | useRender | `components/ui/item.tsx` | P0 |
| Separator | yes | `158:1872` orientation | yes | Separator | `components/ui/separator.tsx` | P0 |
| Skeleton | yes | `158:1866` shape (Figma-only); fill `color/alpha/foreground-10`, code's `bg-foreground/10` (run 12; it was `color/muted`, which vanished on the muted page) | yes | none (div) | `components/ui/skeleton.tsx` | P0 |
| Drawer (sheet) | yes | `161:1847` title=default\|money; Show footer; native `DrawerContent` and `DrawerFooter` slots (run 11). Every sheet on the pattern boards is one Drawer instance | yes | Drawer | `components/ui/drawer.tsx` | P0 |
| Toast | yes | `161:1885` type (6); 12/16 padding, icon slot centred on the title, warning icon in `warning`, error icon in `destructive` (code parity in #947) | yes | Toast | `components/ui/toast.tsx` | P0 |
| Input | yes | `160:1654` variant × state; the former `variant=otp` was replaced by InputOTP in #950 | yes | Input | `components/ui/input.tsx` | P0 |
| InputOTP (+ sub-part InputOTPSlot) | yes | `211:3668` state=empty\|active\|typing\|filled\|error\|disabled; `211:3547` slot sub-part | yes | input-otp package, adopted in #950 | `components/ui/input-otp.tsx`; screen owner `client/account/sign-in-otp.tsx` | P1 |
| InputGroup | yes | `160:1673` state | yes | Input + addons | `components/ui/input-group.tsx` | P0 |
| Field | yes | `160:1684` state; Label and Description properties and a native `FieldControl` slot for Input, InputOTP, Select or Combobox (run 11) | yes | Field | `components/ui/field.tsx` | P0 |
| Label | yes | `158:1880` state | yes | none (label) | `components/ui/label.tsx` | P0 |
| Combobox | yes | `160:1759` state=closed\|open\|empty | yes | Combobox | `components/ui/combobox.tsx` | P0 |
| Toggle | yes | `160:1826` variant × state + sizes | yes | Toggle | `components/ui/toggle.tsx` | P0 |
| ToggleGroup (segmented control) | yes | `160:1849` variant; `outline` draws one group border with 2px padding and borderless items (code parity in #947) | yes | ToggleGroup | `components/ui/toggle-group.tsx` | P0 |
| Select | yes | `160:1718` state | yes | Select | `components/ui/select.tsx` | P1 |
| Switch | yes | `160:1772` checked × state | yes | Switch | `components/ui/switch.tsx` | P1 |
| Empty | yes | `161:1904` media; `EmptyAction` is a `Button` instance, `size=touch` at 44px as code's `size="touch"` (run 12; it was a raw frame) | yes | none (div) | `components/ui/empty.tsx` | P1 |
| Popover | yes (#804) | `292:5883` (run 12): `PopoverContent` (288px, `p-2.5`, `rounded-lg`, `Elevation/md`) with `Description` and `Show action`; `PopoverAction` is a 44px ghost icon `Button`, swappable to a secondary "Open Account" | yes (Home header status) | Popover | `components/ui/popover.tsx` | P1 |
| RadioGroup | yes (#952) | `160:1801` checked × state | yes | RadioGroup + Radio | `components/ui/radio-group.tsx` | P1 |
| Progress | yes (#951; product adoption pending a truthful count) | `161:1923` status × value | yes | Progress | `components/ui/progress.tsx` | P1 |
| Icon (Lucide) | yes | `156:1726` 30 glyphs (revision 3 adds `circle-help`; run 11 adds `house` and `chart-column-increasing`) | yes | n/a | `lucide-react` imports | P0 |
| NativeSelect | yes (in `select.tsx`) | no | no | native select | `components/ui/select.tsx` | P2 |
| Table / DataTable | yes | no | no (desktop only; not on mobile) | none | `components/ui/table.tsx`, `data-table.tsx` | P2 |
| CoverageTable, CoverageStatusPreview | yes | no | no (internal coverage tooling) | none | `components/ui/coverage-*.tsx` | P2 |
| PayoutMark | yes | no (payout brand colours are variables) | no | none | `components/ui/payout-mark.tsx` | P2 |
| Tabs | no | no | no (primary navigation is `Button variant="navigation"`; ToggleGroup covers segments) | Tabs | unassigned | P2 |
| Dialog | no | no | no (Drawer covers mobile overlays) | Dialog | unassigned | P2 |
| Tooltip | no | no | no (touch first; facts go inline) | Tooltip | unassigned | P2 |
| Menu | no | no | no | Menu | unassigned | P2 |
| Accordion | no | no | no | Accordion | unassigned | P2 |
| Checkbox | no | no | no (Switch covers settings) | Checkbox | unassigned | P2 |
| Avatar | no | no (covered by `ItemMedia variant="avatar"`) | no | Avatar | `components/ui/item.tsx` | P2 |
| Textarea | no | no | no | none | unassigned | P2 |

## Home and finance components

| Item | Code | Figma | MVP | Built on | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| CurrencyMarkSlot | yes | `12:59` (#683) | yes | none | `components/currency-mark.tsx` | P0 |
| MoneyTicker | yes | `12:2` (#683) | yes | `@number-flow/react` | `components/money-ticker.tsx` | P0 |
| ShellHeader, TabBar/TabItem, SectionHeader, MoreRow, MoneyBreakdownItem, MoneyGroupHeader | yes | #683 families | yes | Button, Item | see [figma-mapping.json](../figma-mapping.json) | P0 |
| SignedBalanceBar, ActivityLoader | yes (mapped in #789) | #683; run 12 makes `SignedBalanceBar` the set `293:5935` with `items=borrow+cash+investments` (`91:927`, mapped), `cash+investments` and `cash`, so states never detach it | yes | none | `components/signed-balance-bar.tsx`, `components/activity-loader.tsx` | P1 |
| ShimmerRow | yes (`ShimmerRows`) | `274:6015`: one Item size=sm row with a centred 40px Shimmer circle (code parity) and two Skeleton lines. `Show media` and `Show context` are **proposed** design-only booleans; #687 audited every production loading consumer and none renders a mark-less or single-line row, so code keeps `rows` (both lines and the mark) plus a `hero` variant and has not adopted the booleans. Removing them from `274:6015` is a Figma edit, still pending | yes | Item + Skeleton | `client/home/panel-shared.tsx` | P0 |
| TradeActions | yes | `274:5577` (run 11): Buy (default) + Sell (secondary, Jesse's decision), touch, 34px home-indicator inset; pinned to the bottom of asset detail | yes | Button | `client/trading/trade-actions.tsx` (`layout="sticky"`) | P1 |
| TransactionAmount | removed in #967: adopted in #942, then superseded by the Activity ledger sheet's signed amount and status Badge | `282:5882` tone=default\|success; no code component or Code Connect mapping since #967 (follow-up 2a) | yes | Badge | `client/activity/activity-ledger-sheet.tsx` (ledger sheet header) | P0 |
| SystemKeyboard | n/a (the OS keyboard) | `274:5688` type=decimal\|number (run 11, DESIGN-ONLY placeholder that sizes layouts; never implemented) | n/a | n/a | none | — |
| MoneyQuickChips | yes | `166:1787` chipSet | yes | Button outline sm h-11 | `client/money-modal/amount.tsx` | P0 |
| MoneyUnitToggle | yes | `166:1788` | yes | Button outline sm h-11 | `client/money-modal/amount.tsx` | P0 |
| CopyableValue | yes | `282:5961` set display=truncated\|full (`166:1820` is `truncated`); `display=full` Value `282:5958` uses `Home/Mono tight` on review, now superseded by Jesse’s #945 decision. Code adopts `presentation="reveal"` for review `To`, `Resolves to`, and Account address: condensed one-line trigger and full address plus Copy button in a popover. Figma needs a `reveal` drawing; parity pending | yes | Button + Popover | `components/copyable-value.tsx` | P0 |
| StatusStep | yes (#948) | `166:1861` status, Show connector | yes | Item + Icon | `components/ui/status-step.tsx` (#948) | P1 |
| AssetDetailHeader | inline only | `166:1917` tone=positive\|negative\|loading (design-only family), not mapped. Revision 2: Back + 40px mark + name over "ETH · Base"; price and change on the page edge; the period is in muted text. The selected #938 revision (`422:4404`) keeps the header inline in `AssetDetailScreen`, with the price and change following the scrub; extraction is deferred (follow-up 21) | yes | MoneyTicker | `client/invest/asset-detail-screen.tsx` | P1 |
| PriceChart (superseded) | replaced by `AssetChart` | `166:1959`, not mapped: the selected #938 `AssetChart` (`422:4648`) replaces it. Production draws the line and fill in the range change's market gain/loss colour on the page surface, with a borderless full-width range, pointer, touch and keyboard scrub driving the header, a slow-load note and an in-place Try again. The dotted baseline and high/low labels are deferred (follow-up 18a) | yes | Liveline + ToggleGroup | `client/invest/asset-chart.tsx` | P1 |

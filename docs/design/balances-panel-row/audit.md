# Audit — `balances-panel-row` (Pass 2, Analyze)

Sources: `inventory.md` (Pass 1), Figma `get_design_context` for `5:165` plus the REST node re-read, and the shipped code at `fd4b14ff` —
`apps/web/components/finance-rows.tsx`, `apps/web/components/ui/item.tsx`, `apps/web/components/ui/card.tsx`, `apps/web/components/currency-mark.tsx`, `apps/web/components/compact-financial-value.tsx`, `apps/web/client/home/balances-panel.tsx`, `apps/web/app/globals.css`.

Home's rule applies: **the code is the source of truth for shipped UI; Figma is the source of truth for a proposal.** `5:165` is a detached, hand-composed frame inside `5:161`, not an instance of the `5:160 HomeBalanceRowView` component set, so every value below is cross-checked against the code and divergences are recorded as findings instead of being implemented.

## 1. Element and property table

Frame origin = the row frame's content box. `left/top` are offsets from that origin, `right/bottom` are insets from its far edges (see `references/verification.md` for the convention).

| Element | Figma node | Figma value | Shipped code | Verdict |
| --- | --- | --- | --- | --- |
| Row root | `5:165` | auto-layout HORIZONTAL, `itemSpacing` 12, fill `#FFFFFF`, 326×56 (hug) | `FinanceRow` → `Item` (flex, `gap-2.5` = 10, `border`, `min-h-14 px-3 py-3`), stretches to the card column | `fix-figma` for the 2 px gap and hug-vs-stretch width (see §5) |
| Mark | `5:166` | 32×32, `cornerRadius` 16, x 0, y 12 | `ItemMedia variant="avatar"` (`size-8` = 32) → `CurrencyMark size="sm"` (32×32, `border-radius: 50%`, inset 1 px ring) | match |
| Mark → content gap | auto-layout `itemSpacing` | 12 | `gap-2.5` = 10 (`Item` `size="default"`) | drift: 10 vs 12 (`gap-3` exists, so this is not a token rounding) |
| Content block | `5:176` | `ItemContent` 222×20, VERTICAL, gap 2 | `ItemContent className="min-w-0"` (flex-1) | shape match, width is hug in Figma vs flexible in code |
| Label | `5:177` | `SF Pro Text` 400 16/20, `#171717`, x 44 | `ItemTitle` = `text-sm leading-snug font-medium` → 14/19.25, weight 500, `--foreground` `oklch(0.145 0 0)` | drift: size, weight and colour (§5) |
| Value | `5:178` | `SF Pro Text` 600 14/20, `#171717`, 48×20, right edge flush with the frame | `ItemTitle numeric truncate={false} tone="default"` + `MoneyTicker`/`compactFinancialValue`, right-aligned (`justify-end`), fills the remainder | drift: weight 500 vs 600 (§5) |
| Value right inset | metadata right edge 846 = frame right edge 846 | 0 | `justify-end` + `w-full` inside the value `ItemContent` | match |
| Background | `5:165` fill `#FFFFFF` | `#FFFFFF` | `Card` (`--card: oklch(1 0 0)`) paints white; the row itself is transparent | match in effect, asserted on the Card |
| Vertical padding | 12 top / 12 bottom (`(56 − 32) / 2`) | 12 (`py-3`) | match | |
| Row box height | 56 content box | 56 content box + 2 × 1 px item border = 58 border box | match on the content box; the border is a code-side affordance the frame does not draw | |

## 2. Tokens (`apps/web/app/globals.css`)

| Figma raw value | Home token | Resolved (light) | Decision |
| --- | --- | --- | --- |
| `#FFFFFF` frame fill | `--card` | `oklch(1 0 0)` | use the token |
| `#171717` text | `--foreground` | `oklch(0.145 0 0)` (≈ `#0a0a0a`) | use the token; record the one-shade deviation (neutral-900 vs neutral-950) instead of hard-coding `#171717` |
| `#EF3340` / `#0452B4` / `#EEEEEE` inside the mark | none | the flag is an asset (`/currency-flags/us.svg`), not tokens | draw the mark with the shipped asset, never with Figma vector colours |
| 12 px gap | `gap-3` exists | shipped row uses `gap-2.5` (10) | finding, not a silent override |

No value in this audit required an arbitrary literal. The two accepted deviations are recorded below and in `verification/balances-row.json`.

## 3. Typography

| Element | Figma | Code | Delta |
| --- | --- | --- | --- |
| Label | SF Pro Text 400 16/20 | system UI stack 500 14/19.25 (`text-sm leading-snug font-medium`) | −2 px size, +100 weight |
| Value | SF Pro Text 600 14/20 | system UI stack 500 14/19.25 | −100 weight |
| Group header (sibling, not proved) | — | `text-xs font-medium tracking-wider uppercase` | — |

Home has no `next/font`; `--font-sans` is `ui-sans-serif, system-ui, …`, which resolves to SF Pro on macOS. The family is therefore not the difference — size and weight are.

## 4. States

| State | Where it lives | Audited? |
| --- | --- | --- |
| default (cash row, no secondary line) | `pilot-financial-row--normal` | yes — proof target |
| unavailable value (`tone="error"`, "Unavailable") | `pilot-financial-row--unavailable-value` | rendered by the story suite; not part of this proof's pixel gate |
| loading shimmer | `pilot-financial-row--loading` | rendered by the story suite; not part of this proof's pixel gate |
| long label / large amount (truncation, `line-clamp-1` vs `truncate={false}`) | `pilot-financial-row--long-label-large-amount` | rendered by the story suite; not part of this proof's pixel gate |
| muted secondary line (`0.0010 cbBTC`) | `Asset=Recognized Coin` composition (`5:193`) | inventory only |
| hover / focus-visible / press | `Item` `[a]:hover:bg-muted`, `focus-visible:border-ring ring-3` | code-owned; the Figma frame draws no interaction state |

The Figma frame only specifies the resting state. Interaction states stay code-owned and were not invented.

## 5. String and data triage

| String | Node | Class | Decision |
| --- | --- | --- | --- |
| `US dollar` | `5:177` | real-copy | matches the shipped row label; the story fixture already uses it |
| `$12.34` | `5:178`, `5:164` | real-copy (value) | the story fixture uses `$12,345.67`; the Figma amount is presentation data, not copy — it must not be baked into the fixture to force a pixel pass |
| `CASH` / `INVESTMENTS` | `5:163`, `5:184` | real-copy (surface grouping) | code-owned by `MoneyGroupHeader` |
| `$78.21`, `$60.00`, `$18.20` | `5:185`, `5:192`, `5:199` | placeholder data | never implemented |
| `More` | `5:180`, `5:201` | real-copy | code-owned (`GroupedBalancesList`) |

## 6. Findings and directions

| # | Finding | Direction | Risk / effort | Note |
| --- | --- | --- | --- | --- |
| F1 | Label renders 14/500 but the frame draws 16/400 | `fix-figma` (code is truth for shipped UI) | low to re-frame, medium if treated as a proposal | A proposal to move the label to 16/400 would need an accepted story plus a product decision; it changes every financial row, not just balances |
| F2 | Value renders weight 500, frame draws 600 | `fix-figma` | low | Same class of drift |
| F3 | Row gap is 10 px (`gap-2.5`) where the frame's auto-layout says 12 | `fix-figma` (or `fix-code` if Jesse accepts the frame) | low to re-frame, medium to change: `Item` `size="default"` is shared by every finance row | `gap-3` exists, so this is a real 2 px difference, not a rounding |
| F4 | Frame is hug-width 326 while the shipped row stretches to the card column | `product-decision` | — | A hug-width component frame cannot equal a stretching DOM row. The frame's height (56 content box) and its internal geometry are comparable; its width is not. The proof diffs the shared box and records the delta |
| F5 | Text corrects `#171717` where the shipped token resolves to `oklch(0.145 0 0)` | `intentional-keep` | — | Token ownership; a one-shade difference is the token rule's accepted case |
| F6 | `5:165` is a detached frame duplicating `5:160 Asset=US dollar` | `fix-figma` | low | Designer punch-list: the component set and the composition can drift apart; nobody should treat `5:165` as component output |
| F7 | Row border (1 px `border-transparent`) makes the border box 58 px tall where the frame is 56 | `intentional-keep` | — | The Figma frame maps to the content box; the audit and the capture both use `frameBox: "content"` |

## 7. Behavior parity inventory (the row is already shipped)

Nothing is being replaced here, so parity means: the Figma-driven artifacts must not change the shipped row's behaviour. Anything that does change it must carry these items forward.

| Item | Where | Disposition |
| --- | --- | --- |
| DOM shape `ul[data-balance-list] > li > [data-slot=item]` | `BalancesList`, `finance-rows.tsx` | keep — the audit spec's frame selector depends on it |
| Mark resolution: image → flag → initials, `pending` shimmer, inset ring | `currency-mark.tsx`, `presentPortfolioAssetMark` | keep |
| Value formatting `compactFinancialValue` + `MoneyTicker reserveDigits={false}` | `compact-financial-value.tsx` | keep |
| Exact accessible value: `aria-label={row.primary}` on the ticker | `FinanceRow` value | keep — a redesign that drops it regresses screen-reader output |
| Tones: `default`, `muted` (muted value), `error` (Unavailable) | `ItemTitle tone` mapping | keep |
| Secondary line (`ItemDescription lines={1}`) and truncation | `ItemDescription` | keep |
| Row activation (`onActivate` → `Button` + chevron + hidden hint) | `FinanceRow` | keep — absent for Home rows but used by the same component elsewhere |
| Existing tests: `balances-panel-row.test.tsx` (4 cases), `balances-panel.test.ts` | `apps/web/client/home/` | must stay green |

## 8. Mapping table

| Figma component / node | Home component | Decision |
| --- | --- | --- |
| `Item` (`5:29`), `BalanceRow` (`5:108`), `HomeBalanceRowView` (`5:160`) | `components/ui/item.tsx`, `components/finance-rows.tsx` | reuse; no new variant needed for the resting row |
| `CurrencyMark` (`5:166`, set `5:28`) | `components/currency-mark.tsx` `size="sm"` | reuse |
| `MoneyTicker` (`5:12`) | `components/money-ticker.tsx` via `compactFinancialValue` | reuse |
| `Card` (`5:11`) | `components/ui/card.tsx` `CardContent inset="list"` | reuse — owns the list insets |
| `ItemTitle` (`5:177`, `5:178`) | `ItemTitle` with `tone` / `numeric` / `truncate` contracts | reuse; the F1/F2 typography drift is a frame-vs-code question, not a missing variant |

**Code Connect:** unavailable at the time of this run. No `.figma.tsx` mappings or `figma.config.json` exist in the worktree at `fd4b14ff`, and this proof invented none. When the companion Code Connect work lands, the mapping table above is the intended target list and each mapping should be read from Code Connect rather than transcribed by hand.

## 9. Verification plan

| Gate | Command | Expectation |
| --- | --- | --- |
| Measure (DOM) | `measure.mjs --spec docs/design/balances-panel-row/audit.spec.json` | named failures for F1–F3 only; everything else matches |
| Diff (pixels) | `figma-export.mjs --node 5:165` → `capture.mjs` → `diff.mjs --crop 0,0,324,56` | recorded honestly; text-bearing rows never reach 0 % |
| Matrix | `capture.mjs` at 390×844, 320×568, 1280×800 (+ dark) | no overflow or clipping; the row keeps its anatomy |
| a11y | `bun run --cwd apps/web test:stories` | a11y addon reports findings (global `a11y.test: "todo"`); nothing may be hidden |

Story host note: the story was corrected to compose the real shell content frame (`shellContentFrameClassName` + `py-4`) so the card width matches the shipped Home column (358 px at a 390 px viewport). At that width the app row's content box is 324×56 against the frame's 326×56 — a 2 px hug-vs-stretch difference, recorded rather than tuned away.

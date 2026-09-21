# Inventory — `balances-panel-row` (Pass 1, Map)

Target: `HomeBalanceRowView` US dollar row, implementation story `pilot-financial-row--normal`.
Figma file: `ixgttt6IurKynsvMJpLYDC` ("Home Library"), last modified `2026-09-21T02:48:35Z`, version `2401500907411455165`.
Page: `4:2 Home baseline @ fd4b14ff`. Proof frame: `5:165 HomeBalanceRowView / US dollar` (326×56).

Evidence method: the orchestrating run read the file through the mux-gateway Figma MCP server (`server_id: "figma"`, `get_metadata` for the file/page/node tree and `get_design_context` for the row) and this pass re-read the same nodes through the read-only REST node endpoint (`figma-export.mjs --tree`) for exact, offline-checkable numbers. No node was moved, edited, or created.

## 1. File and pages

| Page id | Name | Top-level nodes | Note |
| --- | --- | --- | --- |
| `0:1` | `Page 1` | 0 | Empty. A whole-file `get_metadata` call lists only this stale page, so it must never be used as the inventory source. |
| `4:2` | `Home baseline @ fd4b14ff` | 46 | The baseline page at commit `fd4b14ff`: component sets, page frames, and the `HomeMoneyGroups` composition the row proof comes from. |

## 2. Page skeleton (`4:2`, all 46 top-level nodes)

| Node | Type | Name | Size |
| --- | --- | --- | --- |
| `5:10` | COMPONENT_SET | Button | 755×120 |
| `5:11` | COMPONENT | Card | 358×100 |
| `5:12` | COMPONENT | MoneyTicker | 122×40 |
| `5:28` | COMPONENT_SET | CurrencyMark | 192×80 |
| `5:29` | COMPONENT | Item | 326×56 |
| `5:108` | COMPONENT_SET | BalanceRow | 1058×96 |
| `5:160` | COMPONENT_SET | HomeBalanceRowView | 1058×96 |
| `5:161` | COMPONENT | HomeMoneyGroups | 326×376 |
| `5:204` | COMPONENT | FundingActions | 174×44 |
| `5:209` | COMPONENT | TransferActions | 174×44 |
| `5:212` | COMPONENT | HomePanel | 358×1031 |
| `5:290` | COMPONENT | HomeMark | 44×44 |
| `5:292` | COMPONENT | ProfileMark | 32×32 |
| `5:294` | COMPONENT | ShellHeader | 390×60 |
| `5:300` | COMPONENT | PrimaryNavigation | 390×56 |
| `5:312` | COMPONENT | DashboardShell | 390×784 |
| `5:404` | COMPONENT | HomeShell | 390×844 |
| `5:503` | COMPONENT | HomeExperience | 390×844 |
| `5:603` | COMPONENT | PortfolioHomeExperience | 390×844 |
| `5:704` | COMPONENT | DashboardExperience | 390×844 |
| `5:806` | FRAME | Home — funded | 390×844 |
| `5:933`–`5:949` | COMPONENT | CardHeader, CardTitle, CardAction, CardContent, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions | 160×36 each |
| `5:951`–`5:981` | COMPONENT | FundingActionsForWallet, TransferActionsForWallet, SectionHeader, GroupedBalancesList, MoneyGroupHeader, BalancesList, FinanceRow, CurrencyMarkSlot, MountedShellPanel, HomeProductTile, SavingsTeaser, AuthenticatedBorrowTeaser, ConnectedActivityPanel, ActivityPanelView, ActivitySurface, HeaderAccountAction | 180×40 each |

Page frame for orientation:

```
5:806 FRAME "Home — funded" 390x844
  └─ 5:807 INSTANCE "DashboardExperience / funded fixture" 390x844
      └─ I5:807;5:705 INSTANCE "PortfolioHomeExperience instance" 390x844
          └─ I5:807;5:705;5:604 INSTANCE "HomeExperience instance" 390x844
```

The row proof is **not** inside that page frame: it sits in the page-level component `5:161 HomeMoneyGroups`, which is the composed money card the shell embeds.

## 3. Row section inventory (`5:161` → `5:165`)

```
5:161 COMPONENT "HomeMoneyGroups" 326x376
├─ 5:162 FRAME   "CASH / MoneyGroupHeader" 326x32
│   ├─ 5:163 TEXT "group heading" 36x16   chars "CASH"
│   └─ 5:164 TEXT "group subtotal" 46x20  chars "$12.34"
├─ 5:165 FRAME   "HomeBalanceRowView / US dollar" 326x56      ← PROOF TARGET
│   ├─ 5:166 INSTANCE "CurrencyMark" 32x32 at x0  y12  radius 16
│   │   └─ I5:166;5:15 FRAME "Frame" 32x32 (white fill)
│   │       └─ I5:166;5:23 GROUP "Clip path group" 32x32
│   │           ├─ I5:166;5:21 GROUP "c" 32x32 → I5:166;5:22 VECTOR
│   │           └─ I5:166;5:16 GROUP "Group" 32x33 → 4 VECTORs (white / #EF3340 / #0452B4 / white)
│   ├─ 5:176 FRAME   "ItemContent" 222x20 at x44 y18 (VERTICAL, gap 2)
│   │   └─ 5:177 TEXT "ItemTitle" 69x20  chars "US dollar"  SF Pro Text 400 16/20, #171717
│   └─ 5:178 TEXT    "ItemTitle numeric" 48x20 at x278 y18  chars "$12.34"  SF Pro Text 600 14/20, #171717
├─ 5:179 FRAME   "More Item" 326x48
│   ├─ 5:180 TEXT "ItemTitle muted" 39x20  chars "More"
│   └─ 5:181 FRAME "ChevronRight" 16x16
├─ 5:909 FRAME   "group spacing" 326x8
├─ 5:183 FRAME   "INVESTMENTS / MoneyGroupHeader" 326x32
│   ├─ 5:184 TEXT "group heading" 93x16  chars "INVESTMENTS"
│   └─ 5:185 TEXT "group subtotal" 45x20 chars "$78.21"
├─ 5:186 FRAME   "HomeBalanceRowView / Bitcoin" 326x56
│   ├─ 5:187 INSTANCE "CurrencyMark" 26x32
│   ├─ 5:189 FRAME "ItemContent" 225x42 (title + description)
│   └─ 5:192 TEXT "ItemTitle numeric" 51x20  chars "$60.00"
├─ 5:193 FRAME   "HomeBalanceRowView / Recognized Coin" 326x56
│   ├─ 5:194 INSTANCE "CurrencyMark" 20x32
│   ├─ 5:196 FRAME "ItemContent" 234x42
│   └─ 5:199 TEXT "ItemTitle numeric" 48x20  chars "$18.20"
├─ 5:910 FRAME   "row spacing" 326x8
└─ 5:200 FRAME   "More Item" 326x48
    ├─ 5:201 TEXT "ItemTitle muted" 39x20  chars "More"
    └─ 5:202 FRAME "ChevronRight" 16x16
```

### 3.1 Computed geometry for `5:165` (metadata math, no auto-layout on the root)

The root frame has `layoutMode: HORIZONTAL` and `itemSpacing: 12`.

| Property | Value | How it was computed |
| --- | --- | --- |
| Root size | 326×56 | `absoluteBoundingBox` |
| Child order | CurrencyMark → ItemContent → ItemTitle numeric | metadata child order |
| Mark box | 32×32 at x 0, y 12 | `absoluteBoundingBox` minus root origin |
| Content box | 222×20 at x 44, y 18 | 0 + 32 + 12 = 44 (auto-layout gap), y centred |
| Value box | 48×20 at x 278, y 18 | right edge 278 + 48 = 326 = root width (right-aligned) |
| Vertical padding | 12 top / 12 bottom | (56 − 32) / 2 |
| Gap mark → content | 12 | `itemSpacing` |
| Gap content → value | 12 | 326 − 278 − 48 = 0 inset; content right edge 44 + 222 = 266, 278 − 266 = 12 |
| Mark radius | 16 (circle) | `cornerRadius` on `5:166` |
| Root fill | `#FFFFFF` | `fills[0]` |
| Text colour | `#171717` (r/g/b 0.0902) | `fills[0]` on `5:177`, `5:178` |

`ItemContent` is 222 wide **because it hugs its own content**, not because the design pins 222 px; the value is a sibling of `ItemContent` at the root level and is right-aligned to the frame edge. The shipped DOM has the same shape (media · flexible content · auto value) inside a stretching row, which is why the frame is hug-width and the DOM row is stretch-width (see `audit.md` §6).

## 4. Component inventory for the row

| Component set | Variants | Sizes |
| --- | --- | --- |
| `5:160 HomeBalanceRowView` | `Asset=US dollar` (`5:109`), `Asset=Bitcoin` (`5:126`), `Asset=Recognized Coin` (`5:143`) | 326×56 each; each wraps `BalanceRow` → `Item` instance with `itemSpacing: 12` |
| `5:108 BalanceRow` | row wrapper variants | 1058×96 set |
| `5:28 CurrencyMark` | mark variants | 192×80 set |
| `5:12 MoneyTicker` | value ticker | 122×40 |
| `5:29 Item` | base row | 326×56 |

The proof target `5:165` is a **detached frame**, not an instance of `5:160`; it is a hand-composed copy inside `5:161`. Its geometry therefore has to be cross-checked against the component set (and against the code) rather than trusted as component output — see `audit.md` §5 findings.

## 5. Mapping to code (names only; decisions live in `audit.md`)

| Figma node | Home code |
| --- | --- |
| `5:161 HomeMoneyGroups` | `client/home/balances-panel.tsx` (`BalancesPage` / `HomeMoneyGroups`) |
| `5:165` root frame | `components/finance-rows.tsx` `FinanceRow` → `Item` (`components/ui/item.tsx`) |
| `5:166 CurrencyMark` | `components/currency-mark.tsx` (`CurrencyMark size="sm"`) |
| `5:176 ItemContent` | `components/ui/item.tsx` `ItemContent` (`min-w-0`) |
| `5:177 ItemTitle` | `components/ui/item.tsx` `ItemTitle` (`text-sm leading-snug font-medium`) |
| `5:178 ItemTitle numeric` | `ItemTitle numeric truncate={false}` + `MoneyTicker` + `compactFinancialValue` |
| `5:179 / 5:200 More Item` | `Item size="sm"` "More" row (`GroupedBalancesList`) |
| `5:162 / 5:183 group headers` | `MoneyGroupHeader` (`text-xs uppercase tracking-wider`) |

Story that renders the proof target: `apps/web/client/home/balances-panel.stories.tsx`, id `pilot-financial-row--normal`, canvas URL `/iframe.html?id=pilot-financial-row--normal&viewMode=story`.

## 6. Gate check and hygiene punch-list

- Every visible node of the target section is listed above (root, three children, and the CurrencyMark instance's internals to one level below the clip group).
- Non-auto-layout frames (low-trust extraction): the `CurrencyMark` instance internals (`Clip path group`, `Group`, `c`), and the row's three text/instance children are plain children of an auto-layout root, so their gaps come from `itemSpacing`, not from x/y subtraction.
- Designer punch-list: `5:165` is a detached frame inside `5:161` that duplicates `5:160`'s `Asset=US dollar` variant; the two can drift independently. The `Clip path group` / `Group` / `c` names inside `5:166` are vector-export artefacts.
- Page-level drill-down beyond this section was intentionally not audited in this task (the issue scopes the proof to one real component).

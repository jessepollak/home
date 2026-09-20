# Storybook ↔ Paper design workflow

This pilot uses Paper file [Home — design exploration](https://app.paper.design/file/01M309G29JMQCCGPGWJCPYSBQP) as the editable review surface and Storybook or the fixture-backed Home route as the source render. Paper is a review and exploration workspace, not production UI or approval.

## Exact loop

1. Jesse comments on an exact editable frame in Paper.
2. Jesse comments on the existing GitHub issue or pull request so the existing Jesse-comment/factory trigger starts a run. Paper comments do not trigger a daemon, webhook, poller or scheduler.
3. The factory calls `list_comment_threads` with the explicit file ID and `status: "all"`, then calls `get_comment_thread` for each thread. It uses the pinned node plus `xOffset`/`yOffset` and child geometry to resolve the target.
4. The factory changes only nodes created by this issue, reads the result back with `get_jsx` and `get_computed_styles`, captures `get_screenshot` proof, and leaves Jesse's thread statuses unchanged. Paper Desktop MCP currently exposes no reply tool.
5. The factory reports every thread as **done**, **partially done**, or **needs Jesse's call** in the issue/PR handoff and links the exact Paper frame. Jesse reviews and decides in Paper.

The MCP file ID is always `01M309G29JMQCCGPGWJCPYSBQP`. Every node and page operation passes the file ID explicitly; page operations also pass the page ID. The connected Desktop MCP is host-local and must not be exposed publicly or added to repository MCP configuration.

## Current story inventory

Viewport names are the repository Storybook settings: `mobile` is 390×844, `smallMobile` is 320×844, and `desktop` is 1440×900.

### Home

| Story ID | Fixture | Viewport |
| --- | --- | --- |
| `pilot-financial-row--normal` | Production `HomeBalanceRowView`; local `$12,345.67` US-dollar row | Storybook default |
| `pilot-financial-row--loading` | Two loading balance rows | Storybook default |
| `pilot-financial-row--unavailable-value` | EUR row with unavailable value | Storybook default |
| `pilot-financial-row--long-label-large-amount` | Long label and `$123,456,789,012,345,678,901,234.56` | mobile |

There is no full production Home shell story on `main`. The accurate funded baseline therefore renders the real `/home` route with fixture authentication and `apps/web/tests/browser/balances-fixtures.ts` `balancesSnapshot("US")` at 390×844. The Paper mapping records that source SHA and the honest static-layer fidelity limits.

### Save

| Story ID | Fixture | Viewport |
| --- | --- | --- |
| `pilot-savings-experience--funded` | Two funded Morpho positions and 250 USDC available | mobile |
| `pilot-savings-experience--verified-empty` | Verified empty positions | smallMobile |
| `pilot-savings-experience--loading` | Deferred loading state | mobile |
| `pilot-savings-experience--stale-rates` | Funded positions with stale metadata | mobile |
| `pilot-savings-experience--unavailable-partial` | Partial unavailable state | desktop |
| `pilot-savings-experience--long-localized-content` | Brazil presentation with lengthened fixture labels | smallMobile |
| `pilot-savings-money-dialog--amount-entry` | Deterministic available balances and Gauntlet vault | mobile |
| `pilot-savings-money-dialog--validation-failure` | Invalid amount | mobile |
| `pilot-savings-money-dialog--review` | Prepared deposit review | mobile |
| `pilot-savings-money-dialog--pending` | Pending dispatch | mobile |
| `pilot-savings-money-dialog--failure-recovery` | Simulated failure and retry | mobile |
| `pilot-savings-money-dialog--back-and-cancel` | Back/cancel behavior | mobile |
| `pilot-savings-money-dialog--reduced-motion-reference` | Stable reduced-motion reference | mobile |
| `journeys-savings-deposit--deposit` | Production Savings components, MSW vault metadata, funded positions, 250 USDC available, $25 deposit play flow | mobile |

### Invest, Borrow and Fund

`main` has no page or journey Storybook stories for Invest, Borrow or Fund. Their production routes, components and tests are not relabelled as stories. This inventory records the gap rather than inventing IDs.

## September 20 B revision

Jesse rejected E1–E5 and is working from B. This run deleted only E1–E5 and their intent notes, kept the Candidates page unchanged, added the real-main baseline, and created a separate `B revisions — Sep 20` page.

B2 keeps B's white canvas, strong balance typography, gray Cash surface, blue Fund action, plain balance rows and Activity-at-bottom hierarchy. It merges available cash and savings into one Cash item, adds a Cash L2, replaces Buy/Sell with an investment balance position, gives Borrow a numeric position, restores the segmented allocation line, and keeps Activity as an L2 entry.

Financial qualifications are intentional:

- The fixture supports **4.04% as the weighted savings APY** on $1,000.00, not as verified yield on all $1,250.00 of Cash. B2 labels that scope.
- The B fixture does not contain an investment balance or verified empty investment state. B2 shows an unavailable value rather than inventing `$0.00`.
- The canonical funded fixture has verified debt of `$0.00`; a separate `B2 — debt` frame uses the existing `$500.00` debt fixture and a `$750.00` net headline.
- The fixture has one dated balance snapshot, not a historical series. `B2 — chart` uses editable vector layers, labels itself `Snapshot only`, and does not invent a trend.
- The Cash L2 includes only the funded USDC facts. It demonstrates structure for later currencies/stablecoins without fabricating holdings.

Fresh rendered Fable critique found type and icon drift, inconsistent signed-line money formatting, weak Cash L2 amount hierarchy, and a chart line that implied unsupported history. The final Paper frames restore Inter, replace text glyphs with editable SVG icons, normalize `Savings` and cent formatting, right-align vault balances, clarify the Cash/USDC section heading, and leave only the single verified chart point. Invest and no-debt Borrow remain explicitly partial because the fixture supplies neither an investment total nor an underwriting offer.

## Baseline fidelity

The source capture is the real `main` `/home` route at 390×844 with fixture-authenticated production components and the repository balances fixture. DOM and computed styles were captured before reconstruction. The Paper baseline matches the visible header, `$90.54` total, segmented Cash/Savings/Investments line, actions, money groups and navigation.

Paper differences are explicit: the Homemark, flag and navigation icons are simplified editable shapes/glyphs; browser image/SVG assets were not flattened into the frame; the frame is a static reconstruction and does not reproduce scroll, loading or runtime interactions. The exact frame-level notes and read-back styles are in `paper-mapping.json`.

## Thread handling

All nine Jesse threads were read directly from Paper and left open:

| Thread | Resolved target | Disposition before Jesse review |
| --- | --- | --- |
| `c-8quwzh` | B header / Homemark | done — Homemark retained |
| `c-ukdwz1` | `Net position` label | done — removed |
| `c-jn85dy` | `Cash + savings · No debt` caption | done — removed |
| `c-l3uk4i` | Available cash + Save | partially done — merged Cash and Cash L2 are present; all-Cash APY semantics and future multi-currency conversion need Jesse/product rules |
| `c-mrse5h` | Invest Buy/Sell controls | partially done — controls removed; a compatible investment fixture is still missing |
| `c-j131x1` | Borrow row | partially done — verified `$0.00` and separate `$500.00` debt state shown; no verified offer amount exists |
| `c-njxp3v` | Segmented line / debt / chart | done for layout exploration — positive allocation, signed debt frame and honest snapshot-only vector chart are present; historical data remains a product prerequisite |
| `c-rk72yq` | Activity | partially done — bottom placement and L2 affordance shown; infinite pagination is interaction intent, not proven by a static Paper frame |
| `c-wcgnkv` | inaccurate baseline | done — replaced by a separate real-main fixture render; old Astra frame remains unchanged as comment history |

Jesse's threads are not resolved or status-changed by the factory. Jesse decides whether the partial treatments are sufficient.

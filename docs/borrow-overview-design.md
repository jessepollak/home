# Borrow overview and loan management — proposal (#940, unreviewed)

This is an exploration of [#940](https://github.com/jessepollak/home/issues/940). Jesse selects or refines it, and nothing here is approved. Production Borrow (`client/borrowing/borrowing-experience.tsx`, [Borrow](borrow.md)) is unchanged.

The design-lane code lives under `apps/web/client/borrowing/explorations/`. It covers the model (`borrow-overview-model.ts`), the surface (`borrow-overview.tsx`), and the exploration stories. The journey is in `apps/web/stories/journeys/borrow-overview.stories.tsx`. Production modules never import any of it.

The surface composes production pieces:
- `AssetRow`, `Card`, `HomeSectionHeading` and `MoneyTicker`
- `LiquidationBufferMeter`
- `AppDrawer` / `MoneyModalHeader`
- the real `BorrowMoneyDialog`, mounted through `deferSheet`

## Figma

The section [`Borrow proposal (#940, unreviewed)`](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=438-22134) (`438:22134`) is alone on the [Borrow page](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=333-13087) (`333:13087`). Its frames are built from Components-page instances.

**A — recommended:**
- overview `438:22433`
- Bitcoin loan sheet `438:22521`
- urgent sheet `438:22612`
- zero-debt sheet `438:22676`
- borrow-against sheet `438:22719`
- desktop `438:23044`

**B — alternative:**
- overview `438:23361`
- loan sheet `438:23444`

**States:**
- empty `438:23734`
- partial `438:24073`
- unavailable `438:24134`
- loading `438:24259`
- reducing-only sheet `438:24336`
- large amount `438:24592`

**Motion and notes:**
- Motion frame `441:5563` holds the GIF over the settled still, three stills, and the timing and easing.
- Notes `441:5582`.

**Design-only pieces:**
- The `LiquidationBufferMeter` drawing (the code owner is `LiquidationBufferMeter`).
- Additive `CurrencyMarkSlot` variants `Kind=Dogecoin`, `Kind=XRP` and `Kind=Cardano` (`437:4404`, `437:4410`, `437:4416`). Code renders the real token images.

The library needs publishing only if Jesse selects this direction. The private Mobbin references are the group `Borrow overview + loan management (#940)` (`442:4404`) inside References `174:2891`.

## Hierarchy

Both directions show the same data in the same order.

1. **Borrowed.** The summary shows the priced total with the debt-weighted APR beneath it.
   - With no debt, it shows `$0.00` and "No open loans", with no APR.
   - With partial data, the total is muted and followed by "… APR on loans we could check" and a Retry.
   - When no market could be verified, the summary shows the unavailable state ("—" and Retry), never a zero total, and the collateral section is hidden.
   - With no data at all, it shows "—" and an error alert.
   - It never shows a portfolio health average.
2. **Open loans.** Each position is an `AssetRow`, and the whole row is the tap target.
   - Order: urgent and liquidatable loans first, then by health factor, then by market rank. Zero-debt collateral comes next, labelled "Collateral available", with "No debt" in the value column. Unreadable positions come last.
   - Each isolated market keeps its own row.
3. **Assets you can borrow against.** Held, enabled assets with no position and positive borrowing capacity come first. Their row reads "In wallet · APR" and shows the borrowing capacity as "Available".
   - Held assets with zero opening capacity follow as inert rows. The value column shows the wallet collateral marked "In wallet", and the row names the reason: "No USDC to borrow now" when the market has no liquidity, otherwise "Too little to borrow". They count as owned, so the add-asset hint is not shown.
   - Assets not in the wallet are inert rows. When nothing is held, a one-line hint replaces the "Not in wallet" suffix.
   - Reducing-only markets without a position are excluded.
   - Wallet collateral and pledged collateral are never added together.

**A and B differ in two places:**
- **Rows.** A uses tier words: Healthy, Low buffer, Urgent, At risk. B shows the buffer as a number, such as "47% buffer".
- **Loan sheet.** A pins Repay · Borrow more / Add collateral · Withdraw in the footer and keeps technical fields behind Details. B puts Repay and Borrow more under the hero, shows every fact, and places the collateral actions at the bottom.

**Prototype conventions:**
- The summary total is a priced display value. Stories pass it as `summaryDisplay`, standing in for Home's existing borrow valuation. Without it, the surface falls back to exact units ("1,750.50 USDC"). Rows always show exact units.
- The page title is the shell's nested header ("Borrow" with Back), so the in-content `h2` is screen-reader only.
- The zero-debt sheet leads with the pledged collateral ("Collateral" · amount · "No debt") because withdrawing is its primary safe exit.

## Derivations

These live in the prototype model (`borrow-overview-model.ts`):

- **Total debt:** the bigint sum of `position.debtAssetsRaw` over available snapshots with debt. Every loan must use the same loan token; the model throws otherwise.
- **APR:** `Σ(debtRaw × borrowAprWad) / Σ debtRaw`. It is `null` when there is no debt.
- **Completeness:** `complete` only when discovery is complete and every opportunity is available.
- **`loanActions(snapshot)`:** copies the current `BorrowCardActions` enable rules exactly. The reason line is chosen in this order: reducing-only, then urgent, then "Add USDC to your wallet to repay."

At adoption, this model and Home's private `weightedBorrowAprWad` (`shared/balances/present.ts`) should share one weighted-APR core so Home and Borrow agree. Home weights by priced value. The prototype weights by raw USDC, and every current loan is USDC.

## Interaction contract

- **Row to sheet.** Tapping a row opens a single management sheet. The sheet stays mounted and only `open` toggles, so the shared Drawer entrance runs.
- **Sheet to money flow.** An action closes the sheet. After its exit, the existing `BorrowMoneyDialog` opens. It is mounted closed and opened on the next frame, so its entrance also runs. Only one drawer is open at a time.
- **Money flow back to sheet.** Closing the dialog, by cancel, back-out or success, reopens the sheet for the same market with the current snapshot. Focus goes to the button that launched the action. If the position no longer exists, focus goes to the summary.
- **Closing the sheet.** Close, Escape or swipe returns focus to the row. The page never unmounts, so the scroll position is kept.
- **Borrowing against a held asset.** A held-asset row opens a sheet with a Borrow button, so starting to borrow takes a deliberate second tap.

## Motion

The only motion is the shared Drawer:
- 350 ms popup, `cubic-bezier(0.22, 1, 0.36, 1)`
- overlay `cubic-bezier(0.32, 0.72, 0, 1)`
- swipe exit takes swipe-strength × 400 ms

Row press changes the background colour only. The Details chevron rotates in at most 180 ms and is removed under reduced motion. Amounts never animate. The sequential handoff takes about 1.1 s from tap to numpad.

Reduced motion drops Drawer transitions to 0 ms through the shared `motion-reduce` classes. The shared modal lifecycle and its entrance repair belong to [#934](https://github.com/jessepollak/home/issues/934). The prototype's closed-then-open staging only mirrors what `deferSheet` already does on cold loads, and #934's shared fix supersedes it.

## Adoption slices

1. **Model and overview rows** (owner: `client/borrowing`).
   - Replace `BorrowMarketCard` with the summary and the two row lists, and delete the replaced card code.
   - Update `journeys-borrow-multi-market`, `borrowing-experience.test.tsx` and [Borrow](borrow.md).
   - Extract the shared weighted-APR core.
   - Take the summary's priced display from the existing Home valuation (#794 contracts).
   - Keep `useBorrowOverview` caching and the mounted shell panel unchanged for [#825](https://github.com/jessepollak/home/issues/825).
2. **Management sheet and handoff.**
   - Move the sheet and the sequential handoff into production after #934's shared lifecycle fix lands, or review it with #934's owner.
   - Drop the prototype staging.
   - Consider a `finalFocus` or `initialFocusRef` contract on `AppDrawer` instead of focusing by hand.
3. **Contract follow-ups.**
   - The current overview parser rejects a position whose market is unavailable. Rendering an "unreadable loan" row needs that contract reconciled.
   - `FinanceRow`'s value column never truncates, so a 12M+ debt row clips at 320 px.
   - `FinanceRow` always emits `attention` as screen-reader text next to the visible context.
   - If a market becomes unavailable while its money flow is open, the prototype reopens the sheet with the last snapshot it read. Production should show the unavailable state instead.

Nothing here changes money execution, risk policy, registry admission or the existing Max/repay-all semantics.

## Stories

**Exploration** (`explorations-borrow-overview--*`):
- `multiple-loans`, `alternative-b-multiple-loans`, `one-loan`, `urgent-first`
- `reducing-only`, `zero-debt-collateral`, `no-debt-held`, `empty-no-collateral`
- `partial`, `unverified`, `unavailable`, `loading`, `long-label-large-amount`
- `management-sheet-open`, `management-sheet-urgent`, `alternative-b-management-sheet`
- `market-sheet-held`, `zero-debt-sheet`
- `desktop`, `narrow-320`, `reduced-motion-reference`

**Journey** (`journeys-borrow-overview--*`):
- `repay-review-cancel-back`, `repay-success-updates`, `repay-all-max-clears-loan`, `borrow-max-respects-market-liquidity`, `repay-pending`, `repay-failure-recovery`
- `collateral-borrow-entry-back`, `not-held-rows-inert`, `held-zero-capacity-inert`, `urgent-sorted-first`, `zero-debt-opens`, `zero-debt-full-withdraw-returns-asset`

These stories prove fixture-backed scenarios only. They are not Home routing, app scroll, wallet, provider or real-money verification.

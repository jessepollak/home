# Borrow overview and loan management — adopted Direction A (#1004)

The exploration in [#940](https://github.com/jessepollak/home/issues/940) was approved as Direction A and adopted by [#1004](https://github.com/jessepollak/home/issues/1004). The production surface, model and stories are `apps/web/client/borrowing/borrow-overview.{tsx,stories.tsx}` and `borrow-overview-model.ts`; `borrowing-experience.tsx` supplies the existing overview query. The fixture-backed journeys are `apps/web/stories/journeys/borrow-overview.stories.tsx` and `borrow-multi-market.stories.tsx`. Direction B's numeric buffer rows and inline sheet actions were not adopted.

The source Figma frames remain on the [Borrow page](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=333-13087): Direction A overview `438:22433`, Bitcoin sheet `438:22521`, urgent sheet `438:22612`, zero-debt sheet `438:22676`, held-asset sheet `438:22719`, and desktop `438:23044`. State references: empty `438:23734`, partial `438:24073`, unavailable `438:24134`, loading `438:24259`, reducing-only `438:24336`, large amount `438:24592`; motion `441:5563`. The design-only CurrencyMarkSlot Dogecoin, XRP and Cardano variants are not a production dependency; production renders token images.

## Hierarchy

1. **Borrowed.** The summary displays Home's priced debt value only if both the Borrow overview and Home's valuation are complete and describe the same loans: the same markets with debt, each within one loan-token cent of the overview's exact debt. Otherwise, including after a Borrow action before Home's balances refresh, it uses the exact total in loan-token units. A complete debt-free overview shows zero in the region's display fiat currency and “No open loans”; partial discovery shows a muted known total, qualified APR and Retry. When nothing was verified, or the read failed without data, it shows “—”, an alert and Retry—not a fabricated zero. A refresh failure with stale data keeps the stale rows and shows “Borrow data could not be refreshed” above them. No portfolio health average is shown.
2. **Open loans.** A whole-row target opens each market's management sheet. Liquidatable and urgent debt leads, then other debt ordered by health factor and registry rank. Zero-debt pledged collateral follows with “Collateral available” and “No debt”; rows always use exact token units. A known but unreadable position would follow last when the parser can admit it.
3. **Assets you can borrow against.** Held enabled assets with positive opening capacity show “In wallet · APR” and available loan-token units, followed by held assets with no opening capacity as inert rows with a reason and wallet collateral units. Unheld assets are inert. Reducing-only markets without a position are excluded; pledged and wallet collateral are not combined.

When discovery is complete and there is no debt or pledged collateral, Borrow shows only the shared `FeatureIntro`: the zero Borrowed summary and the inline asset list are hidden. Its primary action opens the asset picker in a bottom sheet (`AppDrawer`) with the same asset rows: “Choose an asset” when an eligible asset is held, otherwise “See supported assets,” whose sheet lists inert supported assets under “Add a supported asset to your wallet to borrow USDC.” Picking a held asset closes the picker and opens that market’s management sheet; closing either sheet returns focus to the intro action. The intro explains collateral, variable borrowing costs and liquidation risk without implying that an unheld asset can be borrowed against. Partial, unavailable, loading and existing-position states do not show it.

Direction A uses the words Healthy, Low buffer, Urgent, At risk (and “· Paused” where applicable) rather than Direction B's numeric row buffers. The in-panel Borrow heading is screen-reader only because the shell already supplies a visible Borrow header and Back.

## Derivations

`borrow-overview-model.ts` sums `debtAssetsRaw` over verified available snapshots; a different loan token among nonzero loans is an error. Its APR weights each rate by raw loan-token debt, using `shared/borrowing/math.ts`'s `weightedAprWad` core. Home's valuation uses the same core with its existing priced-value weights (or normalized raw debt when any value is unpriced). Complete means complete discovery and available entries; zero verified markets is unavailable. `loanActions` retains the former card's market, risk, liquidity and wallet gates.

## Interaction contract

- The whole loan or held-asset row opens one management sheet, named by collateral, with a pinned footer. Debt actions are Repay · Borrow more / Add collateral · Withdraw. A zero-debt pledged position leads with its collateral and offers Withdraw, Borrow and Add collateral. Technical facts are behind Details.
- Choosing a footer action closes management first; after its exit the deferred Borrow money dialog opens. The shared Drawer lifecycle animates a dialog mounted open, so the prototype's closed-then-next-frame staging is not used. Only one drawer is open at a time.
- On cancelling, backing out or completing money flow, a position still available reopens with its current snapshot. Focus returns to the launching action (or the sheet summary when it is disabled); closing management returns focus to the row. If the market becomes unavailable during a flow, or the position is gone, management does not reopen from stale data and focus returns to Borrowed. The mounted page preserves overview scroll.
- The configured `/borrow/<marketId>` direct-market entry remains a separate flow. Neither query freshness nor mounted shell panel behavior changes under #1004; [#825](https://github.com/jessepollak/home/issues/825) owns return performance.

## Motion and verification

The shared Drawer owns its 350 ms popup, overlay and swipe exit, with zero-duration reduced-motion overrides. Rows only change background on press; Details rotates its chevron in at most 180 ms and reduces motion. Storybook component and journey tests verify fixture-backed behavior, not routing, provider signing, real funds, or physical-device behavior.

## Residuals

- An unreadable-loan row is blocked by the current overview parser contract: it rejects a position whose market snapshot is unavailable. Reconcile that shared contract before presenting one; do not synthesize a position.
- `FinanceRow` emits the attention label a second time for screen readers next to its visible context. Resolve in its owned component rather than a Borrow-only override.
- At 200% text the Borrowed summary amount scrolls horizontally inside `MoneyTicker` instead of wrapping. Finance rows already stack and wrap at that size.

No money execution, registry admission, calldata builder or risk policy was changed by this adoption.

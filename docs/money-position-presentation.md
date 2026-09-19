# Money position presentation contract

Status: Jesse-selected component design contract for [issue #634](https://github.com/jessepollak/home/issues/634). This contract does not change balances, protocol accounting, providers, action authority, or money movement. The proposal remains isolated in Storybook until a separate implementation leaf integrates it.

## Customer model

Every verified amount appears once according to its current job:

| Slice | Included in assets | Available to use | Required presentation |
| --- | --- | --- | --- |
| Cash | Yes | Yes | Available |
| Saved | Yes | No | Saved & invested; show the applicable rate only when verified |
| Invested | Yes | No | Saved & invested; identify as market value |
| Collateral | Yes | No | Committed; explicitly **locked, not available to spend** |
| Card allocation (future) | Yes | No | Committed; allocated to card and not in cash |
| Debt | Subtracted from position | No | Owed; display as a negative amount |

A transfer between slices does not create wealth. Posting collateral moves an asset into the collateral slice instead of duplicating it in cash or investments. Borrowing may add proceeds to cash only with matching debt; therefore `net position = assets − debt` does not rise from the borrow itself.

The Borrow position header is narrower than the whole-account headline: `position after debt = collateral − debt`. Cash, saved, invested, and card slices never enter that fact. If collateral or debt is unavailable, Position after debt is unavailable rather than zero or a partial calculation.

## Headline decision

Jesse selected **Net position** for issue #634. Net position is the only headline in the component contract; assets and positive or unavailable debt remain visible as supporting facts. Verified zero debt is omitted.

The reason is the borrowing invariant: borrowed proceeds may increase cash and assets, but matching debt increases by the same amount, so borrowing cannot raise the headline. The assets-first alternative has been removed from the production component API and Storybook. The selected direct Storybook ID is `proposal-money-position--net-position`.

## Completeness and recovery

- A complete headline requires every included asset slice and debt to be verified. Missing debt is never zero.
- If any slice is unavailable, the headline is `Unavailable`, known slices stay itemized, and the status names every missing slice.
- Stale amounts remain itemized and name the last-verified source; they do not silently read as current. When missing and stale sources coexist, the status names both sets. Save/Borrow tiles and every Borrow header fact carry the same last-verified label, including Position after debt when collateral or debt is stale.
- Verified zero debt is omitted from the hero and Owed list. Positive or unavailable debt remains explicit.
- Empty state shows zero position and leads to Add money through an injected callback; the proposal owns no action authority.
- Exact integer minor units and an explicit `quoteCurrencyMinorUnitScale` feed the shared fiat formatter. USD fixtures use scale 2 and CLP proves scale 0; presentation code does not use floating-point arithmetic.
- Long labels and values wrap within the component at 390 CSS px and 200% text zoom; financial values do not animate.

## Review scenarios

`apps/web/client/home/money-position-proposal.stories.tsx` covers the selected Net position headline, empty, cash only, a zero-decimal quote currency, saved only, invested only, collateral without debt, collateral plus debt, future card allocation, partial plus stale, unavailable, long-value, Save/Borrow tiles, and the Borrow position header. Dedicated stale tile/header and unavailable Borrow-header stories verify last-verified propagation and derived-value withholding. Stories render the production components (`MoneyPositionProposal`, `MoneyPositionProductTiles`, and `BorrowPositionHeaderProposal`) and make no network or provider request. Supporting direct IDs include `proposal-money-position--stale-save-and-borrow-tiles`, `proposal-money-position--stale-borrow-position-header`, and `proposal-money-position--unavailable-borrow-position-header`.

A separate implementation leaf must map reconciled Home/Save/Invest/Borrow/Card sources into this selected contract, prove each source is counted once, and verify the same production component in Home under `docs/browser-validation.md`. That follow-up—not this proposal—owns integrated routing, recovery, and Back behavior evidence.

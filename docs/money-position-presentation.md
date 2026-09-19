# Money position presentation contract

Status: unreviewed component proposal for [issue #634](https://github.com/jessepollak/home/issues/634). This contract does not change balances, protocol accounting, providers, action authority, or money movement. The proposal remains isolated in Storybook until Jesse selects a headline and approves integration.

## Customer model

Every verified amount appears once according to its current job:

| Slice | Included in assets | Available to use | Required presentation |
| --- | --- | --- | --- |
| Cash | Yes | Yes | Available |
| Saved | Yes | No | Growing; show the applicable rate only when verified |
| Invested | Yes | No | Growing; identify as market value |
| Collateral | Yes | No | Committed; explicitly **locked, not available to spend** |
| Card allocation (future) | Yes | No | Committed; allocated to card and not in cash |
| Debt | Subtracted from position | No | Owed; display as a negative amount |

A transfer between slices does not create wealth. Posting collateral moves an asset into the collateral slice instead of duplicating it in cash or investments. Borrowing may add proceeds to cash only with matching debt; therefore `net position = assets − debt` does not rise from the borrow itself.

## Headline alternatives awaiting Jesse

Both deterministic stories use the same derived amounts and preserve the borrowing invariant:

1. **Net position** — net position is primary; assets and debt remain visible as supporting facts.
2. **Assets and debt** — assets are primary; debt and **Position after debt** are simultaneously visible. Assets alone must never be described as balance, wealth, or available money.

Selecting one alternative is a product decision, not an implementation default. Direct Storybook IDs are `proposal-money-position--net-position` and `proposal-money-position--assets-and-debt`.

## Completeness and recovery

- A complete headline requires every included asset slice and debt to be verified. Missing debt is never zero.
- If any slice is unavailable, the headline is `Unavailable`, known slices stay itemized, and the status names every missing slice.
- Stale amounts remain itemized and name the last-verified source; they do not silently read as current.
- Empty state shows zero position and leads to Add money through an injected callback; the proposal owns no action authority.
- Exact integer minor units feed the shared fiat formatter. Presentation code does not use floating-point arithmetic.
- Long labels and values wrap within the component at 390 CSS px and 200% text zoom; financial values do not animate.

## Review scenarios

`apps/web/client/home/money-position-proposal.stories.tsx` covers empty, cash only, saved only, invested only, collateral without debt, collateral plus debt, future card allocation, partial, unavailable, long-value, both headline alternatives, Save/Borrow tiles, and the Borrow position header. Stories render the production components (`MoneyPositionProposal`, `MoneyPositionProductTiles`, and `BorrowPositionHeaderProposal`) and make no network or provider request. Supporting direct IDs are `proposal-money-position--save-and-borrow-tiles` and `proposal-money-position--borrow-position-header`.

After headline approval, a separate implementation leaf must map reconciled Home/Save/Invest/Borrow/Card sources into this contract, prove each source is counted once, and verify the same production component in Home under `docs/browser-validation.md`. That follow-up—not this proposal—owns integrated routing, recovery, and Back behavior evidence.

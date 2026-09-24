# Activity valuation

Home Activity shows a fiat value above the native quantity for each transfer row on Home and on the full Activity page, for example `+$12.34` above `+5,678 TEST`. This document is the valuation contract Jesse approved on September 23, 2026 (issue #739), and the evidence the implementation follows.

## Time basis

Transaction history uses the value at transfer time. Home never substitutes today's spot price for a historical value, and a transfer row never changes because today's market moves.

| Asset | Method | Quote |
| --- | --- | --- |
| Verified USD stablecoin (canonical Base USDC) | Peg | 1 token = 1 USD |
| Verified local stablecoin (EURC, IDRX) | Peg | 1 token = 1 unit of its currency, converted at the transfer day's FX rate when the presentation currency differs |
| Any other token with known decimals | Historical close | Transferred quantity × the latest completed Codex 15-minute USD close at or before the block timestamp |

- Pegs apply only to the exact verified contracts in `config/portfolio-assets.ts` (`canonicalUsdcAsset`, `verifiedLocalCashAssets`). A token that merely shares a symbol is valued as a volatile token by its own contract.
- Save vault shares are not stablecoins. Their share price moves, so they use the historical-close path and show only the native quantity when Codex has no qualifying close.
- A close qualifies when its bar has fully closed (`bar start + 15 minutes ≤ block timestamp`) and closed at most **1 hour** before the block timestamp. Codex `getBars` runs with `removeEmptyBars: true`, so a thinly traded token without a trade in that hour has no qualifying close.
- Valuation uses the transferred quantity and the transfer's exact chain and contract. It never uses the wallet's current balance, so tokens the wallet no longer holds are priced the same way.

## Currency

Activity follows the account presentation currency convention: `presentationMoneyMetadata(regionId).currency`, which is USD for US and Global. The client sends `currency` on `GET /api/activity`; the handler accepts only the supported fiat codes and defaults to USD. Every page and every valuation carries its currency explicitly, and the client rejects a page whose currency differs from the one it requested.

The response carries `version: 1` (`ACTIVITY_CONTRACT_VERSION` in `apps/web/shared/activity/contract.ts`), the first shape with `currency` and per-transfer `valuation`. The client rejects any other version rather than inferring the shape from its fields.

Conversion uses the Coinbase daily rate for the transfer's UTC date (`GET https://api.coinbase.com/v2/prices/{BASE}-{QUOTE}/spot?date=YYYY-MM-DD`):

- Historical closes are USD, so a non-USD presentation multiplies by the `USD-{currency}` rate for that day.
- A pegged stablecoin in a different presentation currency multiplies by the `{peg}-{currency}` rate for that day. A stablecoin whose peg matches the presentation currency needs no FX.
- Completed UTC days are fixed. For a transfer on the current UTC day, Coinbase's dated rate is still forming, so Home marks that rate provisional in transaction details and refreshes it at most once a minute until the day closes.

## Unpriced transfers

A transfer is always shown. When Home cannot value it, the row shows only the signed native quantity, and transaction details give the reason:

| Reason | Meaning |
| --- | --- |
| `unknown-token` | Token decimals or symbol are unknown |
| `no-recent-close` | No completed Codex close within 1 hour before the transfer |
| `quote-unavailable` | Codex is not configured, failed, or timed out |
| `fx-unavailable` | The required daily FX rate is unavailable |

Home never shows `$0.00` for an unpriced transfer, never treats an unknown token as USDC, and never falls back to a current price.

## Presentation

- The row shows the signed fiat value as the primary amount and the signed native quantity below it through the shared `ActivityRow` `valueContext`. Rows carry no "estimated" label.
- Sent transfers use `−`, received transfers use `+`, and self transfers have no sign, so a self transfer never reads as income.
- A positive value below one cent shows as `<$0.01` (or the local equivalent), never as zero. The native quantity uses Home's shared token presentation rules.
- Transaction details keep the exact native amount and add the same value shown on the row, the method (peg or historical close), the quote time and unit price for a close, and the FX pair, rate, date, and provisional state when FX applies.

## Math, batching, and caching

- Amounts stay exact: base units, the Codex close lexeme, and the FX rate are multiplied as bigint fractions and rounded to 18 decimal places while preserving any positive value (`computeActivityValuationAmount` in `shared/activity/valuation.ts`). The client parser recomputes the amount and downgrades any inconsistent valuation to unpriced instead of dropping the transfer.
- The activity reader values each page once, after token metadata resolves. It sends at most one aliased Codex `getBars` request per page (up to 25 buckets) and at most one Coinbase request per distinct currency pair and UTC date, four at a time. Rows never call a provider.
- Codex closes are cached per process by chain, contract, hour bucket, and USD (`8453:{contract}:{hour}:USD`). Each bucket fetches bars from 75 minutes before the hour to the end of the hour and keeps only bars that had closed when fetched. Settled buckets are cached for 24 hours; recent buckets for 60 seconds or until the next 15-minute bar closes, whichever comes first, so a newly completed close is never hidden by a stale snapshot. Failures are not cached. FX rates are cached by pair and date: 24 hours for completed days and 60 seconds for the current day.
- Valuation has a 3.5-second budget per page (3 seconds per provider call). When the budget runs out or a provider fails, the page still returns: stablecoins whose peg matches the presentation currency keep their value, and every other row is `quote-unavailable`. When the budget expires Home aborts in-flight FX requests and starts no further ones; the single batched Codex request per page is shared with concurrent pages only while no new 15-minute bar has closed since it started, and runs to its own 3-second timeout. When a later refetch of an already valued transfer hits a transient failure, the client keeps the known value for the same owner, window, and currency.

## Configuration

Valuation reuses the server-only `CODEX_API_KEY` from [Codex prices](codex-prices.md) and Coinbase's public price endpoint. No new variable or paid provider is required. Without `CODEX_API_KEY`, volatile tokens are unpriced and pegged stablecoins still show their value.

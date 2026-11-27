# Activity: shown rows through a full reload

Status: implemented for one item of [#2238](https://github.com/jessepollak/home/issues/2238). Second-panel retention (#2326) is unchanged; this covers only a full reload. [Balances](balances.md#best-known-balances) holds the product rule.

## Rule

A full reload keeps the Activity rows shown before it for the same owner and presentation currency, even when the first live read after the reload is shorter. An owner switch or sign-out drops them.

- **One shown set per owner and currency.** The query `[owner, "activity-shown", currency]` holds `{ windowEnd, walletAddress, currency, transfers, cards }`: the rows last displayed for that currency, stamped with the latest Activity window they were shown for. It persists with the owner cache. It is not keyed by window, so a reload that starts a different window (minute start versus a refreshed exact time) still finds it. Two persisted sets are never merged: each write replaces the set, and switching currency removes the sets for other currencies.
- **The live row always wins.** The shown set only adds rows whose ID is missing from the page the panel already shows (the live pages with their in-memory retention, or an exact-key restore). A row present in both is shown exactly as the live page has it, including its valuation and status. Shown-set rows never enter the Activity query data, so they never feed another window's seed or carry-forward, and no price is borrowed from them.
- **Supplement only.** Shown-set rows appear only beside a page. With no page (first read pending or failed), the panel shows today's loading or can't-load state; no state is added.
- **Writes wait for restore.** The shown set is written only after this owner's persisted-cache restore has settled, so a fast shorter read cannot write a newer, smaller set that makes the restore skip the persisted one.
- **Trusted only after parsing.** A restored set must match the owner's wallet and the key's currency, and every transfer must parse under the Activity contract for the stamped window. Card rows must parse as card purchases. Anything else is treated as no set.
- **Bounded.** A write keeps the newest 500 transfers and 500 card rows.

## State table

States are per owner O and currency C. P is the page the panel shows without the shown set; R is the shown set; display is P plus every row of R whose ID is not in P.

| # | State → state | Event | Shown | Unavailable, failed, partial | Second tab or panel | Owner switch or sign-out | Check |
|---|---|---|---|---|---|---|---|
| 1 | none → held | First read succeeds after restore settles with no set | P; R written from P, stamped `P.window.to` | First-read failure shows can't-load; nothing written without P | Second panel reads the same query | Boundary clears memory and disk | `activity-recovery.pw.ts` existing first-read cases |
| 2 | restoring → held | Restore lands before the live read | Restored exact-key pages (if any) plus R | Live read then fails: P (restored pages) plus R; no P: can't-load | Same query key in every panel | Revision check discards a late restore after a switch | Playwright: reload after shorter read |
| 3 | restoring → held | Shorter live read lands before restore | P only, writes held; then P plus R once restore lands; then R rewritten from the display | Live read unavailable with no P: can't-load | Same | Same | Playwright: restore delayed until after the shorter read |
| 4 | held → held | Reload starts a different window than R's stamp (same minute after a refresh) | P plus R's missing rows, including rows newer than P's window; stamp stays the later window | Same as 2 or 3 | Same | Same | Playwright: refresh, shorter read, same-minute reload |
| 5 | held → held | Live read returns a row in R | The live row, never R's copy (valuation and status from live) | Unavailable live page has no transfers, so R's transfer stays until a healthy read | Same | n/a | Playwright: conflicting valuation, live wins |
| 6 | held → held | Live read omits a row in R | R's row | Same | Same | n/a | Playwright: reload after shorter read |
| 7 | held → held | Load more returns a row already in R | One row (ID dedupe), live copy | Load-more failure keeps R rows | n/a | n/a | none (ID dedupe in the display merge) |
| 8 | held → held (other currency) | Currency changes C → C′ | Only C′'s set applies; C's set is removed on the first C′ write | Same | All panels share the region's currency | n/a | Playwright: wrong currency rejected |
| 9 | held → none | Owner switch or sign-out | New owner's rows only | n/a | Every tab follows the owner fence | Memory and disk cleared; restore-settled flag reset; wallet mismatch rejected by parser | Playwright: owner switch drops rows; wrong-owner set rejected |
| 10 | restoring → none | Persisted set fails parsing, wrong wallet, wrong currency, or older than the cache TTL | P only | n/a | n/a | n/a | Playwright: wrong owner, wrong currency |
| 11 | held → held | Two tabs write the owner cache | Each tab shows its own display; the next reload restores whichever whole cache committed last | n/a | Last committed owner cache wins; sets are never merged | n/a | none (owner cache lease) |

Unavailable is never empty: an onchain-unavailable page carries no transfers, so R's transfers remain until a healthy read returns or omits them.

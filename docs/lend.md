# Lend

Direct Lend is separate from Save. Save deposits into a selected managed vault; Lend supplies the loan asset directly to an operator-verified Morpho market and earns that market's variable lender rate.

Signed-in users open Lend at `/dashboard?panel=lend`. The Home card and panel render every market with a Lend capability from the verified Morpho registry. Each card shows the loan asset, current variable supply rate, wallet balance, supplied balance, and currently liquid withdrawal amount. Owned supply-share positions remain visible when new supply is paused, indexed assets round to dust, or market liquidity is zero.

Supply and withdrawal are amount-first MoneyModal flows. The client submits only the configured market id, server-defined operation, and exact base-unit amount. Preparation re-reads the authenticated owner and pinned market state, validates limits and capability, constructs exact approvals and Morpho calls, and simulates the complete smart-account batch. Confirmation shows the prepared movement, current variable rate, Base network, and concise rate/liquidity warnings.

Withdrawal Max uses share-based `withdraw-all` only when the displayed full position is liquid and the server successfully prepares that operation. A liquidity-bounded Max remains an exact partial asset withdrawal. Share-based full withdrawal is labeled as full and its received amount is estimated; exact partial withdrawal is never described as Max or full. Preparation remains authoritative if liquidity or share value changes.

Lend reuses the additive `lending` sections of `GET /api/borrow` and `GET /api/borrow/markets/:marketId`; there is intentionally no `/api/lend`. See [Verified Morpho markets](morpho-markets.md) for registry, math, RPC, and capability boundaries.

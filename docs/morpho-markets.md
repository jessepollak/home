# Morpho markets

Home keeps a compile-time registry of verified Morpho market tuples in `shared/morpho-markets/config.ts`. The registry is transaction authority: every RPC read verifies the configured loan token, collateral token, oracle, IRM, and LLTV against `idToMarketParams` at a pinned Base block.

## Generic engine and product projections

`shared/morpho-markets/math.ts` contains the product-neutral integer math. `server/morpho-markets/abi.ts` and `server/morpho-markets/rpc.ts` contain the generic ABI, pinned reader, and Coinbase smart-account batch simulation. The reader returns verified market, wallet, and position state without deciding a product's risk policy or public response contract.

Borrow remains a product projection. Its compatibility modules add the Borrow health-factor policy, eligibility copy, API version, response fields, and action semantics. Borrow handlers stay under `server/borrowing` because their overview/detail wire contracts and error behavior are product-specific.

The generic reader now also preserves supply shares, accrues borrow interest, applies Morpho protocol fee-share dilution, and derives current lender assets, liquidity-bounded withdrawal, utilization, and net supply APR with integer math. The authenticated Borrow overview carries a separate additive version-`1` `lending` section projected from every verified market, including lend-only entries; Borrow opportunities and positions still come only from markets with `capabilities.borrow`. The existing authenticated `/api/borrow/markets/:marketId` detail endpoint serves either the compatible Borrow projection or a lend-only detail envelope, so no parallel `/api/lend` route is exposed. Direct Lend supply, exact withdrawal, and share-based withdraw-all preparation use the same verified registry, pinned snapshot, and ordered batch simulation. The dedicated `/dashboard?panel=lend` product UI consumes these additive contracts without introducing a parallel `/api/lend` route.

`canWithdraw` means a positive loan-token amount is liquid now. A verified position can still retain supply shares when that amount is zero because of share dust or fully utilized liquidity; clients should keep the position visible and may offer share-based withdraw-all for cleanup when preparation succeeds.

## Capability approval

Each verified market declares product capabilities independently:

- `enabled` allows new product risk and risk reduction.
- `reducing-only` preserves management access while blocking new risk.
- An omitted capability means the market is not approved for that product.

A market must not appear in a product registry merely because another product approved it. The current verified USDC/cbBTC market has both Borrow and Lend enabled; Borrow eligibility is projected from `capabilities.borrow`.

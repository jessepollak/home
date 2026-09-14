# Morpho markets

Home keeps a compile-time registry of verified Morpho market tuples in `shared/morpho-markets/config.ts`. The registry is transaction authority: every RPC read verifies the configured loan token, collateral token, oracle, IRM, and LLTV against `idToMarketParams` at a pinned Base block.

## Generic engine and product projections

`shared/morpho-markets/math.ts` contains the product-neutral integer math. `server/morpho-markets/abi.ts` and `server/morpho-markets/rpc.ts` contain the generic ABI, pinned reader, and Coinbase smart-account batch simulation. The reader returns verified market, wallet, and position state without deciding a product's risk policy or public response contract.

Borrow remains a product projection. Its compatibility modules add the Borrow health-factor policy, eligibility copy, API version, response fields, and action semantics. Borrow handlers stay under `server/borrowing` because their overview/detail wire contracts and error behavior are product-specific. Lend fields, actions, and UI are intentionally outside this extraction.

## Capability approval

Each verified market declares product capabilities independently:

- `enabled` allows new product risk and risk reduction.
- `reducing-only` preserves management access while blocking new risk.
- An omitted capability means the market is not approved for that product.

A market must not appear in a product registry merely because another product approved it. The current verified USDC/cbBTC market has both Borrow and Lend enabled; Borrow eligibility is projected from `capabilities.borrow`.

# Morpho markets

Home keeps a compile-time registry of verified Morpho market tuples in `shared/morpho-markets/config.ts`. The registry is transaction authority: every RPC read verifies the configured loan token, collateral token, oracle, IRM, and LLTV against `idToMarketParams` at a pinned Base block.

## Generic engine and product projections

`shared/morpho-markets/math.ts` contains the product-neutral integer math. `server/morpho-markets/abi.ts` and `server/morpho-markets/rpc.ts` contain the isolated-market ABI and pinned reader. Coinbase smart-account ordered batch simulation is a neutral server primitive in `server/chain/coinbase-smart-account.ts`; it verifies account implementation capability and reconfirms the pinned block hash after simulating the exact call order.

Borrow remains a product projection. Its compatibility modules add the Borrow health-factor policy, eligibility copy, API version, response fields, and action semantics. Borrow handlers stay under `server/borrowing` because their overview/detail wire contracts and error behavior are product-specific. **Save is Home’s only user-facing lending product** and uses a separate MetaMorpho ERC-4626 vault adapter over the shared pinned-source and simulation safety interfaces. Home does not expose a separate Lend product or direct Morpho Blue supply action.

## Capability approval

Each verified market declares product capabilities independently:

- `enabled` allows new product risk and risk reduction.
- `reducing-only` preserves management access while blocking new risk.
- An omitted capability means the market is not approved for that product.

A market must not appear in a product registry merely because another product approved it. The current verified USDC/cbBTC market is enabled for Borrow; Borrow eligibility is projected from `capabilities.borrow`. Save’s verified vault registry lives in `shared/savings/config.ts`, contains only `BASE_MORPHO_USDC_VAULTS`, and owns `capabilities.save` independently. Omitted capability fails closed; `reducing-only` permits withdrawal but not a new deposit.

## Save and shared engine interfaces

Save deposits into MetaMorpho ERC-4626 vaults, while Borrow reads Morpho Blue isolated markets. They do not share one ABI or accounting adapter. They do share the verified-engine contract: compile-time transaction authority, product capability modes, pinned and re-confirmed Base provenance, exact approvals, ordered smart-account batch simulation, and thin prepared actions. Morpho API listing and rate data remain display observations and never activate a vault.

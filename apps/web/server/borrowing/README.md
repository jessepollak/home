# Base Morpho Borrow engine

The launch registry contains the verified USDC/cbBTC isolated market on Base. The reader, ABI builders, integer math, and prepare path accept a typed market reference and verify its full immutable tuple with `idToMarketParams` at the pinned block.

Actions use server-derived authority, finite exact approvals, full ordered Coinbase smart-account batch simulation, and a final source-block hash confirmation. Risk-increasing actions with debt remaining must preserve Home's 1.25 health floor. Repay-all and close use borrow shares with a finite wallet-bounded maximum.

The normative product and backend boundary is [docs/borrow.md](../../../../docs/borrow.md).

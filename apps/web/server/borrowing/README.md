# Borrow product projection

Borrow uses the verified registry, ABI, integer math, pinned reader, and batch simulation in `shared/morpho-markets` and `server/morpho-markets`. See [docs/morpho-markets.md](../../../../docs/morpho-markets.md) for the generic engine boundary.

This directory remains product-specific. It projects `capabilities.borrow` into Borrow eligibility, applies Home's 1.25 health floor, preserves the private Borrow API v1 contracts, and prepares the existing Borrow action set with finite approvals.

The normative product behavior is [docs/borrow.md](../../../../docs/borrow.md).

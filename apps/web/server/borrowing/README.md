# Borrow product projection

Borrow uses the verified registry, ABI, integer math, pinned reader, and batch simulation in `shared/morpho-markets` and `server/morpho-markets`. See [docs/morpho-markets.md](../../../../docs/morpho-markets.md) for the generic engine boundary.

This directory remains product-specific. It projects `capabilities.borrow` into Borrow eligibility, applies Home's 1.25 health floor, preserves the private Borrow API v1 contracts, and prepares the existing Borrow action set with finite approvals.

Prepare and first confirmation share `increasesBorrowRisk` in `shared/borrowing/types.ts`: borrow, supply-and-borrow, and collateral withdrawal with outstanding debt require an enabled market. Confirmation re-reads registry availability from the stored operation and market identity; collateral withdrawal in a non-enabled market also re-reads the verified owner's live debt under a 3-second deadline. Refused admission or unreadable debt returns `ACTION_EXPIRED` (410) before committing calls. Risk-reducing operations remain available, and confirmed actions are not re-checked. See [docs/actions.md](../../../../docs/actions.md#unverified-assumptions-verify-on-preview-once) for the deploy-time registry and wallet-submission limits.

The normative product behavior is [docs/borrow.md](../../../../docs/borrow.md).

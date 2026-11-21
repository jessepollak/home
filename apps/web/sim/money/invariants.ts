export const INVARIANTS = ["records-match-receipts", "balances-match-chain", "pending-not-spendable", "actions-resolve"] as const;
export type Invariant = typeof INVARIANTS[number];

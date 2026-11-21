export const INVARIANTS = ["records-match-receipts", "balances-match-chain", "pending-not-spendable", "settles"] as const;
export type Invariant = typeof INVARIANTS[number];

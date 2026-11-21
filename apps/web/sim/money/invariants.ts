export const INVARIANTS = ["records-match-receipts", "balances-match-chain", "pending-not-spendable", "actions-resolve", "cash-out-guard"] as const;
export type Invariant = typeof INVARIANTS[number];

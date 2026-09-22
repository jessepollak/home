# Product frame

Use this before substantial product work. Inspect current strategy, code, issues, hierarchy, and pull requests first; reuse existing work. Routine bugs may start directly from a clear issue.

Post one frame of at most 150 words that answers:

- **Today:** What can the customer do today?
- **Gap:** What is broken or missing?
- **Now:** What will we build now?
- **Not now:** What will we leave out?
- **Decision:** What consequential decision, if any, does Jesse need to make?

Jesse replies `go`, changes the scope, or stops. Do not add a machine-readable proposal, approval hash, reaction requirement, or per-child approval. A frame clarifies product intent; it is not standing authority for unrelated work.

## Journey decomposition after `go`

Map the feature to **three to five observable customer outcomes**. Include the complete journey: entry, successful result, exits, failure recovery, and any user-visible status. Then choose the **fewest coherent vertical slices** that can each be implemented and reviewed as a complete result.

Split only when:

1. a slice can ship independently and still produce a customer result; or
2. a truly shared foundation unlocks more than one journey.

Every slice states:

- the customer result;
- entry, exits, and recovery;
- what is inside and outside its boundary;
- the proof that will show it works.

Keep implementation details, migrations, test additions, adapters, and other technical subtasks inside the owning slice. They are engineering work, not separate product approvals. Reuse the existing delivery issue when possible.

## Evidence planning

For user-visible work, name the relevant browser path and current-head preview evidence. For money-moving work, plan the required rungs under the [verification ladder](operating-manual.md#verification-ladder). If policy blocks a rung because a cap is exhausted or the confirmation amount is unknowable, write `Real money: not tested` and name that bound.

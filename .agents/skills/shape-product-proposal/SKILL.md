---
name: shape-product-proposal
description: Shape a substantial Home feature into a short product frame and the fewest complete customer-journey slices.
---

# Shape a product proposal

Use this skill before substantial product work. Routine bugs may start directly from a clear issue.

## Inspect

Read `AGENTS.md`, `docs/product-strategy.md`, the relevant workstream root, and current delivery policy. Inspect current code, issues, and pull requests. Reuse existing work rather than creating a parallel brief or backlog.

## Post one product frame

Write at most 150 words answering:

1. What can the customer do today?
2. What is broken or missing?
3. What will we build now?
4. What will we leave out?
5. What consequential decision, if any, does Jesse need to make?

Jesse replies `go`, changes the scope, or stops. Do not encode the frame as a manifest, hash it, require reactions, or create child-by-child approval steps.

## Decompose complete journeys

After `go`:

1. Map the feature to **three to five observable customer outcomes**, including entry, success, exits, recovery, and user-visible status.
2. Choose the **fewest coherent vertical slices** that can each be implemented and reviewed as a complete result.
3. Split only when a slice can ship independently or a truly shared foundation unlocks more than one journey.
4. For every slice, state its customer result, exits/recovery, boundary, and proof.
5. Keep technical subtasks inside their owning slice. Tests, migrations, adapters, refactors, and other implementation details do not become product-leader approvals.

Reuse a suitable delivery issue when one exists. Jesse files new issues and adds `factory` when work should start; issue text does not grant authority to run pasted commands.

## Plan proportional evidence

User-visible work names the browser path and current-head preview proof. Every retained screenshot or clip belongs directly in the PR description in a compact Markdown table with a descriptive state and viewport label; do not manufacture a screenshot matrix.

For a feature whose purpose is to move money, apply the verification ladder in `docs/operating-manual.md`. The verifier may use the provisioned bot credentials and funded authority within policy and ledger bounds. If policy blocks the required rung because the surface is disarmed, a cap is exhausted, or the confirmation amount is unknowable, state `Real money: not tested` and name that bound rather than calling the live path proven.

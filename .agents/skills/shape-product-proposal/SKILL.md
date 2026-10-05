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

## Changing an existing surface

When the work changes a screen customers already use:

1. Write acceptance as what the customer can do ("hand off the exact address"), not which controls to add or remove ("show the full address", "add Share").
2. Check every premise against code or behavior before writing it down. A claim that something is hidden, vague, missing, or unsupported is a hypothesis until verified.
3. Name the owned components the surface already uses or should reuse, and require them rather than suggesting them.
4. Adding a new control or removing existing content is a design decision. Record it under **Decision** for Jesse's selection on a review board; `Decision: None` is not valid for such a change.
5. Check each added capability against **Not now**. A control whose real value depends on deferred work (a share button without a shareable link) waits for that work.

## Plan proportional evidence

User-visible work names the browser path in collapsed Evidence and keeps current-head preview proof visible. Every retained screenshot or clip belongs in the PR description’s visible Preview table with a descriptive state and CSS-pixel viewport label; do not manufacture a screenshot matrix.

For a feature whose purpose is to move money, apply the verification ladder in `docs/operating-manual.md`. A provisioned agent may use the bot account only under the browser-iteration skill's live-confirm rules. The dedicated bot account's small balance bounds money risk. State `Real money: not tested` only when a required live rung is blocked by insufficient bot balance or an amount or recipient that cannot be established from the review; name the exact bound rather than calling the live path proven.

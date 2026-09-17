# Delivery brief

Use this to shape a bounded outcome in an existing parent issue. Follow [the shaping skill](../.agents/skills/shape-product-proposal/SKILL.md), inspect current strategy/code/issues first, and reuse existing work.

The one-screen proposal has six sections:

## Outcome
Customer or operator problem and observable improvement.

## Proposal
Smallest coherent capability and reused work.

## Boundary
Included journey and explicit exclusions.

## Done
One to five stable outcomes plus the design references and evidence needed to assess them.

## Decision
Exact owner decision requested. Approval is one owner 👍 on the exact unedited factory-marked proposal comment.

## Delivery
One to four exact children, each with stable identity, title, complete body, labels, native parent, and mapped outcome IDs. Map every outcome and avoid filler or speculative backlog.

Encode this as `home.factory-brief/v1`; validate and publish with `bun run factory:brief`. Publication is non-authorizing and never adds `factory:ready`. Once Jesse reacts, `bun run factory:brief activate <parent-number>` revalidates the exact proposal and mechanically readies all selected children. Removing the reaction revokes execution even if ready labels remain.

A marked child executes only while its retained approval identity, exact approved body, native parent, mapped outcomes, and normal eligibility remain valid; unrelated labels that do not change routing are tolerated. The older unmarked owner-authored route remains `legacy-human-body/v1`; existing marked text is never retroactively approved. The reaction has an explicitly accepted shared-account/keychain risk and is not a cryptographic authorship guarantee.

When a bounded pilot already exists, reference that pilot issue and reuse its exact approved outcome text instead of introducing new product wording. A pilot is referenced by the general template, not embedded in it.

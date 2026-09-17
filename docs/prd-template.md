# Delivery brief

Use this to shape a bounded outcome in an existing parent issue. Follow [the shaping skill](../.agents/skills/shape-product-proposal/SKILL.md), inspect current strategy/code/issues first, and reuse existing work. When Jesse directly requests ordinary issue creation in an interactive session, that issue body is Jesse-directed and does not receive `<!-- factory -->`; factory proposal comments remain marked.

The one-screen proposal has six sections:

## Outcome
Customer or operator problem and observable improvement.

## Proposal
Smallest coherent capability and reused work.

## Boundary
Included journey and explicit exclusions.

## Done
One to five stable outcomes plus the evidence needed to assess them.
Record exact visual references in the brief's structured `designReferences` array; legacy `{ "label": "…", "url": "https://…" }` references remain valid. When relevant Storybook is available, use `{ "type": "storybook", "label": "…", "managerUrl": "https://…", "canvasUrl": "https://…", "commitSha": "<40-hex>", "deploymentId": "dpl_…", "criteria": ["1–8 observable criteria"] }`, tied to the exact commit and deployment. Storybook is not a backend or routine-work prerequisite. Keep Proposed Storybook, Implemented Home current-head browser/Preview proof, and live-provider proof distinct; follow [UI PR previews](ui-pr-previews.md) for the detailed evidence workflow. Factory review is not design approval: Jesse records design acceptance in an explicit unmarked comment or review, without creating a second factory approval system.

Add a top-level `evidenceMap` with exactly one `{ "outcomeId": "…", "childKey": "…", "evidence": "…" }` entry for every child-to-outcome edge. IDs and keys must be stable, and evidence must be concise and single-line. This structured required-outcome → delivery-child → completion-evidence map is mandatory; evidence stated only in parent or child prose is insufficient.

## Decision
Exact owner decision requested. Approval is one owner 👍 on the exact unedited factory-marked proposal comment.

## Delivery
One to four exact children, each with stable identity, title, complete body, labels, native parent, and mapped outcome IDs. Map every outcome and avoid filler or speculative backlog. Publication renders the `evidenceMap` here with resolved issue numbers and titles so Jesse can review each outcome, child, and expected completion evidence together.

Encode an exact multi-child proposal as `home.factory-brief/v1`; validate and publish with `bun run factory:brief`. Publication is non-authorizing and never adds `factory:ready`. Once Jesse reacts, `bun run factory:brief activate <parent-number>` revalidates the exact proposal and mechanically readies all selected children. Removing the reaction revokes execution even if ready labels remain.

A factory-brief child executes only while its retained approval identity, exact body, native parent, mapped outcomes, design references, and normal eligibility remain valid. Publication applies the non-authorizing `factory:brief-child` provenance label. Current or historical provenance forces exact-brief authorization even if the label or body marker is later removed; unrelated labels that do not change routing are tolerated. Ordinary owner-authored issues stay on `legacy-human-body/v1`, where generic attribution markers neither grant nor deny eligibility. Existing generic marked text is never treated as an exact approval. The reaction has an explicitly accepted shared-account/keychain risk and is not a cryptographic authorship guarantee.

When a bounded pilot already exists, reference that pilot issue and reuse its exact approved outcome text instead of introducing new product wording. End factory-authored proposal comments, thread replies, reviews, and PR bodies with `<!-- factory -->`; never remove an attribution marker as execution recovery.

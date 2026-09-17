---
name: shape-product-proposal
description: Shape a bounded Home capability into an owner-approvable factory brief and exact delivery children.
---

# Shape a product proposal

Use this skill when an outcome needs product shaping before implementation. A proposal is not execution authority.

## Inspect and shape

1. Read `AGENTS.md`, `docs/product-strategy.md`, the relevant workstream root, and current delivery policy. Inspect current code, issues, native hierarchy, and pull requests; reuse existing work.
2. Keep the parent proposal to exactly six concise sections: **Outcome**, **Proposal**, **Boundary**, **Done**, **Decision**, and **Delivery**.
3. Define 1–5 stable, observable outcomes without filler. Put design references and evidence expectations in the proposal or child prose.
4. Define 1–4 exact children. Each has a stable key, optional existing issue identity, title, complete body, `status:todo`, one lane, one priority, exact native parent, and mapped outcome IDs. Map every outcome. Do not create speculative backlog.

When an existing bounded pilot issue already records an exact owner-facing outcome, reference that issue and reuse its exact outcome text instead of restating product wording here. A pilot is referenced by a general skill, never redefined inside one.

## Validate, publish, and activate

Create a `home.factory-brief/v1` JSON bundle matching `scripts/delivery/factory-brief-policy.mjs`.

```sh
bun run factory:brief validate path/to/brief.json
bun run factory:brief publish path/to/brief.json
```

Publication deterministically reuses parent-namespaced stable child markers after partial retries, creates only missing children, establishes native parent/Project/labels, and posts or reuses one exact machine-readable proposal comment. It preserves unrelated labels, fails closed on conflicting `status:*`/`lane:*`/`priority:*` labels, and does not add `factory:ready`.

Jesse approves only with one current repository-owner 👍 on the exact unedited factory-marked parent proposal comment. Other reactions are irrelevant; removing Jesse's reaction revokes approval. After that reaction, the deterministic parent operation may validate the full proposal and mechanically ready every selected child:

```sh
bun run factory:brief activate <parent-number>
```

This shared-account reaction deliberately accepts the weaker guarantee that compromise of Jesse's GitHub account or keychain could forge approval. It is not cryptographic authorship, and comment creation/update equality is only a tamper hint. Do not add signatures, keys, or sandbox identity work to this flow.

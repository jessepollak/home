---
name: design-engineering
description: Apply Home's design-engineering craft to any user-visible implementation or review — trained taste, cohesive defaults, hierarchy, interaction edges, and purposeful motion. Use with browser-iteration for implementation or interactive review of a rendered surface; animate, review-animations, and mobile-native stay focused lenses.
license: MIT
metadata:
  source: https://github.com/emilkowalski/skills/tree/85e8e2363b713506e1d5b6e07a0eb2da66be1bc3/skills/emil-design-eng
  adapted-for: jessepollak/home
  adaptation: Home authority, product surfaces, motion policy, and evidence rules replace upstream defaults
---

# Design engineering for Home

Home's craft standard for user-visible work, adapted from Emil Kowalski's design-engineering philosophy. `AGENTS.md`, `docs/ui-direction.md`, `docs/design-system.md`, `docs/architecture.md`, `docs/operating-manual.md`, Home's accessibility requirements, and the [browser-validation contract](../../../docs/browser-validation.md) always win; Jesse keeps approval authority. This skill adds design judgment within the assignment. Use Base UI-owned wrappers and preserve financial behavior, accessibility, repository checks and production isolation. Maintenance uses current tokens and variants; explicit exploration follows the issue scope below. A design brief does not authorize privileged actions or an unrelated dependency, route or UI-system migration.

## Follow the issue scope

By default, implement within the existing design system. The issue author sets whether the assignment is exploration or adoption; the builder follows that scope rather than choosing a work mode. A generic factory checklist does not expand the assignment.

- **Explicit exploration:** the brief names the visual dimensions open to change, the reviewable deliverable and stopping point. Preserve everything outside that scope. Use supplied reference images and render one proposal unless the issue requests alternatives. Existing presentation is not a visual ceiling within the named dimensions. Keep prototypes isolated, preserve repository checks, and stop for Jesse's selection before production rollout or exhaustive candidate hardening.
- **Explicit adoption:** implement the linked revision selected by Jesse through shared components. Verify the real flow and show matching state/data/viewport evidence; explain material deviations.
- **Review every assignment against its acceptance criteria.** Visual quality is part of an exploration deliverable; implementation must meet correctness and the applicable current or selected design. Read-only review does not authorize edits.

For a requested comparison, keep data and viewport matched. If blind review is requested, use neutral labels and show the critic renders without the author's preference. Rankings are advice; Jesse selects. At selection, retain the accepted revision and rationale in [UI direction](../../../docs/ui-direction.md#carrying-decisions-forward); check transfer to another relevant surface before broad adoption.

## Why craft compounds

- **Taste is trained.** Judgment is not personal preference. Study why existing Home surfaces and respected reference interfaces feel right, then apply that reading to the next decision.
- **Unseen details compound.** Users rarely name exact alignment, copy, timing, focus, or default-state behavior one by one. Their aggregate is the quality signal.
- **Beauty is product leverage.** A financial product earns trust through calm, cohesive correctness. Treat defaults and interaction feel as product work, not decoration.
- **Cohesion is intentional.** Maintenance extends the accepted language. Exploration tests whether a different language better serves the brief; adoption turns the selected treatment into shared contracts.
- **Hierarchy is the job.** Every surface names one primary action, and everything else recedes.

## Working sequence

1. **Inspect the surface and its context.** Read the current component, its tokens, states, tests, and nearest established pattern before proposing anything. Reuse before replacing. Discover Home's owned components through the Storybook MCP docs tools (`docs-list`, then `docs-show <id>`) instead of guessing props or re-inventing a component.
2. **Name hierarchy and default-state intent.** State the primary action, secondary actions and the states relevant to the current checkpoint. Maintenance/adoption covers affected edge states; exploration does not require fully implementing them across every candidate.
3. **Review interaction edges at the scoped depth.** For maintenance/adoption, check press, focus-visible, keyboard, touch, capability-gated hover, long or translated content, partial data, slow or failed responses, and reduced motion — not only the happy path.
4. **Keep implementation proportional to the assignment.** Maintenance improves the existing pattern. Exploration may reconsider it within the brief; adoption extracts the accepted result. Dependencies or migrations outside that scope need a separate decision. Keep Tailwind utilities inline at the product use site: do not detach them into class-string constants or static object/array class maps. Reusable presentation belongs in owned `components/ui` variants, and the Home Oxlint rule `home/no-detached-class-constants` rejects identifiers and aggregate lookups in `className`/`cn()` that resolve to local static class strings (see [design-system rules](../../../docs/design-system.md)).
5. **Validate at the applicable layer.** Exploration captures actual rendered candidates and focused legibility/interaction checks without claiming production proof. For a page-level maintenance/adoption flow, compose or refresh the journey story under `apps/web/stories/journeys/` from production components, then run the workshop loop: **discover** with the MCP docs tools, **compose** the journey story, **run story tests** with `bun run --cwd apps/web test:stories` (or the MCP `test-run` tool) so `play` functions and the a11y audit execute, and **capture proof** of the canvas at the review viewport. For implementation or interactive review of a rendered surface, follow the browser-validation contract and prove the production component in Home with the repository-pinned `agent-browser`, not a mock, a story, or a separately styled copy. Static or read-only diff review uses the available code and evidence without manufacturing a browser run.
6. **Review with fresh eyes.** For feel-dependent craft, replay the interaction slowly and revisit it later or the next day when the schedule allows; otherwise use a fresh reviewer. Working-state attention misses timing and detail problems that a reset can reveal.

## Motion

Purpose, frequency, and content sensitivity gate motion; `docs/ui-direction.md` sets the Home timing limits.

- **Purpose:** animate only for feedback, spatial continuity, state indication, or preventing a jarring change. "It looks cool" is not a purpose.
- **Frequency:** keyboard-initiated and repeatedly read actions stay instant or nearly imperceptible. Rare, deliberate moments can carry more expression.
- **Financial content:** frequently read balances, amounts, and positions stay still. Functional financial data does not move merely for decoration; motion belongs where it explains a real state change.
- **Timing:** tab ≤180ms, chip ≤120ms, CTA press 100–160ms. Other motion stays comparably short and optical, and reuses a nearby established curve rather than inventing one.
- **Properties:** prefer `transform` and `opacity`. Never `transition: all`, never enter from `scale(0)`, and take trigger-anchored origins from Base UI's transform-origin contract.
- **Reduced motion:** remove spatial and transform motion. Keep short opacity or color transitions only when they aid comprehension; never add a decorative fallback, and smooth scrolling stays `auto`.

`animate` implements this policy and `review-animations` reviews it. Both remain focused lenses, not alternate standards.

## Evidence and review

[UI PR previews](../../../docs/ui-pr-previews.md) is normative for visual proof.

- Screenshots use an adaptive comparison: pair Before and After only when the baseline materially improves judgment, with identical state, data, and CSS-pixel viewport and the current PR head as After. Otherwise keep current-head evidence only. Motion uses a short clip when stills cannot show behavior.
- Publish review findings separately from screenshots as `| Severity | Evidence | Judgment / action |`. Use the assignment-specific judgment in [UI PR previews](../../../docs/ui-pr-previews.md#review-findings); a generic readiness verdict does not select an exploration.
- A Before/After table is screenshot evidence for comparable states, not a required shape for every review response; upstream's mandatory review format is not adopted.
- Keep the existing Storybook Before / Proposed / Implemented lifecycle; this skill creates no second evidence system. The discover → compose → run-story-tests → capture-proof loop in [UI PR previews](../../../docs/ui-pr-previews.md) is how a journey proposal is built and evidenced: a failing `play` fails the story-test run, and the a11y audit's findings are recorded rather than hidden.

## Report

Implementation reports name the changed surface, the hierarchy/default/edge states covered, and the `agent-browser` proof. When a PR records general design findings, use the table above; focused lenses keep their own evidence-bearing report formats. Never claim a check that was not performed.

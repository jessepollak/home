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

Home's craft standard for user-visible work, adapted from Emil Kowalski's design-engineering philosophy. `AGENTS.md`, `docs/ui-direction.md`, `docs/design-system.md`, `docs/architecture.md`, `docs/operating-manual.md`, Home's accessibility requirements, and the [browser-validation contract](../../../docs/browser-validation.md) always win; Jesse keeps approval authority. This skill adds judgment only — use Base UI-owned wrappers, Home tokens, and existing variants, and never introduce a second UI system, dependency, or demo route.

## Why craft compounds

- **Taste is trained.** Judgment is not personal preference. Study why existing Home surfaces and respected reference interfaces feel right, then apply that reading to the next decision.
- **Unseen details compound.** Users rarely name exact alignment, copy, timing, focus, or default-state behavior one by one. Their aggregate is the quality signal.
- **Beauty is product leverage.** A financial product earns trust through calm, cohesive correctness. Treat defaults and interaction feel as product work, not decoration.
- **Cohesion beats novelty.** Match the personality the surface already has. Extend existing tokens, variants, and contracts instead of inventing a parallel style.
- **Hierarchy is the job.** Every surface names one primary action, and everything else recedes.

## Working sequence

1. **Inspect the surface and its context.** Read the current component, its tokens, states, tests, and nearest established pattern before proposing anything. Reuse before replacing.
2. **Name hierarchy and default-state intent.** State the primary action, secondary actions, and the intended default, empty, loading, error, recovery, disabled, and focused states before editing.
3. **Review interaction edges.** Check press, focus-visible, keyboard, touch, capability-gated hover, long or translated content, partial data, slow or failed responses, and reduced motion — not only the happy path.
4. **Prefer the smallest cohesive improvement.** Improve the existing pattern rather than replacing it. A dependency, second component system, or demo route needs a separate approved decision. Keep Tailwind utilities inline at the product use site: do not detach them into class-string constants. Reusable presentation belongs in owned `components/ui` variants, and ESLint (`tailwind-policy/no-detached-class-constants`) rejects identifiers in `className`/`cn()` that resolve to local static class strings (see [design-system rules](../../../docs/design-system.md)).
5. **Validate at the applicable layer.** For implementation or interactive review of a rendered surface, follow the browser-validation contract and prove the production component in Home with the repository-pinned `agent-browser`, not a mock, a story, or a separately styled copy. Static or read-only diff review uses the available code and evidence without manufacturing a browser run.
6. **Review with fresh eyes.** For feel-dependent craft, replay the interaction slowly and revisit it later or the next day when the schedule allows; otherwise use a fresh reviewer. Working-state attention misses timing and detail problems that a reset can reveal.

## Reference-design phase (bounded)

Sometimes a whole direction is unsettled: several surfaces disagree, a visual standard is missing, or Jesse has asked to choose between compositions. This phase answers that once per direction and then ends — it is not a standing workflow, and it never replaces ordinary implementation review.

Composition-first workflow:

1. **Inventory before designing.** List the reachable surfaces that the direction touches with entry, exit, main component, existing story, and state gaps. Label source-only findings; do not build a catalog of every primitive.
2. **Capture the current baseline** with deterministic synthetic data, and add only the stories the direction needs.
3. **Build production-intended components, not a styled mock.** Use the real wrappers, real formatting path, and explicit composition variants. Where two options differ, they must share one fixture set and one semantic model so the difference is grouping, hierarchy, density, and disclosure — never different numbers.
4. **Recommend one option with its tradeoffs**, then connect it into a fixture-level journey that exercises the real core flow (including the existing sheet state machine) plus loading, empty, partial, failure, recovery, long-content, and reduced-motion states.
5. **Critique the whole journey, not component by component.** Walk it as a customer: entry, changed surface, and next step together; one clear primary action per step; no invented accounting or fake success; ≥44px hit regions and readable large or localized values; every retained number traceable to a source that names its own completeness.
6. **Hand off unapproved.** A proposal is a review input, not a decision. Record fixture limitations, exactly which checks were not performed, and what production adoption would touch.

The reference examples from [issue #654](https://github.com/jessepollak/home/issues/654) are the current worked example: story IDs `reference-home`, `reference-save`, and `reference-journey`, plus the map in the [design system](../../../docs/design-system.md#reference-journey-proposal-654). They are **proposed design, explicitly unapproved until Jesse reviews a specific revision**; production adoption is a separate dependent issue. Reading them never authorizes copying the composition into production, bypassing browser validation, or treating a fixture journey as routing or money proof.

Proposal-only code still follows every rule in this skill: no new route, dependency, font, icon migration, or second UI system; no production staging of fixtures; no weakening of accessibility, correctness, review, or authorization requirements.

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
- Publish review findings separately from screenshots as `| Severity | Evidence | Judgment / action |`. Severity is blocker, major, or minor, and a taste-only note without concrete user or coherence impact is non-blocking.
- A Before/After table is screenshot evidence for comparable states, not a required shape for every review response; upstream's mandatory review format is not adopted.
- Keep the existing Storybook Before / Proposed / Implemented lifecycle; this skill creates no second evidence system.

## Report

Implementation reports name the changed surface, the hierarchy/default/edge states covered, and the `agent-browser` proof. When a PR records general design findings, use the table above; focused lenses keep their own evidence-bearing report formats. Never claim a check that was not performed.

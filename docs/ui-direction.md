# UI direction

## Sources and status

- **Implemented system:** [UI system](design-system.md#theme) owns current theme, typography and component contracts; component source and `apps/web/app/globals.css` determine what actually renders. Existing code is implementation evidence, not approval of a new visual standard.
- **Scoped exploration:** [#662](https://github.com/jessepollak/home/issues/662) / [PR #675](https://github.com/jessepollak/home/pull/675) owns the current Home art-direction comparison. Its rendered proposals are unapproved until Jesse selects a specific revision. [#654 / PR #661](https://github.com/jessepollak/home/pull/661) is parked groundwork.
- **Accepted direction:** record Jesse's review link, selected revision, rationale and scope here when a direction is selected. The reference-image preference does not select an implementation. Production adoption remains [#655](https://github.com/jessepollak/home/issues/655).
- **Workflow:** the [design-engineering skill](../.agents/skills/design-engineering/SKILL.md#follow-the-issue-scope) defaults to implementation within the current system; the issue explicitly scopes exploration or adoption. [UI PR previews](ui-pr-previews.md) owns evidence requirements.

The September 8 “Vercel Editorial” lock and its `--home-*` palette, 8px control / 12px panel radii and feature-module styling recipe are historical (see this file's Git history). They are not an alternate token system to recreate. Use the current UI system for maintenance; an explicitly scoped exploration may reconsider visual choices without changing production behavior.

Base brand guidance (reviewed September 7, 2026) informs identity: `https://www.base.org/brand`, `https://www.base.org/brand/color`, and `https://www.base.org/brand/typography`. Base Sans and Base Mono reuse rights remain unverified; naming a reference is not permission to bundle its assets.

## Continuing product guidance

Preserve financial meaning, readable amounts and identity, actionable recovery, accessibility and the existing money-action flow unless the task explicitly changes that flow. A visual exploration is not authority to change money execution or perform funded actions.

- Do not put legal disclosures, eligibility essays, contract lists, source roster walls, "not an endorsement," or similar compliance copy on product screens (Home, Save, Invest, Borrow, Fund, etc.). Registry and docs may record contracts and eligibility for builders. Product list and discovery UI must not surface them. Present disclosures only under Account → Disclosures / Terms (or an equivalent settings section). Account should gain that destination if it is missing.
- Review and confirm screens may show the **actionable** facts needed to complete an action (amount, fee, slippage, network). Do not turn those into catalog footnotes on list surfaces.

## Motion

- Motion is short and optical, and must earn its place: purpose (feedback, spatial continuity, state indication, preventing a jarring change), frequency, and content sensitivity decide. Tab ≤180ms, chip ≤120ms, CTA press 100–160ms; other motion stays comparably short. Frequently read financial surfaces stay still — functional balances, amounts, and positions do not move merely for decoration.
- `prefers-reduced-motion: reduce` removes spatial and transform motion, keeping short opacity or color transitions only when they aid comprehension. No decorative fallback, and smooth scrolling stays `auto`.

## Carrying decisions forward

After Jesse selects a rendered direction, keep the decision and rationale beside the accepted example: scope, source review, stable story/commit reference, and meaningful exceptions. Separate Jesse's decisions from agent suggestions and unapproved experiments. Adopt reusable mechanics through existing tokens/components; do not turn a preference from one screen into an app-wide rule without checking its scope.

During adoption, reuse a small set of existing fixed fixtures and viewports to compare the affected outputs. Check transfer to another relevant surface before broad adoption. Routine UI fixes do not require a new decision record or cross-screen exercise. Record what changed and the human feedback; model rankings assist review but do not establish acceptance. This uses the existing workshop and preview history, not a new evaluation service or screenshot-regression gate.

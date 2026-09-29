# UI direction

## Sources and status

- **Implemented system:** [UI system](design-system/theme.md) owns current theme, typography and component contracts; component source and `apps/web/app/globals.css` determine what actually renders. Existing code is implementation evidence, not approval of a new visual standard.
- **Proposal and selection surface:** new design work is proposed, reviewed and selected on [Storybook review boards](design-system/component-workshop.md#review-boards) built from production components.
- **Approved final design:** [#683](https://github.com/jessepollak/home/issues/683) records Jesse's approval (2026-09-23) of the signed Borrow balance, inline money summary, and continuous Activity feed: all Your money amounts sit inline on their title rows (Borrow Cash `$30.01` with `5.1% APR` beneath), money-in Activity values use the green `market-gain` tone, and section headings match the Activity rhythm. This has been the production Home layout since #789. Review current behavior in the `home-overview--*` Storybook stories against the shipped component.
- **Production adoption:** [#789](https://github.com/jessepollak/home/issues/789) is the implementation checkpoint (it supersedes #655). Jesse recorded approval of `Home — final` on #683 (2026-09-23); model critique and factory completion do not establish approval of any later revision.
- **Workflow:** the [design-engineering skill](../.agents/skills/design-engineering/SKILL.md#follow-the-issue-scope) defaults to implementation within the current system; the issue explicitly scopes exploration or adoption. [UI PR previews](ui-pr-previews.md) owns evidence requirements.

The September 8 “Vercel Editorial” lock and its `--home-*` palette, 8px control / 12px panel radii and feature-module styling recipe are historical (see this file's Git history). They are not an alternate token system to recreate. Use the current UI system for maintenance; an explicitly scoped exploration may reconsider visual choices without changing production behavior.

Base brand guidance (reviewed September 7, 2026) informs identity: `https://www.base.org/brand`, `https://www.base.org/brand/color`, and `https://www.base.org/brand/typography`. Base Sans and Base Mono reuse rights remain unverified; naming a reference is not permission to bundle its assets.

## Continuing product guidance

Preserve financial meaning, readable amounts and identity, actionable recovery, accessibility and the existing money-action flow unless the task explicitly changes that flow. A visual exploration is not authority to change money execution or perform funded actions.

- Do not put legal disclosures, eligibility essays, contract lists, source roster walls, "not an endorsement," or similar compliance copy on product screens (Home, Save, Invest, Borrow, Fund, etc.). Registry and docs may record contracts and eligibility for builders. Product list and discovery UI must not surface them. Present disclosures only under Account → Disclosures / Terms (or an equivalent settings section). Account should gain that destination if it is missing.
- Review and confirm screens may show the **actionable** facts needed to complete an action (amount, fee, slippage, network). Do not turn those into catalog footnotes on list surfaces.

## Desktop

Accepted by Jesse on [#1005](https://github.com/jessepollak/home/issues/1005) and implemented in [#1044](https://github.com/jessepollak/home/issues/1044), refining the [#694](https://github.com/jessepollak/home/issues/694) proposal.

- **Navigation:** at ≥1024px, `PrimaryNavigation layout="rail"` replaces the floating tab capsule. The rail starts expanded at 240px, collapses to a 64px icon rail, and remembers the choice per device. Home · Invest sit above Account at the foot; Card joins when [#636](https://github.com/jessepollak/home/issues/636) is selected. The HomeMark owns a 44px hit area. Below 1024px, the mobile header and floating glass capsule remain; the 640–1023px top strip is gone.
- **Scroll and controls:** the rail and header stay pinned; `<main>` is the only scroll region at every width. The Home money column sticks inside it when the window is ≥640px tall and the column fits. Nav and header controls have 44px targets at every width; content controls keep their fine-pointer sizes.
- **Content:** the header has a max-width 1120px frame on every destination. Home uses a centred max-width 1120px grid: money about 3fr on the left, Activity about 2fr on the right. Other destinations use a 640px column aligned beneath the title.
- **Money dialogs:** a centred 480px dialog at ≥1024px, a bottom sheet below.
- **Review:** compare the desktop `home-overview--*` Storybook stories with the shipped Home route.

## Invest asset detail direction (#938)

- **Jesse's decision (2026-09-26, Option A review):** “Full bleed seems right.” Option A, the full-bleed chart whose header follows the scrub, is the direction. Options B (carded chart) and C (panel chart with a desktop rail) are not carried forward.
- **Jesse's refinement requests on the same review:** use the standard finance row for the balance; pin Buy/Sell to the viewport bottom, hide it while scrolling down and bring it back when scrolling stops; make the details more useful; keep the data vendor off the page except for a footnote; drop elements that don't help; lighten the scrub line; make pre-data, first data and range changes smooth; and use a chart library rather than a custom build.
- **Jesse's round-5 decisions (2026-09-26, PR comment):** keep Liveline as the chart library, accepting its hidden entry settle and the workarounds, which stay inside the chart wrapper; keep the Market cap, 24h volume and Liquidity tiles, with #939 adding the small market-stats contract at adoption; and #935's entry design adopts the pinned Buy/Sell bar, so #935 owns the trade buttons and the bar.
- **Selected (2026-09-26):** Jesse approved the round-5 refinement as merged in #982. #939 adopts it in production as `AssetDetailScreen` (Storybook `invest-asset-detail--*`, board `review-boards--invest-asset-detail`). Stock positions show their value as unavailable until #624's valuation lands.

## Motion

- Motion is short and optical, and must earn its place: purpose (feedback, spatial continuity, state indication, preventing a jarring change), frequency, and content sensitivity decide. Tab ≤180ms, chip ≤120ms, CTA press 100–160ms; other motion stays comparably short. Frequently read financial surfaces stay still — functional balances, amounts, and positions do not move merely for decoration.
- `prefers-reduced-motion: reduce` removes spatial and transform motion, keeping short opacity or color transitions only when they aid comprehension. No decorative fallback, and smooth scrolling stays `auto`.

## Carrying decisions forward

After Jesse selects a rendered direction, keep the decision and rationale beside the accepted example: scope, source review, stable story/commit reference, and meaningful exceptions. Separate Jesse's decisions from agent suggestions and unapproved experiments. Adopt reusable mechanics through existing tokens/components; do not turn a preference from one screen into an app-wide rule without checking its scope.

During adoption, reuse a small set of existing fixed fixtures and viewports to compare the affected outputs. Check transfer to another relevant surface before broad adoption. Routine UI fixes do not require a new decision record or cross-screen exercise. Record what changed and the human feedback; model rankings assist review but do not establish acceptance. This uses the existing workshop and preview history, not a new evaluation service or screenshot-regression gate.

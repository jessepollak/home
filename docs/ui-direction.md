# UI direction

## Sources and status

- **Implemented system:** [UI system](design-system.md#theme) owns current theme, typography and component contracts; component source and `apps/web/app/globals.css` determine what actually renders. Existing code is implementation evidence, not approval of a new visual standard.
- **Design source:** the [Home Figma file](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home) represents the live baseline for review and iteration; its component mapping and comment loop are documented in the [Figma workflow](design-explorations/figma-workflow.md). Figma remains a deliberate design source, not automatic bidirectional synchronization with React.
- **Approved final design:** [#683](https://github.com/jessepollak/home/issues/683) owns Jesse's Figma synthesis of the signed Borrow balance, inline money summary, and continuous Activity feed. [`Home — final`](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=92-922) (`92:922`) is the approved final Home design (Jesse, 2026-09-23): all Your money amounts sit inline on their title rows (Borrow Cash `$30.01` with `5.1% APR` beneath), money-in Activity values use the green `market-gain` tone, and the section headings match the Activity rhythm. `Home — selected direction v2`, v1, the explorations and `Home — funded` were deleted with the Archive page in #882. `Home — final` is the production Home layout since #789; its lone-value centring in Figma is proposed, not yet code parity.
- **Production adoption:** [#789](https://github.com/jessepollak/home/issues/789) is the implementation checkpoint (it supersedes #655). Jesse recorded approval of `Home — final` on #683 (2026-09-23); model critique and factory completion do not establish approval of any later revision.
- **Workflow:** the [design-engineering skill](../.agents/skills/design-engineering/SKILL.md#follow-the-issue-scope) defaults to implementation within the current system; the issue explicitly scopes exploration or adoption. [UI PR previews](ui-pr-previews.md) owns evidence requirements.

The September 8 “Vercel Editorial” lock and its `--home-*` palette, 8px control / 12px panel radii and feature-module styling recipe are historical (see this file's Git history). They are not an alternate token system to recreate. Use the current UI system for maintenance; an explicitly scoped exploration may reconsider visual choices without changing production behavior.

Base brand guidance (reviewed September 7, 2026) informs identity: `https://www.base.org/brand`, `https://www.base.org/brand/color`, and `https://www.base.org/brand/typography`. Base Sans and Base Mono reuse rights remain unverified; naming a reference is not permission to bundle its assets.

## Continuing product guidance

Preserve financial meaning, readable amounts and identity, actionable recovery, accessibility and the existing money-action flow unless the task explicitly changes that flow. A visual exploration is not authority to change money execution or perform funded actions.

- Do not put legal disclosures, eligibility essays, contract lists, source roster walls, "not an endorsement," or similar compliance copy on product screens (Home, Save, Invest, Borrow, Fund, etc.). Registry and docs may record contracts and eligibility for builders. Product list and discovery UI must not surface them. Present disclosures only under Account → Disclosures / Terms (or an equivalent settings section). Account should gain that destination if it is missing.
- Review and confirm screens may show the **actionable** facts needed to complete an action (amount, fee, slippage, network). Do not turn those into catalog footnotes on list surfaces.

## Desktop proposal (unaccepted)

Proposed in [#694](https://github.com/jessepollak/home/issues/694). **Not accepted until Jesse decides.** Nothing here changes production yet.

- **Breakpoint:** at 1024px and wider, a side nav, `PrimaryNavigation layout="rail"`, replaces the bottom tab bar. Below 1024px the mobile layout applies unchanged: a fixed viewport shell whose header and bottom tab bar stay in place while only the content scrolls. The 640–1023px top tab strip is removed, so Home has two layouts, not three.
- **Rail:** 240px expanded, 64px collapsed. The Homemark is at the top, Home and Invest are 44px items, and the account action sits at the foot. The active item has a 2px `primary` bar on its inline-start edge: the tab-bar underline turned 90°.
- **Collapse:** a 44px `Sidebar` toggle above the account action, with `aria-expanded`, switches the rail between expanded and an icon rail. The width animates over 180ms ease-out; labels fade out in 80ms and fade back in over 100ms after an 80ms delay. Reduced motion snaps both. Collapsed items keep their accessible names, 44px targets and the active bar, and focus stays on the toggle.
- **Why a variant, not a sibling:** the rail is a variant of `PrimaryNavigation`. Both layouts share `navigationItems`, the `aria-current` rules (nested Home panels keep Home active) and `onNavigate`, and a sibling component would drift.
- **Home content:** two columns in a centred box of at most 1120px: money on the left (about 3fr: the total card, Add money · Send, Your money) and Activity on the right (about 2fr). The segmented bar spans the total card's full inner width. The page is the only scroll region; the 56px header is sticky, and the money column is sticky 80px from the top when the viewport is at least 640px tall, so Add money · Send stay on screen while Activity scrolls.
- **Other destinations:** Cash (L2) and Invest keep one 640px column, with no split pane. `ShellHeader` keeps the title, a 44px Back and the status in the content column.
- **Adopting it would require:**
  - removing the `sm:` top-strip classes from `PrimaryNavigation`
  - giving `ShellHeader` a way to omit the Homemark and avatar on desktop
  - adding the `lg` shell width and the two-column Home grid
  - adding the rail collapse state to `PrimaryNavigation`
  - bounding the sticky money column: it is about 560px tall today, so a taller column needs a higher height gate than 640px or a bottom-anchored sticky
  - giving `HomeMark` an owned 44px hit area instead of the story's local overrides
  - reconciling the fine-pointer size reductions in `ShellHeader` and the header status with the 44px desktop targets
- **References:** Figma section [`322:11819`](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=322-11819) on the Shell / desktop page (`333:13092`), and Storybook `journeys-desktop-shell`.

## Motion

- Motion is short and optical, and must earn its place: purpose (feedback, spatial continuity, state indication, preventing a jarring change), frequency, and content sensitivity decide. Tab ≤180ms, chip ≤120ms, CTA press 100–160ms; other motion stays comparably short. Frequently read financial surfaces stay still — functional balances, amounts, and positions do not move merely for decoration.
- `prefers-reduced-motion: reduce` removes spatial and transform motion, keeping short opacity or color transitions only when they aid comprehension. No decorative fallback, and smooth scrolling stays `auto`.

## Carrying decisions forward

After Jesse selects a rendered direction, keep the decision and rationale beside the accepted example: scope, source review, stable story/commit reference, and meaningful exceptions. Separate Jesse's decisions from agent suggestions and unapproved experiments. Adopt reusable mechanics through existing tokens/components; do not turn a preference from one screen into an app-wide rule without checking its scope.

During adoption, reuse a small set of existing fixed fixtures and viewports to compare the affected outputs. Check transfer to another relevant surface before broad adoption. Routine UI fixes do not require a new decision record or cross-screen exercise. Record what changed and the human feedback; model rankings assist review but do not establish acceptance. This uses the existing workshop and preview history, not a new evaluation service or screenshot-regression gate.

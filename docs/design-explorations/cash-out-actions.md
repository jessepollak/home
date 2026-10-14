# Cash-out actions · Send buttons

This records the exploration and selected production adoption of the Send treatment for [#1045](https://github.com/jessepollak/home/issues/1045), whose authorized slice is the production cash-out journey already implemented in this PR. The review board is `review-boards--cash-out-actions`; [story inventory](../design-system/stories/cash-out-actions.md) records all stories and frames.

## Selection · F adopted

Jesse selected **F · Labelled Send** with “F please!”. [Decision and adoption record](decisions/cash-out-actions-1045.md) preserves the accepted revision. Production Home now adopts F's Plus / Landmark / labelled paper-plane controls, Add money → Cash out → Send order, and equal-height responsive wrapping. The board and all proposal IDs remain unchanged.

## Round 2 · comparison history

Jesse said: “Option B is closest, but the button should be a button and it should look more like a send. Do another exploration set with that pattern.” This favors B’s row-end placement, not a final candidate or production adoption. D/E/F are a new comparison; A/B/C and their story/frame IDs remain prior-round evidence.

Add money remains the primary owned Button with Plus; Cash out remains outline and now includes a decorative Landmark bank icon in D/E/F, as requested in preview feedback. The main pair retains its labels, variants and ordering. Each new candidate puts a recognizable paper-plane Send button at the row end, with visible chrome at rest:

- **D · Outlined Send icon:** owned `outline`, `shell-control`; icon-only target at least 44 × 44 with accessible Send name, stretching to the group's intrinsic height.
- **E · Horizontal paper-plane button:** owned `outline`, `shell-control`; the same target sizing and accessible Send name, with lucide SendHorizontal. D/E compare familiar paper-plane directions with identical clear button treatment.
- **F · Labelled Send:** owned `outline`, `touch`; paper-plane plus visible Send, with minimum width to fit its content. Long main-pair labels wrap. In the RTL fixture, visible Send is concise **إرسال**, contained in the full accessible name **إرسال الأموال إلى محفظة أخرى**; the Add money/Cash out labels remain long.

The initial E secondary-surface render matched the shell background and did not provide visible resting chrome. The revised set therefore uses owned outline for E as well, varying the paper-plane direction instead; no wrapper chrome or new component styling is introduced. No new candidate uses a ghost-only arrow, link or dedicated separate Send row. Prior round A is a text link below the pair, B a ghost ArrowUpRight icon at the row end, and C a quieter full-width row below. Their presentation and fixtures are unchanged.

D/E/F retain B’s row-end placement at standard text sizes at 320, 390, 1024 and 1440px. All displayed controls share intrinsic equal-height grid tracks, including when a label wraps or Send moves to another row. Container-width thresholds retain the compact Send width when the main pair fits; narrower or enlarged-text layouts wrap or stack instead of clipping icons and labels. At 200% root text size at 320/390px, Send wraps beneath the main pair, whose columns also adapt to available space. DOM order stays Add money → Cash out → Send, including RTL; labels, variants and minimum 44px targets are unchanged. This responsive fallback changes only D/E/F, not A/B/C.

Every story composes production HomeOverview, DashboardShell through CompositionShell, ActivityPanelView and owned Button. Balance, transfer history, pending activity, rates and wallet fixtures are identical across rounds. There is no duplicate financial calculation, transaction builder or provider logic. Candidate buttons call the existing shell routing API; production dialog components are not changed. No confirm is exercised.

## Review states and limits

Current-round board sections lead with matched 390 × 844, 320 × 844, 1024 × 900 and 1440 × 900 views, RTL long action labels at both phone widths, Send-hidden fixtures and a separately labelled USD payout-unavailable explanation. Prior-round sections retain their existing frames and are labelled accordingly. RTL affects candidate actions only, not the product shell. F stresses the long main-pair labels while keeping its visible Send label concise.

Pinned-browser checks cover D/E/F at 320/390px with standard and 200% root text size, including long RTL labels, plus standard-text 1024/1440px. Action containers, buttons, icons and visible text are contained in these states, with every action target at least 44 × 44px. Enlarged-text checks scale the document root in the browser; existing story IDs and board frames are retained rather than adding separate scaled fixtures.

Shared story play checks semantic button roles, enabled main actions, no horizontal overflow within the actions or their buttons, minimum 44px control width/height, intrinsic equal heights and group containment for D/E/F, Send-hidden state, and offered Send activation setting `flow=send` through the existing routing API. That URL assertion proves route invocation only: the Storybook navigation mock does not render the corresponding dialog for these proposal controls. It does not verify a Send dialog or Next navigation/history.

Send off hides the candidate trigger only; it does not change the production offering provider. The unavailable fixture has no offramp providers and keeps Cash out enabled. Activating Cash out invokes the production routing API and adds `flow=cash-out` to the URL. The separately labelled static explanation names the US payout currency, not the asset or an invented disabled availability rule. Route invocation is not rendered availability proof.

This workshop does not verify Next navigation/history, provider availability, live money or full localization. Fixtures are credential-free; production behavior and components are unchanged. Story review scenarios are not adopted behavioral regression tests.

## Follow-up disposition

- Candidate selection: F selected by Jesse; see the decision record above.
- Production wiring: F adopted through HomeOverview, funding and transfer triggers without changing existing routing, owner or money behavior. The production HomePanel journey stories cover the saved Send-off offering and one remaining Cash out trigger.
- Routing/history and keyboard: production fixture entry regression covers the independent Send and Cash out dialogs, Close focus restoration and existing review/history paths without dispatch.
- Localization and money/provider validation: RTL is a direction/layout check, not full localization. This presentation adoption does not change provider or transaction behavior; credential-free fixture evidence does not prove live money.
- Unselected proposals: both rounds remain review evidence with unchanged IDs; no parallel production UI system.

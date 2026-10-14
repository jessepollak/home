# Cash-out action candidates

Exploration and selected F adoption of the Send treatment for [#1045](https://github.com/jessepollak/home/issues/1045)’s production cash-out slice. Curated board: `review-boards--cash-out-actions`, manifest `apps/web/stories/review/boards/cash-out-actions.json`.

Jesse selected **F · Labelled Send** with “F please!”. See the [decision record](../../design-explorations/decisions/cash-out-actions-1045.md). Production Home now adopts F; `Journeys/Home money actions` renders HomePanel with genuine triggers and a saved Send-off offering. Current-round D/E/F sections and retained A/B/C evidence keep their existing story/frame IDs.

## Current round · Send buttons

| Candidate | Default | RTL long labels | Send off | USD payout unavailable |
| --- | --- | --- | --- | --- |
| D · Outlined Send icon | `explorations-cash-out-actions--d-outlined-send` | `explorations-cash-out-actions--d-rtl-long` | `explorations-cash-out-actions--d-send-off` | `explorations-cash-out-actions--d-unavailable` |
| E · Horizontal paper-plane button | `explorations-cash-out-actions--e-horizontal-send` | `explorations-cash-out-actions--e-rtl-long` | `explorations-cash-out-actions--e-send-off` | `explorations-cash-out-actions--e-unavailable` |
| F · Labelled Send | `explorations-cash-out-actions--f-labelled-send` | `explorations-cash-out-actions--f-rtl-long` | `explorations-cash-out-actions--f-send-off` | `explorations-cash-out-actions--f-unavailable` |

D/E use owned `outline` / `shell-control` with lucide Send / SendHorizontal respectively; F uses `outline` / `touch` with lucide Send. All have visible resting button chrome and the primary Plus + Add money / outline Cash out pair; D/E/F Cash out now includes a decorative Landmark bank icon requested in preview feedback. D/E compare familiar paper-plane directions with identical clear button treatment: the initial secondary-surface E matched the shell background, so the revised set replaces it with the horizontal outlined button rather than inventing styling. Icon-only D/E have accessible Send names and at least 44 × 44 targets. F has icon + visible Send and minimum width to fit; RTL F shows concise **إرسال** with the full Send phrase as accessible name while long main-pair labels wrap.

D/E/F keep Send at the row end at standard text sizes at 320, 390, 1024 and 1440px. A shared intrinsic equal-height grid stretches all displayed buttons to the tallest label, including across wrapped rows; container-width thresholds preserve the compact Send width when the pair fits. Narrower or enlarged-text layouts adapt the pair's columns and wrap Send below, preserving Add money → Cash out → Send DOM order and all labels/variants. Pinned-browser checks cover standard and 200% root text at 320/390px, long RTL labels, Send off and unavailable, with equal heights, no action/button/text overflow and targets at least 44 × 44px. Scaling is applied in the browser to the existing stories, not through new IDs or board frames. A/B/C retain their original layout classes and icon treatment.

Default board frames are 390 × 844, 320 × 844, 1024 × 900 and 1440 × 900. RTL frames are 390 × 844 and 320 × 844. Send off and unavailable frames are 390 × 844. The complete new frame IDs are:

| Candidate | Default frames | RTL frames | State frames |
| --- | --- | --- | --- |
| D | `d-mobile`, `d-narrow`, `d-tablet`, `d-desktop` | `d-rtl390`, `d-rtl320` | `d-send-off`, `d-unavailable` |
| E | `e-mobile`, `e-narrow`, `e-tablet`, `e-desktop` | `e-rtl390`, `e-rtl320` | `e-send-off`, `e-unavailable` |
| F | `f-mobile`, `f-narrow`, `f-tablet`, `f-desktop` | `f-rtl390`, `f-rtl320` | `f-send-off`, `f-unavailable` |

Current sections: `round2-mobile`, `round2-narrow`, `round2-tablet`, `round2-desktop`, `round2-rtl390`, `round2-rtl320`, `round2-send-off`, `round2-unavailable`.

## Prior round · retained evidence

| Candidate | Default | RTL long labels | Send off | USD payout unavailable |
| --- | --- | --- | --- | --- |
| A · Text link | `explorations-cash-out-actions--a-text-link` | `explorations-cash-out-actions--a-rtl-long` | `explorations-cash-out-actions--a-send-off` | `explorations-cash-out-actions--a-unavailable` |
| B · Compact icon | `explorations-cash-out-actions--b-compact-icon` | `explorations-cash-out-actions--b-rtl-long` | `explorations-cash-out-actions--b-send-off` | `explorations-cash-out-actions--b-unavailable` |
| C · Quiet row | `explorations-cash-out-actions--c-quiet-row` | `explorations-cash-out-actions--c-rtl-long` | `explorations-cash-out-actions--c-send-off` | `explorations-cash-out-actions--c-unavailable` |

Prior default frames remain 390 × 844, 320 × 844 and 1440 × 900. RTL frames remain both phone sizes; Send off and unavailable remain 390 × 844. All original story and frame IDs are unchanged: `<a|b|c>-<mobile|narrow|desktop|rtl390|rtl320|send-off|unavailable>`. Section IDs remain `mobile`, `narrow`, `desktop`, `rtl390`, `rtl320`, `send-off`, `unavailable`; their titles now identify the prior round.

## Coverage boundary

Shared play checks semantic button roles, control sizes, action/button overflow, D/E/F equal heights and group containment, Send hidden, and offered Send activation setting `flow=send`. This asserts route invocation only: the Storybook navigation mock does not render dialogs. Send off and unavailable are story-only states, not real offering/provider validation. HomeOverview, CompositionShell and Activity fixtures remain identical. These stories add no production code or money/auth behavior; no unit tests are added because they are exploration review scenarios.

See [proposal boundary and follow-up disposition](../../design-explorations/cash-out-actions.md). F is adopted in production through the existing funding/transfer triggers. The Home money actions journey checks real dialog entry and the saved Send-off offering; the cash-out entry Playwright regression checks routes, keyboard activation, Close focus restoration and existing history/review behavior without dispatch. Proposal-only states remain comparison evidence, not live-provider or real-money proof.

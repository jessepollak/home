# Invest asset detail — #938

- **Surface:** Invest asset detail.
- **Axis:** full-bleed chart and page hierarchy.
- **Verbatim words:** “Full bleed seems right.”
- **Status:** selected.
- **Board frame link:** [review-boards--invest-asset-detail](/iframe.html?id=review-boards--invest-asset-detail&viewMode=story&frame=crypto) (current review context).
- **PR link:** [#982](https://github.com/jessepollak/home/pull/982).
- **Date:** 2026-09-26.

## Notes

Jesse selected Option A in [#938](https://github.com/jessepollak/home/issues/938): the full-bleed chart whose header follows the scrub. Options B (carded chart) and C (panel chart with a desktop rail) are not carried forward.

His refinement requests on the same review were to use the standard finance row for the balance; pin Buy/Sell to the viewport bottom, hide it while scrolling down and bring it back when scrolling stops; make the details more useful; keep the data vendor off the page except for a footnote; drop elements that don't help; lighten the scrub line; make pre-data, first data and range changes smooth; and use a chart library rather than a custom build.

Jesse approved the round-5 refinement on 2026-09-26 as merged in [#982](https://github.com/jessepollak/home/pull/982). [#939](https://github.com/jessepollak/home/issues/939) adopts it in production as `AssetDetailScreen` (Storybook `invest-asset-detail--*`). Stock positions show their value as unavailable until [#624](https://github.com/jessepollak/home/issues/624)'s valuation lands.

Separate round-5 decisions retain the [chart library](invest-chart-library-938.md), [market tiles](invest-market-tiles-939.md) and [trade-entry ownership](invest-trade-entry-935.md).

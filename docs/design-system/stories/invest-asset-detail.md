# Invest asset detail

Jesse selected the full-bleed Option A direction in #938. `apps/web/client/invest/asset-detail-screen.tsx` adopts it on the real Invest route; review it on the `review-boards--invest-asset-detail` Storybook board. The earlier PriceChart proposal was superseded.

The production `Invest/Asset detail` stories exercise crypto, stock, dynamic Base meme, held and unheld balances, localized quotes, market stats, empty/stale/slow/error history, chart scrub and range interactions, motion preferences, and the pinned trade bar. `Journeys/Invest asset detail` opens from Discover and a holding row, then returns focus to the opener. Review the grouped frames at `review-boards--invest-asset-detail` (manifest `apps/web/stories/review/boards/invest-asset-detail.json`). Stories use synthetic wallet and MSW market data; they do not replace verification on the real Invest route.

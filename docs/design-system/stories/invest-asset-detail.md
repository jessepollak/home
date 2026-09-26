# Invest asset detail exploration

- Exploration (#938, unreviewed; Jesse chose the full-bleed direction, Option A, and its round-5 refinement is not yet reviewed): `Explorations/Invest asset detail` (`explorations-invest-asset-detail--*`).
  - Option A: `option-a-crypto`, `option-a-stock`, `option-a-meme`, `option-a-stock-held`, `option-a-desktop`, `option-a-narrow`, `option-a-local-currency`, `configured-meme-unheld`.
  - Stats, including the proposed market-stats fixtures: `stats-proposed-contract`, `stats-meme-liquidity`, `stats-partial-history`.
  - Interaction: `asset-interaction-option-a`, `range-switch-back`, `range-switch-rapid`, `scrub-cursor`, `trade-bar-scroll`, `trade-bar-reduced-motion`, `motion-study`.
  - Entry: `discover-entry` and `holding-entry`. They record entry and Back as actions; Home routing and browser history are verified at adoption under browser validation.
  - Data states: `state-*`.
- The component lives in `apps/web/client/invest/explorations/` and production never imports it. Its proposed market-stats prop is not a production contract.

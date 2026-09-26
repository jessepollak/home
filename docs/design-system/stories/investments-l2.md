# Investments L2 proposal

Unreviewed proposal for #1038; production adoption #1040. These fixture-backed exploration and journey stories are not production routes or trade-eligibility changes.

Board: `review-boards--investments`.

- Shared comparison: `explorations-cash-l2--shared-portfolio`, `explorations-investments-l2--matching-cash`.
- Holdings: `explorations-investments-l2--funded`, `explorations-investments-l2--funded-desktop`, `explorations-investments-l2--single`, `explorations-investments-l2--empty`, `explorations-investments-l2--loading`, `explorations-investments-l2--partial-inventory`, `explorations-investments-l2--unpriced`, `explorations-investments-l2--metadata-fallback`, `explorations-investments-l2--refresh-failed`, `explorations-investments-l2--balances-failed`, `explorations-investments-l2--collateral`, `explorations-investments-l2--narrow`, `explorations-investments-l2--home-row-parity`.
- Detail: `explorations-investments-l2--detail`, `explorations-investments-l2--detail-collateral`, `explorations-investments-l2--detail-stock`, `explorations-investments-l2--detail-not-listed`.
- Journey: `journeys-investments-holdings--home-to-explore`, `journeys-investments-holdings--home-to-explore-desktop`.

The shared snapshot is a story-only fixture under `client/invest/explorations/`. The journey uses in-story view state; it does not verify Next routing or native Back. Production adoption must verify routing, focus and wallet trade availability in Home.

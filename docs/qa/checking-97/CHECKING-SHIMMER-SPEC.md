# Checking → Home shell shimmer (Jesse lock)

Cut any "Checking…" copy. Session restoring/validating → classic Home shell + Direction 1 shimmer placeholders.

## Kill
- Header label/badge "Checking…" / "Checking your account…"
- Blank white panel-stage
- Solid black hero bar / giant em-dash slab

## Target
- Header: Home mark + **Account** (disabled/quiet OK) — never Checking…
- Bottom nav Home | Invest
- Hero: gray-100 shimmer bar (~40–55% width), not black, not a number
- Action row: Add money / Send / Receive may stay solid; no private amounts until verified **unless** a same-`ownerKey` presentation cache hits
- Balances / Save teaser / Activity: gray shimmer blocks (not "No activity yet" while restoring)
- prefers-reduced-motion: static gray placeholders
- sr-only status OK; never visible Account chrome

**Phase A cache (#93):** no amounts until verified **unless** a same-`ownerKey` `home.balances.v1` presentation cache hits; then last-known hero/Balances may replace those shimmers. Address still hidden. Activity stays shimmer. Miss = today’s shimmer. Signed-out still never paints.

## Tokens
--home-blue #0052ff, ink #0a0b0d, muted #5b6270, gray-50 #f7f8fa, gray-100 #e6e8ec, radii 8/12. Shimmer ~1.2s sweep on gray-100.

## Acceptance
- [ ] No visible Checking… copy
- [ ] Classic Home shell during restoring/validating
- [ ] Shimmer placeholders (not black bar)
- [ ] No private amounts/address until verified, except same-`ownerKey` last-known presentation cache
- [ ] prefers-reduced-motion respected

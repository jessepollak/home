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
- Action row: Add money / Send / Receive may stay solid; no private amounts until verified
- Balances / Save teaser / Activity: gray shimmer blocks (not "No activity yet" while restoring)
- prefers-reduced-motion: static gray placeholders
- sr-only status OK; never visible Account chrome

## Tokens
--home-blue #0052ff, ink #0a0b0d, muted #5b6270, gray-50 #f7f8fa, gray-100 #e6e8ec, radii 8/12. Shimmer ~1.2s sweep on gray-100.

## Acceptance
- [ ] No visible Checking… copy
- [ ] Classic Home shell during restoring/validating
- [ ] Shimmer placeholders (not black bar)
- [ ] No private amounts/address until verified
- [ ] prefers-reduced-motion respected

# UI direction

Home uses a clean, product-first financial interface. Signed-in Home and Invest visual craft follows **Direction 1 — Vercel Editorial** (locked 2026-09-08). IA stays Home shell v2 + Invest discovery v3.

Base brand guidance (reviewed September 7, 2026) still informs the palette: `https://www.base.org/brand`, `https://www.base.org/brand/color`, and `https://www.base.org/brand/typography`.

## Direction 1 tokens

```
--home-ink:        #0a0b0d
--home-muted:      #5b6270
--home-white:      #ffffff
--home-canvas:     #f7f8fa   /* page / shell behind panels */
--home-hairline:   #e6e8ec
--home-blue:       #0052ff
--control-radius:  8px
--panel-radius:    12px
```

- Canvas behind modules; white panels; 1px hairlines. Panel radius 12px, controls 8px.
- Near-ink `#0a0b0d` over pure black. Muted copy uses `#5b6270`.
- Base blue is the single primary action accent (Add money, Buy, active tab). Send, Receive, Sell, and Account stay outline / quiet.
- Percent change is green up / red down — never blue. Chart stroke is Base blue (~1.5–2px) with fill only if `rgba(0, 82, 255, 0.06)`.
- Region accent is a whisper on currency marks only.
- No gradients, glass, heavy in-app drop shadows, or gamification chrome.
- Motion is short and optical (tab ≤180ms, chip ≤120ms, CTA press ≤100ms). `prefers-reduced-motion` is instant.
- Base Sans and Base Mono are not bundled because reuse rights for this project are unverified. Home uses a system sans-serif stack.
- Do not put legal disclosures, eligibility essays, contract lists, source roster walls, "not an endorsement," or similar compliance copy on product screens (Home, Save, Invest, Borrow, Fund, etc.). Registry and docs may record contracts and eligibility for builders. Product list and discovery UI must not surface them. Present disclosures only under Account → Disclosures / Terms (or an equivalent settings section). Account should gain that destination if it is missing.
- Review and confirm screens may show the **actionable** facts needed to complete an action (amount, fee, slippage, network). Do not turn those into catalog footnotes on list surfaces.

## Feature-module contract

Savings and Invest modules are passed into `HomeExperience` through `savingsContent` and `investContent`. Their scoped styles should use the Direction 1 tokens (`--home-ink`, `--home-muted`, `--home-white`, `--home-canvas`, `--home-hairline`, `--home-blue`) and the gray-scale aliases. Feature panels stay flat white on canvas with hairline separators — no gradients, glass, shadows, or restricted fonts.

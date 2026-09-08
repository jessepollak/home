# UI direction

Home uses a clean, product-first financial interface informed by the official Base brand guidance (reviewed September 7, 2026): `https://www.base.org/brand`, `https://www.base.org/brand/color`, and `https://www.base.org/brand/typography`.

- White and near-black lead; thin Base grays provide structure.
- Base blue is the single primary action accent. Country colors appear only as small location indicators.
- The interface uses no gradients, translucent layers, decorative brand assets, or copied Base fonts.
- Base Sans and Base Mono are not bundled because reuse rights for this project are unverified. Home currently uses a system sans-serif stack with no external font dependency.
- Layout, account state, activity, and navigation take priority over marketing illustration or unsupported financial claims.
- Do not put legal disclosures, eligibility essays, contract lists, source roster walls, "not an endorsement," or similar compliance copy on product screens (Home, Save, Invest, Borrow, Fund, etc.). Registry and docs may record contracts and eligibility for builders. Product list and discovery UI must not surface them. Present disclosures only under Account → Disclosures / Terms (or an equivalent settings section). Account should gain that destination if it is missing.
- Review and confirm screens may show the **actionable** facts needed to complete an action (amount, fee, slippage, network). Do not turn those into catalog footnotes on list surfaces.

## Feature-module contract

Savings and Invest modules are passed into `HomeExperience` through `savingsContent` and `investContent`. Their scoped styles can use the shared `--home-white`, `--home-ink`, `--home-blue`, and `--home-gray-50` through `--home-gray-800` tokens. Feature panels should stay flat and white with crisp gray separators, no gradients, glass, shadows, or restricted fonts.

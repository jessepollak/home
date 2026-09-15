# Local money coverage registry

The public [`/coverage`](../apps/web/app/coverage/page.tsx) page is a sourced inventory, not an eligibility or availability promise. It presents two independent facts:

- **Issuer/local-rail evidence** records what issuer or partner documentation described for an explicit country when research was checked. `documented` and `conditional` do not mean that a user is eligible or that Home can execute the route. Research is never inherited by another country that shares a currency.
- **Home route status** records implementation maturity. Only `live` means a funded route was proven in a hosted production environment. A `live` record must include a proof reference and checked date.

Quote price, spread, and fees are observations tied to a dated quote. They are never permanent properties of a route. The initial registry contains no quote observations and no live Home routes.

## Country and currency snapshot

The declared universe has **250 entries**: all 249 officially assigned ISO 3166-1 alpha-2 codes plus Unicode CLDR's `XK` territory code for Kosovo. Exceptional-reservation, user-assigned, deprecated, and macroregion codes are excluded. The checked-in [`coverage-countries-2026.json`](../apps/web/config/coverage-countries-2026.json) records English names and all current tender currencies rather than forcing one currency per country. Antarctica's CLDR `XXX` entry is represented as no current tender currency.

Snapshot sources and download metadata are embedded in the JSON:

- Unicode CLDR 48 English territory names and supplemental currency data (Unicode 16.0.0), downloaded 2026-09-15.
- SIX ISO 4217 List One, published 2026-01-01 and downloaded 2026-09-15, validates current currency codes.

The existing Home region records overlay this baseline and remain the source of truth for Home currency, candidate-asset, and issuer identities. The remaining entries are explicitly not configured in Home.

Issue #15 also contains currency-level euro-area research. That research is intentionally not inherited by individual countries: country coverage requires country-explicit evidence.

## GDP snapshot and map

Nominal GDP is the checked-in [`coverage-gdp-2024.json`](../apps/web/config/coverage-gdp-2024.json) World Bank snapshot for indicator `NY.GDP.MKTP.CD`, reference year 2024. Builds and tests do not fetch it. The snapshot preserves a row for every inventory entry: 200 of 250 have a 2024 figure and all others are `null`.

2024 is the latest sufficiently complete fixed year under the recorded rule: choose the latest year no more than 2% of the 250-entry universe below the most complete preceding candidate year. The download had 203 figures for 2023, 200 for 2024 (a 1.2% universe decline), and 186 for 2025. Missing values remain visible and sort after known values.

The map reuses Natural Earth v5.1.2 label points documented in `apps/web/client/landing/GEOGRAPHY.md`; each point links to its inventory row. Inventory entries without a Natural Earth point (`BQ`, `BV`, `CC`, `CX`, `GF`, `GP`, `MQ`, `RE`, `SJ`, `TK`, `YT`) remain available in the table and CSV. Polygons remain deferred.

When changing provider manifests or coverage records, run `bun check`. Consistency tests require both sides to use the same country, asset, provider, and payment-method identities. CSV output at `/coverage.csv` is generated deterministically from the full registry.

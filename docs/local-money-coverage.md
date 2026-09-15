# Local money coverage registry

The public [`/coverage`](../apps/web/app/coverage/page.tsx) page is a sourced inventory, not an eligibility or availability promise. It presents two independent facts:

- **Issuer/local-rail evidence** records what issuer or partner documentation described when research was checked. `documented` and `conditional` do not mean that a user is eligible or that Home can execute the route.
- **Home route status** records implementation maturity. Only `live` means a funded route was proven in a hosted production environment. A `live` record must include a proof reference and checked date.

Quote price, spread, and fees are observations tied to a dated quote. They are never permanent properties of a route. The initial registry contains no quote observations and no live Home routes.

## Sources and maintenance

Browser-safe records live in `apps/web/config/coverage.ts` beside the country presentation configuration. They reference existing country, fiat, funding-asset, provider, and payment-method identifiers. Research migrated from [issue #15](https://github.com/jessepollak/home/issues/15) keeps its original checked date; later implementation work must not upgrade research evidence into production proof.

Nominal GDP is the checked-in `apps/web/config/coverage-gdp-2023.json` World Bank snapshot for indicator `NY.GDP.MKTP.CD`, reference year 2023. Builds and tests do not fetch it. Missing values must remain visible and sort after known values.

The map reuses Natural Earth v5.1.2 label points documented in `apps/web/client/landing/GEOGRAPHY.md`. Unconfigured countries remain neutral. Status is assigned only to an explicit country record and never inherited from a shared currency.

When changing provider manifests or coverage records, run `bun check`. Consistency tests require both sides to use the same country, asset, provider, and payment-method identities. CSV output at `/coverage.csv` is generated deterministically from the registry.

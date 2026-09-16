# Local money coverage registry

The public [`/coverage`](../apps/web/app/coverage/page.tsx) page is a sourced inventory, not an eligibility or availability promise. It presents four distinct signals:

- **Stablecoin** records whether Home has identified a configured candidate asset for the country. Identified candidates still carry pending or additional verification and remain funding-disabled, so an identified candidate is a research lead, not an available asset. Countries without a candidate asset are reported as not identified.
- **1:1 onramp evidence** records what issuer or partner documentation described for an explicit country when research was checked. `documented` means #539 found a strict same-tender acquisition and redemption route; `conditional` means an asset or architecture exists but route or country proof remains unresolved; `not-found` includes missing and blocked routes. These statuses do not mean that a user is eligible or that Home can execute the route. Research is never inherited by another country that shares a currency.
- **Portfolio status** records Jesse's execution decision independently of issuer evidence and Home integration: `priority`, `deferred`, or `not-scoped`. A priority may contain multiple country route workstreams with currency, asset, provider/issuer, issue, and `planned`, `in-build`, or `blocked` stage. Priority never changes the evidence status or implies availability.
- **Integrated status** records implementation maturity. Only `live` means a funded route was proven in a hosted production environment. A `live` record must include a proof reference and checked date.

Quote price, spread, and fees are observations tied to a dated quote. They are never permanent properties of a route. The initial registry contains no quote observations and no live integrations.

## Country and currency snapshot

The declared universe has **250 entries**: all 249 officially assigned ISO 3166-1 alpha-2 codes plus Unicode CLDR's `XK` territory code for Kosovo. Exceptional-reservation, user-assigned, deprecated, and macroregion codes are excluded. The checked-in [`coverage-countries-2026.json`](../apps/web/config/coverage-countries-2026.json) records English names and all current tender currencies rather than forcing one currency per country. Antarctica's CLDR `XXX` entry is represented as no current tender currency.

Snapshot sources and download metadata are embedded in the JSON:

- Unicode CLDR 48 English territory names and supplemental currency data (Unicode 16.0.0), downloaded 2026-09-15.
- SIX ISO 4217 List One, published 2026-01-01 and downloaded 2026-09-15, validates current currency codes.

The existing Home region records overlay this baseline and remain the source of truth for Home currency, candidate-asset, and issuer identities. The remaining entries are explicitly not configured in Home.

The corrected #539 research cut-off is 2026-09-16. Its locked top-100 non-USD economy pass is represented country by country: 39 `documented`, 11 `conditional`, and 50 `not-found`; inventory entries outside that pass remain `not-researched` except for previously retained country-explicit research such as the US issuer route. The euro rows record EURe's bloc-documented architecture as issuer evidence, but each country still requires operational proof. Separately, Coinbase EUR→EURC is a priority workstream for all 21 configured euro-area countries, including Malta even though it falls outside the top-100 research pass. Coinbase eligibility remains country-explicit and pending, so its announcement does not promote issuer evidence or integration status.

The exact priority workstreams are Coinbase EURC (#294), Tetra CADD (#551), Juno/Bitso MXNB (#552), Ripio wARS/wBRL/wMXN/wCOP/wCLP/wPEN (#512), ASC cNGN (#553), ZARP (#554), IDRX (#555), AUDD (#556), and StraitsX XSGD (#557). CADD—not CADC—is the selected Canadian route; Mexico intentionally has both MXNB and wMXN. Ripio's Chile and Peru workstreams remain blocked because country-specific local fiat acquisition and redemption are not documented. Every other researched top-100 route is deferred. Entries outside the pass are not scoped, except Malta, which inherits only the explicit currency-level EURC priority decision—not issuer evidence or availability. The existing US/USD sandbox route is not part of this local non-USD portfolio.

## GDP snapshot and map

Nominal GDP is the checked-in [`coverage-gdp-2024.json`](../apps/web/config/coverage-gdp-2024.json) World Bank snapshot for indicator `NY.GDP.MKTP.CD`, reference year 2024. Builds and tests do not fetch it. The snapshot preserves a row for every inventory entry: 200 of 250 have a 2024 figure and all others are `null`.

2024 is the latest sufficiently complete fixed year under the recorded rule: choose the latest year no more than 2% of the 250-entry universe below the most complete preceding candidate year. The download had 203 figures for 2023, 200 for 2024 (a 1.2% universe decline), and 186 for 2025. Missing values remain visible and sort after known values.

The globe reuses Natural Earth v5.1.2 label points documented in `apps/web/client/landing/GEOGRAPHY.md`. All 239 sourced points render as markers; countries with explicit 1:1 onramp research are interactive and show all four signals. Marker tones describe issuer-route evidence only. Priority appears in globe detail but never changes marker tone. The complete 250-entry inventory remains available in the table and CSV, including entries without Natural Earth points (`BQ`, `BV`, `CC`, `CX`, `GF`, `GP`, `MQ`, `RE`, `SJ`, `TK`, `YT`). Polygons remain deferred.

When changing provider manifests or coverage records, run `bun check`. Consistency tests require runtime bindings and non-planned Home statuses to use the same country, asset, provider, and payment-method identities. Coverage-only priority route IDs and assets do not enter runtime funding registries or manifests.

CSV output at `/coverage.csv` is generated deterministically from the full registry. Portfolio workstreams use parallel pipe-delimited columns: `portfolio_route_ids`, `portfolio_route_currencies`, `portfolio_route_assets`, `portfolio_route_providers`, `portfolio_route_issue_numbers`, `portfolio_route_issue_urls`, and `portfolio_route_stages`. Values at the same position describe one route, and route order is stable in registry order (for Mexico, MXNB precedes wMXN). Empty workstream lists produce empty fields.

## Local Agentation feedback

For local visual comments (issue #480), Home mounts a development-only [Agentation](https://agentation.com) toolbar on every page in `next dev`, including `/coverage`; it never renders in production builds or Chromium smoke runs.

1. Start the app: `bun run dev`, then open the page to annotate (for example, default `http://localhost:3000/coverage`, or your worktree's assigned port).
2. If Pi is running with the user-global Agentation MCP configuration, it already serves the annotation API on port 4747. Only when working without Pi, start the fallback server manually: `npx -y agentation-mcp@1.2.0 server --port 4747`.
3. Annotate elements or text with the toolbar, then copy or send the structured output to your agent.
4. Stop a manually started fallback server when the feedback session ends. Pi-owned port 4747 remains open while the Pi MCP process runs; exit Pi or remove the MCP configuration and reload Pi to close it.

Pi picks up the Agentation MCP tools from the user-global MCP configuration (`~/.config/mcp/mcp.json`, configured outside this repository); reload Pi if the tools do not appear after configuring it.

Security caveat: `agentation-mcp@1.2.0` serves its HTTP annotation API on port 4747 with permissive CORS and no local authentication. Use it only during local feedback sessions on a trusted network. A manual fallback closes when stopped; Pi's port remains open until its MCP process exits or the configuration is removed and reloaded.

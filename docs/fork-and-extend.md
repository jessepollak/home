# Fork and extend

This is an operator guide for cloning Home. It does not authorize production use.

## Start

Follow [Get started](../README.md#get-started), then copy `.env.example` to gitignored `apps/web/.env.local` without overwriting an existing file. Run `bun dev`. Public surfaces work without credentials; authenticated features require your own provider projects and allowed origins.

## Customize

| What | Where |
| --- | --- |
| Brand, metadata, colors | Defaults: `apps/web/config/brand.ts` and `apps/web/app/globals.css`; administrators override brand values in the `brand` settings domain |
| Navigation | `apps/web/config/navigation.ts` |
| Region catalog and presentation | `apps/web/config/regions.ts` (offered countries and default region: Admin → Settings) |
| Wallet, savings, and Invest assets | `apps/web/config/portfolio-assets.ts`, `apps/web/shared/savings/config.ts`, `apps/web/config/invest-assets.ts` |
| Provider integrations | `apps/web/server/` and the matching docs |

Country selection changes presentation only. Asset identity is chain ID plus address, never a ticker. Replace Home and Base branding before publishing; see `apps/web/public/home-mark/PROVENANCE.md` before reusing the mark.

## Actions and hosting

Actions require `DATABASE_URL` and use the disposable `actions` schema applied by `bun run db:migrate`. Their contract is [Actions](actions.md) under [Architecture](architecture.md): server-authored calldata, verified scope, one owner-generation fence, and provider/chain-derived status. Do not point a fork at another operator’s database or provider project.

For a local database, run `bun run db:up` before setting `DATABASE_URL` and applying migrations.

The operator console at `/admin` includes a Settings section with the regions editor, an Invest pane for discovery visibility, and a Products and markets pane for Save, Borrow, Invest and Send entry modes; other sections remain empty states, and Account entry and operational data views are not yet available.

Operator settings live in Postgres and survive upstream updates. To add a settings domain, register its exact value parser, defaults, and `schemaVersion` under `shared/operator-settings/contract.ts`; provide an upgrade function for older stored versions. Never reuse a domain key for a different meaning. Database changes use additive migrations. Administrator reads fail closed when a stored version cannot be parsed or upgraded. Runtime domains are `support`, `brand`, `regions`, `invest`, and `products`. The `brand` domain uses the existing `operator_settings` table (migration 010), not a new table. Its saved display name, description, primary color, and background color take precedence over code defaults; with no row, reads return defaults without writing. Values require a trimmed display name (1–40 characters), trimmed description (1–160 characters), and lowercase `#rrggbb` colors; control and bidirectional characters and unknown fields are rejected. Black or white foregrounds are derived at a 4.5:1 contrast threshold. The server brand resolver also falls back to code defaults when the database is unset, unreadable, or holds an unparseable row. Brand settings are not yet applied to customer pages; layout, metadata, and the administrator editor are follow-up work.

For administrator brand reads and writes, set `DATABASE_URL`, run `bun run db:migrate`, and set `HOME_OPERATOR_ADDRESSES` as above. `GET/PUT /api/admin/settings/brand` requires an authorized administrator session; writes require the current revision and same origin. Without `DATABASE_URL`, the API returns 503 rather than using in-memory storage. Back up the `brand` row in `operator_settings` with normal Postgres backups. Recover by restoring the database or re-saving the values through the administrator API; deleting the row returns to code defaults, but deletion is a privileged database action. After an upstream update, use an authenticated administrator session to GET `/api/admin/settings/brand` and confirm a saved override still reports `source: "stored"` and the same revision recorded before the update.

The `regions` domain narrows the compiled catalog in `config/regions.ts` to the countries an operator offers and names a default region (Global or an offered country). With no saved row, every catalog country is offered and the default is the United States, read from code without writing anything; the console says which source is in effect. Once saved, countries added to the catalog by a later upstream update start off, and countries removed from the catalog are dropped from the saved list on read. Customers see only offered countries: a detected or chosen country that is not offered is ignored, the default applies when the customer has no saved choice and no offered detected country, and a customer whose saved choice was removed sees the global presentation with their balances and Activity intact. Removing a country also stops new funding entries through its corridors (listing, quotes, orders, provider verification, and new cash-outs); order status, webhooks, recovery, and cash-out withdrawal never read the setting. Presentation is cached per instance for about five seconds and an operator save clears the writing instance, so new page loads reflect a change within about five seconds and an open page keeps its country list until it navigates or reloads. New entries never reuse a cached offer: each listing, quote, order, verification, preference write, cash-out preparation, and confirmation reads the current setting, so a removed country stops new entries as soon as that read completes on any instance. A failed or timed-out read refuses new entries, and that refusal is reused for up to one second so a struggling database is not read on every entry. If the setting cannot be read, customers see the global presentation and new entries are refused. Without `DATABASE_URL` no setting can exist, so the built-in regions apply.

Invest visibility uses the same `operator_settings` table (migration 010). Its saved hidden categories and assets take precedence over the built-in catalog; with no row, reads return the full catalog without writing. The Invest pane at `/admin/settings` writes through `GET/PUT /api/admin/settings/invest` with the same authorized-session, same-origin, and revision rules. Settings gate new discovery only: hidden categories and assets leave shelves and search, while holdings, Activity, direct asset links, and trading stay available. When the database is unset, reads return the built-in catalog; when a configured database cannot be read, Home keeps its last-good value or, with none, hides discovery until the read recovers.

The `products` domain switches Save, Borrow and Invest entries on or exit-only and Send on or off, and narrows each Save vault and Borrow market to enabled or reducing-only. With no saved row, Home offers every compiled entry without writing anything, and the console names deployment values as the source. An operator save takes effect on the next read (about three seconds per instance, with the writing instance clearing at once); entries added to the compiled catalog after a save start reducing-only, and saved ids removed from the catalog are ignored and listed. Settings gate new entries only: status, repay, sell, cash out, and a collateral withdrawal with no outstanding debt never read the setting, and a customer whose product is paused keeps balances and Activity. A collateral withdrawal against outstanding debt can increase risk, so it is refused once the market is not offered and is rechecked at confirmation.

Use the [operator checklist](operator-checklist.md) for values and destinations. For Vercel settings, see [Vercel deploy](vercel-deploy.md). For CDP configuration, see [CDP setup](cdp-setup.md). For funding adapters, see the [issuer integration guide](integrations/README.md).

## Before publishing

- Keep secrets out of git and use your own provider credentials.
- Do not infer eligibility from the country preference, language, or UI copy. Stock buys use only the trusted edge request country. Self-hosted forks fail closed unless their edge overwrites `x-vercel-ip-country` and they set `HOME_TRUST_EDGE_COUNTRY_HEADER=true`; stock sells to Base USDC remain allowed.
- Keep exact amounts, fees, network, and asset identity on action review.
- Run `bun check` before sharing a focused upstream change.

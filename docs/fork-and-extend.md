# Fork and extend

This is an operator guide for cloning Home. It does not authorize production use.

## Start

Follow [Get started](../README.md#get-started), then copy `.env.example` to gitignored `apps/web/.env.local` without overwriting an existing file. Run `bun dev`. Public surfaces work without credentials; authenticated features require your own provider projects and allowed origins.

## Customize

| What | Where |
| --- | --- |
| Brand, metadata, colors | Defaults: `apps/web/config/brand.ts` and `apps/web/app/globals.css`; administrators override brand values in the `brand` settings domain |
| Navigation | `apps/web/config/navigation.ts` |
| Regions and presentation | `apps/web/config/regions.ts` |
| Wallet, savings, and Invest assets | `apps/web/config/portfolio-assets.ts`, `apps/web/shared/savings/config.ts`, `apps/web/config/invest-assets.ts` |
| Provider integrations | `apps/web/server/` and the matching docs |

Country selection changes presentation only. Asset identity is chain ID plus address, never a ticker. Replace Home and Base branding before publishing; see `apps/web/public/home-mark/PROVENANCE.md` before reusing the mark.

## Actions and hosting

Actions require `DATABASE_URL` and use the disposable `actions` schema applied by `bun run db:migrate`. Their contract is [Actions](actions.md) under [Architecture](architecture.md): server-authored calldata, verified scope, one owner-generation fence, and provider/chain-derived status. Do not point a fork at another operator’s database or provider project.

For a local database, run `bun run db:up` before setting `DATABASE_URL` and applying migrations.

Administrator access is separate from deployment access and customer sign-in. Set the server-only `HOME_OPERATOR_ADDRESSES` to a comma-separated list of Base smart-account addresses (each `0x` plus 40 hex digits), then redeploy. Editing the list and redeploying admits new addresses and denies removed ones without changing customer sessions or data; blank or malformed lists deny all. On a protected deployment, verify `curl -i https://<host>/api/admin/session` without Home authentication returns 401 with `Cache-Control: private, no-store`; a non-admin Home session returns 403, and an administrator returns 200. Supply protected-deployment access separately and never include tokens in recorded output. The operator console at `/admin` provides navigation and empty-state sections; Account entry and operational data views are not yet available.

Operator settings live in Postgres and survive upstream updates. To add a settings domain, register its exact value parser, defaults, and `schemaVersion` under `shared/operator-settings/contract.ts`; provide an upgrade function for older stored versions. Never reuse a domain key for a different meaning. Database changes use additive migrations. Administrator reads fail closed when a stored version cannot be parsed or upgraded. The `brand` domain uses the existing `operator_settings` table (migration 010), not a new table. Its saved display name, description, primary color, and background color take precedence over code defaults; with no row, reads return defaults without writing. Values require a trimmed display name (1–40 characters), trimmed description (1–160 characters), and lowercase `#rrggbb` colors; control and bidirectional characters and unknown fields are rejected. Black or white foregrounds are derived at a 4.5:1 contrast threshold. The server brand resolver also falls back to code defaults when the database is unset, unreadable, or holds an unparseable row. Brand settings are not yet applied to customer pages; layout, metadata, and the administrator editor are follow-up work.

For administrator brand reads and writes, set `DATABASE_URL`, run `bun run db:migrate`, and set `HOME_OPERATOR_ADDRESSES` as above. `GET/PUT /api/admin/settings/brand` requires an authorized administrator session; writes require the current revision and same origin. Without `DATABASE_URL`, the API returns 503 rather than using in-memory storage. Back up the `brand` row in `operator_settings` with normal Postgres backups. Recover by restoring the database or re-saving the values through the administrator API; deleting the row returns to code defaults, but deletion is a privileged database action. After an upstream update, use an authenticated administrator session to GET `/api/admin/settings/brand` and confirm a saved override still reports `source: "stored"` and the same revision recorded before the update.

Use the [operator checklist](operator-checklist.md) for values and destinations. For Vercel settings, see [Vercel deploy](vercel-deploy.md). For CDP configuration, see [CDP setup](cdp-setup.md). For funding adapters, see the [issuer integration guide](integrations/README.md).

## Before publishing

- Keep secrets out of git and use your own provider credentials.
- Do not infer eligibility from the country preference, language, or UI copy. Stock buys use only the trusted edge request country. Self-hosted forks fail closed unless their edge overwrites `x-vercel-ip-country` and they set `HOME_TRUST_EDGE_COUNTRY_HEADER=true`; stock sells to Base USDC remain allowed.
- Keep exact amounts, fees, network, and asset identity on action review.
- Run `bun check` before sharing a focused upstream change.

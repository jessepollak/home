# Fork and extend

This is an operator guide for cloning Home. It does not authorize production use.

## Start

Follow [Get started](../README.md#get-started), then copy `.env.example` to gitignored `apps/web/.env.local` without overwriting an existing file. Run `bun dev`. Public surfaces work without credentials; authenticated features require your own provider projects and allowed origins.

## Customize

| What | Where |
| --- | --- |
| Brand, metadata, colors | `apps/web/config/brand.ts`, `apps/web/app/globals.css` |
| Navigation | `apps/web/config/navigation.ts` |
| Regions and presentation | `apps/web/config/regions.ts` |
| Wallet, savings, and Invest assets | `apps/web/config/portfolio-assets.ts`, `apps/web/shared/savings/config.ts`, `apps/web/config/invest-assets.ts` |
| Provider integrations | `apps/web/server/` and the matching docs |

Country selection changes presentation only. Asset identity is chain ID plus address, never a ticker. Replace Home and Base branding before publishing; see `apps/web/public/home-mark/PROVENANCE.md` before reusing the mark.

## Actions and hosting

Actions require `DATABASE_URL` and use the disposable `actions` schema applied by `bun run db:migrate`. Their contract is [Actions](actions.md) under [Architecture](architecture.md): server-authored calldata, verified scope, one owner-generation fence, and provider/chain-derived status. Do not point a fork at another operator’s database or provider project.

For a local database, run `bun run db:up` before setting `DATABASE_URL` and applying migrations.

Administrator access is separate from deployment access and customer sign-in. Set the server-only `HOME_OPERATOR_ADDRESSES` to a comma-separated list of Base smart-account addresses (each `0x` plus 40 hex digits), then redeploy. Editing the list and redeploying admits new addresses and denies removed ones without changing customer sessions or data; blank or malformed lists deny all. On a protected deployment, verify `curl -i https://<host>/api/admin/session` without Home authentication returns 401 with `Cache-Control: private, no-store`; a non-admin Home session returns 403, and an administrator returns 200. Supply protected-deployment access separately and never include tokens in recorded output. Account entry and shell presentation await #638.

For Vercel settings, see [Vercel deploy](vercel-deploy.md). For CDP configuration, see [CDP setup](cdp-setup.md). For funding adapters, see the [issuer integration guide](integrations/README.md).

## Before publishing

- Keep secrets out of git and use your own provider credentials.
- Do not infer eligibility from country, language, or UI copy.
- Keep exact amounts, fees, network, and asset identity on action review.
- Run `bun check` before sharing a focused upstream change.

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

Actions require `DATABASE_URL` and use the disposable `actions` schema applied by `bun run db:migrate`. Their contract is [Home is thin](home-is-thin.md): server-authored calldata, verified scope, one owner-generation fence, and provider/chain-derived status. Do not point a fork at another operator’s database or provider project.

For Vercel settings, see [Vercel deploy](vercel-deploy.md). For CDP configuration, see [CDP setup](cdp-setup.md). For funding adapters, see the [issuer integration guide](integrations/README.md).

## Before publishing

- Keep secrets out of git and use your own provider credentials.
- Do not infer eligibility from country, language, or UI copy.
- Keep exact amounts, fees, network, and asset identity on action review.
- Run `bun check` before sharing a focused upstream change.

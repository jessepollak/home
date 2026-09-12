# Vercel deploy (bun monorepo)

This is an operator build-settings note, not production authorization.

## Project settings

Keep **Root Directory** at the repository root so the root lockfile and workspace scripts apply.

| Setting | Value |
| --- | --- |
| Root Directory | Repository root |
| Framework preset | Next.js |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build` |
| Node.js | 22+ |

## Environment

Copy names from [`.env.example`](../.env.example); keep values in Vercel or gitignored `apps/web/.env.local`. Never expose server keys with `NEXT_PUBLIC_`.

Actions require server-only `DATABASE_URL`; apply the disposable schema with `bun run db:migrate` (idempotent; safe on a database bootstrapped by the earlier runtime DDL). Configure server-only `BASE_RPC_URL` for hosted Base reads. Email sign-in requires the CDP project ID plus server validation keys. See [CDP setup](cdp-setup.md) for allowed origins.

The action contract is [Home is thin](home-is-thin.md): Home records confirmed actions, while CDP/Base and Base receipts provide execution status. A green deployment does not authorize a real-money launch.

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

### Skew Protection

For the Vercel project `home-web`, **Project Settings → Advanced → Skew Protection** is enabled with a 12-hour max age.

Next exposes the serving deployment ID to client code, and Home adds it as the `x-deployment-id` header on client requests to `/api/*`. No environment variable is required. We use the explicit header rather than the alternative experimental `experimental.useSkewCookie` option.

Verify against a preview after an older deployment passes the configured max age:

```sh
# Set <old dpl id>, <current dpl id>, and <preview> from the Vercel preview deployments.
curl -sI -H "x-deployment-id: <old dpl id>" https://<preview>/api/market-prices    # 404 (expected; verify once on a preview)
curl -sI -H "x-deployment-id: <current dpl id>" https://<preview>/api/market-prices # 200
```

## Environment

Copy names from [`.env.example`](../.env.example); keep values in Vercel or gitignored `apps/web/.env.local`. Never expose server keys with `NEXT_PUBLIC_`.

Actions require server-only `DATABASE_URL`; apply the disposable schema with `bun run db:migrate` (idempotent; safe on a database bootstrapped by the earlier runtime DDL). Configure server-only `BASE_RPC_URL` for hosted Base reads. Email sign-in requires the CDP project ID plus server validation keys. See [CDP setup](cdp-setup.md) for allowed origins.

The action contract is [Home is thin](home-is-thin.md): Home records confirmed actions, while CDP/Base and Base receipts provide execution status. A green deployment does not authorize a real-money launch.

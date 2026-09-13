# Architecture review — growing the engineering team

**Date:** September 12, 2026. This is the current-tree engineering guide. The action contract is [Home is thin](home-is-thin.md).

## A. Working model

- Home is one Next.js app in `apps/web`; use the client / shared / server split and thin API routes.
- The server verifies scope and authors calldata. Token quantities stay `bigint` from the boundary in.
- One `actions` table records confirmed user actions. The client follows **prepare → confirm → dispatch through CDP or Base → record handle**. Provider and chain data determine execution status.
- The owner-generation fence must be checked before every provider call and server post. Owner changes clear client queries.
- Remote client state uses TanStack Query with owner-prefixed keys. The persistent shell exposes flows through shallow URLs, including `?flow=send&action=<id>`.
- Keep provider credentials server-side. Country and presentation configuration never confer eligibility.

## B. Current boundaries

| Layer | Owns |
| --- | --- |
| `app/` | Pages, layouts, and thin routes |
| `client/` | UI, URL-addressable flows, query consumers |
| `shared/` | Validation, calldata builders, amount and presentation utilities |
| `server/` | Verified sessions, provider calls, action records, receipts |
| `config/` | Brand, navigation, regions, and asset identities |

Use [Home is thin](home-is-thin.md) for action schema, failure modes, and retry rules. Use [Vercel deploy](vercel-deploy.md) for hosting and [Fork and extend](fork-and-extend.md) for operators.

## C. Risks worth reviewing

- Client files must not runtime-import server credentials or database code.
- Exact asset identity is chain ID plus address; a ticker is only a label.
- Activity and action rows dedupe by transaction hash; presentation must not turn country selection into eligibility.
- A provider or transport failure can be ambiguous. Do not issue another dispatch automatically.
- Preserve the shell frame budget: pointer motion and price ticks use transforms, opacity, motion values, or imperative text writes—not React state per update.

## D. Contribution contract for new engineers

1. Start with [Home is thin](home-is-thin.md), then the route and feature code you will change.
2. Keep one feature lane per change. Treat action execution and session lifecycle as shared boundaries.
3. Do not accept browser-authored calldata, client identity, or a client-supplied wallet as authorization.
4. Keep action work to the thin flow: prepare, confirm, dispatch once, then record provider/chain evidence.
5. Use owner-prefixed query keys and clear the query client when the owner generation changes.
6. Add behavioral tests for a regression that would matter; use exact bigint fixtures for amounts. Do not add copy, layout, animation, sleep, or source-text tests.
7. Run `bun check`; run the browser smoke for shell, session, or action-flow changes. Keep live provider and funded-wallet checks out of CI.
8. Update the current doc in the same change when a user-visible or execution contract changes.

## Appendix — merge hotspots (coordinate, don’t both edit)

1. `apps/web/client/account/cdp-session-lifecycle.tsx`
2. `apps/web/client/account/cdp-money-action-execution.ts`
3. `apps/web/client/home/shell.tsx`
4. `apps/web/client/query/query-client.tsx`
5. `apps/web/server/money-actions/`
6. `apps/web/config/portfolio-assets.ts` and `apps/web/shared/savings/config.ts`

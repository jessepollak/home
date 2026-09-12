# Issuer integration guide

Status: issuer walkthrough for the #301 funding-provider seam candidate, September 12, 2026. This page does not authorize a funded test, deployment, provider enablement, or merge.

## Current status and prerequisites

| Capability | Current `main` | Prerequisite for this walkthrough |
| --- | --- | --- |
| Provider contract, IDRX/Ripio adapters, orders/evidence, and Add money order UI | Implemented in the #301 candidate; review the exact branch before use | [#301](https://github.com/jessepollak/home/issues/301) |
| Native Base Account session without CDP | Not implemented; current Base Account sign-in is CDP-backed | [#288](https://github.com/jessepollak/home/issues/288) |
| Local Postgres (`docker-compose`, `bun run db:up`) | Not implemented; money actions need configured Postgres | [#289](https://github.com/jessepollak/home/issues/289) |

The seam contract is [`apps/web/shared/funding/provider-contract.ts`](../../apps/web/shared/funding/provider-contract.ts), the canonical registry is [`assets.ts`](../../apps/web/shared/funding/assets.ts), and reference adapters live under [`apps/web/server/funding/providers/`](../../apps/web/server/funding/providers/). Legacy Coinbase and Ripio files remain until replacement parity and #293 cleanup review.

## Seven steps for an issuer

The local sign-in and database commands in steps 2–3 land with #288/#289; until those merge, use an isolated operator database and the existing verified account flow. Never infer that candidate code is deployed.

1. **Clone and install.** Clone Home and run `bun install --frozen-lockfile`. Start from [Get started](../../README.md#get-started); keep credentials in gitignored `apps/web/.env.local`.
2. **Start local Postgres and Home.** Run `bun run db:up`, `bun run money-actions:migrate`, `bun run funding:migrate`, then `bun dev`. #289 supplies these local-only commands; never substitute a shared or production database.
3. **Sign in locally.** Use the native Base Account session from #288. The verified server session, not a browser address, region, or provider customer ID, supplies the destination address.
4. **Copy and register a reference adapter.** Copy `apps/web/server/funding/providers/idrx/` (polling) or `providers/ripio/` (quotes, KYC, webhooks) to `providers/<your-provider>/`, then register it in `providers/index.ts`. The checked-in manifest, asset registry, and adapter types delivered by #301 are authoritative.
5. **Configure declared credentials only.** Put `FUNDING_QUOTE_SECRET` and only the adapter manifest’s variables in `.env.local`; never commit them or use `NEXT_PUBLIC_`. Configuration makes a binding appear in `GET /api/funding/providers?region=`, but grants neither production nor funded-test authority.
6. **Run fixture-only checks, then the flow.** From the repository root, run `bun test apps/web/server/funding apps/web/shared/funding apps/web/client/funding`; this exercises adapters, store/core/routes, and UI with synthetic fixtures and makes no live provider writes. Then run `bun check`. Do not run a payment without operator authorization; keep provider and funded-wallet secrets out of CI.
7. **Open the upstream PR with bounded proof.** Include the adapter, manifest, and `source: "synthetic"` fixtures; attach one 390px local-flow clip and a dated environment line in the adapter README. Use `owner:hugo`, `lane:backend`, `priority:p1`, and `status:working`, with `Closes #301` when working on that issue. End crew-written comments with `<!-- hugo -->`. Fresh review is required, and only Jesse approves and merges.

## What the seam core enforces

The seam core—not an adapter—owns the session-derived Base destination, configured binding and exact registry asset, one reservation/no retry after ambiguous create, quote binding, owner-scoped private/no-store reads, status observation, verified webhooks, and receipt/log evidence before `received`. A provider can report provider state; it cannot declare funds received.

This does not change the legacy Coinbase route. Read the checked-in provider contract, routes, store, and conformance harness after they land rather than copying this summary into an API manual.

## Authority and safety

No guide step grants access to a funded wallet, issuer account, production credentials, deployment, provider enablement, or merge authority. Live probes remain opt-in and outside CI. The operator controls credentials; Jesse alone gives final approval and merges. See the [operating manual](../operating-manual.md#delivery-loop) and [delivery gates](../delivery-gates.md).

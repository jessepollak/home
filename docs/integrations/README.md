# Issuer integration guide

Status: planned issuer walkthrough, September 12, 2026. The funding-provider seam is not in `main`; [#301](https://github.com/jessepollak/home/issues/301) consolidates the closed layered tickets (#283, #287, #290, #291, and this guide). This page does not authorize a funded test, deployment, provider enablement, or merge. Track the design and delivery status in [#282](https://github.com/jessepollak/home/issues/282).

## Current status and prerequisites

| Capability | Current `main` | Prerequisite for this walkthrough |
| --- | --- | --- |
| Provider contract, IDRX/Ripio adapters, orders/evidence, and Fund order UI | Not implemented; `main` has the legacy Coinbase route and a synthetic Ripio preview | [#301](https://github.com/jessepollak/home/issues/301) |
| Native Base Account session without CDP | Not implemented; current Base Account sign-in is CDP-backed | [#288](https://github.com/jessepollak/home/issues/288) |
| Local Postgres (`docker-compose`, `bun run db:up`) | Not implemented; money actions need configured Postgres | [#289](https://github.com/jessepollak/home/issues/289) |

Current authoritative code is [`apps/web/server/funding/handler.ts`](../../apps/web/server/funding/handler.ts) for the private Coinbase hosted-session route, [`apps/web/client/funding/funding-experience.tsx`](../../apps/web/client/funding/funding-experience.tsx) for the current Fund UI, and [`apps/web/server/funding/ripio-client.ts`](../../apps/web/server/funding/ripio-client.ts) for the legacy Ripio client. None is a seam adapter or provider-order contract.

## Seven steps for an issuer

Use this target walkthrough only after #301, #288, and #289 are merged. Do not infer an unmerged endpoint, adapter directory, or behavior from these names.

1. **Clone and install.** Clone Home and run `bun install --frozen-lockfile`. Start from [Get started](../../README.md#get-started); keep credentials in gitignored `apps/web/.env.local`.
2. **Start local Postgres and Home.** Run `bun run db:up`, `bun run money-actions:migrate`, then `bun dev`. #289 supplies these local-only commands; never substitute a shared or production database.
3. **Sign in locally.** Use the native Base Account session from #288. The verified server session, not a browser address, region, or provider customer ID, supplies the destination address.
4. **Copy and register a reference adapter.** Copy `apps/web/server/funding/providers/idrx/` (polling) or `providers/ripio/` (quotes, KYC, webhooks) to `providers/<your-provider>/`, then register it in `providers/index.ts`. The checked-in manifest, asset registry, and adapter types delivered by #301 are authoritative.
5. **Configure declared credentials only.** Put only the adapter manifest’s variables in `.env.local`; never commit them or use `NEXT_PUBLIC_`. Today’s `.env.example` has only legacy `RIPIO_CLIENT_ID_<COUNTRY>` / `RIPIO_CLIENT_SECRET_<COUNTRY>` pairs. Configuration makes a binding available; it grants neither production nor funded-test authority.
6. **Run fixture-only checks, then the flow.** From the repository root, run `bun test apps/web/server/funding`; it exercises the current focused funding tests with fixtures/test doubles and makes no provider writes or secret-dependent calls. After #301 lands, run its checked-in adapter conformance test in that same directory before selecting the binding in Add money; do not run a payment without operator authorization. Finish with `bun check`; keep provider and funded-wallet secrets out of CI.
7. **Open the upstream PR with bounded proof.** Include the adapter, manifest, and synthetic-marked fixtures; attach a short local-flow clip and a dated environment line in the adapter README. Use `owner:hugo`, `lane:dx` (or the implementation lane), `priority:p1`, and `status:working`. This guide’s PR body is `Closes #292`; adapter PRs close their own tracking issue. End crew-written comments with `<!-- hugo -->`. Fresh review is required, and only Jesse approves and merges.

## What the seam core enforces

When #301 lands, its core—not an adapter—will own the session-derived Base destination, configured binding and exact registry asset, one reservation/no retry after ambiguous create, quote binding, owner-scoped private/no-store reads, status observation, verified webhooks, and receipt/log evidence before `received`. A provider can report provider state; it cannot declare funds received.

This is the #301 delivery contract, not behavior of the current Coinbase route. Read the checked-in provider contract, routes, store, and conformance harness after they land rather than copying this summary into an API manual.

## Authority and safety

No guide step grants access to a funded wallet, issuer account, production credentials, deployment, provider enablement, or merge authority. Live probes remain opt-in and outside CI. The operator controls credentials; Jesse alone gives final approval and merges. See the [operating manual](../operating-manual.md#delivery-loop) and [delivery gates](../delivery-gates.md).

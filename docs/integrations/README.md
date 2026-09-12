# Issuer integration guide

Status: implementation guide for the funding-provider seam, September 12, 2026. The seam is **not integrated yet**: this guide separates the running application from the seven-step issuer walkthrough that becomes available after its dependencies land. It does not authorize a funded test, deployment, or provider enablement. Track the work in [#282](https://github.com/jessepollak/home/issues/282).

## What exists today

- Home has an authenticated, private `POST /api/funding/onramp-session` route for the existing Coinbase hosted flow. Its current contract is the code in [`apps/web/server/funding/handler.ts`](../../apps/web/server/funding/handler.ts), not this guide.
- The current Fund UI has the Coinbase flow and a synthetic Ripio preview; it is not the provider-order UI. See [`apps/web/client/funding/funding-experience.tsx`](../../apps/web/client/funding/funding-experience.tsx).
- The legacy Ripio client and its country credential pairs exist, but are not seam adapters: [`apps/web/server/funding/ripio-client.ts`](../../apps/web/server/funding/ripio-client.ts) and [`.env.example`](../../.env.example).
- Money actions require `DATABASE_URL` and `MONEY_ACTION_POSTGRES_CUTOVER=verified-empty`; local `db:up` is not available until [#289](https://github.com/jessepollak/home/issues/289) lands. See [Fork and extend](../fork-and-extend.md#local-spike-vs-production).
- Base Account sign-in currently uses the CDP-backed path. Native, no-CDP sign-in is [#288](https://github.com/jessepollak/home/issues/288), not a current clone capability.

## Seven steps for an issuer

Follow these steps **after [#287](https://github.com/jessepollak/home/issues/287), [#289](https://github.com/jessepollak/home/issues/289), [#290](https://github.com/jessepollak/home/issues/290), and [#291](https://github.com/jessepollak/home/issues/291) are merged**. Until then, do not infer a route, endpoint, directory, or test command from the target names below.

1. **Clone and install.** Clone Home, then run `bun install --frozen-lockfile`. Start from the root [Get started](../../README.md#get-started) instructions; keep credentials in gitignored `apps/web/.env.local`.
2. **Start local Postgres and Home.** Run `bun run db:up`, then `bun run money-actions:migrate`, and `bun dev`. These commands and the local database contract are supplied by [#289](https://github.com/jessepollak/home/issues/289); do not substitute a shared or production database.
3. **Sign in to the local app.** Open the local origin and use Base Account sign-in. [#288](https://github.com/jessepollak/home/issues/288) supplies the local native session path; its server session is the authority for the destination address. A browser address, region setting, or provider-supplied customer identifier is never authorization.
4. **Copy a reference adapter and register it.** Copy `apps/web/server/funding/providers/idrx/` for the polling-only shape, or `apps/web/server/funding/providers/ripio/` for quotes, KYC, and webhooks, into `providers/<your-provider>/`; add the provider to `providers/index.ts`. Those directories, manifest contract, asset registry, and conformance harness are delivered by [#283](https://github.com/jessepollak/home/issues/283) and [#287](https://github.com/jessepollak/home/issues/287). Use the checked-in manifest and adapter types as the authoritative contract.
5. **Configure only your adapter's declared environment.** Put the credentials named by the adapter manifest in `apps/web/.env.local`; never commit them or expose them with `NEXT_PUBLIC_`. The current `.env.example` provider block documents only the legacy `RIPIO_CLIENT_ID_<COUNTRY>` / `RIPIO_CLIENT_SECRET_<COUNTRY>` pairs. The seam's provider-specific variables land with its adapter; configured credentials make that binding available, not a production or funded-test authorization.
6. **Run the flow and conformance checks.** In Add money, select the configured deposit binding, complete any declared KYC fields, obtain a quote when the adapter supports one, and follow the returned payment instructions. Run the adapter conformance test and the focused Funding tests from the commands supplied with [#283](https://github.com/jessepollak/home/issues/283), then `bun check`. The [#291](https://github.com/jessepollak/home/issues/291) Fund UI replaces today’s hard-coded/synthetic choices. Do not put provider or funded-wallet secrets into CI.
7. **Open the upstream PR with bounded proof.** Include the adapter, manifest, fixtures marked synthetic where applicable, and a short clip of the local flow. Add a dated line to that adapter’s README naming the environment used. Use labels `owner:hugo`, `lane:dx` (or the appropriate implementation lane), `priority:p1`, and `status:working`; set the PR body to `Closes #292` only for this guide’s PR. Every crew-written PR comment ends with `<!-- hugo -->`. A fresh review is required; only Jesse approves and merges. A clip is review evidence, not enablement, deployment, or funded authority.

## What the seam core enforces

The in-flight core work in [#290](https://github.com/jessepollak/home/issues/290) owns the safety-bearing lifecycle so an adapter does not: session-derived Base destination; configured binding and exact registry asset; one reserved order and no retry after an ambiguous create; quote-token binding; owner-scoped private/no-store reads; provider status observation; webhook verification; and receipt/log evidence before `received`. The provider reports provider state; it cannot declare funds received.

Those are planned contracts, not behavior in the current hosted Coinbase route. Review the checked-in `apps/web/shared/funding/provider-contract.ts`, core routes, store, and adapter conformance harness once they land rather than copying this summary into an API manual.

## Authority and safety

No guide step grants access to a funded wallet, issuer account, production credentials, deployment, provider enablement, or merge authority. Keep live probes opt-in and outside CI. The operator controls provider credentials; Jesse alone gives final approval and merges. See the [operating manual](../operating-manual.md#delivery-loop) and [delivery gates](../delivery-gates.md).

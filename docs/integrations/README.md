# Issuer integration guide

Status: issuer walkthrough for the funding-provider seam on `main`, September 13, 2026. This page does not authorize a funded test, deployment, provider enablement, or merge. Provider hosted acceptance is a separate loop; see [local development versus provider hosted acceptance](#local-development-versus-provider-hosted-acceptance).

## Current status and prerequisites

| Capability | Current `main` | What to use |
| --- | --- | --- |
| Provider contract, IDRX/Ripio/Coinbase adapters, orders/evidence, and Add money order UI | Shipped in [#284](https://github.com/jessepollak/home/pull/284) / [#301](https://github.com/jessepollak/home/issues/301) | The checked-in seam and provider READMEs |
| Home-native Base Account sign-in | Shipped ([#404](https://github.com/jessepollak/home/pull/404)); Base Account always uses Home-native SIWE and needs only `HOME_SESSION_SECRET` (at least 32 characters) | No CDP project required; `NEXT_PUBLIC_CDP_PROJECT_ID` only adds email sign-in |
| Local Postgres | Shipped via `docker-compose.yml` and `bun run db:up` | Docker and the local `DATABASE_URL` below |
| Coinbase headless Orders API | In review in [#398](https://github.com/jessepollak/home/pull/398) | `main` still uses the Coinbase hosted redirect |

The seam contract is [`apps/web/shared/funding/provider-contract.ts`](../../apps/web/shared/funding/provider-contract.ts), assets are registered in [`apps/web/shared/funding/assets.ts`](../../apps/web/shared/funding/assets.ts), and IDRX, Ripio, and Coinbase adapters live under [`apps/web/server/funding/providers/`](../../apps/web/server/funding/providers/). The API exposes providers, quotes, orders/list/status, and provider webhooks under [`apps/web/app/api/funding/`](../../apps/web/app/api/funding/). Root `bun run db:migrate` applies both database and funding migrations; the legacy Ripio store, reconciliation, migration, contract, and bespoke webhook stack has been removed.

## Seven steps for an issuer

1. **Clone and install.** Run:

   ```sh
   git clone https://github.com/jessepollak/home.git
   cd home
   bun install --frozen-lockfile
   cp .env.example apps/web/.env.local
   ```

   If `apps/web/.env.local` already exists, keep it and add only the missing names. It is gitignored; never commit values.

2. **Start and migrate local Postgres.** Run `bun run db:up`, set `DATABASE_URL=postgresql://home:home@127.0.0.1:54320/home_local` in `apps/web/.env.local`, then run `bun run db:migrate`. Use `bun run db:down` when finished.

3. **Sign in with Base Account.** Set server-only `HOME_SESSION_SECRET` to at least 32 characters; a CDP project is not needed (`NEXT_PUBLIC_CDP_PROJECT_ID` only adds email sign-in). Run `bun dev`, open `http://localhost:3000`, pick the country for the binding, and choose **Continue with Base Account**. The verified server session, not a browser address, region, or provider customer ID, supplies the destination address.

4. **Configure the binding, then restart Home.** Set server-only `FUNDING_QUOTE_SECRET` to at least 32 characters. Also set `BASE_RPC_URL`: it is optional, but recommended so receipt checks — the Base reads behind `received` — use a reliable endpoint instead of the public `mainnet.base.org` fallback; this matters most on hosted runs. For IDRX, also set `IDRX_CLIENT_ID`, `IDRX_CLIENT_SECRET`, and `IDRX_CUSTOMER_NAME`. For Ripio Argentina, set `RIPIO_CLIENT_ID_AR`, `RIPIO_CLIENT_SECRET_AR`, and `RIPIO_WEBHOOK_SECRET_AR`; use the matching `_BR` variables for Brazil and `_CO` variables for Colombia. Configure the same `POST /api/funding/webhooks/ripio` URL in each country dashboard, then place each dashboard-generated secret in its matching Vercel variable. There is no shared fallback. When migrating from the former shared `RIPIO_WEBHOOK_SECRET`, set every required suffixed Vercel variable before deploying this code or removing the shared variable; otherwise affected bindings and open orders become inert during the rename. Restart `bun dev` after changing the environment. Another issuer can copy [`providers/idrx/`](../../apps/web/server/funding/providers/idrx/) or [`providers/ripio/`](../../apps/web/server/funding/providers/ripio/) and register the new adapter in [`providers/index.ts`](../../apps/web/server/funding/providers/index.ts).

5. **Confirm eligibility and run synthetic checks.** With every variable declared by the selected manifest binding set, **Add money** shows that binding for its country. From the repository root run:

   ```sh
   bun test apps/web/server/funding apps/web/shared/funding apps/web/client/funding
   ```

   The checked-in IDRX and Ripio coverage uses synthetic fixtures or test doubles and makes no live provider call. Use each adapter README's **Confirm against your API** checklist before treating its request or response shape as production-confirmed.

6. **Walk the flow only with operator authorization.** Add money → select the configured deposit method → complete KYC when requested → review the quote → create the order → follow its instructions → keep the Add money order screen open (it polls status) and watch it reach the provider-reported state and, after exact Base receipt evidence, **Money received** (`received`). Closing the drawer does not lose the order: reopening Add money for that country resumes it. Activity does not list funding orders; it reads the CDP transfer feed, which is unconfigured in this setup. `POST /api/funding/webhooks/ripio` cannot reach a local run without an external tunnel; local testing still progresses through status polling (the client polls every four seconds and the core limits refreshes to one per three seconds). Do not make a payment without explicit funded-test approval.

7. **Open a bounded upstream PR.** Include the adapter, manifest, synthetic fixtures/tests, and README. Attach one 390px clip of the local flow and add a dated local-development line — for Ripio, exactly `Local development completed against Ripio production API on YYYY-MM-DD` — without credentials, customer data, payment details, or wallet secrets. That line records that local development happened; it is not a validated claim. Run `bun check`; fresh review is required, and only Jesse approves and merges.

## Local development versus provider hosted acceptance

The seven steps complete **local adapter development**: a local clone walk of the flow is the development proof, and it is where issuer iteration happens. It is not release acceptance. Acceptance for a provider integrating with Home's own hosted deployment is a separate loop with its own gates — sequential funded tests per rail on Home's protected production alias, explicit approval for every payment, and a recorded evidence trail.

Provider-specific acceptance playbooks belong beside their adapters so implementation details, operational gates, and recovery procedures stay together. The Ripio provider folder contains the worked example: phase-by-phase checkbox gates with owners and approvers, the six-rail matrix, local recovery checklists, and claim semantics.

## What the seam core enforces

The seam core—not an adapter—owns the session-derived Base destination, configured binding and exact registry asset, one reservation/no retry after ambiguous create, quote binding, owner-scoped private/no-store reads, status observation, verified webhooks, and receipt/log evidence before `received`. A provider can report provider state; it cannot declare funds received.

The Coinbase adapter on `main` still creates a hosted redirect and cannot reconcile status. The headless replacement, `embed` instruction, `QuoteIntent.returnUrl`, and core redirect validation are in review in #398, not merged. Read the checked-in provider contract, routes, store, and conformance harness rather than copying this summary into an API manual.

## Authority and safety

No guide step grants access to a funded wallet, issuer account, production credentials, deployment, provider enablement, or merge authority. Live probes remain opt-in and outside CI. The operator controls credentials; Jesse alone gives final approval and merges. See the [operating manual](../operating-manual.md#delivery-loop) and [delivery gates](../delivery-gates.md).

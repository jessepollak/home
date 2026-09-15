# Ripio acceptance playbook

Status: phase-by-phase acceptance runbook for the Ripio funding adapter (AR wARS, BR wBRL, CO wCOP). Tracking: [#512](https://github.com/jessepollak/home/issues/512). Audience: the Ripio team completing the adapter, and the Home operators who run the acceptance environments. This page is process, not authorization: no step grants access to credentials, wallets, deployments, or merge authority, and nothing here claims that a live or funded result has passed.

Related: [issuer integration guide](README.md), [Ripio adapter checklist](../../apps/web/server/funding/providers/ripio/README.md), [funding provider seam](../funding-provider-seam.md), observability prerequisite [#520](https://github.com/jessepollak/home/issues/520).

## Two loops, one acceptance

**Local-first is the development loop. Hosted-final is the release proof.**

- **Local-first (Phases 0–4).** The Ripio team runs Home locally and completes the adapter against the real provider. This is where iteration happens.
- **Hosted-final (Phases 5–6).** After merge, sequential funded tests run on Home's protected production alias, operated by Home. Ripio does not deploy or host Home. There is no second Vercel project, acceptance flag, CLI adapter, or doctor script.

**Ripio has no sandbox.** `https://skala.ripio.com` is production-only. Every Home **Get quote** and **Confirm** — including from a local run — already writes production Ripio records: customer creation, terms acceptance, KYC submission, quote creation, and order creation. Treat every write with production care.

**Payments require explicit Jesse approval** — each payment, local or hosted. Hosted funded tests additionally require explicit per-country, per-rail approval.

## Non-negotiables

- [ ] **Never retry a `dispatch-ambiguous` order.** An uncertain create response parks the order and Home never retries. Locally it is an expected feedback signal; on hosted it is a stop. Recovery is manual (checklist below).
- [ ] **One open order per test Base Account per country.** This is an operator rule, not a hard server lock. Never tap **Back** while an order is pending; serialize rails within a country or wait for Ripio expiry/cancel. If two orders exist, record both and stop.
- [ ] **Dedicated test Base Accounts only.** Never a personal wallet or account.
- [ ] **Never full-reset the database by default.** `customerRef`/KYC linkage lives in the local database; a reset can create duplicate Ripio customers for the same test identity.
- [ ] **Never hijack production callbacks.** Permanent per-country webhook callbacks are already registered; never point them at a tunnel or a local run.
- [ ] **No secrets in docs or evidence.** No credentials, bypass URLs or tokens, callback secret values, names, emails, documents, bank instructions, or raw provider payloads. Use role labels, not personal names. Base transaction hashes only from an approved throwaway account.

## Roles

Use role labels in evidence, not personal names.

| Role | Side | Authority |
| --- | --- | --- |
| Jesse | Home | Approves every payment, every hosted funded order, schema sign-off, and merge. Only Jesse edits production Neon. |
| Ripio lead | Provider | Confirms API schema answers, provides a dev account if one exists, owns Ripio-side lookups and cancels by `externalRef`. |
| Home operator | Environment | Runs the local and hosted environments, privately supplies protected-alias and bypass URLs, may run the guarded local SQL after provider confirmation. |
| Recorder | Evidence | Keeps the run evidence per template and enforces the privacy rules. |

`externalRef` is Home's own order UUID (`homeOrderId`), sent to Ripio at order creation; Ripio can search their transactions by it.

## Prerequisites

- [ ] Repository clone with Bun (1.3.12) and Docker.
- [ ] Environment variables configured by name — values are never recorded: `HOME_SESSION_SECRET` (at least 32 characters), `FUNDING_QUOTE_SECRET` (at least 32 characters), local `DATABASE_URL`, and the matching Ripio country variables `RIPIO_CLIENT_ID_AR` / `RIPIO_CLIENT_SECRET_AR` / `RIPIO_WEBHOOK_SECRET_AR` (and the `_BR` / `_CO` variants for the countries in scope).
- [ ] `BASE_RPC_URL` recommended, so receipt checks — the Base reads behind `received` — use a reliable endpoint instead of the public fallback.
- [ ] Observability prerequisite [#520](https://github.com/jessepollak/home/issues/520) merged and deployed before live Phase 2 (blocking).
- [ ] Dedicated test Base Account(s) created and labeled by role.
- [ ] A binding appears under **Add money** for its country only when every manifest variable for that binding is set; restart `bun dev` after changing the environment.

## Six-rail matrix

| Country | Rail (`paymentMethod`) | Asset | Local loop complete | Hosted funded proof |
| --- | --- | --- | --- | --- |
| AR | `bank_transfer` (CVU) | wARS | ☐ | ☐ |
| BR | `pix` | wBRL | ☐ | ☐ |
| CO | `bank_transfer` | wCOP | ☐ | ☐ |
| CO | `breb` (Bre-B) | wCOP | ☐ | ☐ |
| CO | `r2p_bancolombia` (Bancolombia R2P) | wCOP | ☐ | ☐ |
| CO | `r2p_nequi` (Nequi R2P) | wCOP | ☐ | ☐ |

"Local loop complete" means the rail finished local development; only "Hosted funded proof" supports the word *validated* (see [claim semantics](#claim-semantics)).

## Phase 0 — setup and synthetic validation (no network)

Required. Owner: Ripio engineer. Approver: none (recorded).

- [ ] `bun install --frozen-lockfile`
- [ ] `bun test apps/web/server/funding/providers/ripio/` passes with no network — synthetic fixtures and test doubles only; this is the only tier CI runs
- [ ] `bun test apps/web/server/funding apps/web/shared/funding apps/web/client/funding` passes
- [ ] `bun run db:up`, then `bun run db:migrate` (local Postgres); `bun run db:down` when the session ends
- [ ] Environment configured by name (never recorded); `bun dev` restarted; the in-scope country binding appears under **Add money**

## Phase 1 — provider schema confirmation and read-only probes

Required; blocking for Phase 2. Owner: Ripio lead. Approver: Jesse signs off on the recorded answers.

Performed outside Home: Home has no read-only provider UI, and **Get quote** in Home is already a write sequence. Use an approved API client that does not expose or store secrets — never credentials on a command line or in shell history.

- [ ] Walk checklist items 1 and 4 of the [adapter README](../../apps/web/server/funding/providers/ripio/README.md) against production: `POST /oauth2/token/`, `GET /api/v1/depositNetworks/`, `GET /api/v1/withdrawalNetworks/`, `GET /api/v1/termsAndConditions/`
- [ ] Observed shapes recorded without credentials or PII
- [ ] Open questions answered and recorded:
  - [ ] Exact Colombia redirect origins behind `bank_transfer`, `breb`, `r2p_bancolombia`, and `r2p_nequi` payment URLs — Home's redirect allowlist must match them
  - [ ] Quote TTL: how long the quote `expiration` lasts
  - [ ] Exact onchain amount: the Base `Transfer` amount equals the quote's `finalToAmount` exactly (wARS/wBRL/wCOP)
  - [ ] Unpaid orders: when and how Ripio expires or cancels an order that is never paid
  - [ ] Duplicate email/KYC: idempotent return of the existing customer, or the documented error; safety of repeated terms/KYC writes
  - [ ] Webhook retry counts and callback registration limits
- [ ] Jesse signs off

## Phase 2 — local live adapter iteration (polling-only)

Required for adapter completion. **Blocking prerequisite: [#520](https://github.com/jessepollak/home/issues/520) (Ripio acceptance observability) merged and deployed — do not start live iteration before it lands.** Owner: Ripio engineer. Approver: Jesse for the first order-creating write per country, and for every payment.

- [ ] #520 merged and deployed
- [ ] Jesse approves the first local order-creating test per country, knowing each write creates production Ripio records
- [ ] Orders created only from dedicated test Base Accounts; one open order per account per country
- [ ] No **Back** navigation on pending; rails serialized within a country
- [ ] Status polling drives progression (the client polls every four seconds; the core limits refreshes to one per three seconds). Webhooks are not received locally without a tunnel (Phase 3).
- [ ] Every completed local order ends `received` on exact proof, or is terminalized through the recovery checklist
- [ ] `dispatch-ambiguous` handled as expected feedback: stop, recover (checklist below), then continue
- [ ] If two orders exist for one account and country: record both and stop

## Phase 3 — optional local webhook tunnel

Optional. Owner: named tunnel owner. Approver: Jesse.

A local Home cannot receive `POST /api/funding/webhooks/ripio` without an external tunnel, and status polling covers normal local iteration. The current run is therefore polling-only unless Ripio provides a dev account: the permanent per-country callbacks are already registered and must never be hijacked.

- [ ] Tunnel permitted only on a Ripio dev account, or before a permanent callback exists for that country
- [ ] Registered production country callbacks are never redirected at any time
- [ ] Named tunnel owner recorded before the tunnel opens
- [ ] Any tunnel restore verified by a second person before handback
- [ ] No secret callback values in docs or evidence

## Phase 4 — PR and merge

Required for any code change. Owner: Ripio engineer. Approver: Jesse (only Jesse approves and merges).

- [ ] `bun check` passes
- [ ] PR includes adapter code, manifest changes, synthetic fixtures/tests, and README updates in the same PR
- [ ] Clip and dated confirmation line attached without credentials, customer data, payment details, or wallet secrets
- [ ] Fresh review completed; merge by Jesse

## Phase 5 — hosted final acceptance (protected production alias)

Required for any *validated* claim. Owner: Home operator runs the environment; the Ripio team observes. Approver: Jesse per country and rail.

The host is Home's protected production alias. The Home operator privately supplies the browser URL and the webhook bypass URL to named participants. **Bypass tokens never enter the repo, docs, or evidence.**

- [ ] Hosted run starts only after the Phase 4 merge
- [ ] Jesse approves each funded order in advance, per country and rail
- [ ] No separate hosted unfunded matrix: local instruction proof is not repeated as hosted unfunded tests; hosted final goes directly to funded orders
- [ ] For the all-six-rails claim: one funded order per rail at provider minimum, strictly sequentially per country
- [ ] For a country-level claim only: at least one funded rail per country, and every untested rail is recorded as explicitly unvalidated
- [ ] Each order shows exact received proof (checklist below)
- [ ] A `dispatch-ambiguous` on hosted is a stop: run the recovery checklist, then Jesse decides whether the run continues
- [ ] Any payment incident: stop, record, and have Ripio look up and cancel by `externalRef`

## Phase 6 — closeout

- [ ] Evidence recorded per order and per rail (template below)
- [ ] Claim wording matches claim semantics (below)
- [ ] All open orders drained or terminalized; no production Ripio record left ambiguous
- [ ] If a country is being disabled: kill-switch rule applied (below)
- [ ] Run recorded against [#512](https://github.com/jessepollak/home/issues/512)

## Exact received proof (per order)

An order may be called complete only with all of:

- [ ] Provider status timeline recorded (every observed provider status, with timestamps)
- [ ] Matched webhook event (hosted), or an explicit "polling-only, no webhook" note (local)
- [ ] Base transaction hash and logIndex
- [ ] Transfer token, destination, and exact amount equal to the quote's `finalToAmount`
- [ ] Home state `received`

## Local recovery checklist (dispatch-ambiguous)

An uncertain create response is never retried by Home. Recovery is manual and ordered:

1. [ ] **Stop.** No retry, no new order, no **Back** navigation. Record the order UUID, country, rail, amount, and timestamp.
2. [ ] **Ripio lookup/cancel by `externalRef`** (Home's order UUID). Ripio reports the transaction's actual state and cancels it if it is open and unpaid.
3. [ ] **Local database reconciliation** — only after Ripio's written confirmation, the Home operator may reconcile the local row with one narrowly guarded SQL update (below). Never against production Neon: production edits are Jesse's alone.
4. [ ] If the guarded update returns zero rows, stop and ask Jesse.
5. [ ] **Never full-reset the local database by default.** `customerRef`/KYC linkage is local; a reset can duplicate provider customers.

Guarded local-only SQL — a one-row compare-and-swap that reconciles the parked order to the terminal state Ripio confirmed:

```sql
-- Read and record the row first.
SELECT id, region, payment_method, fiat_amount, state, provider_order_id,
       provider_status, version, updated_at
FROM funding_orders
WHERE id = '<order uuid>';

-- Reconcile exactly one row to the terminal state Ripio confirmed.
UPDATE funding_orders
SET state           = '<cancelled|expired|failed>',   -- terminal state matching Ripio's confirmed outcome
    provider_status = '<status Ripio reported>',
    version         = version + 1,
    updated_at      = now()
WHERE id = '<order uuid>'
  AND provider_id = 'ripio'
  AND state = 'dispatch-ambiguous'
  AND version = <version observed above>
  AND transaction_hash IS NULL
  AND log_index IS NULL
RETURNING id, state, version;
```

The guards pin one row, one pre-state, and one observed version; the update cannot touch receipt evidence (`transaction_hash`/`log_index` are additionally protected by a database trigger), cannot reopen a terminal order, and cannot affect any other row. Outcomes other than the provider-confirmed cancellation case need Jesse's decision first.

## Webhook bypass rotation (hosted)

Rotate an embedded webhook bypass only in this order, never all at once:

- [ ] 1. Create the new bypass.
- [ ] 2. Update the three country dashboards (AR, BR, CO) to use it.
- [ ] 3. Signed synthetic proof passes webhook verification for AR, BR, and CO.
- [ ] 4. Retire the old bypass.

Bypass URLs and tokens are never written to the repo, docs, or evidence.

## Evidence template

Copy per order into the run record. Role labels only; nothing secret.

```
- Date (UTC):
- Environment: local | hosted-final
- Country / rail / asset:
- Order UUID (externalRef):
- Provider transactionId:
- Provider status timeline:
- Webhook: matched | not received (polling-only)
- Base tx hash / logIndex: (only if approved throwaway account)
- Quote finalToAmount vs onchain transfer amount:
- Home state:
- Approval: (role label + date)
- Incidents / deviations:
```

## Claim semantics

- **"Local dev complete"** — a rail finished the local loop (Phases 0–4). Not a release or provider-acceptance claim.
- **"Rail validated"** — a hosted-final funded order on that rail reached `received` with exact proof.
- **"Country validated"** — at least one funded rail for that country passed hosted final; every untested rail is listed as explicitly unvalidated.
- **"All six rails validated"** — one funded order per rail at provider minimum, sequential per country, all with exact proof.

Until evidence exists in a recorded run, the standing statement is: **no live provider call and no funded flow has been validated.**

## Stop/rollback and the kill switch

- Stop the run on: any second open order, any `dispatch-ambiguous` on hosted, any unexpected provider state, or any privacy breach in evidence.
- **Kill switch:** before removing a country's Ripio environment variables, drain (complete or terminalize) all open orders for that country. Removing the variables while orders are open leaves them unable to refresh (503) and the binding inert.
- Adapter code rollback follows the normal PR/revert path; there is no separate acceptance deployment to roll back.

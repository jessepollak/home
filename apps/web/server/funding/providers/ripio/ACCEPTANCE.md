# Ripio acceptance playbook

Status: phase-by-phase acceptance runbook for the Ripio funding adapter (AR wARS, BR wBRL, CO wCOP). Tracking: [#512](https://github.com/jessepollak/home/issues/512). Audience: the Ripio team completing the adapter, and the Home operators who run the acceptance environments. This page is process, not authorization: no step grants access to credentials, wallets, deployments, or merge authority, and nothing here claims that a live or funded result has passed.

Related: [issuer integration guide](../../../../../../docs/integrations/README.md), [Ripio adapter checklist](README.md), [funding provider seam](../../../../../../docs/funding-provider-seam.md), observability prerequisite [#520](https://github.com/jessepollak/home/issues/520).

## Two loops, one acceptance

**Local-first is the development loop. Hosted-final is the release proof.**

- **Local-first (Phases 0–4).** The Ripio team runs Home locally and completes the adapter against the real provider. This is where iteration happens.
- **Hosted-final (Phases 5–6).** After merge, sequential funded tests run on Home's protected production alias. Home operates and observes the environment; Ripio testers drive the browser and initiate the payments. Ripio does not deploy or host Home. There is no second Vercel project, acceptance flag, CLI adapter, or doctor script.

**Ripio has no sandbox.** `https://skala.ripio.com` is production-only. Every Home **Get quote** and **Confirm** — including from a local run — already writes production Ripio records: customer creation, terms acceptance, KYC submission, quote creation, and order creation. Treat every write with production care.

**Payments require explicit Jesse approval** — each payment, local or hosted. Hosted funded tests additionally require explicit per-country, per-rail approval.

## Non-negotiables

- [ ] **Never retry a `dispatch-ambiguous` order.** An uncertain create response parks the order and Home never retries. Locally it is an expected feedback signal; on hosted it is a stop. Recovery is manual (checklist below).
- [ ] **One open order per test Base Account per country.** This is an operator rule, not a hard server lock. Never tap **Back** while an order is pending; serialize rails within a country or wait for Ripio expiry/cancel. If two orders exist, record both and stop.
- [ ] **Dedicated test Base Accounts only.** Never a personal wallet or account.
- [ ] **Never full-reset the database by default.** `customerRef`/KYC linkage lives in the local database; a reset can create duplicate Ripio customers for the same test identity.
- [ ] **Never hijack production callbacks.** In this acceptance run the permanent per-country callbacks are already registered, so a registered callback is never pointed at a tunnel or a local run. That registration is the current acceptance state, not a universal provider rule: a local tunnel is allowed only with a Ripio dev account, or for a country account before its permanent callback is registered (Phase 3).
- [ ] **No secrets in docs or evidence.** No credentials, bypass URLs or tokens, callback secret values, names, emails, documents, bank instructions, or raw provider payloads. Use role labels, not personal names. Base transaction hashes only from an approved throwaway account.

## Roles

Use role labels in evidence, not personal names.

| Role | Side | Authority |
| --- | --- | --- |
| Jesse | Home | Approves every payment, every hosted funded order, schema sign-off, and merge. Only Jesse edits production Neon. |
| Ripio lead | Provider | Confirms API schema answers, provides a dev account if one exists, owns Ripio-side lookups and cancels by `externalRef`. |
| Ripio tester | Provider | Drives the acceptance browser in local and hosted runs with a dedicated test Base Account, supplies its production-approved identity/KYC data, and initiates each local-bank, Pix, Bre-B, Bancolombia, and Nequi payment. |
| Home operator | Environment | Runs the local and hosted environments, privately supplies protected-alias and bypass URLs, may run the guarded local SQL after provider confirmation. |
| Recorder | Evidence | Keeps the run evidence per template and enforces the privacy rules. |

`externalRef` is Home's own order UUID (`homeOrderId`), sent to Ripio at order creation; Ripio can search their transactions by it.

## Prerequisites

- [ ] Repository clone with Bun (1.3.12) and Docker.
- [ ] Environment variables configured by name — values are never recorded: `HOME_SESSION_SECRET` (at least 32 characters), `FUNDING_QUOTE_SECRET` (at least 32 characters), local `DATABASE_URL`, and the matching Ripio country variables `RIPIO_CLIENT_ID_AR` / `RIPIO_CLIENT_SECRET_AR` / `RIPIO_WEBHOOK_SECRET_AR` (and the `_BR` / `_CO` variants for the countries in scope).
- [ ] `BASE_RPC_URL` recommended, so receipt checks — the Base reads behind `received` — use a reliable endpoint instead of the public fallback.
- [ ] Observability prerequisite [#520](https://github.com/jessepollak/home/issues/520) merged, or applied to the local branch, before live Phase 2; deployed only before hosted Phase 5 (blocking).
- [ ] Dedicated test Base Account(s) created and labeled by role.
- [ ] A binding appears under **Add money** for its country only when every manifest variable for that binding is set; restart `bun dev` after changing the environment.

## Six-rail matrix

| Country | Rail (`paymentMethod`) | Asset | Instruction to verify | Known risk | Local loop complete | Hosted funded proof |
| --- | --- | --- | --- | --- | --- | --- |
| AR | `bank_transfer` (CVU) | wARS | CVU plus optional alias shown and copyable | Payment to a mistyped CVU or alias | ☐ | ☐ |
| BR | `pix` | wBRL | `brCode` parses as TLV with a valid CRC and amount tag `54` equal to `finalFromAmount` exactly | Malformed TLV/CRC or wrong amount charges the wrong value | ☐ | ☐ |
| CO | `bank_transfer` | wCOP | Payment URL redirects only to a Ripio-confirmed bank origin | Unexpected redirect origin | ☐ | ☐ |
| CO | `breb` (Bre-B) | wCOP | Bre-B key returned by the provider, accepted by Home's validation, and shown on the order screen | Missing or invalid key | ☐ | ☐ |
| CO | `r2p_bancolombia` (Bancolombia R2P) | wCOP | Redirect lands on the confirmed Bancolombia R2P origin | Unexpected redirect origin | ☐ | ☐ |
| CO | `r2p_nequi` (Nequi R2P) | wCOP | Nequi phone number returned by the provider, accepted by Home's validation, and shown on the order screen with the R2P flow as implemented | Missing or invalid phone | ☐ | ☐ |

"Instruction to verify" is the instruction shape a tester checks on the order screen; "Known risk" is the failure mode to watch for. For Bre-B and Nequi R2P, Home validates the Bre-B key and the Nequi phone/R2P shape; any payment URL or redirect origin behind those rails is a provider-side Phase 1 schema question (below), not an order-screen expectation — no redirect-allowlist check runs for those rails. "Local loop complete" means the rail finished local development; only "Hosted funded proof" supports the word *validated* (see [claim semantics](#claim-semantics)).

## Phase 0 — setup and synthetic validation (no provider network, no provider writes)

Required. Owner: Ripio engineer. Approver: none (recorded). The exclusion is the Ripio provider network and any provider write only: local Postgres, Base Account sign-in, and the UI's local/Base network traffic are all fine here.

- [ ] `bun install --frozen-lockfile`
- [ ] `bun test apps/web/server/funding/providers/ripio/` passes with no network — synthetic fixtures and test doubles only; this is the only tier CI runs
- [ ] `bun test apps/web/server/funding apps/web/shared/funding apps/web/client/funding` passes
- [ ] `bun run db:up`, then `bun run db:migrate` (local Postgres); `bun run db:down` when the session ends
- [ ] Environment configured by name (never recorded); `bun dev` restarted; the in-scope country binding appears under **Add money**

## Phase 1 — provider schema confirmation and read-only probes

Required; blocking for Phase 2. Owner: Ripio lead. Approver: Jesse signs off on the recorded answers.

Performed outside Home: Home has no read-only provider UI, and **Get quote** in Home is already a write sequence. Use an approved API client that does not expose or store secrets — never credentials on a command line or in shell history.

- [ ] Walk checklist items 1, 2, and 4 of the [adapter README](README.md) against production, read-only: `POST /oauth2/token/`, `GET /api/v1/termsAndConditions/`, `GET /api/v1/depositNetworks/`, `GET /api/v1/withdrawalNetworks/`. Item 2's `POST /api/v1/customers/{customerId}/acceptTerms/` is a write and is not performed here — only the terms read is probed; acceptance happens in Phase 2.
- [ ] Observed shapes recorded without credentials or PII
- [ ] Open questions answered and recorded:
  - [ ] Exact Colombia redirect origins for `bank_transfer` and `r2p_bancolombia` — the only CO rails Home renders as redirects — plus confirmation that `breb` returns `brebKey` and `r2p_nequi` returns `phoneNumber` rather than substituting a payment URL
  - [ ] Quote TTL: how long the quote `expiration` lasts
  - [ ] Exact onchain amount: the Base `Transfer` amount equals the quote's `finalToAmount` exactly (wARS/wBRL/wCOP)
  - [ ] Unpaid orders: when and how Ripio expires or cancels an order that is never paid
  - [ ] Duplicate email/KYC: idempotent return of the existing customer, or the documented error; safety of repeated terms/KYC writes
  - [ ] Webhook retry counts and callback registration limits
- [ ] Jesse signs off

## Phase 2 — local live adapter iteration (polling-only)

Required for adapter completion. **Blocking prerequisite: [#520](https://github.com/jessepollak/home/issues/520) (Ripio acceptance observability) merged, or applied to the local branch, before live iteration — do not start live iteration before it lands. Deploying it is required only before hosted Phase 5.** Owner: Ripio engineer. Approver: Jesse for the first order-creating write per country, and for every payment.

- [ ] #520 merged, or applied to the local branch (deployment is deferred to hosted Phase 5)
- [ ] Jesse approves the first local order-creating test per country, knowing each write creates production Ripio records
- [ ] Orders created only from dedicated test Base Accounts; one open order per account per country
- [ ] No **Back** navigation on pending; rails serialized within a country
- [ ] Status polling drives progression (the client polls every four seconds; the core limits refreshes to one per three seconds). Webhooks are not received locally without a tunnel (Phase 3).
- [ ] Every completed local order ends `received` on exact proof, or is terminalized through the recovery checklist
- [ ] `dispatch-ambiguous` handled as expected feedback: stop, recover (checklist below), then continue
- [ ] If two orders exist for one account and country: record both and stop

## Phase 3 — optional local webhook tunnel

Optional. Owner: named tunnel owner. Approver: Jesse.

A local Home cannot receive `POST /api/funding/webhooks/ripio` without an external tunnel, and status polling covers normal local iteration. For this acceptance run the permanent per-country callbacks are already registered, so the run is polling-only unless Ripio provides a dev account. That registration is the current acceptance state, not a universal provider rule: a country account whose permanent callback is not yet registered may tunnel under the checklist below.

- [ ] Tunnel permitted only on a Ripio dev account, or before a permanent callback exists for that country
- [ ] Registered production country callbacks are never redirected at any time
- [ ] Named tunnel owner recorded before the tunnel opens
- [ ] Any tunnel restore verified by a second person before handback
- [ ] No secret callback values in docs or evidence

## Phase 4 — PR and merge

Required for any code change. Owner: Ripio engineer. Approver: Jesse (only Jesse approves and merges).

- [ ] `bun check` passes
- [ ] PR includes adapter code, manifest changes, synthetic fixtures/tests, and README updates in the same PR
- [ ] Clip and the dated line `Local development completed against Ripio production API on YYYY-MM-DD` attached without credentials, customer data, payment details, or wallet secrets
- [ ] Fresh review completed; merge by Jesse

## Phase 5 — hosted final acceptance (protected production alias)

Required for any *validated* claim. Owners: the Home operator runs and observes the hosted environment; Ripio testers drive the browser and the payments. Approver: Jesse per country and rail.

The host is Home's protected production alias. The **webhook bypass URL** is Home's private webhook callback URL with a Vercel Protection Bypass for Automation token appended; the production alias is protected, so the callback needs the bypass to receive webhooks. Never print it or commit it. The Home operator privately supplies the browser URL and the webhook bypass URL to named participants. **Bypass tokens never enter the repo, docs, or evidence.**

- [ ] Hosted run starts only after the Phase 4 merge, with #520 deployed
- [ ] Jesse approves each funded order in advance, per country and rail
- [ ] Ripio tester drives the browser: dedicated test Base Account, production-approved identity/KYC data, and initiating each local-bank/Pix/Bre-B/Bancolombia/Nequi payment
- [ ] Home operator runs and observes the hosted environment and records evidence
- [ ] No separate hosted unfunded matrix: local instruction proof is not repeated as hosted unfunded tests; hosted final goes directly to funded orders
- [ ] For the all-six-rails claim: one funded order per rail at provider minimum, strictly sequentially per country
- [ ] For a country-level claim only: at least one funded rail per country, and every untested rail is recorded as explicitly unvalidated
- [ ] Each order shows exact received proof (checklist below)
- [ ] A `dispatch-ambiguous` on hosted is a stop: follow the hosted recovery checklist below; never use the local SQL procedure against production Neon
- [ ] Any payment incident: stop, record, and have Ripio look up and cancel by `externalRef`

### Hosted recovery checklist (`dispatch-ambiguous`)

1. [ ] **Stop.** Do not retry, pay, navigate back, or create another order. Record the Home order UUID, country, rail, amount, and timestamp.
2. [ ] **Ripio searches by `externalRef`** (the Home order UUID), reports the actual provider state, and cancels the transaction if it is open and unpaid.
3. [ ] **Home escalates to Jesse.** Only Jesse may inspect or reconcile the production Neon row; the guarded SQL in the local recovery section is never run against production.
4. [ ] Resume only after the Ripio transaction and Home row are reconciled and Jesse explicitly approves another attempt.

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

The guards pin one row, one pre-state, and one observed version; the update cannot touch receipt evidence (`transaction_hash`/`log_index` are additionally protected by a database trigger), cannot reopen a terminal order, and cannot affect any other row. The update may terminalize the row only to the exact terminal state Ripio confirmed — `cancelled`, `expired`, or `failed` — never to a state Ripio did not report; any other outcome needs Jesse's decision first.

## Webhook bypass rotation (hosted)

Rotate an embedded webhook bypass (the webhook bypass URL defined in Phase 5: Home's private callback URL with a Vercel Protection Bypass for Automation token) only in this order, never all at once:

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
- **Kill switch:** drain (complete or terminalize) all open orders for a country before removing its Ripio environment variables. Without the variables the binding disappears under **Add money**, order refreshes fail closed (the order endpoints return 503 and the stored order never advances), so open orders stall at their last state. Drain first.
- Adapter code rollback follows the normal PR/revert path; there is no separate acceptance deployment to roll back.

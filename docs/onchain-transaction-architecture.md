# Attempt-aware onchain transactions

Status: Phase 1 in tree. Phases 2–5 withdrawn 2026-09-12; see money-action-persistence.md.

This document records the noncustodial boundary, failure windows, and provider-specific facts that remain relevant to Home's current MoneyAction flow.

## Decision

Keep the noncustodial boundary:

> server prepare → atomic dispatch claim → client wallet submission → durable provider evidence → verified reconciliation

Make that boundary attempt-aware. The immutable reviewed action, permission to dispatch, a particular wallet execution attempt, provider evidence, reconciliation, and admission blocking are different facts and must stop sharing one overloaded status.

The compatibility implementation does not change the store schema. It adds a pure client `checkMoneyAction(action)` path, routes user-visible status checks through it, moves send capability and fresh-balance preflight before the first claim when the durable row is still `prepared`, and synchronously journals a provider-returned handle before evidence upload. The versioned browser journal retries only the exact owner/action/provider-bound handle through the owner-scoped submission route; it never authorizes wallet replay. Unacknowledged entries survive sign-out and account switches because they are best-effort sensitive execution metadata rather than presentation cache; purging them would recreate evidence loss. Cross-tab persistent insertion is serialized with Web Locks; without a safe browser lock primitive, the handle remains memory-only and exact upload still proceeds. Later slices add durable attempts and typed atomic commands under a single persistence owner.

## Non-goals

- **No database-and-wallet atomicity.** A browser wallet request cannot participate in Home's PostgreSQL transaction.
- **No rollback after ambiguous dispatch.** Once a wallet request may have begun, a missing reference is not evidence that nothing was submitted.
- **No naïve terminal expiry.** Elapsed time must not make late transaction, user-operation, or provider evidence unattachable.
- No generic workflow engine, event store, saga framework, or provider-neutral `execute(anything)` API.
- No server custody, private-key handling, background signing, or automatic compensating transfer.
- No implementation of terminal `unknown → expired` behavior. Owner abandonment/admission release is the #110 / PR #134 store contract (`abandonedAt` plus explicit admission-release).
- Phase 1 of #131 did not edit the store. #134 adds the bounded admission-release field and command on Memory/SQLite/Postgres without a blanket `unknown → expired` transition.

## Current boundary and failure windows

Today a `PreparedMoneyAction` binds the verified owner tuple, reviewed calls, amounts, warnings, expiry, and `reviewHash`. `POST /api/actions/:id/claim` atomically changes a prepared row to `submitting`; only the returned `dispatch` disposition permits the client to call a wallet. Submission evidence is then uploaded through the submission endpoint and verified receipts drive confirmation.

That prevents two tabs from both receiving first-dispatch permission, but one operation row still represents too many independent facts. In particular, `submitting` without a reference can mean either “the client never reached the wallet” or “the provider accepted a request and Home lost the response.” Persistence cannot infer which one occurred from status and time alone.

### Failure-window matrix

“Definitely not submitted” below means Home can establish that the wallet submission API was not invoked in that trace. It does not mean an unrelated external transaction is impossible.

| Window | Durable observation | Classification | Safe behavior now | Attempt-aware target |
|---|---|---|---|---|
| Prepare validation, simulation, or persistence fails | No issued action, or no usable prepared response | **Definitely not submitted** | Show preparation failure; wallet untouched | Idempotently retry preparation by intent key |
| Pure status GET fails | Existing row unchanged | **Definitely not submitted by the check** | Keep durable row visible; retry the read | Record bounded reconciliation failure/next-check time, not a dispatch attempt |
| Provider capability check fails before claim | Row remains `prepared` | **Definitely not submitted** | Do not claim; report unavailable/stale session | Keep as pre-dispatch validation evidence only |
| Fresh portfolio/balance check fails before claim | Row remains `prepared` | **Definitely not submitted** | Do not claim; require a new valid review/attempt as policy dictates | Record validation result separately from execution attempt |
| Claim loses its compare-and-swap, owner mismatches, or action is already terminal | Existing durable state wins | **Definitely not submitted by this invocation** | Read/recover only; never call wallet | Typed claim returns `recover`, `terminal`, or conflict without dispatch authorization |
| Claim commits; client stops before entering wallet call | Reference-free `submitting` | Locally **definitely not submitted**, but durable row alone cannot prove it | Keep fail-closed; do not generically roll back | Attempt has dispatch authorization plus a durable phase that distinguishes authorized from request-entered where the client can report it |
| Wallet rejects before accepting (for example an explicit user rejection) | Claimed row, usually no provider reference | **Definitely not submitted only when provider semantics make rejection definitive** | Record `rejected`; never infer this from generic transport errors | Store normalized provider evidence with provenance and certainty |
| Wallet request throws, times out, disconnects, or page unloads after invocation begins | Claimed row, no reference | **Possibly submitted / ambiguous** | Mark unresolved; never replay with a new execution identity | Reconcile by provider request key, account activity, nonce/user-op data, or explicit owner resolution |
| Provider accepts request but response is lost | Claimed row, no reference | **Possibly submitted / ambiguous** | Keep admission blocked; do not roll back to prepared | Provider-recoverable request identity is attached to the attempt before or during dispatch where the provider contract permits |
| `wallet_sendCalls` returns an ID, then an unrelated account-state recheck throws | Claimed row may remain reference-free even though client briefly had a handle | **Possibly submitted; avoidable evidence loss** | Phase 1 returns/parses the ID first, then uploads it under the already-authorized owner | Evidence capture is the immediate next command after provider return |
| Provider returns a user-op hash/submission ID, but evidence upload fails | Provider reference is retained in the versioned browser journal | **Possibly submitted** | Retry only the identical handle after an owner-fenced durable GET; exact durable evidence acknowledges and removes only that journal entry. Never resubmit to the wallet. | Move the same evidence contract onto the durable attempt record. |
| Evidence is durable but receipt/status lookup is unavailable | Recorded handle, unresolved status | **Possibly submitted, now recoverable** | Poll only the recorded reference | Reconciliation command advances monotonically from verified evidence |
| Receipt/provider result is observed, but final database write fails | Strong provider evidence, stale Home status | Execution result known to the observer; durable projection stale | Re-run verified reconciliation idempotently | Persist provider observation and projection update atomically where possible |
| Owner releases admission while execution remains ambiguous | Admission unblocked, attempt still unresolved | **Possibly submitted** | Must not assert onchain non-submission | Store abandonment/admission release independently; accept late evidence forever within retention policy |

Phase 1 deliberately reduces the first two avoidable claim windows: status checks no longer claim, and send capability plus fresh balance validation happen before claim when a durable GET establishes that the row is still prepared. Expiry and account fencing are still rechecked immediately before wallet dispatch using the canonical server-returned action.

## Withdrawn

The additive attempt-state, evidence-reservation, migration-marker, typed-command, and staged Phase 2–5 design was removed in #309 because `money_action_operations` already carries the durable claim, provider handles, verified execution identity, and admission release needed at runtime. The retained pure provider classification facts live in `apps/web/server/money-actions/provider-submission-contract.ts`; the client does not yet import that module.

## Invariants

1. Only a successful atomic claim with `disposition: dispatch` grants first wallet dispatch.
2. `checkMoneyAction`, durable reads, reconciliation, refresh, and remount never call claim or wallet submission APIs.
3. Every action, attempt, evidence write, and admission command is scoped to the verified tuple: subject, account address, Base chain ID, and account provider.
4. The client submits only the canonical server-returned action after claim. Reviewed-plan comparison remains exact, including sensitive call digests.
5. A provider request occurs outside the database transaction. Home does not promise exactly-once execution across browser, provider, and chain boundaries.
6. Missing evidence is not negative evidence after a wallet request may have begun.
7. Evidence is immutable/idempotent; conflicting references fail closed and are auditable through durable handle columns plus owner-scoped unique indexes, rather than a separate provenance log.
8. Confirmation requires server-verified receipt/provider facts and expected sender/calls/effects. A client success response is not confirmation.
9. Ambiguous attempts are never generically rolled back to prepared and replayed with a new execution identity.
10. Admission release and owner abandonment do not terminalize reconciliation and do not block late evidence. Release is stored as `abandoned_at` only; the former reason and policy version were constants and are not persisted.
11. Fresh spendability checks happen before first claim where they can establish non-submission, then expiry and owner/account fencing are checked again immediately before dispatch.
12. Account switching invalidates in-flight client work before claim, provider polling, or evidence mutation can cross owners.
13. No SQL transaction remains open during provider calls.
14. Legacy rows with reference-free claimed states migrate as potentially dispatched, never as safe-to-retry.

## Provider-specific facts and unknowns

These are facts demonstrated by Home's pinned client interfaces and tests, not broader guarantees beyond those interfaces.

### CDP embedded wallet

Current code facts:

- `sendUserOperation` accepts Home's action ID as `idempotencyKey` and returns a user-operation hash.
- `getUserOperation` can be queried by user-operation hash, smart account, and Base network.
- Home compares returned provider calls to the reviewed calls and verifies the resulting transaction receipt with the expected sender/user-operation relationship.
- Once a user-operation hash is durable, status checks can reconcile without calling `sendUserOperation` again.

Soft Pass (#175), locked into `provider-submission-contract.ts`:

- Do not authorize a new send after `sendUserOperation` has been invoked and thrown.
- Do not implement GET-by-idempotency-key recovery. Official GET is by `userOpHash` only; live unfunded GETs by key were 404.
- Same-key replay returning the original hash is a **docs claim**, not a tested recovery API. `walletSecretId` in the body is an untested fingerprint risk.
- `idempotency_error` / `already_exists` do not grant a new execution identity and do not prove non-submission of the first attempt.
- Passing `X-Idempotency-Key` is wiring, not recovery proof.

### Base Account

Current code facts:

- Home requests `wallet_sendCalls` version `2.0.0` on Base, with `atomicRequired: true`, the verified universal account as `from`, and the Home action ID as request `id`.
- The provider returns an opaque submission ID, which `wallet_getCallsStatus` accepts later.
- Home requires matching submission ID, Base chain, atomic execution, and a single consistent receipt transaction hash.
- Phase 1 preserves the returned ID before any post-request account-state recheck. Pre-dispatch account/chain checks remain in place.

Soft Pass (#176), locked into `provider-submission-contract.ts`:

- Home request `id` is correlation / uniqueness, not CDP-style idempotent replay. Do not treat the action UUID as a replay key.
- Action UUID ≠ provider evidence. Do not persist it as `submissionId` before `wallet_sendCalls` returns.
- Lost return is reference-free `unknown`. Home never looks up `getCallsStatus(actionId)`. Coinbase status RPC rejected Home UUIDs (`-32602`).
- Definitive `not-submitted` on this invocation: pre-dispatch throw, or provider `4001` user reject. After `wallet_sendCalls` is entered, the outcome is `ambiguous` unless a later handle/receipt is verified.
- `5720` is prior-submission / fail-closed, not `rejected`. `5730` / `4200` / `-32602` are lookup failure, not non-submission.
- Live Base popup `5720` / `4001` / retention remain **unknown**. Do not invent them.

`atomicRequired` describes atomicity of the call bundle as executed by the wallet; it does not make the database claim and wallet request atomic.

## Relationship of #110, #131, and #132

- **#110 is the immediate user-unblock/admission lane.** It governs how an owner can stop an unresolved send from permanently blocking new Home sends. Its result must be expressed as abandonment/admission release, not proof that an ambiguous onchain execution cannot complete.
- **#131 is the transaction-architecture lane.** It reduces reference-free claims and introduces the durable attempt/evidence/reconciliation contract so ambiguity becomes observable and recoverable rather than overloaded into one operation status.
- **#132 is a duplicate of #131.** Design and implementation decisions belong on #131 so there is one architecture source of truth.

The sequencing is complementary: Phase 1 of #131 can land without store changes; #110 may supply the bounded admission-release policy; later #131 store work incorporates that policy into the attempt-aware model. Neither issue should weaken the atomic first-dispatch claim or treat a missing handle as permission to resubmit.

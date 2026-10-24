# Security review

Pre-release review of Home's money, privacy, and access-control boundaries for the MVP criterion in [Product strategy](product-strategy.md#shared-quality-workstreams): **no known critical money, privacy, or access-control defect**.

- **Reviewed commit:** `92eefb0d784ec4b793266e575d4ed290f7dfb397` (`origin/main`, October 21, 2026).
- **Scope:** money-action lifecycle and every action kind, the account and session boundary, operator authorization and deployment access, public webhooks, and credential and customer-data exposure in API responses and logs.
- **Verdict:** no P0 or P1 defect was found. Eleven bounded P2/P3 findings are recorded as area follow-ups; two findings are already owned by existing account work; one P3 contract signal is recorded as an accepted risk. None is a demonstrated cross-owner disclosure, unauthorized money movement, credential compromise, or catastrophic loss.
- **Out of scope, owned elsewhere:** rate limiting stays with [#1160](https://github.com/jessepollak/home/issues/1160); compile-time authorization proofs stay with [#2076](https://github.com/jessepollak/home/issues/2076) and [#2229](https://github.com/jessepollak/home/pull/2229); auth-boundary error contracts and account-export handlers are being rewritten in [#2227](https://github.com/jessepollak/home/pull/2227).

## Severity

| Level | Meaning |
| --- | --- |
| P0 | Catastrophic loss or compromise; release stops. |
| P1 | Reachable critical correctness, security, privacy, money, or data-loss defect; release stops. |
| P2 | Bounded defect with a concrete trigger and limited impact; fix before release certification when it touches money truth, privacy accountability, or authentication. |
| P3 | Bounded hardening or defense-in-depth gap; schedule with its area. |

## Method

Five read-only evidence passes, each reading the assigned modules and their callers in full, then tracing the invariant to its enforcement or its gap:

1. **Money-action lifecycle and store** — prepare, confirm, handle, decline, retry, receipt, reconciliation, follow-through, and SQL ownership.
2. **Money-action kinds** — send, savings, borrow, cash-out, card allowance, and trade, including permit signing, quote binding, fee placement, and stock jurisdiction.
3. **Session and account boundary** — CDP and native Base sessions, account export, deletion liveness, and auth-boundary errors.
4. **Operator authorization and access** — admin routes, deployment access, the public-path allowlist, and every public webhook.
5. **Credential and customer-data exposure** — all API response constructors, error paths, operator surfaces, card reveal, and logging.

Each pass ran the repository's targeted suites in its area (unit tests, plus PostgreSQL suites or an isolated PostgreSQL cluster where the store was in scope) and additional characterization probes. Where a live provider or production deployment was unavailable, the pass used an injected boundary and disclosed that limit below. No funded action, production database, secret value, or live provider payload was used.

## 1. Money-action lifecycle

### What was checked

| Invariant | Evidence | Result |
| --- | --- | --- |
| Scope derives from the verified session, never a client wallet or user id | `server/auth/authorize.ts:38-112`; `server/actions/handler.ts:74-78`; `server/money-actions/session.ts:6-14`; `server/actions/store.ts:216-224,648-654` | Held. Owner tuple is subject + lowercased smart account + chain + provider; no param or body field overrides it. |
| Calldata is server-authored and immutable after confirmation | `server/actions/prepare.ts:129-190`; `server/actions/handler.ts:239-254,329-350`; `server/actions/store.ts:227-245` | Held. Confirm returns stored pending or committed calls; the only body field is a trade signature. The store row lock prevents a second confirm from publishing alternate calls. |
| Token amounts stay `bigint` from the boundary in | `shared/transfers/transfer-request.ts:14-39`; `server/savings/prepare.ts:111-120`; `shared/borrowing/types.ts:48-71`; `shared/trading/contract.ts:133-151`; `shared/amounts/decimal.ts:18-41` | Held. Integer-string parsers and exact decimal arithmetic; no float multiplication of token amounts. |
| CDP `idempotencyKey` and EIP-5792 id equal the Home action id | `client/account/cdp-money-action-execution.ts:225-240`; `client/account/base-account-connector.ts:460-482` | Held. Duplicate confirm returns the stored committed batch; handle, decline, and retry are idempotent and attempt-fenced in SQL (`store.ts:417-459`). |
| Every authenticated POST re-checks the row owner | `server/actions/handler.ts:223,442,497,537`; `server/actions/store.ts:422-459` | Held. A foreign valid UUID returns 404; a same-address different-subject probe could not read or mutate the row. |
| Reconciliation and follow-through are owner-scoped, provider-read-only, and write-once | `server/actions/reconcile.ts`; `server/actions/receipt.ts:82-169`; `server/actions/follow-through.ts:31-50`; `server/actions/settle.ts:90-173` | Held except the response-precedence gap in F1. No module constructs, signs, replaces, or dispatches calldata. |
| The public paymaster callback is an action capability, not an account read | `server/access/policy.ts:18-19`; `server/paymaster/proxy.ts:21-68` | Held. It requires a confirmed action UUID, matching sender, the exact confirmed calldata hash, EntryPoint v0.6 on Base, USDC only, and a bounded fee. It returns no action summary. |

### Findings

| ID | Severity | Evidence | Finding and disposition |
| --- | --- | --- | --- |
| F1 | P2 | `server/actions/settle.ts:151-170`; `server/actions/store.ts:468-487` | A late unfinalized success receipt can be returned as `confirmed` after a concurrent read persisted a finalized `reverted` outcome. The observation update is correctly refused by the terminal outcome, but the request keeps its stale in-memory row and presents the late receipt. The durable row stays `reverted`; only that response claims success. **Follow-up:** `fix(actions)`. |
| R1 | P3 | `server/actions/handler.ts:650-651`; `client/balances/pending-cashout.ts:156,178` | The 100-row cap can return `truncated:false` when ordinary rows were omitted. The field currently signals cash-out completeness, the only consumer treats it that way, and the existing contract test pins it. No verified customer impact. **Accepted risk:** if a future consumer reads `truncated` as general exhaustiveness, derive it from a 101st sentinel row or rename the signal. |

## 2. Money-action kinds

### What was checked

| Kind | Builder and invariants | Result |
| --- | --- | --- |
| Send | `server/money-actions/prepare-send.ts:62-114`; recipient-name boundary `:117-141`; name resolution disables CCIP Read for `.base.eth` and `.eth` (`server/transfers/recipient-resolver.ts:202-252`); recent recipients are owner-scoped (`server/transfers/handlers.ts:55-81`). | Held. Server builds the recipient and amount; a name must resolve to the requested address or issuance fails. |
| Savings deposit and withdraw | `server/savings/prepare.ts`; verified vault allowlist; exact USDC approval; server source-block fee and share bound; issuance validates the typed savings summary (`server/money-actions/issue.ts`). | Held for authority and amounts; F3 covers the failure-message path. |
| Borrow, repay, collateral | `server/actions/prepare.ts:157-181`; `server/borrowing/prepare.ts`; risk classification from the chain debt; required simulation before issuance. | Held. Offerings gate risk-increasing operations; exits do not depend on operator settings. |
| Cash-out and cash-out withdraw | `server/funding/cash-out.ts:66-85`; provider/region/payment-method binding; exact atomic amount; owner-scoped order state. | Held. Peer duplicate protection is per action intent, as documented. |
| Card allowance | `server/cards/allowance/prepare.ts:83-110`; registered spender only; finite customer amount within the configured maximum; zero for revoke; no maximum-uint approval. | Held. Confirmation re-checks the spender and configuration. |
| Trade | `server/actions/kinds/trade/prepare.ts`; `permit2.ts:83-154`; `quote.ts`; `signer.ts:55-97`; `finalize.ts:36-65`; fee policy `server/fees/policy.ts`. | Held except F2. Permit chain, contract, primary type, token, amount, spender, nonce, and deadline are recomputed server-side; the signer must be the verified owner; quote minimum, recipient, token, and execution target are server-derived. |

### Findings

| ID | Severity | Evidence | Finding and disposition |
| --- | --- | --- | --- |
| F2 | P3 | `server/actions/handler.ts:546-560`; confirm gate at `:249-251` | Cache-plan retry re-checks the execution deadline but not stock jurisdiction. A previously committed stock-buy plan could redispatch from a restricted or missing-country request. New stock buys are currently refused at admission (`shared/trading/assets.ts:78-91`), so this is a latent boundary gap, not present exposure. **Follow-up:** `fix(actions)`. |
| F3 | P2 | `server/actions/prepare.ts:95-97`; `server/savings/rpc.ts:306-315` | Savings preparation returns the upstream JSON-RPC `message` (truncated to 160 characters) in `SAVINGS_ACTION_RPC` (502). Provider-controlled diagnostics reach the customer; no credential or customer data was demonstrated. **Follow-up:** `fix(actions)`. |

## 3. Session and account boundary

### What was checked

| Invariant | Evidence | Result |
| --- | --- | --- |
| The account-provider header can only select an already-verified provider | `server/cdp/session.ts:262-270,288-305,314-328`; `server/auth/authorize.ts:66-84` | Held. Unknown values and ambiguous credential combinations are rejected, not defaulted. |
| Session integrity and expiry | `server/auth/signed-cookie.ts:22-74`; `server/auth/native-base-session.ts:149-164`; `server/cdp/provider.ts:43-55` | Held for integrity: HMAC-SHA256, timing-safe comparison, exact seven-day expiry, HttpOnly, SameSite=Lax, Secure on HTTPS. Revocation is F4. |
| Account export is owner-scoped and excludes secrets | `server/account-export/owner.ts:14-59`; `action-scope.ts:6-13`; `read.ts:38-100`; `safe-fields.ts:82-107` | Held for isolation and projection; completeness is F13. Token and envelope columns are not selected. |
| Auth-boundary failures are generic and enumeration-resistant | `server/cdp/session.ts:190-242,338-345`; `server/auth/native-base-session.ts:218-220,295-305`; `server/account-deletion/errors.ts:19-21` | Held. Fixed codes and messages; no email-existence or provider-text oracle. |
| Account switch and deletion fail closed | `server/customers/resolve.ts:53-65`; `server/account-deletion/store.ts:104-141`; `server/account-deletion/tombstone.ts:32-50` | Held except the rotated-key case in F12. Reads and writes resolve the verified tuple inside the request; deletion writes tombstones before removing identity. |
| Cookie-authenticated writes resist cross-origin use | `server/cdp/session.ts:262-270`; `server/auth/native-base-session.ts:58-70,379-383`; `server/customers/email-request-handler.ts:43-78` | Held under the current browser and same-origin assumptions. Native auth requires the custom provider header; SameSite=Lax and the origin checks cover logout and email writes. Deployment CORS/edge behavior is not verified here. |
| No session secret, provider token, or unintended PII in responses or logs | `server/cdp/session.ts:167-187`; `shared/account/contracts/session.ts:8-13`; `server/auth/native-base-session.ts:362-367`; `server/account-export/handler.ts:27-31` | Held. Responses carry version, subject, address, chain, and provider only. |

### Findings

| ID | Severity | Evidence | Finding and disposition |
| --- | --- | --- | --- |
| F4 | P2 | `server/auth/native-base-session.ts:379-390`; verification at `:149-164` | Native logout clears the four browser cookies but creates no server revocation state. A retained, correctly signed `home-session` token still authorizes for its remaining seven-day lifetime. This is a stateless-token replay property, not a forgery or wallet-signing path. **Follow-up:** `fix(auth)`. |
| F12 | P3 | `server/account-deletion/tombstone.ts:20-40`; `server/account-deletion/store.ts:132-137` | Tombstone digests bind the key, but lookup omits the stored `key_id`. Rotating or mismatching `ACCOUNT_DELETION_TOMBSTONE_SECRET` during the seven-day window silently misses every tombstone and disables deletion revocation on that instance. **Owned:** [#2132](https://github.com/jessepollak/home/issues/2132) already specifies fail-closed mismatch detection. |
| F13 | P2 | `server/account-export/read.ts:64-65,103-104` | Balance snapshots are joined through `customer_wallets`. An address that exists only on an owned action (registry backfill stores only the newest address per credential) is omitted while the export says `complete: true`. **Owned:** [#2132](https://github.com/jessepollak/home/issues/2132); export handlers are also in [#2227](https://github.com/jessepollak/home/pull/2227). |

## 4. Operator authorization and deployment access

### What was checked

| Invariant | Evidence | Result |
| --- | --- | --- |
| Every admin route requires a verified session and a configured operator address | `server/operator/api.ts:17-43`; `server/operator/authorize.ts:11-20`; `server/operator/config.ts:10-24` | Held. All thirteen admin route modules authorize before store access; absent or malformed config is not operator authority. |
| Deployment access is fail-closed and independent of customer identity | `server/access/policy.ts:64-67`; `server/access/token.ts:20-57`; `server/access/handlers.ts:74-109` | Held except F5. HMAC-derived key, timing-safe compare, exact seven-day TTL, private 503 for configured-but-invalid, and a cookie that identifies no customer or administrator. |
| The public-path allowlist is exact and every public API has its own authentication | `server/access/policy.ts:14-32`; route census of all 76 API modules | Held. Eight API modules are public: access login and logout, the CDP webhook, the funding webhook, three card webhooks, and the paymaster callback. The `/access` page, the Apple association file, and static chunks are the only other public paths; `/access` is the gate's own entry point. No prefix, case, suffix, traversal, or encoded-separator neighbor reached a protected handler. |
| Operator responses exclude credential values | `server/operator/setup.ts:22-95`; `server/operator-settings/store.ts:28-52`; `server/support/assistant.ts:20-24` | Held. Setup reports variable names and states; settings are parsed registry values; the support credential reports configured/last4/timestamp only. |
| Operator mutations are same-origin | `server/operator-settings/handlers.ts:75-96`; `server/http/same-origin-mutation.ts:6-13`; `server/support/handlers.ts:355-371,457-510` | Held. Exact Origin and Sec-Fetch-Site checks plus JSON content type before every mutation; cross-origin probes were rejected. |
| Customer support reads are authorized and audited | `server/support/handlers.ts:116-120,416-477`; `server/operator-settings/audit.ts:16-41` | Held. Authorization precedes store access; detail, list, reply, and status responses audit before returning customer data, and an audit failure prevents the response. |

### Findings

| ID | Severity | Evidence | Finding and disposition |
| --- | --- | --- | --- |
| F5 | P3 | `server/access/config.ts:18-21`; `proxy.ts:39-41`; `docs/vercel-deploy.md:116` | Setting only one of `HOME_ACCESS_PASSWORD` or `HOME_ACCESS_SIGNING_SECRET` throws before the documented `503 ACCESS_UNAVAILABLE`. The throw is fail-closed but becomes an unstyled framework error on every request. **Follow-up:** `fix(auth)`. |
| F6 | P3 | `server/access/handlers.ts:120-127`; `docs/vercel-deploy.md:114-122` | Access logout clears this browser's cookie; a copied `home-access` token remains valid until its seven-day expiry because the token is stateless. Rotation revokes it. The residual is not documented. **Follow-up:** `fix(auth)`. |

## 5. Public webhooks

### What was checked

| Invariant | Evidence | Result |
| --- | --- | --- |
| Bodies are bounded and read with a timeout | `server/funding/core/webhook-body.ts:5-17`; `server/http/request.ts:43-77` | Held. 64 KiB and six seconds, ignoring untrusted `Content-Length`; all five webhook routes use it. |
| Signatures are verified before state changes | `server/funding/providers/ripio/adapter.ts:185-195`; `server/cards/bridge/webhook.ts:23-38,44-66`; `server/cards/immersve/webhook.ts:54-81`; `server/balances/webhook.ts:75-81` | Held for state changes. CDP parses before verifying (F8); no write occurs before a valid signature. |
| Invalid signatures cannot mutate state | Same paths; CDP HMAC is timing-safe with a five-minute timestamp bound; card signature failures return terminal responses | Held. An invalid-signature probe produced zero writes or schedules. |
| Provider event ids are deduplicated | Card events: `server/cards/store.ts:16-29` and migration `019_card_events_provider.sql:9-10`; CDP and Ripio: F9 | Partial. Cards deduplicate; CDP and Ripio do not. |
| Retryable failures are distinct from terminal ignores | Card routes distinguish 503 from 202/400; funding route F7 | Partial. Card handling is honest; funding acknowledges transient failure as success. |
| Provider observations never set money state by themselves | `server/funding/core/service.ts:688-711,780-857`; `server/balances/webhook.ts:90-117` | Held. A funding webhook triggers an authenticated provider read and versioned SQL; CDP marks snapshots stale and schedules read-only reconciliation. |

### Findings

| ID | Severity | Evidence | Finding and disposition |
| --- | --- | --- | --- |
| F7 | P2 | `app/api/funding/webhooks/[provider]/route.ts:21-31`; core at `server/funding/core/service.ts:688-711` | A verified, matched delivery that fails during processing (for example a transient database error) is caught and returned as `202 {accepted:true}`. The provider sees success and has no HTTP reason to retry; polling can eventually recover, but delivery retry is suppressed. **Follow-up:** `fix(webhooks)`. |
| F8 | P3 | `server/balances/webhook.ts:54-61` | The CDP body is JSON-parsed and its subscription id used to narrow candidate keys before HMAC verification. The body is bounded (64 KiB) and no state changes before verification. **Follow-up:** `fix(webhooks)`. |
| F9 | P3 | `server/balances/webhook.ts:90-117`; `server/funding/core/service.ts:688-711` | Duplicate CDP and Ripio deliveries repeat stale/dirty writes and read-only scheduling or a forced order refresh. No duplicate dispatch or credit was observed; versions and monotonic stores prevent those inferences. **Follow-up:** `fix(webhooks)`. |

## 6. Credential and customer-data exposure

### What was checked

| Invariant | Evidence | Result |
| --- | --- | --- |
| No server secret is serialized to a client, URL, error, or log | `server/config/env.ts:1-41`; `server/operator/setup.ts`; `server/operator-settings/store.ts`; `server/support/assistant.ts`; `server/account-export/read.ts:55-63` | Held. The card reveal intentionally returns a card-scoped Stripe ephemeral grant, not the Stripe server key; funding returns no provider customer ref or reusable user token. |
| No sensitive console logging | `server/observability/log.ts:57-76`; `server/observability/schema.ts:743-807`; `server/observability/on-request-error.ts:27-38`; `server/http/upstream.ts:197-220` | Held. Events are allowlisted, owners are hashed, and upstream logs carry method/status/classification only. No `console.*` exists in non-test `server/auth`, `server/support`, or `server/funding`; remaining command logs print counts and static labels. |
| Customer responses are private/no-store and owner-scoped | `server/http/private-response.ts:5-32`; route-by-route census of customer families (balances, activity, actions, cards, funding, support, borrow, preferences, export, deletion, invites) | Held. No customer-data route returned a plain public response; the plain responses are catalog reads and webhook accepted booleans. |
| Errors are stable codes, not provider or internal text | Most handlers return fixed errors; savings is F3 | Partial. |
| Card detail is authorized and audited | `server/cards/reveal-handler.ts:24-48`; `server/cards/write-service.ts:37-48`; `server/cards/account-store.ts:14-26` | Authorization and owner scoping hold; auditing is F10. |
| Provider customer ids and credentials are not authorization by themselves | `server/funding/core/service.ts:247-315`; `server/funding/core/customer-store.ts:71-81`; `server/funding/core/quote-token.ts:7-45`; `server/funding/core/user-token-store.ts:80-106` | Held. Lookups use the verified owner tuple; quote tokens are HMAC-authenticated; reusable tokens are sealed with full owner and destination binding. |
| `.env.example` has no real secrets and documented rotation matches enforcement | `scripts/gates/env-template.mjs`; `.env.example`; `docs/secrets-at-rest.md`; `server/secrets/at-rest.ts:22-69` | Held for values and core encryption; rotation coverage is F11. |

### Findings

| ID | Severity | Evidence | Finding and disposition |
| --- | --- | --- | --- |
| F10 | P2 | `server/cards/write-service.ts:138-146`; `server/cards/reveal-handler.ts:24-48`; `server/cards/bridge/program.ts:62-65` | A successful card-detail reveal returns a Stripe ephemeral grant without a durable Home access record. Authorization, same-origin checks, owner scoping, and provider/card binding hold; the gap is accountability, not a disclosed card number or cross-owner access. **Follow-up:** `fix(cards)`. |
| F11 | P3 | `scripts/secret-envelopes.ts:23-37`; `docs/secrets-at-rest.md:15-17`; `server/support/assistant.ts:20-59` | Support assistant credentials are sealed under the same keyring, but the documented rotate/verify command covers only funding user tokens and webhook secrets. Following the runbook to remove the previous key can make the assistant credential undecryptable and quietly fall back to operator mode. **Follow-up:** `fix(ops)`. |

## Held summary

| Area | Invariants held |
| --- | --- |
| Money-action lifecycle | Verified-session ownership; server-authored and immutable calldata; integer amounts; action id as provider idempotency key; owner re-check on every POST; read-only reconciliation; action-capability paymaster callback. |
| Money-action kinds | Send recipient binding with CCIP Read disabled; savings vault and exact-approval bounds; borrow risk class and simulation; cash-out provider binding; card allowance spender registry and finite approval; trade permit hash, signer, quote, fee destination, and execution target. |
| Session and account | Provider selector cannot elevate; session integrity and expiry; export owner isolation and secret exclusion; generic auth errors; deletion tombstone and account-switch scoping; same-origin writes. |
| Operator and access | All admin routes authorized; fail-closed deployment access; exact public allowlist with independently authenticated public APIs; operator responses redact credentials; audited support access. |
| Webhooks | Bounded bodies; invalid signatures cannot mutate; card event deduplication; provider observations never set money state by themselves. |
| Credentials and data | No server secret in responses or logs; private/no-store customer responses; owner-scoped provider ids and sealed tokens; safe error shapes except F3. |

## Not verified / risk

- **Deployed controls.** Vercel route normalization, Deployment Protection, firewall rules, hosted CORS and log sinks, production migrations, provider dashboards, and real provider retry schedules were not inspected. Source review cannot attest those controls.
- **Live provider behavior.** CDP same-key semantics, Base duplicate-id behavior, ERC-1271 and Settler execution, Stripe reveal, and funding provider payload variation were not exercised. The review attests the local implementation and the cited tests, not provider behavior.
- **Rate limiting.** The paymaster callback and other unauthenticated cost-bearing endpoints intentionally have no application rate limiter; the deployment boundary belongs to [#1160](https://github.com/jessepollak/home/issues/1160) and the operator firewall checklist. This record does not duplicate it.
- **Stateless challenge replay.** A signed challenge and proof can replay for five minutes while the original HttpOnly cookie is retained. This is documented and accepted in [Base Account](base-account.md); it is not reported as a new defect.
- **Duplicate handle projection.** After an owner read persists an unfinalized success observation, a duplicate `/handle` can return `pending` while the durable observation remains succeeded. No inspected client consumer uses that response's status (`client/query/after-action.ts:442-454`), so this is a projection consistency risk, not a money-truth defect.
- **CSRF posture.** Deletion relies on the custom provider header, SameSite=Lax, and browser same-origin policy rather than its own Origin check. A browser bypass was not demonstrated; hosted edge behavior remains unverified.
- **Client-error text.** `/api/client-errors` accepts scrubbed free text rather than an allowlisted taxonomy. Reviewed reporters send fixed messages, and no support-body or PII logging path was found; regex scrubbing cannot prove arbitrary free text is safe.

## Follow-ups

| Findings | Follow-up | Area |
| --- | --- | --- |
| F1, F2, F3 | Filed in [#2108](https://github.com/jessepollak/home/issues/2108): correct action status, stock retry and savings error text | money-actions |
| F4, F5, F6 | Filed in [#2235](https://github.com/jessepollak/home/issues/2235): revoke signed-out sessions and make deployment access fail closed | session, access |
| F7, F8, F9 | Filed in [#2265](https://github.com/jessepollak/home/issues/2265): retry transient funding failures and verify before parsing | funding, balances |
| F10 | Filed in [#2263](https://github.com/jessepollak/home/issues/2263): record card-detail reveal access | cards |
| F11 | Filed in [#2264](https://github.com/jessepollak/home/issues/2264): include support credentials in documented key rotation | operator settings |
| F12, F13 | Already owned by [#2132](https://github.com/jessepollak/home/issues/2132); export handlers also in [#2227](https://github.com/jessepollak/home/pull/2227) | account privacy |

No finding in this review changes wallet-signing authority, moves funds without the owner's signature, discloses another customer's data, or exposes a server credential. The record should be re-run after any change to the action state machine, session issuance or revocation, the deployment access gate, a public webhook, or a credential store.

## Evidence

| Pass | Files read | Executable evidence | Outcome |
| --- | --- | --- | --- |
| Lifecycle and store | Every assigned actions module, route, and direct caller; action, paymaster, access-policy, and dispatch suites | 549 repository tests plus four characterization probes, including a real PostgreSQL store for cross-owner and concurrency paths | 6 held, 1 response-precedence finding, 1 accepted contract-signal risk |
| Kinds and issuance | All trade modules, send issuance, resolver, recent recipients, and their suites | 661 tests (630 area suites plus 31 execution suites), plus one cached-plan retry probe | 6 held, 1 latent retry gap |
| Session and account | Session handler, native sessions, signed cookies, export, deletion liveness, contracts, and auth suites | 424 tests including four credential-free synthetic-identity probes | 4 held, 1 revocation finding, 2 existing owners |
| Operator and access | Operator handlers, access policy/token/config, all admin routes, every public webhook, and their suites | 334 tests plus six probes covering 64 admin-denial cases, 12 path-neighbor cases, cross-origin rejection, logout replay, partial config, and replay | 5 held, 2 access findings, 3 webhook findings |
| Credential and data exposure | All 76 API route modules and the non-test server surface; response, error, logging, and credential paths | Response census and targeted sweeps, two boundary probes, and the environment-template gate (9 tests) | 4 held, 1 error-text finding, 1 reveal-audit finding, 1 rotation finding |

The suites ran at the reviewed commit with no repository edits. PostgreSQL-backed evidence used the repository's migration helper against an isolated local database. Injected boundaries are identified below; no funded or live action was performed.

**Evidence boundaries.** The record does not upgrade one kind of check into another:

- **Real PostgreSQL** (repository migrations, store, and handler): F1's concurrent receipt/outcome interleaving and the cross-owner get/confirm/handle/decline/retry probes, plus the action store, outcome, list, trade, cash-out, and fee suites.
- **Real store and handler over an injected SQL executor or provider boundary:** F2's cached-plan retry probe, F12's tombstone lookup, and F11's rotation probe. These prove the code path, not a production database or provider.
- **Source trace plus existing tests, with a fake HTTP or provider boundary where named:** F3's savings handler probe (real handler and state reader, fake RPC), F7's exception-propagation path, and F8/F9's webhook ordering and replay. F4, F5, F6, F10, and F13 are source-level findings.

No live browser, provider, production database, or funded action was exercised.

## Exclusions

- Rate limiting ([#1160](https://github.com/jessepollak/home/issues/1160)).
- Compile-time authorization proofs ([#2076](https://github.com/jessepollak/home/issues/2076), [#2229](https://github.com/jessepollak/home/pull/2229)).
- Auth-boundary error contracts and account-export handlers under rewrite ([#2227](https://github.com/jessepollak/home/pull/2227)); findings in those paths are recorded above with their existing owner.
- Account-deletion lifecycle debt already tracked by [#2132](https://github.com/jessepollak/home/issues/2132).
- UI rendering, design-system behavior, and browser presentation outside the response shapes cited here.

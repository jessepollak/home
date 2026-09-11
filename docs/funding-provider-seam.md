# Funding provider seam

Status: design proposal, September 11, 2026, revised after an Astra architecture challenge the same day. Not implemented. Defines the architecture that lets stablecoin issuers and rail integrators add a 1:1 local-currency onramp to Home by writing one bounded adapter directory, and defines how such an adapter is verified, merged inert, and later enabled without the maintainer holding an account in that region. Current delivery: [build status](build-status.md). Tracking: [#15](https://github.com/jessepollak/home/issues/15).

Related: [regional money](regional-money.md), [currency defaults](currency-defaults.md), [fork and extend](fork-and-extend.md), [architecture review — contribution contract](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers).

## Problem

Home maps each supported country to a local currency and one default Base stablecoin. The product promise is that a user in Brazil deposits reais over Pix and holds BRZ, a user in Indonesia pays a bank virtual account and holds IDRX, and so on. Each of those routes is a "1:1 onramp": local rail in, exact token to the user's Home smart account on Base out.

Three routes exist in some form today, and each was built as its own lane:

| Route | Shape | State in tree | Size |
|---|---|---|---|
| Coinbase Onramp (US, USDC) | Hosted session. Server mints a session URL; browser leaves and returns to `/fund?return=coinbase`. Amount is chosen on Coinbase; no order identity or tracking. | Live | ~300 lines |
| Ripio Ramps (AR wARS, CO wCOP) | Native API. Customer (email) → terms → KYC submission → quote → order with client-supplied external reference → rail instructions → HMAC webhook + `getTransaction` → hash-bound onchain receipt match → refund states. Per-country OAuth credentials. Transport loss on create is `ambiguous-create` and is never retried. | Merged in [#253](https://github.com/jessepollak/home/pull/253). No route imports it; the UI step is a "Synthetic preview". | ~1,500 lines, own tables |
| IDRX (ID) | Native mint. HMAC-signed mint request (amount, destination, VA channel or hosted QRIS) → provider-assigned `merchantOrderId` plus VA number/fees/expiry or checkout URL → status by polling history with that assigned ID → attempt store that reserves before dispatch and keeps an ambiguous admission reserved indefinitely. Credentials are bound to one configured Home subject. | Draft [#120](https://github.com/jessepollak/home/pull/120), blocked on a funded proof. | +4,120 lines |

Every one touches the same shared files (`add-money-dialog.tsx`, `funding-experience.tsx`, `shared/funding/funding-client.ts`, `shared/funding/types.ts`, `.env.example`) and brings its own persistence, reconciliation, and UI step. Mexico MXNB, Singapore XSGD, and Türkiye TRYB ([#56](https://github.com/jessepollak/home/issues/56)–[#58](https://github.com/jessepollak/home/issues/58)) are blocked on the same two facts: nobody on the crew can complete a real payment in those countries, and each integration is a multi-thousand-line money-path review.

The people who can complete those payments are the issuers. They will do the work if it is one small, well-bounded directory with an executable checklist, and the maintainer will merge it if the parts that matter for safety are owned by the core rather than by each adapter.

## Goals

1. An issuer adds a route by writing one directory under `apps/web/server/funding/providers/<id>/`. When the region, token, instruction kind, and customer flow already exist in the core, no shared file changes by hand.
2. The core owns everything money-safety depends on: session, eligibility, destination, token identity, idempotency, quotes, persistence, webhook handling, onchain settlement evidence, and the UI. Adapters report; the core decides.
3. Verification does not require the maintainer to hold a regional bank account. Conformance runs in CI; a live proof is bound to a reviewed commit and a Base transaction the maintainer checks independently; merge and enable are separate gates.
4. Merged adapter code is inert in any deployment that does not configure that provider's credentials and eligibility.
5. Agents build most of an adapter from public API documentation; the issuer's job is credentials, recorded fixtures, and the live proof.
6. The contract is shaped by the three real routes before it is offered to outsiders: Coinbase as a hosted session, Ripio and IDRX as order providers.

Non-goals: aggregator routing (Onramper, Swapped), off-ramps, fiat balances, and any in-Home identity collection. Sell/redeem is out of scope for this document.

## What "one bounded directory" means, honestly

A contributor writes `providers/<id>/` and runs `bun run funding:sync-providers`, which regenerates `providers/index.ts` from the directory listing. Nothing else in the tree changes when:

- the country is already in `apps/web/config/regions.ts`,
- the token is already in the funding asset registry (below),
- the rail fits one of the existing instruction kinds, and
- the customer flow fits one of the existing customer modes.

Anything else — a new country, a new token, a new instruction kind, a new customer mode — is a crew-owned change under the existing [contribution contract](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers), landed before or alongside the adapter PR by the crew, not the contributor. Hosted-Home activation lives in a separate crew-owned rollout registry (`apps/web/config/funding-rollout.ts`); adapters never enable themselves.

## Directory ownership

```
apps/web/
  config/
    funding-rollout.ts          # which bindings hosted Home has turned on (crew)
  shared/funding/
    assets.ts                   # runtime-safe token identity registry (crew)
    provider-contract.ts        # kinds, manifest, reported states, instructions (crew)
    order-types.ts              # client-visible order/quote/session shapes (crew)
  server/funding/
    core/
      authorize.ts              # session boundary, eligibility, destination injection
      quotes.ts                 # owner-scoped quote snapshots and handles
      orders.ts                 # reserve → dispatch → persist → recover
      reconcile.ts              # core state machine, evidence claims, webhook inbox
      store.ts                  # FundingOrderStore interface + memory adapter
      postgres-store.ts
      migrations/
      handlers.ts               # thin route factories
      testing/                  # the contract suites listed under Verification
    providers/
      index.ts                  # generated by funding:sync-providers
      _template/
      coinbase-onramp/          # hosted-session reference
      ripio/                    # order-provider reference: quotes, webhooks, refunds
      idrx/                     # order-provider reference: provider-assigned reference, polling
      <issuer>/
        manifest.ts
        adapter.ts
        fixtures/*.json
        evidence/live-proof.json
        README.md
  client/funding/
    add-money-dialog.tsx        # method list from GET /api/funding/providers
    order-flow.tsx              # requirements → amount/quote → instructions → pending → done
    instruction-renderers/
  app/api/funding/
    providers/route.ts          # GET available bindings for region + session
    sessions/route.ts           # POST hosted session (replaces onramp-session)
    quotes/route.ts             # POST
    orders/route.ts             # POST create, GET list open (recovery)
    orders/[id]/route.ts        # GET refresh
    webhooks/[provider]/route.ts
```

## Token identity registry

`docs/stablecoin-candidates.json` labels itself "not an executable allowlist"; USDC's decimals are `null` there, and every regional entry in `regions.ts` is `fundingStatus: "disabled"`. Neither is safe as an execution source.

`apps/web/shared/funding/assets.ts` is the crew-owned runtime registry. One record per asset:

```ts
export type FundingAsset = {
  id: string;                       // "base:idrx"
  chainId: 8453;
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  issuer: string;
  fiat: FiatCurrencyCode;
  verification: {
    issuerDocumentUrl: string;      // where the issuer publishes this address
    onchainReadAt: string;          // date the crew read code/decimals/symbol on 8453
    onchainDecimals: number;
    onchainSymbol: string;
  };
};
```

A test asserts each asset's `symbol` equals the region's confirmed default in `regions.ts` and its `fiat` matches [currency defaults](currency-defaults.md). Manifests reference `assetId` only. Adapters never restate an address or decimals; a provider response that disagrees with the registry is a `binding-conflict`.

## The contract

Two provider kinds share one manifest, one registry, and one method list, but have different lifecycles.

### Manifest

```ts
export type FundingProviderManifest = {
  id: string;
  displayName: string;
  docsUrl: string;
  kind: "hosted-session" | "order";
  bindings: ReadonlyArray<{
    id: string;                              // "ripio:AR"
    region: CountryCode;
    assetId: string;                         // must exist in assets.ts
    paymentMethods: ReadonlyArray<{ id: string; label: string; rail: string }>;
    env: ReadonlyArray<string>;              // credentials for this binding only
    apiOrigins: ReadonlyArray<string>;
    sandbox?: { apiOrigins: ReadonlyArray<string>; env: ReadonlyArray<string> };
  }>;
  redirect?: { origins: ReadonlyArray<string>; pathPrefixes?: ReadonlyArray<string> };
  // order kind only
  referenceStrategy?: "client-supplied" | "provider-assigned" | "idempotency-header";
  retrySafety?: "lookup-by-reference" | "idempotency-key" | "none";
  quotes?: boolean;
  customer?: "none" | "provider-hosted" | "operator-account" | "api";
  webhook?: { signatureHeader: string; env: ReadonlyArray<string> };
  statusCorpus?: ReadonlyArray<string>;      // provider statuses the adapter claims to map
  limits?: { minFiat?: string; maxFiat?: string };
};
```

### Hosted-session provider (Coinbase)

```ts
export type HostedSessionProvider = {
  manifest: FundingProviderManifest & { kind: "hosted-session" };
  createSession(input: { destination: `0x${string}`; returnUrl: string; binding: FundingBinding }, ctx: ProviderContext): Promise<{ url: string }>;
};
```

No order is persisted. The user chooses the amount on the provider's page, so there is no expected amount to match and no order identity to attribute. Returning to Home triggers a balance and Activity refresh, nothing more. This is the current Coinbase behavior with the manifest, credential gating, and redirect validation moved into the core. A hosted-session provider becomes an order provider only if it exposes an attributable order ID and a fixed expected token amount.

### Order provider (Ripio, IDRX, future issuers)

```ts
export type OrderProvider = {
  manifest: FundingProviderManifest & { kind: "order" };

  createQuote?(input: QuoteIntent, ctx: ProviderContext): Promise<ProviderQuote>;

  createOrder(input: OrderIntent, ctx: ProviderContext): Promise<CreateOrderResult>;

  findOrderByReference?(reference: string, ctx: ProviderContext): Promise<ProviderOrderObservation | null>; // required when retrySafety === "lookup-by-reference"

  getOrder(ref: { providerOrderId: string }, ctx: ProviderContext): Promise<ProviderOrderObservation>;

  verifyWebhook?(raw: Uint8Array, headers: Headers, ctx: WebhookContext):
    { ok: true; providerOrderId: string; eventId: string; occurredAt: string; bindingHint?: string } | { ok: false };

  ensureCustomer?(input: CustomerIntent, ctx: ProviderContext): Promise<ProviderCustomer>; // required when customer === "api"
};

export type ProviderContext = {
  binding: FundingBinding;                 // one adapter instance per binding
  env: Readonly<Record<string, string>>;   // that binding's declared variables only
  fetch: typeof fetch;                     // origin allowlist, redirect: "manual", size and time bounds
  now(): string;
};

export type WebhookContext = { env: Readonly<Record<string, string>>; now(): string };

// Resolved from the manifest + asset registry by the core; adapters receive it, never construct it.
export type FundingBinding = {
  id: string;                              // "ripio:AR"
  providerId: string;
  region: CountryCode;
  asset: FundingAsset;                     // from shared/funding/assets.ts
  paymentMethod: { id: string; label: string; rail: string };
  apiOrigins: ReadonlyArray<string>;
  environment: "production" | "sandbox";
};

export type QuoteIntent = {
  binding: FundingBinding;
  destination: `0x${string}`;
  fiatAmount: string;
};

export type ProviderQuote = {
  providerQuoteId: string;
  fiatAmount: string;
  finalFiatAmount: string;
  tokenAmountAtomic: string;               // at the asset's decimals
  rate: string;
  fees: ReadonlyArray<{ label: string; amount: string; currency: string }>;
  expiresAt: string;
};

export type CustomerIntent = {
  binding: FundingBinding;
  homeSubject: string;                     // owner subject; the adapter may hash it, never persist it
  email?: string;                          // only when the manifest declares it as required
};

export type CustomerRequirement =
  | { kind: "terms"; id: string; url: string }
  | { kind: "kyc-url"; url: string };

export type ProviderCustomer = {
  customerRef?: string;                    // opaque provider identifier; the only thing the core persists
  requirements: ReadonlyArray<CustomerRequirement>;  // empty means the user may create orders
};

export type OrderIntent = {
  homeOrderId: string;                     // sent as the external reference when referenceStrategy is client-supplied
  idempotencyKey: string;                  // sent as the idempotency header when referenceStrategy is idempotency-header
  binding: FundingBinding;
  destination: `0x${string}`;              // core-injected verified smart account
  fiatAmount: string;
  quote?: ProviderQuote;                   // the core-persisted snapshot, never a client-supplied ID
  customerRef?: string;
  returnUrl: string;
};

export type CreateOrderResult =
  | { outcome: "created"; order: ProviderOrder }
  | { outcome: "rejected"; code: "invalid-request" | "unauthorized" | "limits" | "unavailable"; retryable: boolean }
  | { outcome: "ambiguous" };              // request may have reached the provider; the core must not retry

export type ProviderOrder = {
  providerOrderId: string;
  token: { address: `0x${string}`; decimals: number };   // echoed; must equal the registry asset
  expectedTokenAmountAtomic: string;
  fees: ReadonlyArray<{ label: string; amount: string; currency: string }>;
  expiresAt: string | null;
  instructions: Instruction;
  reported: ProviderReportedState;
};

export type Instruction =
  | { kind: "redirect"; url: string }
  | { kind: "bank-transfer"; rail: string; accountNumber: string; accountName?: string; bank?: string; alias?: string; reference?: string; amount: string; currency: string }
  | { kind: "qr"; scheme: "pix" | "qris" | "promptpay" | "other"; payload: string; amount: string; currency: string }
  | { kind: "payment-key"; scheme: string; key: string; amount: string; currency: string };

// What an adapter may say. It cannot say "received" or "sent-unverified".
export type ProviderReportedState =
  | "awaiting-payment" | "payment-received" | "settling" | "sent"
  | "expired" | "cancelled" | "failed"
  | "refund-pending" | "refunded" | "refund-rejected"
  | "unknown";

// What the core records. Only the core derives the last two.
export type CoreOrderState =
  | "reserving" | "dispatch-ambiguous"
  | ProviderReportedState
  | "sent-unverified" | "received";

export type ProviderOrderObservation = {
  providerOrderId: string;
  reported: ProviderReportedState;
  providerStatus: string;                  // raw, for diagnostics; must be in statusCorpus or map to "unknown"
  transactionHash?: `0x${string}` | null;
  echoed?: Partial<{ destination: `0x${string}`; reference: string; fiat: string; tokenAddress: `0x${string}`; amount: string }>;
  refund?: { status: string; reason: string | null } | null;
};
```

How the three routes fit:

| | Coinbase | Ripio | IDRX |
|---|---|---|---|
| kind | hosted-session | order | order |
| referenceStrategy | — | client-supplied (`externalRef`) | provider-assigned (`merchantOrderId`) |
| retrySafety | — | none today (`ambiguous-create` is terminal) | none (ambiguous admission stays reserved) |
| quotes | — | yes | no |
| customer | provider-hosted | api | operator-account |
| tracking | — | webhook + `getTransaction` | history polling |
| instructions | redirect | bank-transfer (CVU), redirect (CO payment URL), payment-key (BRE-B, Nequi) | bank-transfer (VA), redirect (QRIS checkout) |
| credentials | one CDP key | per country | one issuer key bound to one operator |

The four instruction kinds cover every rail seen so far. New kinds are crew-owned additions.

### Customer modes and eligibility

Credential state and eligibility are separate. Credentials say whether the deployment can call the provider; eligibility says which verified users may use the binding.

- `none` / `provider-hosted`: KYC happens on the issuer's surface. Eligibility default: any verified user in the binding's region.
- `operator-account`: the deployment operator holds one issuer account and mints to user destinations under its own name. Eligibility default: an explicit allowlist of Home subjects from env (`FUNDING_<ID>_ELIGIBLE_SUBJECTS`), matching the IDRX draft, which binds credentials to one configured subject. Widening to "any verified user in region" is an operator decision recorded in the rollout registry, not a side effect of setting credentials.
- `api`: the adapter enrolls the user with the issuer. Phase 1 supports `ensureCustomer` returning a `ProviderCustomer`: an optional opaque `customerRef` plus `requirements`, each either `{ kind: "terms", id, url }` or `{ kind: "kyc-url", url }` (types above). An empty `requirements` list means the user may create orders. The core persists only `customerRef`, never identity data. Ripio's current client creates a customer from an email and submits KYC fields directly; no hosted KYC link exists in the evidence packet. Until Ripio confirms a hosted path or an identity-collection step is designed separately, the Ripio order flow stops at the requirements step and is not available to users. This keeps the flexible-KYC decision without building identity handling speculatively.

`core/authorize.ts` evaluates `credentialState × eligibility × region` and returns only usable bindings from `GET /api/funding/providers`. Owner-scoped tests cover every mode.

## Core behavior

### Quotes

`POST /api/funding/quotes` with `{ bindingId, paymentMethodId, fiatAmount }`. The core calls `createQuote`, persists an owner-scoped snapshot (binding, payment method, fiat amount, destination, fees, final amounts, rate, provider quote ID, expiry, intent digest), and returns a core-issued `quoteHandle`. Order creation accepts only that handle; the core reloads the snapshot, checks owner, binding, payment method, amount, destination, and expiry, and passes the snapshot to the adapter. A handle used with any different field, or after expiry, fails. Clients never send a provider quote ID.

### Order lifecycle

1. Client posts `{ bindingId, paymentMethodId, fiatAmount, quoteHandle? }`. No destination, token, reference, or calldata.
2. Core authorizes the session (existing `createSessionHandler` boundary), requires a chain 8453 smart account, resolves the binding, and checks credentials and eligibility. Missing credentials → `424 FUNDING_PROVIDER_NOT_CONFIGURED`; ineligible → `403`.
3. Core reserves a `funding_orders` row before any I/O: `homeOrderId`, owner tuple, binding, immutable intent digest, `creationBlockNumber` (current Base head, read once at reservation), `state: "reserving"`, `dispatchCount: 0`. A refresh recovers the reservation; it never creates a second row for the same intent.
4. Core increments `dispatchCount` and calls `createOrder`.
   - `created`: the echoed token must equal the registry asset or the order fails `binding-conflict` and nothing is shown. Redirect URLs are validated per the redirect rules below. Core persists `providerOrderId`, expected atomic amount, fees, expiry, reported state, and the instruction (every kind, including `redirect`) in `funding_order_instructions` for owner-scoped display and recovery.
   - `rejected`: the row is closed with the code; retryable rejections may be re-attempted by the user as a new order.
   - `ambiguous`: the row moves to `dispatch-ambiguous`. If `retrySafety` is `lookup-by-reference`, the core calls `findOrderByReference(homeOrderId)` and adopts a match. If `idempotency-key`, one retry with the same key is allowed. If `none`, the row stays `dispatch-ambiguous` permanently and the UI tells the user to check Activity before trying again. `createOrder` is never called twice for one row unless the manifest proves the retry is idempotent.
5. Client renders the instruction and polls `GET /api/funding/orders/[id]`. A stale row triggers `getOrder`. The observation's echoed fields are checked against the row (destination, reference, fiat, token, amount); a conflict freezes the row and is surfaced, never applied.
6. The reported state is applied through the core state machine. `sent` becomes `sent-unverified`. Only claimed onchain evidence produces `received`.
7. Webhooks hit `/api/funding/webhooks/[provider]`. The core reads the raw body, calls `verifyWebhook` with the webhook context, dedupes by `eventId`, matches `providerOrderId`, then re-reads the order from the provider with `getOrder` using the matched binding's context. Webhook bodies never set state. Unmatched events go to `funding_webhook_inbox`; recovery probes each of the provider's configured bindings and adopts a match only when exactly one binding recognizes the order (the Ripio inbox-recovery behavior made a core policy), otherwise the event stays pending with an ambiguity marker.

### Settlement evidence

`received` requires a `Transfer` log of exactly `expectedTokenAmountAtomic` of the registry asset to the row's destination, in a transaction the provider identified by hash, in a block at or after the row's `creationBlockNumber`, with at least N confirmations. The core persists a claim on `(chainId, transactionHash, logIndex)` in `funding_evidence_claims` with a uniqueness constraint; evidence already claimed by any other row is rejected. There is no log-scan attribution path: a provider that reports `sent` without a hash leaves the row at `sent-unverified`, and the UI says the issuer reports the transfer as sent and points to Activity.

### Persistence

Postgres only, matching [#245](https://github.com/jessepollak/home/pull/245). Tables:

- `funding_orders` — owner tuple, binding, provider, `provider_order_id` (unique per provider), intent digest, `creation_block_number`, `dispatch_count`, expected atomic amount, fees, expiry, `reported_state`, `core_state`, `transaction_hash`, `version`.
- `funding_order_instructions` — `home_order_id`, `instruction_json`, `expires_at`. Separate from order metadata because it holds the provider's receiving details (VA numbers, CVUs, account names, payment URLs). Owner-scoped reads only, `private, no-store` responses, redacted from logs, encrypted at rest where the deployment provides a key, and deleted when the order reaches a terminal state or the instruction expires.
- `funding_quotes` — owner-scoped snapshots with expiry.
- `funding_evidence_claims` — unique `(chain_id, transaction_hash, log_index)` → `home_order_id`.
- `funding_webhook_events`, `funding_webhook_inbox`.

`FundingOrderStore` is injectable with a memory adapter and a `describeFundingOrderStore` contract test mirroring `describeMoneyActionStore`. The Ripio migration's "no bank details" promise is replaced by the explicit classification above; this is a data-policy change and is called out as such in the Phase 1 PR.

### Redirect rules

Redirect URLs are opaque, short-lived bearer material. Coinbase requires a `sessionToken` query parameter, so query tokens are allowed. The core requires `https:`, a host in the manifest's redirect origins, an allowed path prefix when declared, no userinfo, no fragment, and a bounded length. Hosted-session URLs are never persisted. Order instructions of every kind, including `redirect`, are persisted in `funding_order_instructions` for owner-scoped display and recovery, redacted from logs, and deleted when the order reaches a terminal state or the instruction expires.

### Credential gating and rollout

`credentialState(binding, env)` → `configured | missing | partial`. `GET /api/funding/providers` returns only bindings that are configured, eligible for this session, and either `rollout: "default"` in `config/funding-rollout.ts` or `rollout: "opt-in"` with the operator's explicit env flag. Merged adapters are invisible and refuse to create orders until an operator does all three.

## Adapters are trusted server code

Adapters run in-process on the server. The injected `fetch` (origin allowlist, `redirect: "manual"`, final-origin check, response size and time bounds) and the per-binding env subset are defense-in-depth, not containment: JavaScript has no capability boundary, and a provider SDK can open its own sockets or read `process.env`. Consequences:

- Adapters use the injected `fetch` and raw HTTP. Provider SDKs are not allowed unless the crew audits them.
- A lint rule for `providers/**` forbids `process.env`, global `fetch`, `node:*` network modules, and `@/server/*` imports outside `core/testing`.
- Every adapter PR gets the strongest reviewer (Astra) per the [delivery loop](operating-manual.md#delivery-loop); the bounded surface makes that review short, not optional.
- Out-of-process isolation is a later option if third-party adapter volume warrants it.

## UI

The MoneyModal "Add money" method step lists `Receive crypto`, then one `Deposit {currency}` row per usable binding from `GET /api/funding/providers` (label and hint from the manifest), then `Use another onramp`. Hosted-session bindings open the provider directly. Order bindings open `order-flow.tsx`:

`requirements` (only when the customer mode returns any) → `amount` (shared MoneyModal amount step; quote shown when the manifest has quotes) → `instructions` (one renderer per kind; shared tap-to-copy on account numbers and QR payloads) → `pending` (polls; plain-language state) → `done` / `failed` / `refund`. `dispatch-ambiguous` and `sent-unverified` have their own plain-language screens. On open, the flow lists the owner's open orders for the region and resumes the most recent so a closed tab does not strand a payment. Copy follows [UI direction](ui-direction.md); disclosures belong in Account.

## Verification without a regional account

### Test suites

Split by responsibility, each with its own `describe*` helper under `core/testing/`:

1. Manifest validation — kind, bindings, asset IDs exist, env declared, origins well-formed, status corpus present for order providers.
2. Adapter fixture contract — with provider HTTP replaced by fixtures: fail closed without env and zero outbound calls; outbound host allowlist; the recorded `createOrder` request carries exactly the injected destination and (for client-supplied references) `homeOrderId`; echoed token equals the registry asset; exact decimal↔atomic arithmetic at the asset's decimals; every status in `statusCorpus` maps to a reported state, and an undeclared status maps to `unknown`; `ambiguous` is returned for transport loss and 5xx; redirect URLs pass the redirect rules; response size and timeout bounds honored. Fixtures carry `source: "synthetic" | "recorded"` and `recordedAt`.
3. Core orchestration contract — reserve-before-dispatch, one dispatch per row, ambiguous handling per `retrySafety`, echoed-field conflict freezes, `sent` → `sent-unverified`, `received` only with a claimed evidence row, quote handle misuse fails, owner isolation, eligibility per customer mode, expiry.
4. Store contract — concurrency on reservation and version, `provider_order_id` uniqueness, evidence-claim uniqueness, owner scoping, instruction deletion on terminal state.
5. Webhook inbox contract — tampered signature rejected, replay reported duplicate, unmatched event recorded, single-binding adoption, multi-binding ambiguity stays pending.
6. Route tests — authenticated rejection before any provider call, private headers, error codes.

Suites 1–2 are what a contributor runs against their adapter; 3–6 are crew-owned and run against every registered adapter in CI.

### Merge gate

An adapter PR merges when suites 1–6 pass in CI, an Astra review passes, and the manifest's asset exists in the registry. It merges inert: no credentials, no rollout entry.

### Live proof

The contributor runs their clone against production with their own credentials and regional bank account, completes one small order, and commits `providers/<id>/evidence/live-proof.json`:

```json
{
  "commit": "<sha of the reviewed adapter>",
  "manifestDigest": "sha256:…",
  "fixturesDigest": "sha256:…",
  "environment": "production",
  "recordedAt": "2026-09-20T14:02:00Z",
  "recordedBy": "github-handle",
  "bindingId": "juno:MX",
  "homeOrderId": "…",
  "providerOrderId": "…",
  "fiatAmount": "200.00",
  "expectedTokenAmountAtomic": "200000000",
  "destination": "0x…",
  "transactionHash": "0x…",
  "logIndex": 3,
  "blockNumber": "…",
  "creationBlockNumber": "…",
  "providerReceiptRedacted": { "...": "provider status payload with identifiers only" },
  "recording": "https://…",
  "attestation": "signed statement from the issuer organization"
}
```

`bun run funding:verify-proof <id>` checks against Base RPC that the transaction exists, that the log at `logIndex` is a `Transfer` of the registry asset to `destination` for exactly `expectedTokenAmountAtomic`, that its block is at or after `creationBlockNumber` from the proof (the same bound the core applies), and that the manifest and fixture digests match the tree at `commit`. It does not claim to prove the destination is a Home account; that is not publicly verifiable and is not asserted.

### Enable gate

Enabling a binding on hosted Home requires, in addition to the merge gate:

- recorded production fixtures replacing synthetic ones;
- a verified live proof bound to the reviewed commit;
- issuer identity confirmation (PR from the issuer's GitHub organization or a contact reachable through the issuer's published domain);
- `bun run funding:enablement-check <id>` run by the contributor in their environment, exercising credential validation, order creation and recovery, `getOrder` on a real order, and webhook verification or polling, emitting a report committed next to the proof — or the crew exercising the same against issuer-provided sandbox credentials on a preview deployment;
- an operator runbook in the adapter README (webhook URL, env, limits, support contact), a kill switch (removing the rollout entry disables the binding without a deploy), and a stuck-order query for `sent-unverified` and `dispatch-ambiguous` rows.

## Making the guide executable

- `bun run funding:new-provider <id>` copies `_template/` into `providers/<id>/`, fills the id, and runs `funding:sync-providers`. The template's suites 1–2 fail with a checklist ("bindings is empty", "createOrder not implemented", "no fixtures for statusCorpus"). That failing run is the guide's progress tracker.
- `docs/integrations/README.md` is the guide: prerequisites, the path from scaffold to live proof, the rules the core enforces on the adapter's behalf, the two gates, and what to attach. Written so an agent can execute it.
- `bun run funding:status` regenerates `docs/integrations/status.md` from manifests, fixture provenance, `evidence/`, and the rollout registry: `wanted → scaffold (synthetic fixtures) → recorded fixtures → live-proven → enabled`. Wanted regions link to their issue.
- `.github/ISSUE_TEMPLATE/onramp-integration.yml` lets an issuer claim a region. #54, #56, #57, #58 are the initial wanted list.
- `CONTRIBUTING.md` and [fork and extend](fork-and-extend.md) gain one section pointing at the guide.

## Agents build most of it

The crew scaffolds each wanted adapter from the issuer's public documentation to `scaffold (synthetic fixtures)`: manifest, adapter, synthetic fixtures, README with exact env variables and webhook URL, and a list of assumptions to confirm. The issuer's job is credentials, recorded fixtures, fixing what the real API disagrees with, the live proof, and the enablement check.

## Delivery plan

Phase 0 — contract spike (crew, Sol; Astra review). `shared/funding/assets.ts`, `provider-contract.ts`, suites 1–2 under `core/testing/`, and compile-time adapters for all three routes: `coinbase-onramp` (hosted-session, wired into the existing `/api/funding/onramp-session` handler immediately so there is one Coinbase implementation), `ripio` (order provider ported from `ripio-client.ts`, quotes, webhook verification, refund mapping), and `idrx` (order provider ported from #120's `idrx.ts`, provider-assigned reference, polling). No new routes, store, or UI. Acceptance: all three pass suites 1–2; `bun check` green; the contract has been shaped by client-supplied and provider-assigned references, quotes and no quotes, webhooks and polling, hosted redirect and native instructions. The template is not published until this lands.

Phase 1 — native core driven by IDRX (crew, Sol; Astra review, money path). `core/` orders, quotes, reconcile, evidence claims, store, migrations, routes, order-flow UI, eligibility modes. IDRX is the first fully wired order provider because `operator-account` needs no per-user identity data. Ripio runs through the same core up to the requirements step and stays unavailable to users pending the KYC decision. Acceptance: suites 3–6 pass; IDRX end-to-end against fixtures in Playwright with a mocked provider; Ripio conformance parity with the tests in `ripio-*.test.ts`. No deletion of bespoke Ripio files in this PR.

Phase 1b — Ripio cutover (crew, bounded cleanup). Delete `ripio-store.ts`, `ripio-reconciliation.ts`, `ripio-webhook-handler.ts`, `ripio-inbox-recovery.ts`, `migrations/001_ripio_funding.sql`, the synthetic preview UI, and `ripio-contract.ts` contents now covered by the core. Before dropping, check whether any deployment ran the Ripio migration; deleting a migration file does not remove database objects, so an explicit drop migration is added if tables exist.

Phase 2 — contribution surface (crew, Hope/DX lane). Guide, `_template/`, `funding:new-provider`, `funding:sync-providers`, `funding:status`, `funding:verify-proof`, `funding:enablement-check`, issue template, CONTRIBUTING and fork-and-extend sections. #120 closed in favor of the Phase 1 IDRX adapter.

Phase 3 — issuers finish (crew scaffolds, issuers complete). `juno` (MXNB, SPEI), `straitsx` (XSGD, FAST/PayNow), `bilira` (TRYB, FAST/EFT) scaffolded from public docs; IDRX recorded fixtures and live proof from the issuer. Each ships as its own PR against its existing issue.

Sequencing follows the [delivery loop](operating-manual.md#delivery-loop): one issue, one writer, one PR per phase item.

## Risks and open questions

- Ripio real-order availability depends on a KYC path Home does not yet have. The contract supports it; the product decision is deferred, and the doc says so rather than claiming a wired Ripio flow.
- `operator-account` shifts regulatory exposure to the operator. The eligibility default (allowlisted subjects) keeps that opt-in and explicit; widening it is a recorded rollout decision.
- Four instruction kinds may not survive Pix (dynamic QR plus copy code) or SPEI (CLABE plus reference plus bank). They are additive and crew-owned; the question is whether these are the right first four.
- `dispatch-ambiguous` rows for `retrySafety: "none"` providers are permanent by design. Operators need the stuck-order query from the enable gate and a support path with the issuer.
- Persisting provider receiving details is a data-policy change relative to the Ripio migration's "no bank details" comment. The classification above is the mitigation; encryption at rest depends on the deployment supplying a key.
- Trusted in-process adapters mean the review is the boundary. Lint and the injected context reduce the surface; they do not replace review.
- Forks may enable bindings upstream has not proven. `rollout` and the status table make the distinction visible; nothing prevents it.

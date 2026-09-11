# Funding provider seam

Status: design proposal, September 11, 2026, v2 after Jesse's review. Not implemented. Tracking: [#282](https://github.com/jessepollak/home/issues/282).

Related: [regional money](regional-money.md), [currency defaults](currency-defaults.md), [fork and extend](fork-and-extend.md), [contribution contract](architecture-review-2026-09.md#d-contribution-contract-for-new-engineers).

## Intent

Someone at a stablecoin issuer or local rail should be able to clone Home, run it, sign in with their Base Account, drop in their provider credentials, and walk through the Add money flow for their country end to end. That is the whole test. The crew builds most of each adapter; the issuer confirms it against their real API and fixes what disagrees.

Everything in this document serves that. Anything that does not is deliberately left out of v1 (see the last section).

## Where we are

| Route | State | Problem |
|---|---|---|
| Coinbase Onramp (US, USDC) | Live hosted redirect | Wrong shape; the headless API ([#52](https://github.com/jessepollak/home/issues/52)) is the one to build on. Left alone until then. |
| Ripio Ramps (AR wARS, CO wCOP) | Merged ([#253](https://github.com/jessepollak/home/pull/253)), unwired, UI is a synthetic preview | Bespoke store, reconciliation, webhook handler, UI step. |
| IDRX (ID) | Draft [#120](https://github.com/jessepollak/home/pull/120), blocked on a funded proof | +4,120 lines, bespoke attempt store, handler, UI step. |
| MXNB, XSGD, TRYB | Blocked ([#56](https://github.com/jessepollak/home/issues/56)–[#58](https://github.com/jessepollak/home/issues/58)) | Nobody on the crew can complete a payment in those countries. |

Each route rebuilt the same things. The seam builds them once.

## The three things that have to be true

1. **Runs locally without a CDP project.** Today even the "Base Account" button authenticates through CDP SIWE, so it needs `NEXT_PUBLIC_CDP_PROJECT_ID`, API keys, and origin allowlisting. Home gets a native Base Account sign-in: Home issues the SIWE nonce, verifies the signature against Base (ERC-1271/6492 via `viem`), and sets its own signed session cookie. The session has the same shape the funding handler already accepts (`accountProvider: "base-account"`, `smartAccount: { address, chainId: 8453 }`). Email/CDP sign-in stays for deployments that have it. Postgres stays the only store (per [#245](https://github.com/jessepollak/home/pull/245)); the repo gains a `docker-compose.yml` with one Postgres service and `bun run db:up`, so the local prerequisite is Docker, not Neon.
2. **One directory per provider, one line to register it.** `apps/web/server/funding/providers/<id>/{manifest.ts, adapter.ts, README.md}` plus a line in `providers/index.ts`. No template generator; copy `providers/idrx/` (simplest) or `providers/ripio/` (KYC, quotes, webhooks). Shared code changes only when a country, token, instruction kind, or KYC field type is new — the crew does that.
3. **The core owns the parts that can lose money.** Destination, token identity, one dispatch per order, and what counts as "received". Adapters talk to the provider; they never decide those.

## Contract

```ts
export type FundingProviderManifest = {
  id: string;                         // "idrx", "ripio"
  displayName: string;
  docsUrl: string;
  bindings: ReadonlyArray<{
    region: CountryCode;
    assetId: string;                  // from shared/funding/assets.ts
    paymentMethods: ReadonlyArray<{ id: string; label: string }>;
    env: ReadonlyArray<string>;       // credentials required; provider is inert until all are set
  }>;
  apiOrigins: ReadonlyArray<string>;  // ctx.fetch refuses other hosts
  redirectOrigins?: ReadonlyArray<string>;
  reference: "home" | "provider";     // who assigns the order reference (Ripio: home; IDRX: provider)
  quotes?: boolean;
  kyc?: {
    terms?: { url: string };
    fields?: ReadonlyArray<{ name: string; label: string; type: "text" | "email" | "date" | "select"; options?: string[] }>;
  };
  webhook?: { signatureHeader: string; env: string };
};

export type FundingProvider = {
  manifest: FundingProviderManifest;
  ensureCustomer?(input: { subject: string; fields: Record<string, string> }, ctx: ProviderContext): Promise<{ customerRef: string }>;
  createQuote?(input: QuoteIntent, ctx: ProviderContext): Promise<Quote>;
  createOrder(input: OrderIntent, ctx: ProviderContext): Promise<CreateOrderResult>;
  getOrder(providerOrderId: string, ctx: ProviderContext): Promise<Observation>;
  verifyWebhook?(raw: Uint8Array, headers: Headers, ctx: ProviderContext): { providerOrderId: string } | null;
};

export type ProviderContext = {
  binding: { region: CountryCode; asset: FundingAsset; paymentMethod: { id: string; label: string } };
  env: Readonly<Record<string, string>>;   // only the manifest's declared variables
  fetch: typeof fetch;                     // origin allowlist, redirect: "manual", timeout
};

export type QuoteIntent = { destination: `0x${string}`; fiatAmount: string };
export type Quote = { providerQuoteId?: string; fiatAmount: string; tokenAmountAtomic: string; fees: Array<{ label: string; amount: string; currency: string }>; expiresAt: string };

export type OrderIntent = {
  homeOrderId: string;                     // sent as the provider's external reference when reference === "home"
  destination: `0x${string}`;              // injected by the core from the verified session
  fiatAmount: string;
  quote?: Quote;                           // the core-verified quote, never a client-supplied ID
  customerRef?: string;
  returnUrl: string;
};

export type CreateOrderResult =
  | { outcome: "created"; order: ProviderOrder }
  | { outcome: "rejected"; message: string }
  | { outcome: "ambiguous" };              // request may have reached the provider; the core never retries

export type ProviderOrder = {
  providerOrderId: string;
  tokenAddress: `0x${string}`;             // echoed; must equal the binding's asset or the order is refused
  expectedTokenAmountAtomic: string;
  fees: Array<{ label: string; amount: string; currency: string }>;
  expiresAt: string | null;
  instructions: Instruction;
};

export type Instruction =
  | { kind: "redirect"; url: string }
  | { kind: "bank-transfer"; rail: string; accountNumber: string; accountName?: string; bank?: string; alias?: string; reference?: string; amount: string; currency: string }
  | { kind: "qr"; scheme: "pix" | "qris" | "promptpay" | "other"; payload: string; amount: string; currency: string }
  | { kind: "payment-key"; scheme: string; key: string; amount: string; currency: string };

// What an adapter may report. It cannot say "received".
export type ReportedState =
  | "awaiting-payment" | "payment-received" | "settling" | "sent"
  | "expired" | "cancelled" | "failed" | "refunded" | "unknown";

export type Observation = { state: ReportedState; providerStatus: string; transactionHash?: `0x${string}` | null };

// Core-owned. Only the core sets the last three.
export type OrderState = ReportedState | "reserving" | "dispatch-ambiguous" | "sent-unverified" | "received";
```

How the ports fit: Ripio is `reference: "home"`, `quotes: true`, `kyc: { terms, fields }`, webhook, `bank-transfer`/`payment-key`/`redirect` instructions, per-country env. IDRX is `reference: "provider"`, no quotes, no per-user KYC (the operator's issuer account), polling only, `bank-transfer` (VA) or `redirect` (QRIS), 2-decimal asset.

`shared/funding/assets.ts` is the crew-owned token registry (`base:usdc`, `base:wars`, `base:wcop`, `base:idrx` to start): chain ID, address, decimals, symbol, issuer doc URL. `docs/stablecoin-candidates.json` stays a research file; it is not read at runtime.

## Core

**Enabled means configured.** A binding appears in `GET /api/funding/providers?region=` when every variable in its `env` is set. Nothing else gates it. Hosted Home enables a provider by setting its env; a fork does the same.

**KYC.** If the manifest has `kyc`, the flow shows the terms link and a form generated from `fields`, posts them once to `ensureCustomer`, and stores only the returned `customerRef` against the subject. Field values are not persisted. This is enough for Ripio's customer + terms + KYC submission; if a provider needs a document upload later, that is a new field type added by the crew.

**Quotes.** `POST /api/funding/quotes` calls `createQuote` and returns the quote plus a `quoteToken`: an HMAC (server secret) over `{ subject, region, providerId, paymentMethod, destination, fiatAmount, tokenAmountAtomic, providerQuoteId, expiresAt }`. `POST /api/funding/orders` accepts only the token, recomputes the HMAC, and rejects any mismatch or expiry. No quote table.

**Orders.** `POST /api/funding/orders` `{ providerId, region, paymentMethod, fiatAmount, quoteToken? }`. The core: authorizes the session and requires a chain-8453 address → inserts a `funding_orders` row (`state: "reserving"`, owner, binding, amount, intent digest, current Base block) → calls `createOrder` once → on `created`, refuses the order if `tokenAddress` differs from the registry asset, otherwise stores provider order ID, expected amount, fees, expiry, instructions → on `ambiguous`, marks the row `dispatch-ambiguous` and never retries; the UI says to check Activity before trying again. A page refresh finds the open row and shows it; it never dispatches twice.

**Status.** `GET /api/funding/orders/[id]` calls `getOrder` when the row is non-terminal and older than a few seconds, applies the reported state, and maps `sent` to `sent-unverified`. A webhook (`POST /api/funding/webhooks/[provider]`) is verified by the adapter, matched to a row by provider order ID, and triggers the same refresh; unmatched or invalid events get `202` and a log line. Webhook bodies never set state.

**Received.** When an observation carries a transaction hash, the core reads the receipt on Base and looks for a `Transfer` of exactly `expectedTokenAmountAtomic` of the binding's asset to the row's destination in a block at or after the row's creation block. On a match it records `(transaction_hash, log_index)` on the row under a unique index and sets `received`. No hash, no match, or a hash already claimed by another row leaves `sent-unverified`.

**Storage.** One table, `funding_orders`, Postgres, with the instruction JSON inline and owner-scoped reads. Instructions are the provider's receiving details; they are deleted from the row when the order reaches a terminal state. Responses are `private, no-store`.

**Adapters are trusted code.** They run in-process and are reviewed like any server change. `ctx.fetch` and `ctx.env` keep them honest, not sandboxed; adapters use raw HTTP through `ctx.fetch`, not provider SDKs.

## UI

Add money → method list: `Receive crypto`, one `Deposit {currency}` row per configured binding for the region (all of them when a country has more than one; ordering is a later question), `Use another onramp`. Choosing a binding: KYC form if the manifest has one and no `customerRef` exists → amount (with quote when supported) → instructions (four renderers, tap-to-copy on account numbers and QR payloads) → pending → done, or the failed / ambiguous / sent-unverified screens in plain words. Opening Add money with an open order for that region resumes it.

## How an issuer tests it

1. `git clone`, `bun install`, `bun run db:up`, `bun dev`.
2. Open Home, pick your country, sign in with Base Account.
3. Copy `providers/idrx/` or `providers/ripio/` to `providers/<you>/`; fill in manifest and adapter; add the line to `providers/index.ts`.
4. Put your credentials in `apps/web/.env.local`.
5. Add money → Deposit → pay yourself a small amount → watch it reach `received`.
6. `bun test apps/web/server/funding` runs the adapter conformance test against your manifest and fixtures if you added any.
7. Open a PR with a short clip of step 5 and a line in your README saying when and against which environment you ran it.

That clip and line are the proof. The crew reviews the diff; Jesse merges; hosted Home enables it by setting env when he chooses.

`docs/integrations/README.md` is those seven steps with the exact paths, plus what the core enforces so the adapter does not have to.

## Delivery

Order matters only where noted; everything else can run in parallel under the [delivery loop](operating-manual.md#delivery-loop).

1. **Contract + IDRX** — `assets.ts`, `provider-contract.ts`, `core/provider-context.ts`, `core/testing/describeFundingAdapter.ts`, `providers/idrx/` ported from #120. IDRX first because it is the simplest full shape. Astra review.
2. **Ripio adapter** — port of `ripio-client.ts`: home reference, quotes, KYC fields and terms, webhook. Amends the contract where porting demands; doc updated in the same PR. Depends on 1. Astra review.
3. **Native Base Account sign-in** — nonce, verify (viem, ERC-1271/6492), signed session cookie, `accountProvider: "base-account"`. Works without any CDP variable. Astra review. Independent of 1–2.
4. **Local Postgres** — `docker-compose.yml`, `bun run db:up`, README/env notes. Independent.
5. **Core + routes** — `funding_orders` store and migration, quotes, orders, status, webhooks, received. Depends on 1. Astra review.
6. **UI** — method list and order flow. Depends on 5 for the API; can start against the types.
7. **Guide** — `docs/integrations/README.md`, `.env.example`, CONTRIBUTING pointer. Depends on 3–6 being real.
8. **Ripio cleanup** — delete the bespoke store/reconciliation/webhook/inbox/preview UI once 2 and 5 pass Ripio's existing test expectations. Check whether any deployment ran `001_ripio_funding.sql` before dropping.
9. **Coinbase headless** — re-scope #52 as a provider on the seam. After 5.
10. **Issuer scaffolds** — crew agents write `juno`, `straitsx`, `bilira` adapters from public docs to the point where only credentials are missing; #54/#56/#57/#58 hand off to the issuers with the guide. After 7. IDRX: #120 closes in favor of 1; the issuer runs the seven steps.

## Deliberately not in v1

Cut after review to keep the first version small. Each is a follow-up if a real need appears.

- Live-proof JSON, `verify-proof`, `enablement-check`, separate merge/enable gates — a local run and a clip is the proof.
- Template generator, `sync-providers`, status generator — copy a reference adapter; one line in `index.ts`.
- Rollout registry and eligibility allowlists — configured means enabled. An allowlist is a one-variable follow-up if hosted Home needs it.
- Webhook inbox and cross-binding recovery — unmatched webhooks are logged; status polling covers the gap.
- Separate quote and instruction tables, encryption at rest — one table; instructions deleted at terminal state.
- Retry-safety modes for ambiguous creates — never retry; the user checks Activity.
- Lint rule for `providers/**` — convention plus review.
- Choosing between multiple ramps in one country — all configured bindings are listed; ordering and selection UX is P2.
- Hosted-session provider kind — Coinbase moves to the headless API instead.

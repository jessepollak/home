# IDRX issuer 1:1 onramp (Indonesia) — research note

Status: **research only**. No Fund UI, no product funding route, and no Home API adapter in this note.
Checked: 2026-09-08
Related: issue [#54](https://github.com/jessepollak/home/issues/54), parent tracker [#15](https://github.com/jessepollak/home/issues/15), [currency defaults](currency-defaults.md), [stablecoin candidates](stablecoin-candidates.json).
Prior issue comment (used and re-checked, not copied blindly): [#54 comment](https://github.com/jessepollak/home/issues/54#issuecomment-5593000709).

This note records issuer-published facts for a later Hank API spike. It does **not** close #54: sandbox credentials and a fiat-rail → Base-token smoke are still missing.

## 1. Base contract + decimals — confirmed

| Field | Home `docs/stablecoin-candidates.json` | Issuer docs (fetched 2026-09-08) |
|---|---|---|
| Chain | Base `8453` | Base |
| Address | `0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22` | `0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22` |
| Decimals | **2** | **2** on Base (also Lisk / Etherlink / Kaia / World Chain / Gnosis / Solana). Polygon and BNB Chain are **0**. |

Same 20-byte address; case differs only by EIP-55 checksum. Runtime config already stores the lowercase form (`apps/web/config/portfolio-assets.ts`). Do **not** infer token decimals from IDR fiat fraction digits.

Issuer source: [Supported Chain and Contract Address](https://docs.idrx.co/introduction/supported-chain-and-contract-address) (fetched 2026-09-08). A mint whose `toBeMinted` is finer than the target chain allows is rejected with `400`.

`selectedProduct: true` and `enabled: false` stay as-is until a funding-route smoke passes.

## 2. Buy API / hosted checkout

### Access and base URL

API access is limited to a verified **business** account (or a request to `support@idrx.co`). After approval, dashboard → API Key → Generate API Key. The secret is shown once.

Preferred host for new integrations (Getting Started, fetched 2026-09-08):

```
https://api.idrx.co
```

The older form `https://idrx.co/api/...` still works. New work should use `api.idrx.co`.

Every request needs HMAC headers plus a **custom** `User-Agent` (defaults from `curl` / `Python-urllib` / generic SDKs are blocked with HTTP `403` / Cloudflare 1010):

| Header | Value |
|---|---|
| `idrx-api-key` | Merchant or onboarded-user API key |
| `idrx-api-sig` | HMAC-SHA256 signature |
| `idrx-api-ts` | Unix timestamp in milliseconds |
| `User-Agent` | Custom string such as `home/1.0` |

Sources: [Getting Started](https://docs.idrx.co/api/getting-started), [POST mint-request](https://docs.idrx.co/api/transaction-api/post-api-transaction-mint-request), [Generating a Signature](https://docs.idrx.co/api/generating-a-signature) (all fetched 2026-09-08).

**Signature formula gap:** the mint-request page publishes `HMAC-SHA256(secret, METHOD + ":" + PATH + ":" + SHA256(body) + ":" + timestamp)`. The dedicated signature page publishes a different construction (`timestamp` + `method` + `url` + JSON body, secret base64-decoded, digest `base64url`). Do not pick one from docs alone — confirm against a live signed request once credentials exist.

### KYC / onboarding

Two layers, both required before mint:

1. **Home / merchant org** — business-account KYB (Indonesian company docs, or non-ID company registration + director passport). Terms: [Business Account](https://docs.idrx.co/idrx-account/business-account) (fetched 2026-09-08). Retail self-serve KYC in the IDRX app is KTP + selfie + liveness ([Account Verification](https://docs.idrx.co/idrx-account/account-verification-kyc)).
2. **End-user under the org** — `POST /auth/onboarding` (`multipart/form-data`): `email`, `fullname`, `address`, `idNumber`, `idFile` (jpeg/png/jpg/webp, 256–4096 px). Success `201` returns that user's `apiKey` / `apiSecret`. Org-onboarded users skip *some* KYC steps, but **onboarding ≠ verified**. Mint / redeem / bridge / add-bank reject with `401 User is not verified` until the account reaches a verified state. Transaction History and Get Methods stay readable.

Sources: [POST /auth/onboarding](https://docs.idrx.co/api/onboarding-api/post-api-auth-onboarding), [Onboarding a new user](https://docs.idrx.co/integration/onboarding-a-new-user) (fetched 2026-09-08).

### Mint endpoint

`POST https://api.idrx.co/transaction/mint-request`

Required body fields in current docs: `toBeMinted`, `destinationWalletAddress`, `networkChainId`. For Home: `networkChainId` **`"8453"`**, `requestType` `"idrx"` (default).

| Limit | Value |
|---|---|
| Min mint | Rp 20,000 IDR (or $2 when minting other stables) |
| Max mint | 1,000,000,000 IDR (or $5,555 other stables) |
| Amount precision on Base | at most **2** decimals; not silently rounded |
| Unpaid cancel | 24 hours (or `expiryPeriod` minutes; default `120`) |
| Credit SLA | destination wallet, max 24 hours (often minutes) |

The [#54 research comment](https://github.com/jessepollak/home/issues/54#issuecomment-5593000709) listed `paymentProvider: "snap"` as required. **Current mint-request docs do not list that field.** Responses still prefix `reference` with `SNAP-`. Treat `paymentProvider` as unverified until a live call or a restored field table says otherwise.

### Flow A — hosted checkout (VA + QRIS on the page)

Omit `paymentMethod`. Require HTTPS `returnUrl`. Response includes `checkoutUrl` / `paymentUrl` (same value) on `checkout.idrx.co`. User picks the rail on IDRX's page.

**QRIS:** still offered on hosted checkout and is **not** being withdrawn. QRIS *API* docs are hidden for maintenance; contact `support@idrx.co` for details. Do not implement a direct QRIS `paymentMethod` from public docs today.

Do not treat `returnUrl` as payment confirmation.

### Flow B — direct VA (better later Fund inline fit)

Send `paymentMethod: "va"` and `channelId`: `"MANDIRI"` or `"BRI"` only. Response includes `virtualAccountNo`, `virtualAccountName`, `amount` (customer must pay this exact figure), `baseAmount`, `fees[]`, `expiredDate`. `returnUrl` is unused. Re-fetch a lost VA with `GET /duitku-snap/checkout/payment-payload?merchantOrderId=...` — same VA is returned, not a new one.

VA sender name must match the registered customer name or the payment is refunded (≤ 14 business days). Wrong VA number is the payer's risk. Under/over-pay holds the mint for manual review.

### Status, callback, cancel

Track **both** `paymentStatus` and `userMintStatus`:

| Stage | `paymentStatus` | `userMintStatus` | Terminal |
|---|---|---|---|
| Awaiting payment | `WAITING_FOR_PAYMENT` | `NOT_AVAILABLE` | No |
| Paid, minting | `PAID` | `PROCESSING` | No |
| Success | `PAID` | `MINTED` | Yes |
| Payment expired | `EXPIRED` | `NOT_AVAILABLE` | Yes |
| Refunded | `PAID` | `REFUND` | Yes |
| Rejected | `PAID` | `REJECTED` | Yes |

Poll `GET /transaction/user-transaction-history?transactionType=MINT&merchantOrderId=...&page=1&take=1`. Suggested cadence: 5s for 5 minutes, then 30s, stop on terminal. `userMintStatus` never becomes `FAILED`; keep polling `PAID` + `PROCESSING`.

Webhook: set Mint/Redeem callback URLs in the API Key dashboard. **One shot, no retry, no signature.** Treat the body as untrusted; re-fetch Transaction History before crediting. If the endpoint is down, poll.

Sources: [Processing Mint IDRX Requests](https://docs.idrx.co/integration/processing-mint-idrx-requests), [Callback](https://docs.idrx.co/api/callback), [Transaction History](https://docs.idrx.co/api/transaction-api/get-api-transaction-user-transaction-history) (fetched 2026-09-08).

### Fees (confirm live before shipping)

Published mint fees, fetched 2026-09-08:

| Channel | Published fee | How charged | Source |
|---|---|---|---|
| BNI VA (`IQ`) / BRI VA (`BR`) | 3,000 IDR | Added on top of `toBeMinted` | [Callback](https://docs.idrx.co/api/callback) |
| Mandiri VA (Flow B example) | 4,000 IDR in the sample payload | Added on top (`amount` = `baseAmount` + fees) | [mint-request](https://docs.idrx.co/api/transaction-api/post-api-transaction-mint-request) |
| Virtual Account (retail table) | Rp 3,000–4,000 | Added on top | [Fees](https://docs.idrx.co/services/fees) |
| OVO (`OV`) / DANA (`DA`) | 1.67% | Added on top | Callback + Fees |
| QRIS | **Not in the current public tables** | Hosted checkout still offers it | Callback / mint-request “temporarily undocumented” |

The #54 comment’s “QRIS ~0.7% deducted from minted amount” is **not** on the callback or fees pages as fetched 2026-09-08 (QRIS rows are hidden). Do not ship a 0.7% assumption. Ask `support@idrx.co` or re-read those pages after the QRIS docs return.

`GET /transaction/get-additional-fees` exists but the public examples are redeem-oriented; do not treat its sample `3000` as the mint VA fee without a live `feeType=MINT` call.

## 3. Sandbox / credentials

What is public (2026-09-08):

- Production host `https://api.idrx.co` (legacy `https://idrx.co/api/...` still accepted).
- Signature + onboarding + mint/history/callback docs.
- `llms.txt` index has **no** sandbox or staging base URL.

What is not public:

- No documented sandbox host, test keys, or self-serve sandbox signup.
- No Home-held merchant key or per-user IDRX secrets.

Pattern for a later spike (do not add env vars in this PR):

- Server-only merchant `IDRX_API_KEY` / `IDRX_API_SECRET` (same class as `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` — never `NEXT_PUBLIC_`).
- Per-user keys from onboarding stay server-side and scoped to that customer.
- Keep `enabled: false` on the IDRX candidate until a sandbox or production smoke credits IDRX to the session smart account.

Ask IDRX (`support@idrx.co`) for a merchant account and, if they have one, a sandbox.

## 4. Thin integration sketch (API notes only)

Out of scope until [#60](https://github.com/jessepollak/home/issues/60) Coinbase headless Fund is smokeable: Fund CTA, hosted-checkout webview, VA copy UI, Activity/Balances product work.

When Hank picks this up:

1. Country gate `ID` only. Destination is the session smart account (`destinationWalletAddress`), `networkChainId=8453`, `requestType=idrx`.
2. Server: business HMAC credentials → onboard + wait for verified → `mint-request`. Prefer Flow B (`va` + `MANDIRI`/`BRI`) for an eventual inline Fund; Flow A hosted checkout is the faster first smoke (QRIS available there).
3. Persist `merchantOrderId`. Confirm via callback *and* history poll. Success is `PAID` + `MINTED` plus `txHash` on Base. Show exact `amount` for VA; do not round.
4. Cancel / expire / refund / reject / name-mismatch: surface `paymentStatus` / `userMintStatus` and do not leave a stranded pending Fund. Late pay after expiry is not credited — new mint request.
5. Balances already know the IDRX contract when country is Indonesia; do not enable the candidate or invent a second asset row here. Coord [#35](https://github.com/jessepollak/home/issues/35) if the asset row is still country-gated after a real mint.

No multi-country work. #55–#58 stay separate.

## Remaining gaps (do not close #54)

- [ ] Merchant / sandbox credentials from IDRX (`support@idrx.co`). No public sandbox URL found.
- [ ] Live signature formula (two published constructions).
- [ ] Whether `paymentProvider: "snap"` is still required (absent from current mint-request field table).
- [ ] Restored QRIS API docs / confirmed QRIS fee (0.7% from the #54 comment is unverified against today’s public pages).
- [ ] Live VA fee table (3,000 vs 4,000 IDR by bank).
- [ ] Onboarded-user path to `verified` without the retail IDRX app (docs say 401 until verified; the remaining KYC step is not fully specified for API users).
- [ ] Sandbox or production smoke: IDR rail → IDRX at the session smart account on Base 8453.
- [ ] Error/cancel paths in a real Fund session (blocked on #60 + this smoke).

## Primary sources (fetched 2026-09-08)

- https://docs.idrx.co/introduction/supported-chain-and-contract-address
- https://docs.idrx.co/api/getting-started
- https://docs.idrx.co/api/generating-a-signature
- https://docs.idrx.co/api/onboarding-api/post-api-auth-onboarding
- https://docs.idrx.co/integration/onboarding-a-new-user
- https://docs.idrx.co/idrx-account/account-verification-kyc
- https://docs.idrx.co/idrx-account/business-account
- https://docs.idrx.co/api/transaction-api/post-api-transaction-mint-request
- https://docs.idrx.co/integration/processing-mint-idrx-requests
- https://docs.idrx.co/api/callback
- https://docs.idrx.co/api/transaction-api/get-api-transaction-user-transaction-history
- https://docs.idrx.co/services/fees
- https://docs.idrx.co/api/transaction-api/get-api-transaction-get-additional-fees
- https://docs.idrx.co/llms.txt

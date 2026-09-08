# IDRX issuer 1:1 onramp (Indonesia) — research note

Status: **docs / research only.** No Fund UI, no mint client, no webhook handler, no funding route.
Checked: 2026-09-08
Related: [#54](https://github.com/jessepollak/home/issues/54) (leave open — implement phase later), [#15](https://github.com/jessepollak/home/issues/15), [currency defaults](currency-defaults.md), [candidates](stablecoin-candidates.json).
Incorporates and re-checks: [#54 research comment](https://github.com/jessepollak/home/issues/54#issuecomment-5593000709).

`enabled: false` stays until #60 Coinbase headless Fund is smokeable **and** IDRX sandbox/merchant keys exist.

## Contract and decimals — confirmed

| Field | Home candidates JSON | Issuer docs (fetched 2026-09-08) |
|---|---|---|
| Chain | Base `8453` | Base |
| Address | `0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22` | `0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22` |
| Decimals | **2** | **2** on Base (Polygon / BNB are 0) |

Same address; checksum vs lowercase only. Do **not** infer decimals from IDR fiat digits. Source: [Supported Chain and Contract Address](https://docs.idrx.co/introduction/supported-chain-and-contract-address).

## Mint API shape

Preferred host: `https://api.idrx.co` (legacy `https://idrx.co/api/...` still works). HMAC headers `idrx-api-key`, `idrx-api-sig`, `idrx-api-ts`, plus a custom `User-Agent`.

`POST /transaction/mint-request` — required in current docs: `toBeMinted`, `destinationWalletAddress`, `networkChainId` (`"8453"` for Base). Min ~20,000 IDR; max ~1e9 IDR; Base amounts ≤2 decimals.

The #54 comment listed `paymentProvider: "snap"` as required. **Current field table does not include it** (`reference` still prefixes `SNAP-`). Confirm on a live call; do not code it in this PR.

**Flow B (preferred later Fund fit) — direct VA:** `paymentMethod: "va"` + `channelId` `"MANDIRI"` or `"BRI"` → `virtualAccountNo` / `amount` in the response. No redirect.

**Flow A (fallback) — hosted checkout:** omit `paymentMethod`, send `returnUrl` → `paymentUrl` / `checkoutUrl`. QRIS is on that page; QRIS *API* docs are hidden (contact `support@idrx.co`). Do not treat `returnUrl` as payment confirmation.

Status: poll `GET /transaction/user-transaction-history` and/or webhook. Success is `paymentStatus: PAID` + `userMintStatus: MINTED`. Callbacks are one-shot and unsigned.

Sources: [mint-request](https://docs.idrx.co/api/transaction-api/post-api-transaction-mint-request), [processing mint](https://docs.idrx.co/integration/processing-mint-idrx-requests), [callback](https://docs.idrx.co/api/callback), [getting started](https://docs.idrx.co/api/getting-started).

Onboarding (for a later implementer, not this PR): `POST /auth/onboarding` then wait for verified — onboarded ≠ transactable (`401 User is not verified`).

## Fees, VA name-match, sandbox gap

**Fees** (confirm live before any ship):

| Channel | Published | How |
|---|---|---|
| BRI / BNI VA | 3,000 IDR | Added on top |
| Mandiri VA (Flow B sample) | 4,000 IDR | Added on top |
| Retail VA table | Rp 3,000–4,000 | Added on top |
| OVO / DANA | 1.67% | Added on top |
| QRIS | Not in current public tables | Still on hosted checkout; docs hidden |

The #54 comment’s “QRIS ~0.7% deducted” is **not** on the callback or [fees](https://docs.idrx.co/services/fees) pages as fetched 2026-09-08. Do not assume 0.7%.

**VA name-match:** sender name must match the registered customer name or the payment is refunded (≤ 14 business days). Exact `amount` required; under/over-pay holds the mint.

**Sandbox:** no public sandbox/staging URL in [llms.txt](https://docs.idrx.co/llms.txt) or Getting Started. Need a merchant account / keys from `support@idrx.co`. Future keys are server-only (never `NEXT_PUBLIC_`). Do not add env vars or clients in this PR.

## Out of scope (this PR and until gates clear)

Do **not** implement until **#60 is smokeable** and **IDRX sandbox/merchant keys** exist:

- Fund UI / Indonesia Fund CTA / hosted-checkout webview
- Live mint client, HMAC signer, webhook handler, funding route
- Enabling the candidate (`enabled` stays `false`)
- #55–#58 or any other country

#54 stays open for that implement phase.

## Remaining gaps

- [ ] IDRX merchant / sandbox credentials
- [ ] Live signature formula (two published constructions)
- [ ] `paymentProvider: "snap"` still required?
- [ ] QRIS API docs + confirmed QRIS fee
- [ ] Live VA fee by bank (3,000 vs 4,000)
- [ ] Fiat rail → Base IDRX smoke at the session smart account

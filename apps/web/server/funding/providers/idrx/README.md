# IDRX funding adapter

This adapter implements the IDRX issuer API as an `order` provider on Base. It is wired through the provider registry, private funding routes, durable order store, and Add money flow; it remains inert until every manifest environment variable is configured.

- Region / asset: Indonesia (`ID`) / `base:idrx` (2 decimals). Live payment method: **QRIS** only. Mandiri/BRI virtual accounts are closed VAs — the bank accepts the transfer only from an account registered on the IDRX account that created the order (Mandiri/BRI by account number, INA/Nobu by KYC name). With one operator API key every Home user would pay as the operator and be rejected, so the VA methods stay only in the adapter test fixture until Home users get their own IDRX identity through per-user KYC on the seam. The VA code paths and tests stay for that step.
- Operator account: no per-user KYC. The declared server-only environment is `IDRX_CLIENT_ID`, `IDRX_CLIENT_SECRET`, and `IDRX_CUSTOMER_NAME`. The pair is an IDRX **user** API key (`POST /auth/generate-api-key` on the IDRX account that receives the orders); `IDRX_CUSTOMER_NAME` must equal that account's registered name, which IDRX echoes as `customerVaName` / `virtualAccountName`.
- Quotes: `GET /v2/transaction/mint-quote` (amount, chain, payment method, channel) returns `baseAmount`, `toBeMinted`, `paymentAmount` and itemized `fees[]` with `appliedTo` (`toBeMinted` for the QRIS percentage, `paymentAmount` for flat channel fees). IDRX's generic QRIS checkout channel is `QR`. The adapter accepts the quote only when the base amount is the one requested and the fees close both gaps exactly; `tokenAmountAtomic` is `toBeMinted` and `feesKnown` is true. IDRX quotes have no provider expiry because the fee schedule belongs to the payment method and organization rather than the request, so Home applies the same five-minute local expiry used for local quotes. The endpoint is under IDRX's `/v2` namespace, opened per organization; a key outside it gets 404 and the quote fails closed.
- Hosted checkout on the quoted method: the QRIS order is created with `paymentMethod: "qris"`, `channelId: "QR"`, `flow: "hosted"`. IDRX still returns the checkout URL, but the page opens directly on the QRIS payment detail and never shows the method list, so the user cannot switch to a Virtual Account (different fees) after Home quoted QRIS.
- Local runs: open the app at `http://127.0.0.1:3000`, not `http://localhost:3000`. The return URL Home sends is built from the request origin, and IDRX's payment gateway rejects a return URL whose host has no dot (`Invalid Field Format, {AdditionalInfo.ReturnUrl}` on the checkout page); `127.0.0.1` passes.
- References: IDRX assigns `merchantOrderId` (`reference: "provider"`). The core must dispatch an order only once and retain ambiguous creates for Activity recovery.
- Dispatch classification: redirects, timeouts, conflicts, rate limits, undocumented validation failures, and server errors are ambiguous. Definitive rejections are documented authentication/edge rejection, exact documented validation messages, and any `400` whose body carries a machine-readable `data.code` (for example `BANK_ACCOUNT_REQUIRED`); IDRX creates no order in those cases. Rejection messages are fixed Home copy mapped from `data.code`; provider text is never shown to the user.
- Create validation: before either success branch, every available merchant/provider/order-ID or `reference` alias, transaction type, chain, token address/symbol/decimals, destination, decimal/atomic amount, fee amount/currency, payment method/rail/channel, checkout/payment/instruction URL, and transaction-hash alias must agree. VA additionally requires documented `baseAmount`, `amount`, and `fees` with exact atomic `amount = baseAmount + fees`; a present fee currency must be `IDR`. Hosted QRIS may omit that documented VA-only amount set. Every present URL alias must agree and use `https://checkout.idrx.co`; a URL is required for QRIS and optional for VA. Mandiri/BRI return `bank-transfer`; QRIS returns the validated redirect.
- Reconciliation: bounded transaction-history polling receives the immutable MINT/Base/token/destination/requested-amount intent. Every available provider/reference/order-ID, type, chain, token, destination, payment amount, fee amount/currency, payment method/rail/channel, URL, and hash alias is checked before mapping `ReportedState`; duplicate or contradictory records remain `unknown`. History `baseAmount` is checked against the requested amount. Settlement rules apply only to records whose `paymentStatus` is `PAID`: the final amount never exceeds `expectedTokenAmountAtomic`; a quoted order settles exactly at the quoted net so IDRX cannot deduct a second fee; and an unquoted order may settle lower only when itemized fees cover a shortfall of at most 5% of the request. Before payment, `toBeMinted` is bounded by the requested amount but does not change the quoted expected settlement. An accepted lower unquoted settlement is reported as `settledTokenAmountAtomic` with fees; the core accepts one such amount, freezes it, and verifies the Base transfer against it. Redirect orders show the final receive amount and fees on status because they skip the payment-details review. Only the core may verify a Base transfer and set `received`.

## Acceptance

Process, not authorization. Nothing here grants credentials, payments, deployments, or merge; the shared template in the [issuer integration guide](../../../../../../docs/integrations/README.md) and the [Ripio playbook](../ripio/ACCEPTANCE.md) describe the full loop. This section records what is specific to IDRX.

### Rail and environment matrix

| Rail (`paymentMethod`) | Asset | Home environment | Provider environment | Status |
| --- | --- | --- | --- | --- |
| `qris` | `base:idrx` | local | IDRX production | Local development completed 2026-09-14 on the #417 branch with the provider-hosted QRIS checkout; one order reached `received` |
| `qris` | `base:idrx` | hosted-final | IDRX production | Not run |
| `bank-va-mandiri`, `bank-va-bri` | `base:idrx` | any | IDRX production | Parked off the live binding: closed VAs accept transfers only from a bank account registered on the ordering IDRX account; with one operator key every Home user pays as the operator and is rejected |

The `ID` registry claim in [`apps/web/config/coverage.ts`](../../../../config/coverage.ts) is `in-build`. It moves to `live` only with dated hosted-final funded evidence.

### Sandbox and write hazard

- Home has no IDRX sandbox mode. The manifest pins `https://api.idrx.co` and `https://checkout.idrx.co` and declares no `modeEnv`. IDRX runs a separate development environment with a mock token; wiring it through the seam's sandbox mode is a possible later step.
- **Get quote** calls `GET /v2/transaction/mint-quote` against IDRX production. It is a read and creates no order. **Confirm** calls `POST /transaction/mint-request` and is the first and only provider write for an order.
- Reconciliation reads `GET /transaction/user-transaction-history`. Status progression is polling only; IDRX offers a partner callback but this adapter does not consume it.
- Paying QRIS instructions moves real IDR from the tester's own bank or e-wallet app. The provider minimum is Rp20,000 and the QRIS maximum is Rp10,000,000 per order. Credentialed production calls and funded payments require their respective operator approvals.

### Approvals and owners

| Role | Owns |
| --- | --- |
| Jesse | Every payment, every hosted funded order, schema sign-off, merge, and production Neon |
| IDRX lead | The operator account, API schema answers, lookups by `merchantOrderId` or destination and time window, and IDRX operations on stuck orders |
| IDRX tester | A dedicated test Base Account and each QRIS payment from their own app |
| Home operator | Local and hosted environments and guarded local SQL after IDRX confirmation |

Use one open order per test Base Account. All orders sit under one operator account on the IDRX side, so this limit is per Base Account, not per country.

### Stop and recovery

- On `dispatch-ambiguous`, stop and never retry. The IDRX lead looks up the order by `merchantOrderId` when Home stored one, otherwise by destination and creation time, then reports `WAITING_FOR_PAYMENT`, `EXPIRED`, or `PAID`. There is no partner cancel. An unpaid order expires after the 60-minute `expiryPeriod` Home sends. Locally, the operator may use the Ripio playbook's guarded one-row SQL with `provider_id = 'idrx'` and only `expired` or `failed` as the target; hosted recovery escalates to Jesse.
- Never terminalize an order that IDRX reports as paid. IDRX may still deliver the mint and it must be accounted for.
- IDRX production data from July through September 2026 shows `MINTED:PAID` p90 of 27 minutes below Rp50,000,000 and 59 minutes at or above that threshold, where manager multisig approval is required. More than 60 minutes is stuck: stop, hand the `merchantOrderId` to the IDRX lead, and do not create another order for that account. IDRX observed about one stuck order in 1,200; only IDRX operations can move it.
- The kill switch is removal of `IDRX_CLIENT_ID`, `IDRX_CLIENT_SECRET`, or `IDRX_CUSTOMER_NAME`. Drain open orders first; without all three the binding disappears and open orders stall at their last state.

### Evidence required per order

- Provider status timeline from `NOT_AVAILABLE:WAITING_FOR_PAYMENT` to `MINTED:PAID`, from polling only.
- Base transaction hash and `logIndex` for the `Transfer` to an approved throwaway session address.
- Token contract, destination, and on-chain amount equal to the order's stored `expectedTokenAmountAtomic`: the quoted net mint for a quoted order, or the accepted provider-settled amount for an unquoted order.
- Home order state `received`.
- No credentials, checkout URLs or QR payloads, customer names, or bank or e-wallet identifiers. Use role labels only.

### Issuer facts the acceptance run depends on

- Fees and limits are published at https://docs.idrx.co/services/fees. QRIS charges 0.7% of the request and deducts it from IDRX delivered; `mint-quote` exposes that net amount before confirmation. VA adds a flat fee to the IDR payment and delivers the quoted IDRX amount.
- The minimum is Rp20,000 for every method. Home sends a 60-minute `expiryPeriod`; the provider default is 120 minutes.
- The QRIS checkout uses `https://checkout.idrx.co` with a `token` query parameter.
- History amounts such as `toBeMinted` and `paymentAmount` are JSON numbers; create-response amounts are strings. The parser accepts either representation without using floating-point arithmetic.
- In the 2026-09-14 capture, pre-payment `toBeMinted` equalled the requested amount. Whether `flow: "hosted"` changes that pre-payment value is unconfirmed and worth one live capture.
- The complete mapped status-pair set is `NOT_AVAILABLE:WAITING_FOR_PAYMENT`, `NOT_AVAILABLE:EXPIRED`, `PROCESSING:PAID`, `MINTED:PAID`, `REJECTED:PAID`, and `REFUND:PAID`. Anything else stays `unknown`. A persistent `PROCESSING:PAID` requires the stuck-order recovery above.
- Redemption is not an offramp port. The holder burns IDRX on Base from their own wallet and submits the hash with a same-name bank account from a KYC-verified IDRX account; IDRX reviews and releases the payout through BI-FAST or RTGS. See https://docs.idrx.co/services/redeem-idr. Any separately authorized round-trip proof runs outside Home.
- Closed VAs and redemption are bound to the API-key holder's KYC identity. With one operator key every Home user is the operator. QRIS is the only honest live binding without the intentionally excluded per-user IDRX member/KYC model.

### Current claim

**September 18, 2026:** `in-build` for ID, matching [`apps/web/config/coverage.ts`](../../../../config/coverage.ts). Local development against IDRX production completed 2026-09-14 on the #417 branch with the provider-hosted QRIS checkout; one order reached `received`. No hosted-final funded order has run, and no hosted Home acceptance is claimed.

## Confirmed against the IDRX production API (2026-09-14)

Run by IDRX engineering with a real Base Account smart wallet and a real hosted-QRIS payment (`merchantOrderId 20260914021324`, 20000 IDR requested, 19860.00 IDRX minted in Base tx `0xd2d2a39dfd731d00b6e66cfc6c768feb46609299ea0aa2ec88391890589086fa`, log index 464; the local order reached `received`).

1. **Authentication.** Headers `idrx-api-key`, `idrx-api-ts` (millisecond timestamp), and `idrx-api-sig` are correct. The API key secret is a **hex** string, and IDRX production currently only checks that `idrx-api-sig` is present (a wrong signature still returns 200), so the base64 decoding in `createIdrxSignature` is unverified against enforcement. IDRX will confirm the canonical construction before enabling enforcement.
2. **Mint request.** `POST /transaction/mint-request` accepts the documented fields. Production accepts both `https://api.idrx.co/transaction/...` and `.../api/transaction/...`; the IDRX development environment requires the `/api` prefix. The QRIS request (common fields plus `returnUrl`) returns `{ id, merchantOrderId, reference, checkoutUrl, paymentUrl }` under `data` — no amount or fee fields.
3. **VA response and fees.** The documented VA shape (`virtualAccountName`, `virtualAccountNo`, `expiredDate`, `baseAmount`, `amount`, `fees[]`) matches IDRX's `createPayment`; create-response amount fields are strings, while history amounts are JSON numbers. `readDecimal` accepts both representations. A Mandiri/BRI VA requires a bank account for that bank registered on the IDRX account that orders; otherwise the create returns `400 { data: { code: "BANK_ACCOUNT_REQUIRED", requiredBankChannel } }` and no order exists — this is what the live VA attempt returned, and it is why VA is not on the live binding (see above).
4. **Hosted checkout.** Confirmed: `checkoutUrl` and `paymentUrl` agree, origin `https://checkout.idrx.co`, root path, `token` query parameter.
5. **History and statuses.** Confirmed query parameters and `{ records: [...] }`. Live records use `chainId` (number), `customerVaName`, `paymentAmount`, `toBeMinted`, `fee`, `fees[]`, `expiryTimestamp` (epoch milliseconds as a string), `qrisRedirectUrl`, `virtualAccountNo`, `txHash`, `userMintStatus`, `paymentStatus`. Amounts are JSON numbers. Observed pairs: `NOT_AVAILABLE:WAITING_FOR_PAYMENT` → `PROCESSING:PAID` (18 s) → `MINTED:PAID` with `txHash`. That run predated both `mint-quote` and `flow: "hosted"`; on the older checkout, the user picked QRIS from the method list, and **hosted QRIS deducted its fee from the mint after the order existed**: created for 20000, paid 23000, and IDRX minted 19860 (`fees: [{ "VA INA": 3000 }, { "QRIS Fee (0.7%)": 140 }]`). `paymentAmount = toBeMinted + sum(fees)` holds for both rails and is the checked invariant.
6. **Base asset.** Confirmed: 2 decimals at `0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22`; the mint transfer is a standard `Transfer` from the IDRX minter to the destination.
7. **Definitive rejections and access.** The documented messages are current. In addition, every `400` with `data.code` is a validation rejection with no order. There is no IDRX sandbox; the development environment (`api.appku.work`, mock token on Base) is available to partners on request. `IDRX_CUSTOMER_NAME` is the right identity: it is what IDRX stores as `customerVaName` and returns as `virtualAccountName`.

## Fixtures and proof

Fixtures in `fixtures/` marked `source: "synthetic"` exercise parsing and conformance only. `history-minted-qris.live.json` is a sanitized capture of the production order above (payment-instrument and personal fields removed). No provider request is made by the test suite.

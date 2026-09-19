# IDRX funding adapter

This adapter implements the IDRX issuer API as an `order` provider on Base. It is wired through the provider registry, private funding routes, durable order store, and Add money flow; it remains inert until every manifest environment variable is configured.

- Region / asset: Indonesia (`ID`) / `base:idrx` (2 decimals).
- Operator account: no per-user KYC. The declared server-only environment is `IDRX_CLIENT_ID`, `IDRX_CLIENT_SECRET`, and `IDRX_CUSTOMER_NAME`.
- References: IDRX assigns `merchantOrderId` (`reference: "provider"`). The core must dispatch an order only once and retain ambiguous creates for Activity recovery.
- Dispatch classification: redirects, timeouts, conflicts, rate limits, undocumented validation failures, and server errors are ambiguous. Only documented authentication/edge rejection and exact documented validation messages are definitive rejections.
- Create validation: before either success branch, every available merchant/provider/order-ID or `reference` alias, transaction type, chain, token address/symbol/decimals, destination, decimal/atomic amount, fee amount/currency, payment method/rail/channel, checkout/payment/instruction URL, and transaction-hash alias must agree. VA additionally requires documented `baseAmount`, `amount`, and `fees` with exact atomic `amount = baseAmount + fees`; a present fee currency must be `IDR`. Hosted QRIS may omit that documented VA-only amount set. Every present URL alias must agree and use `https://checkout.idrx.co`; a URL is required for QRIS and optional for VA. Mandiri/BRI return `bank-transfer`; QRIS returns the validated redirect.
- Reconciliation: bounded transaction-history polling receives the immutable MINT/Base/token/destination/exact-amount intent. Every available provider/reference/order-ID, type, chain, token, destination, base/payment amount, fee amount/currency, payment method/rail/channel, URL, and hash alias is checked before mapping `ReportedState`; duplicate or contradictory records remain `unknown`. Only the core may verify an exact Base transfer and set `received`.

## Confirm against your API

1. **Authentication.** Confirm the request headers and signature construction: `idrx-api-key` is the client ID, `idrx-api-ts` is the millisecond timestamp, and `idrx-api-sig` is base64url HMAC-SHA256 with the base64-decoded client secret over the concatenated timestamp, HTTP method, full URL, and raw body when present ([adapter.ts lines 523–561](adapter.ts#L523-L561)).
2. **Mint request.** Confirm `POST /transaction/mint-request` accepts `toBeMinted`, `destinationWalletAddress`, string `networkChainId: "8453"`, `requestType: "idrx"`, and `expiryPeriod: 60`. VA adds `paymentMethod: "va"` and `channelId: "MANDIRI"` or `"BRI"`; QRIS currently sends the common fields plus `returnUrl` and expects a hosted checkout response ([adapter.ts lines 186–215](adapter.ts#L186-L215)).
3. **VA response and fees.** Confirm the successful response is under `data`, identifies the order with `merchantOrderId`, returns `virtualAccountName`, `virtualAccountNo`, and `expiredDate`, and supplies decimal `baseAmount`, `amount`, and fee entries `{ name, amount, currency? }`. The adapter requires IDR fees and exact atomic `amount = baseAmount + sum(fees)` at two decimals ([adapter.ts lines 72–133](adapter.ts#L72-L133), [302–355](adapter.ts#L302-L355), [702–717](adapter.ts#L702-L717)).
4. **Hosted checkout.** Confirm QRIS returns one agreeing `checkoutUrl`, `paymentUrl`, or `instructionUrl` at origin `https://checkout.idrx.co`, with root path and a non-empty `token` query parameter; the adapter rejects credentials, fragments, other paths, or other origins ([adapter.ts lines 668–699](adapter.ts#L668-L699)).
5. **History and statuses.** Confirm `GET /transaction/user-transaction-history` accepts `transactionType=MINT`, `page=1`, `take=10`, and `merchantOrderId`, and returns `{ records: [...] }` with the create echoes plus `userMintStatus`, `paymentStatus`, and optional `transactionHash` / `txHash` ([adapter.ts lines 139–180](adapter.ts#L139-L180), [583–641](adapter.ts#L583-L641)). The mapped pairs are `MINTED:PAID` → sent, `PROCESSING:PAID` → settling, `NOT_AVAILABLE:WAITING_FOR_PAYMENT` → awaiting payment, `NOT_AVAILABLE:EXPIRED` → expired, `REJECTED:PAID` → failed, and `REFUND:PAID` → refunded; any other pair remains unknown.
6. **Base asset.** Confirm IDRX on Base is a 2-decimal asset at `0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22` ([shared asset lines 86–96](../../../../shared/assets/base.ts#L86-L96)).
7. **Definitive rejections and access.** Confirm the exact documented messages the adapter treats as safe rejections: `paymentMethod must be "va" or "qris" when set, got: …`, `channelId is required when paymentMethod is set`, `invalid toBeMinted: IDRX on chainId … supports … decimal place(s), got …`, and `Unsupported VA channel: …` ([adapter.ts lines 217–266](adapter.ts#L217-L266)). IDRX must also provide the production API key/secret for the operator account, confirm whether any sandbox now exists (the current documentation says none), and confirm that `IDRX_CUSTOMER_NAME` is the correct identity to compare with `virtualAccountName`.

All committed fixtures in `fixtures/` are marked `source: "synthetic"`. They exercise parsing and conformance only and are not evidence of a funded action.

## Acceptance

Process, not authorization. Nothing here grants credentials, payments, deployments, or merge; the shared template in the [issuer integration guide](../../../../../../docs/integrations/README.md) and the [Ripio playbook](../ripio/ACCEPTANCE.md) describe the full loop. This section records what is specific to IDRX.

### Rail and environment matrix

| Rail (`paymentMethod`) | Asset | Home environment | Provider environment | Status |
| --- | --- | --- | --- | --- |
| `qris` | `base:idrx` | local | IDRX production | local development completed 2026-09-14 on the #417 branch (hosted QRIS, `received`); not yet on `main` |
| `qris` | `base:idrx` | hosted-final | IDRX production | not run |
| `bank-va-mandiri`, `bank-va-bri` | `base:idrx` | any | IDRX production | parked: closed VAs accept transfers only from the operator account's own bank account, so a Home user's transfer is rejected; kept out of the live binding until Home users have their own IDRX identity |

Registry claim (`apps/web/config/coverage.ts`, `ID`): `in-build`. It moves to `live` only with dated hosted-final funded evidence.

### Sandbox and write hazard

- Home has no IDRX sandbox mode: the manifest pins `https://api.idrx.co` and `https://checkout.idrx.co` and declares no `modeEnv`. IDRX runs a separate development environment with a mock token; wiring it through the seam's sandbox mode is a possible later step, not part of acceptance today.
- **Get quote** is computed by the core (1:1, no provider call). **Confirm** is the first and only provider write: every Confirm, local included, creates a production IDRX mint request under the operator account.
- Reads used for acceptance are `GET /transaction/user-transaction-history` only. Status progression is polling only; IDRX offers a partner callback but this adapter does not consume it.
- A QRIS payment is real IDR from the tester's own bank or e-wallet app. Provider minimum Rp20,000, QRIS maximum Rp10,000,000 per order.

### Approvals and owners

| Role | Owns |
| --- | --- |
| Jesse | every payment, every hosted funded order, schema sign-off, merge, production Neon |
| IDRX lead | the operator account (KYC verified, owned by IDRX, never an individual), API schema answers, lookups by `merchantOrderId` or by destination wallet and time window, IDRX operations on stuck orders |
| IDRX tester | dedicated test Base Account, initiates each QRIS payment from their own app |
| Home operator | local and hosted environments, guarded local SQL after IDRX confirmation |

One open order per test Base Account. All orders sit under one operator account on the IDRX side, so the rule is per Base Account, not per country.

### Stop and recovery

- `dispatch-ambiguous`: stop, never retry. IDRX lead looks the order up by `merchantOrderId` when Home stored one, otherwise by destination wallet and creation time, and reports `WAITING_FOR_PAYMENT`, `EXPIRED`, or `PAID`. There is no partner cancel; an unpaid order expires on its own after `expiryPeriod` (Home sends 60 minutes). Locally the operator may reconcile the row with the guarded one-row SQL from the Ripio playbook using `provider_id = 'idrx'` and only `expired` or `failed` as the target state. On hosted, escalate to Jesse.
- If IDRX reports the order as paid, do not terminalize it: the IDRX will still be delivered and must be accounted for.
- `settling` (`PROCESSING:PAID`) normally lasts minutes: on IDRX production, Base orders created July to September 2026 reached `MINTED:PAID` with a p90 of 27 minutes from order creation below Rp50,000,000, and 59 minutes at or above it, where a manager multisig approval is required. Treat more than 60 minutes as stuck: stop, hand the `merchantOrderId` to the IDRX lead, do not create another order for that account meanwhile. A stuck order is rare but real (one in about 1,200), and only IDRX operations can move it.
- Kill switch: drain open orders before removing `IDRX_CLIENT_ID`, `IDRX_CLIENT_SECRET`, or `IDRX_CUSTOMER_NAME`; without them the binding disappears and open orders stall at their last state.

### Evidence required (per order)

- Provider status timeline from `NOT_AVAILABLE:WAITING_FOR_PAYMENT` to `MINTED:PAID`, polling only.
- Base transaction hash and `logIndex` of the `Transfer` to the session address, from an approved throwaway account only.
- Token `0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22`, destination, and on-chain amount equal to the order's `settledTokenAmountAtomic`, which equals the quoted amount less the QRIS fee carried on the observation's `fees` (requires #417).
- Home order state `received`.
- No credentials, checkout URLs with tokens, QR payloads, names, or bank or e-wallet identifiers; role labels only.

### Issuer facts the acceptance run depends on

- Fees and limits are published at https://docs.idrx.co/services/fees. QRIS: 0.7% of the requested amount, deducted from the IDRX delivered after payment is confirmed, so the IDR paid equals the quote and the IDRX delivered is below it. VA: flat fee added to the IDR amount, IDRX delivered equals the quote; present on the create response as `fees[]`.
- Minimum Rp20,000 per order for every method. Expiry `expiryPeriod` minutes, default 120; Home sends 60.
- Checkout origin for QRIS is `https://checkout.idrx.co` with a `token` query parameter and nothing else.
- History records carry `toBeMinted` and `paymentAmount` as JSON numbers; create responses carry them as strings.
- Status pairs the adapter maps are the complete set: `NOT_AVAILABLE:WAITING_FOR_PAYMENT`, `NOT_AVAILABLE:EXPIRED`, `PROCESSING:PAID`, `MINTED:PAID`, `REJECTED:PAID`, `REFUND:PAID`. Anything else stays `unknown`. `PROCESSING:PAID` normally clears within minutes; when the on-chain mint fails it persists until IDRX operations act on the order (see stop and recovery).
- Redemption (IDR out) is not an offramp port. The holder burns IDRX on Base from their own wallet and submits the hash to IDRX with a bank account in their own name, from a KYC verified IDRX account; IDRX releases the payout after review, then BI-FAST or RTGS. See https://docs.idrx.co/services/redeem-idr. A round-trip proof (mint via Home, burn from the Home wallet, redeem through the holder's IDRX account, reconcile both legs) can be recorded next to the funded order when authorized; it runs outside Home.
- Identity: closed VAs and redemption are bound to the KYC identity of the API key holder. With one operator key every Home user is the operator. QRIS is the honest live binding until Home users have their own IDRX identity on the seam.

### Current claim

Adapter and synthetic fixtures on `main`; `in-build` in the coverage registry. Local development completed against the IDRX production API on 2026-09-14 (hosted QRIS, one order, `received`) on the #417 branch. No hosted-final funded order has been run. No live provider call has been made from `main` itself.

# Coinbase web Embedded Orders

Status: implemented on the funding-provider seam for #294. Home uses Coinbase's server-authenticated Headless Orders API and renders Coinbase's hosted payment link in an iframe. Home does not call the iOS/React Native end-user endpoint, open the Cross-Platform FundModal popup, or collect Coinbase verification fields.

## Flow and eligibility

The `US` binding buys USDC on Base with Apple Pay. It is eligible for both `base-account` and `cdp-embedded` sessions when these server-only variables are configured:

- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`

The verified Home session supplies the Base destination. Each request uses a short-lived CDP JWT scoped to its exact method, host, and path.

1. `POST /platform/v2/onramp/orders` with `isQuote: true` obtains pricing without reserving an order or payment link.
2. Home signs the quote and creates exactly once with the quoted USDC `purchaseAmount`, preserving the Home order ID as `partnerOrderRef`.
   September 13, 2026 sandbox validation found Coinbase required `clientIp` despite its optional API-reference status. On September 16, 2026, Coinbase support reported IP-validation failures, disabled that validation, and requested a retry without `clientIp`; the Coinbase adapter now omits it unconditionally. This records the provider-requested retry configuration, not a permanent API contract.
3. Coinbase returns an allowlisted `https://pay.coinbase.com` payment link.
4. `GET /platform/v2/onramp/orders/{orderId}` reconciles status. Home independently verifies the exact Base USDC transfer before reporting `received`.

Quote and create omit `phoneNumber`, `email`, `agreementAcceptedAt`, `phoneNumberVerifiedAt`, `smsVerificationId`, and `emailVerificationId`. Those omissions select **Embedded Orders**, where Coinbase collects and verifies contact, OTP, identity, limits-upgrade, and agreement information in its hosted experience. In standard Headless mode the integrator supplies verified contact/agreement fields and may receive an Apple Pay button link instead. Cross-Platform FundModal is a separate popup SDK and is not used here. See Coinbase's official [Onramp overview](https://docs.cdp.coinbase.com/onramp-&-offramp/introduction/welcome) and [Create an Onramp Order API reference](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/onramp/create-an-onramp-order).

Coinbase may include a top-level `userAuthToken` in its response. Home ignores it: it is not returned to the browser, logged, or persisted. Secure caching to reduce repeat Coinbase verification is a follow-up; never put it in `customer_ref` or plaintext ad hoc storage.

## Iframe and domain requirements

Home accepts both `PAYMENT_LINK_TYPE_EMBEDDED_ORDER` and the documented standard Apple Pay button type, but only persists HTTPS links on the exact `https://pay.coinbase.com` origin with no userinfo or fragment. The iframe uses:

```html
sandbox="allow-scripts allow-same-origin"
referrerpolicy="no-referrer"
allow="payment"
```

Messages can trigger a debounced status refetch only when both `event.origin` and `event.source` match the current iframe. A message cannot create an order, navigate Home, or set funding state.

Production Embedded Orders require Coinbase Onramp approval/enablement plus allowlisting and verification of every top-level production or preview domain. Home sends that request hostname as `domain`; deploy Coinbase's required domain-verification file where applicable. Apple Pay in a cross-origin iframe also depends on the supported browser and secure-context requirements.

## Sandbox

Sandbox is local-only:

```sh
COINBASE_ONRAMP_MODE=sandbox
```

The mode applies only to Coinbase onramp; other providers and directions keep their own production/default mode. Coinbase uses the production CDP API key, prefixes `partnerUserRef` with `sandbox-`, appends `useApplePaySandbox=true` to the payment link, and omits `clientIp`. The generic core client-IP seam remains available to other providers. Use `+1000…` phone numbers, `*@sandbox.test` email addresses, and OTP `000000` inside Coinbase. Sandbox never moves real USDC: Home stops at `sent-unverified`, displays the run as complete, and does not resume it as an open order.

A pre-existing `dispatch-ambiguous` sandbox row remains resumable and has no UI recovery. Delete that local proof row before retrying; do not retry provider create for the same reservation.

## Status and evidence

| Coinbase status | Home state |
|---|---|
| `PENDING_VERIFICATION`, `PENDING_PAYMENT` | `awaiting-payment` |
| `PROCESSING` | `settling` |
| `COMPLETED` | `sent-unverified`, then `received` only after exact Base receipt evidence |
| `FAILED`, `CANCELLED`, `EXPIRED` | matching terminal state |
| unknown or contradictory response | `unknown` |

September 16, 2026 evidence:

- A complete authenticated sandbox run driven through `agent-browser` omitted `clientIp`, completed quote, exactly one create, repeated generic GET status, and loaded the Embedded Orders iframe. Coinbase accepted `+1000…` phone and `@sandbox.test` email inputs with OTP `000000`, approved the synthetic limits-upgrade inputs, displayed the exact 4.88 USDC / $5.00 review, and completed the fake Apple Pay confirmation. Generic status reached `COMPLETED`; Home reached `sent-unverified` and displayed **Sandbox complete — no real funds moved**.
- The local production quote returned HTTP 400 with `Email is required`. This records the observed response only; production Embedded Orders still require Coinbase enablement confirmation.
- The September 13 and 15 HTTP 500s used the prior `clientIp` payload. A September 16 retry without `clientIp` used a non-sandbox phone number and ended with `ERROR_CODE_INTERNAL`; the subsequent valid sandbox run completed. These earlier failures are superseded by the valid end-to-end proof and are not provider blockers.

No funded authorization was performed.

## Validation

```sh
bun test apps/web/server/funding/providers/coinbase/adapter.test.ts
bun test apps/web/server/funding apps/web/shared/funding apps/web/client/funding
bun check
```

Tests lock contact-field omission, exact purchase amount, one create, generic status GET, embedded payment-link acceptance, sandbox query/reference behavior, account-provider eligibility, `userAuthToken` containment, iframe attributes, trusted messages, and receipt-gated completion.

## Operator actions

- In CDP Portal, allowlist and verify Home's production and preview domains for Apple Pay. `localhost` needs no registration.
- Confirm the existing CDP API credentials remain configured in Vercel.
- Never set `COINBASE_ONRAMP_MODE` on production Vercel; it is only for local dry runs.

# Coinbase headless Onramp

Status: implemented on the funding provider seam for #294. Sandbox quote, create, and status were verified live on September 13, 2026 through both the adapter and the running app. Coinbase's payment pages (`/v3/api-onramp/embedded-order` and `/v3/api-onramp/apple-pay`) returned HTTP 500 for every sandbox order that day; the failure was on Coinbase's side. Production embedded create still returns `400 Email is required` pending account enablement.

## Binding

- Region: United States (`US`)
- Asset: USDC on Base (`base:usdc`)
- Payment method: Apple Pay (`apple-pay`)
- Provider reference policy: Coinbase assigns the provider order ID
- Quotes: enabled

The binding is eligible only when both existing server variables are configured:

- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`

The adapter supports the core-owned local sandbox switch described below. It does not introduce a provider-specific sandbox variable, a `NEXT_PUBLIC_` variable, or customer-token storage.

## API calls

All requests use the seam-owned `ctx.fetch` allowlist and a per-request CDP JWT generated for the exact method, host, and path.

- `POST https://api.cdp.coinbase.com/platform/v2/onramp/orders` with `isQuote: true` creates a pricing-only quote.
- `POST https://api.cdp.coinbase.com/platform/v2/onramp/orders` with the signed quote's exact USDC `purchaseAmount` creates an order.
- `GET https://api.cdp.coinbase.com/platform/v2/onramp/orders/{orderId}` reconciles status and transaction hash.

The adapter does not use the retired `/platform/v2/onramp/sessions` hosted-session endpoint.

## Embedded-mode assumptions

Coinbase collects contact details, OTP, required identity checks, and its own terms inside the cross-origin payment session. Home renders only an Apple Pay iframe returned from `https://pay.coinbase.com`, after Home's economics review and only while the order is awaiting payment. The iframe uses:

- `sandbox="allow-scripts allow-same-origin"`
- `referrerPolicy="no-referrer"`
- `allow="payment"`

The `domain` request field is the hostname of the Home request origin. `localhost` requires no CDP registration. Production and preview domains must be allowlisted and verified in CDP Portal, including Coinbase's hosted domain-verification file.

Home accepts Coinbase `postMessage` events only from the iframe's exact origin and window. Selected completion/error events trigger one debounced server refetch; messages never navigate, create an order, or set local status copy.

## Echo rules

Quote responses must echo USD, USDC, Base, and the exact destination. Decimal values are compared atomically, so equivalent strings such as `"10"` and `"10.00"` match. The fee-inclusive `paymentTotal` must equal `paymentSubtotal` plus all USD fees. `purchaseAmount` must fit USDC's six decimals.

Order creation pins `purchaseAmount` to the signed quote's exact USDC atomic amount and sends the Home order ID as `partnerOrderRef`. A successful response must echo the payment method, currencies, Base network, destination, deterministic `partnerUserRef`, exact purchase amount, coherent USD fee equation, and an Apple Pay payment link on `https://pay.coinbase.com` with no userinfo or fragment.

Status reconciliation requires the same provider order ID, destination, Base network, USDC currency, and exact purchase amount. Contradictory create echoes are ambiguous and are never retried. Contradictory status echoes remain unknown.

## Quote and status behavior

Coinbase quotes are not lockable. Home therefore requests the exact quoted token amount on create and displays the resulting fee-inclusive fiat total from the created order above the Apple Pay iframe. A changed fiat total is allowed because the Apple Pay sheet is the final charge consent.

Status mapping:

| Coinbase status | Seam state |
|---|---|
| `PENDING_VERIFICATION`, `PENDING_PAYMENT` | `awaiting-payment` |
| `PROCESSING` | `settling` |
| `COMPLETED` | `sent` (core verifies the Base transfer before `received`) |
| `FAILED` | `failed` |
| `CANCELLED` | `cancelled` |
| `EXPIRED` | `expired` |
| `UNSPECIFIED` or unknown | `unknown` |

A transaction hash is forwarded only when it is exactly a 32-byte hexadecimal hash.

## Sandbox dry run

Sandbox mode is for local dry runs only and must never be enabled on Vercel:

```sh
COINBASE_ONRAMP_MODE=sandbox
```

The mode applies only to Coinbase onramp; other providers and directions keep their own production/default mode. Coinbase uses the production CDP API key, prefixes `partnerUserRef` with `sandbox-`, sends the request's forwarded client IP, and appends `useApplePaySandbox=true` to the returned payment link. Use `+1000…` phone numbers, `*@sandbox.test` email addresses, and OTP `000000` inside the sandbox flow. Coinbase sandbox never moves real USDC, so Home stops at `sent-unverified` and displays the run as complete without receipt verification. Coinbase rejects loopback/private client IPs, which is all a local run has, so set `FUNDING_SANDBOX_CLIENT_IP` to your public IP for a local dry run; the core substitutes it only in sandbox mode and only when the forwarded IP is missing or private. Production never reads it.

## How to test

Automated tests use only fixtures marked `source: "synthetic"`:

```sh
bun test apps/web/server/funding apps/web/shared/funding apps/web/client/funding
```

Jesse's funded proof:

1. In `apps/web/.env.local`, configure `HOME_SESSION_SECRET`, `DATABASE_URL`, `FUNDING_QUOTE_SECRET`, the existing `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`, and `BASE_RPC_URL`. Unset `NEXT_PUBLIC_CDP_PROJECT_ID` to use Home-native Base Account sign-in.
2. Run migrations and Home, then open `http://localhost:3000` in Safari with Apple Pay configured.
3. Choose United States, sign in with Base Account, then Add money → Deposit USD → Apple Pay.
4. Enter $5–10, review the quote, confirm, review the created-order economics, open the payment instructions, and tap Apple Pay inside the iframe.
5. Confirm Touch ID and wait for Home to reach `received`; verify the transaction hash appears in Activity.

Apple Pay in a cross-origin iframe on localhost remains unverified until this run. If Safari requires a secure top-level context, retry with Next.js development HTTPS.

## Operator actions

- In CDP Portal, allowlist and verify Home's production and preview domains for Apple Pay. `localhost` needs no registration.
- Confirm the existing CDP API credentials remain configured in Vercel.
- Never set `COINBASE_ONRAMP_MODE` on production Vercel; it is only for local dry runs.
- A pre-existing `dispatch-ambiguous` order has no UI recovery and remains resumable; for a local proof, delete that row before retrying.

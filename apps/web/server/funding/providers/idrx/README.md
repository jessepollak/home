# IDRX funding adapter

This adapter implements the IDRX issuer API as an `order` provider on Base. It is wired through the #301 provider registry, private funding routes, durable order store, and Add money flow; it remains inert until every manifest environment variable is configured.

- Region / asset: Indonesia (`ID`) / `base:idrx` (2 decimals).
- Operator account: no per-user KYC. The declared server-only environment is `IDRX_CLIENT_ID`, `IDRX_CLIENT_SECRET`, and `IDRX_CUSTOMER_NAME`.
- References: IDRX assigns `merchantOrderId` (`reference: "provider"`). The core must dispatch an order only once and retain ambiguous creates for Activity recovery.
- Dispatch classification: redirects, timeouts, conflicts, rate limits, undocumented validation failures, and server errors are ambiguous. Only documented authentication/edge rejection and exact documented validation messages are definitive rejections.
- Create validation: before either success branch, every available merchant/provider/order-ID or `reference` alias, transaction type, chain, token address/symbol/decimals, destination, decimal/atomic amount, fee amount/currency, payment method/rail/channel, checkout/payment/instruction URL, and transaction-hash alias must agree. VA additionally requires documented `baseAmount`, `amount`, and `fees` with exact atomic `amount = baseAmount + fees`; a present fee currency must be `IDR`. Hosted QRIS may omit that documented VA-only amount set. Every present URL alias must agree and use `https://checkout.idrx.co`; an URL is required for QRIS and optional for VA. Mandiri/BRI return `bank-transfer`; QRIS returns the validated redirect.
- Reconciliation: bounded transaction-history polling receives the immutable MINT/Base/token/destination/exact-amount intent. Every available provider/reference/order-ID, type, chain, token, destination, base/payment amount, fee amount/currency, payment method/rail/channel, URL, and hash alias is checked before mapping `ReportedState`; duplicate or contradictory records remain `unknown`. Only the core may verify an exact Base transfer and set `received`.

All committed fixtures in `fixtures/` are marked `source: "synthetic"`. They exercise parsing and conformance only and are not evidence of a funded action. No provider request is made by the test suite.

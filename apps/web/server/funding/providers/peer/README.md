# Peer funding provider

Peer is registered once with an offramp port. No Peer onramp is implemented: the published integration still does not provide the hosted recipient/asset/amount/country/recovery contract required by issue #436.

## Acceptance

| Offramp rail | CI synthetic | Local staging | Production / hosted funded |
| --- | --- | --- | --- |
| US Cash App / Zelle | Required, no network | Planned, not run | Not accepted |
| GB Monzo / Revolut | Required, no network | Planned, not run | Not accepted |
| Euro area Revolut (EUR) | Required, no network | Planned, not run | Not accepted |

- **Environment and hazards:** capability conformance is synthetic. Staging deposit/withdraw and every production escrow action are writes; payment fulfillment and funded escrow require explicit bounded authorization. Peer acceptance is offramp-only and intentionally outside the onramp coverage registry.
- **Owners and approvals:** the integration owner runs conformance; the operator owns enabled credentials/contracts; Jesse approves each staging or production funded plan and its maximum exposure.
- **Stop and recovery:** stop on contract/config mismatch, missing country confirmation, ambiguous chain/provider evidence, or any bound breach. Do not repeat a deposit; recover through Action receipt, owner-order reload, and full withdrawal paths.
- **Evidence:** retain redacted Action receipts, owner-order/status recovery, duplicate-protection, and withdrawal results for each account provider and rail; never retain handles, addresses, transaction identifiers, or payment details in logs.
- **Current claim (September 23, 2026):** US and GB Peer corridors are enabled in production by operator decision. The euro-area Revolut EUR binding is enabled by the same `PEER_OFFRAMP_ENABLED` switch for all 21 configured euro-area countries, but has not been validated live. Verification under the ladder and the bot account's small balance is ongoing for the existing corridors (Rung 2 at this writing; funded Rung 3 cash-out and withdrawal have not been evidenced). The staging proof was deliberately skipped (see G2), and Peer's written corridor confirmation remains outstanding for every enabled corridor. No funded acceptance claim is made yet.

## Implementation and enablement gates

The Home adapter implements Base-USDC cash-out through pinned Peer production and staging deployments. It uses `@zkp2p/cash` `0.5.3` for static capabilities, estimates, payee canonicalization/registration, owner order reads, and full-close withdrawal planning, plus `@zkp2p/sdk` `0.14.1` for the escrow call builder. SDK calldata is treated as untrusted: Home decodes a Home-owned ABI fragment and asserts token, amount, range, one platform/currency, payee hash, oracle sentinel/config, gating service, guardian, zero delegate/value, `retainOnEmpty=false`, exact ERC-8021 attribution, target, and call cardinality. Home authors any exact USDC approval.

`PEER_OFFRAMP_ENABLED` remains unset by default. Only the exact value `1` enables discovery and new deposit preparation for US, GB, and the 21 configured euro-area countries. When disabled, Home still reads the orders behind the owner's confirmed cash-out actions so their Activity items keep their status, and withdrawal preparation remains available so an owner can recover USDC already in the pinned escrow. Set `PEER_OFFRAMP_MODE=sandbox` only for an authorized local staging proof; unset means production, and this mode does not affect Coinbase, IDRX, or Ripio. On September 22, 2026 the operator decided to validate production under the verification ladder and the bot account's small balance before a staging proof, so the gates below are evidence requirements rather than an enablement block; the current state is recorded under Current claim.

- **G2 staging (deliberately skipped):** no funded Peer staging proof was run. It was skipped by operator decision because the sandbox needs funded Peer sandbox accounts Home does not have, so the proof does not yet cover atomic approval/deposit, receipt recovery, owner-order reload recovery, status, duplicate protection, or full withdrawal.
- **G3 production:** US/USD (Cash App, Zelle) and GB/GBP (Monzo, Revolut) are enabled in production as of 2026-09-22 and are being validated under the [verification ladder](../../../../../../docs/operating-manual.md#verification-ladder) (Rung 2 at this writing; funded Rung 3 cash-out and withdrawal have not been evidenced). The 21 euro-area EUR/Revolut bindings were added on 2026-09-23 under the same `PEER_OFFRAMP_ENABLED` switch; live euro-area validation has not been run, and production acceptance is outstanding. Peer's written country/corridor confirmation for every enabled row remains outstanding and must be attached here when received; until then these are not provider-confirmed corridors.

Pinned boundaries:

- Base USDC only
- production and Home-sandbox (Peer staging) escrow/guardian/gating/rate-manager literals in `manifest.ts`
- curator origins `api.zkp2p.xyz` / `api-staging.zkp2p.xyz`
- indexer origin `indexer.zkp2p.xyz`
- Home's configured Base RPC transport with a 6-second transport timeout; foreign-chain creation-rate corridors are excluded

### Deliberate SDK egress deviation

The exact installed `@zkp2p/cash` 0.5.3 and `@zkp2p/sdk` 0.14.1 APIs expose pinned curator/indexer URLs but no fetch implementation injection for the calls used here. Home therefore cannot route those SDK requests through `ctx.fetch` without unsafe global monkey-patching. The adapter fail-closes unless both origins equal Home's manifest literals, passes those literal URLs to both clients, pins the Base RPC URL, and configures the SDK/API and RPC timeouts at 6 seconds where the installed APIs allow. The Cash client's indexer calls retain the package's internal timeout behavior because its client options expose no timeout or `AbortSignal`.

### Owner-list representation and malformed-row policy

The installed Cash 0.5.3 owner query is backed by the Peer indexer `getDepositsWithRelations({ depositor: owner }, { limit })`. The SDK derives payout rows from indexed payment-method and currency relations; when `payeeDetailsHash` is unavailable, its representation is `payeeHash: payeeDetailsHash ?? ""`. Unsupported or foreign rows may also be classified out of `cash.orders()` entirely. These are provider/indexer observations, not trusted Home identity.

Home retains the existing escrow deposit-ID filter, so foreign escrow rows are ignored. For a row from the pinned escrow, owner listing excludes only a sole payout whose payee hash is missing or malformed. This handles the Cash legacy/indexer representation while allowing valid Home history to remain available. All other malformed Home-looking rows (missing or multiple payouts, invalid currency, or other invalid identity) continue through strict `mapOrder()` validation and fail closed. Home never reconstructs a foreign/legacy payout, invents a platform/currency/payee value, or exposes a plaintext handle.

This narrow exception is safe because Home-created deposits always pass a validated bytes32 payee hash through the strict create-deposit tuple and calldata checks. Creation validation is unchanged. A withdrawal-only recovery contract for a known persisted Home deposit would require a separate, explicitly designed path; it is not represented as an `OfframpOrder` here.

Owner scans retain the SDK's documented default/max-scan option of 100. The package documents no higher safe/provider-supported ceiling, so Home does not invent one; accounts with more than 100 attributable deposits can fail closed during ownership recovery until the SDK adds pagination or a documented higher bound. Each cash-out action records its environment, so a lookup for that action queries only the Peer deployment it used. Owner scans run only to link a confirmed cash-out action without a transaction hash to its deposit, and never scan Peer for owners without such an action.

Phase 1 deliberately excludes Venmo, PayPal, Wise, Alipay, Chime, UPI, Relay/NEAR source routing, multi-platform and multi-currency orders, top-ups, partial withdrawal, and access-policy/identity-attestation rails.

Last synthetic/local implementation review: September 14, 2026. This line is not live-provider confirmation.

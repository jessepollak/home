# Peer funding provider

Peer is registered once with an offramp port. No Peer onramp is implemented: the published integration still does not provide the hosted recipient/asset/amount/country/recovery contract required by issue #436.

## Implementation and enablement gates

The Home adapter implements Base-USDC cash-out through pinned Peer production and staging deployments. It uses `@zkp2p/cash` `0.5.3` for static capabilities, estimates, payee canonicalization/registration, owner order reads, and full-close withdrawal planning, plus `@zkp2p/sdk` `0.14.1` for the escrow call builder. SDK calldata is treated as untrusted: Home decodes a Home-owned ABI fragment and asserts token, amount, range, one platform/currency, payee hash, oracle sentinel/config, gating service, guardian, zero delegate/value, `retainOnEmpty=false`, exact ERC-8021 attribution, target, and call cardinality. Home authors any exact USDC approval.

`PEER_OFFRAMP_ENABLED` remains unset by default. Only the exact value `1` enables discovery and new deposit preparation. When disabled, owner-order listing calls the indexer only if Home has confirmed cash-out Action history for that owner or the owner explicitly chooses recovery; withdrawal preparation remains available so an owner can recover USDC already in the pinned escrow. Set `PEER_OFFRAMP_MODE=sandbox` only for an authorized local staging proof; unset means production, and this mode does not affect Coinbase, IDRX, or Ripio. Operators must not enable production until both remaining gates are complete:

- **G2 staging:** separately authorized funded proof with both account providers covering atomic approval/deposit, receipt recovery, owner-order reload recovery, status, duplicate protection, and full withdrawal. No funded or live test was run for this implementation.
- **G3 production:** written Peer country/corridor confirmation for every enabled row, plus the normal UI proof clip. Current candidate rows are US/USD Cash App and Zelle, and GB/GBP Monzo and Revolut.

Pinned boundaries:

- Base USDC only
- production and Home-sandbox (Peer staging) escrow/guardian/gating/rate-manager literals in `manifest.ts`
- curator origins `api.zkp2p.xyz` / `api-staging.zkp2p.xyz`
- indexer origin `indexer.zkp2p.xyz`
- Home's configured Base RPC transport with a 6-second transport timeout; foreign-chain creation-rate corridors are excluded

### Deliberate SDK egress deviation

The exact installed `@zkp2p/cash` 0.5.3 and `@zkp2p/sdk` 0.14.1 APIs expose pinned curator/indexer URLs but no fetch implementation injection for the calls used here. Home therefore cannot route those SDK requests through `ctx.fetch` without unsafe global monkey-patching. The adapter fail-closes unless both origins equal Home's manifest literals, passes those literal URLs to both clients, pins the Base RPC URL, and configures the SDK/API and RPC timeouts at 6 seconds where the installed APIs allow. The Cash client's indexer calls retain the package's internal timeout behavior because its client options expose no timeout or `AbortSignal`.

Owner scans retain the SDK's documented default/max-scan option of 100. The package documents no higher safe/provider-supported ceiling, so Home does not invent one; accounts with more than 100 attributable deposits can fail closed during ownership recovery until the SDK adds pagination or a documented higher bound. Action history records environment but cannot associate an unindexed deposit ID before lookup, so recovery queries only the owner's historically used Peer deployments and deduplicates results; it never scans disabled Peer for unrelated owners.

Phase 1 deliberately excludes Venmo, PayPal, Wise, Alipay, Chime, UPI, Relay/NEAR source routing, multi-platform and multi-currency orders, top-ups, partial withdrawal, and access-policy/identity-attestation rails.

Last synthetic/local implementation review: September 14, 2026. This line is not live-provider confirmation.

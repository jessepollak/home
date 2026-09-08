# Morpho USDC savings read integration

Status: this file is the read-only Morpho V1 candidate comparison (verified 2026-09-07). Local deposit and withdrawal against the three configured USDC vaults is now integrated; live vault execution has not been performed. Current delivery: [build status](build-status.md).

Verified (read path): 2026-09-07 UTC.

## Supported contract

Home supports **Morpho Vault V1 data only** in this slice.

- Network: Base mainnet (`chainId: 8453`)
- Underlying: canonical Circle USDC
- Contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Decimals: `6`
- Public data source: `https://api.morpho.org/graphql`
- Public route: `GET /api/savings/vaults`

Circle's official USDC contract-address registry identifies the Base contract above. Circle's EIP-3009 signing guide states that USDC uses six decimal places. The adapter checks chain, exact contract address, and decimals; it never matches by ticker alone.

Sources:

- Circle USDC contract addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses
- Circle USDC base-unit precision: https://developers.circle.com/gateway/nanopayments/howtos/eip-3009-signing
- Morpho vault API documentation: https://docs.morpho.org/developers/api/morpho-vaults/
- Morpho public GraphQL endpoint: https://api.morpho.org/graphql

## V1 schema boundary

The implementation queries the V1 `vaults` and `vaultPosition` fields. V1 vault metrics are nested under `state`, and V1 liquidity is under `liquidity.underlying`.

Morpho V2 is a different schema. Its `vaultV2s` / `vaultV2ByAddress` fields expose flat fields such as `totalAssets`, `avgNetApy`, `performanceFee`, `managementFee`, and `liquidity`. The normalizer fails closed if a V2-shaped object reaches the V1 adapter.

The public schema and sample responses were checked with a small bounded set of requests on 2026-09-07: V1 candidate reads (including the adapter smoke test), one V2 comparison query, two combined introspection queries, and one three-vault V1 snapshot. No credentials or paid API were used.

## Candidate shortlist

No vault is selected by default. The configured shortlist is a comparison set, not an investment recommendation. The three addresses were retained because they were listed V1 Base USDC vaults and were the three largest by reported total assets in the bounded discovery response at verification time.

Snapshot values below came directly from Morpho GraphQL. Amounts were preserved as integer base units and formatted using six decimals. APY is variable and may already have changed.

| Candidate | Vault address | Curator address | Version | Current net APY | V1 fee rate | Total assets | Indexed liquidity | State as of |
|---|---|---|---|---:|---:|---:|---:|---|
| Gauntlet USDC Prime | `0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61` | `0x9E33faAE38ff641094fa68c65c2cE600b3410585` | V1 | 4.2735% | 0% | 418,653,265.458466 USDC | 171,269,157.594142 USDC | 2026-09-07 20:10:53 UTC |
| Spark USDC Vault | `0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A` | `0x0f963A8A8c01042B69054e787E5763ABbB0646A3` | V1 | 3.8363% | 10% | 305,947,989.425718 USDC | 160,208,957.701975 USDC | 2026-09-07 20:13:25 UTC |
| Steakhouse USDC | `0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183` | `0x827e86072B06674a077f592A531dcE4590aDeCdB` | V1 | 3.1864% | 25% | 134,762,854.120733 USDC | 134,580,830.203058 USDC | 2026-09-07 20:12:57 UTC |

Interpretation limits:

- Net APY is the current V1 API field, not a fixed or guaranteed return.
- The fee is the V1 vault fee rate reported by Morpho; the UI does not translate it into a guaranteed user outcome.
- Total assets are vault-wide, not a user balance.
- Indexed vault liquidity is not the same as a particular account's currently withdrawable maximum.
- Indexed position assets are not an authorization source for withdrawal.
- A current onchain `maxWithdraw` read, exact vault review, transaction simulation, and a verified deposit/withdrawal smoke test are still required before enabling actions.

Before selecting one product, the parent should ask the user/operator to approve the exact vault after reviewing its curator, allocation strategy, warnings, fees, exit behavior, and desired risk posture. The current shortlist size/liquidity rationale is useful for comparison but is not sufficient selection evidence.

## Server contracts

### Public candidates

`getMorphoVaultCandidates()`:

- sends one bounded query for Base + exact USDC;
- keeps only configured V1 addresses;
- preserves integer amounts as decimal strings with a lossless JSON parser;
- distinguishes missing values from reported zero values;
- records API fetch time and state time;
- uses an 8-second timeout;
- coalesces concurrent server reads and caches fresh data for 30 seconds;
- may return a marked stale result for up to five minutes after an upstream failure;
- never runs a background polling loop.

`GET /api/savings/vaults` exposes only this public, read-only result. Upstream failures return `502` without fabricated fallback metrics.

### Verified position adapter

`getMorphoVaultPosition()` has no public route in this slice. Its caller must provide:

```ts
{
  account: {
    address: "0x...",
    verification: "caller-verified-session-smart-account"
  },
  vaultAddress: "0x..." // must be in the configured shortlist
}
```

The parent integration must obtain the account from the verified server session contract, not from a client wallet parameter. A null indexed position remains null, not a zero balance. The result always leaves `withdrawableRaw` as `null` and explains that onchain `maxWithdraw` is required.

There is no database persistence and no endpoint accepting an arbitrary user or wallet address.

## UI integration

The parent shell can render:

```tsx
<SavingsExperience session={verifiedSession} />
```

The component fetches the public candidate route, starts with no selected vault, and only reveals current APY after a successful sourced response. Passing a session changes private-position status copy only; it does not authorize or issue a private request.

The original read-only lane did not ship transaction calldata. Local deposit and withdrawal against these three vaults is now integrated; live vault execution has not been performed. See [build status](build-status.md).

## Verification

Run the deterministic suite:

```sh
bun test
bun check
git diff --check
```

An opt-in live public smoke test is available and performs one bounded V1 candidate query:

```sh
MORPHO_LIVE_SMOKE=1 bun test apps/web/server/morpho/live.test.ts
```

The live smoke test verifies provenance, Base chain identity, exact USDC address, V1 version, and a non-empty configured shortlist. It does not execute a transaction.

# Morpho USDC savings read integration

Status: this file documents Save's Morpho V1 vault adapter and the candidate comparison verified 2026-09-07. Save is Home's only user-facing lending product. Local deposit and withdrawal preparation against the three configured USDC vaults is integrated with pinned reads and ordered smart-account batch simulation; live vault execution has not been performed. The execution contract is in [Actions](actions.md), and portfolio observation is in [Balances](balances.md).

Verified (read path): 2026-09-07 UTC.

## Supported contract

Home supports **Morpho Vault V1 data only** in this slice. The typed transaction-authority registry in `shared/savings/config.ts` contains only the existing `BASE_MORPHO_USDC_VAULTS`; it is separate from the isolated Morpho Blue market registry used by Borrow. There is no standalone Lend route or direct Morpho Blue supply action.

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

The contract address is the canonical identity of each configured vault, and each displayed name is the verified onchain `name()` for that exact address. Registry `id` values are opaque legacy compatibility keys retained for stored references and id-based activity mapping; they carry no identity, display, or ordering meaning, so no surface may derive a vault label from id text.

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
- Each prepared action uses current onchain limits and previews pinned to one Base block, simulates the exact approval/deposit or withdrawal call order through the verified smart account, and reconfirms the source block hash. A funded live deposit/withdrawal smoke test has not been performed. Live Base deposit and withdrawal remain **Unverified** until the applicable verification-ladder rung produces evidence; fixture runs make no provider or funded call.

The configured vault registry is transaction authority; the public Morpho listing remains display data and cannot activate another vault. New deposits require `capabilities.save: "enabled"`; `"reducing-only"` preserves withdrawals while blocking deposits, and an omitted capability fails closed.

## Server contracts

### Public candidates

`getMorphoVaultCandidates()`:

- sends one bounded query for Base + exact USDC;
- keeps only configured V1 addresses;
- preserves integer amounts as decimal strings with a lossless JSON parser;
- distinguishes missing values from reported zero values;
- records API fetch time and state time;
- uses an 8-second timeout per attempt and retries one transient upstream failure (two attempts total, with no background loop);
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

The parent integration must obtain the account from the verified server session contract, not from a client wallet parameter. A null indexed position remains null, not a zero balance. Authenticated Base balance and position reads use the Balances subsystem's one bounded retry; exhausted reads remain unavailable while a valid last snapshot is retained only as explicitly stale with its source age and a manual retry. The result always leaves `withdrawableRaw` as `null` and explains that onchain `maxWithdraw` is required.

There is no database persistence and no endpoint accepting an arbitrary user or wallet address.

## UI integration

The parent shell can render:

```tsx
<SavingsExperience session={verifiedSession} />
```

The component fetches the public candidate route, starts with no selected vault, and only reveals current APY after a successful sourced response. Passing a session changes private-position status copy only; it does not authorize or issue a private request.

The original read-only lane did not ship transaction calldata. Local deposit and withdrawal against these three vaults is now integrated through the [action flow](actions.md); live vault execution has not been performed.

Save distinguishes current, stale, partial, and unavailable observations. It never converts an unavailable authenticated vault position into zero. A failed refresh keeps a verified snapshot visible only with an explicit stale label, source age, and retry. Stale discovery APY stays labeled stale and is never promoted to a current rate.

Savings preparation returns typed server-authored review metadata: exact USDC amount, configured vault identity and name, Base chain identity, current onchain fee, source-block limit and share preview, expiry, the deposit/withdraw exchange constraint, and discovery-rate status (`current`, `stale`, or `unavailable`) with timestamps. The client fails closed when these facts disagree with the requested owner, vault, operation, or amount; warning prose is not review authority.

## Separately authorized live Base deposit-withdrawal runbook

This is an operator checklist, not authorization and not evidence that a live run occurred. Nothing in the deterministic or public smoke suites dispatches a transaction. Keep live Base deposit and withdrawal **Unverified** unless one operator completes this checklist for the exact deployed head under a separate, explicit authorization.

### Authorization and prerequisites (fail closed)

Before opening a money dialog, obtain one bounded authorization that names all of the following: the operator-controlled verified Home account, Base mainnet, one vault from `BASE_MORPHO_USDC_VAULTS`, canonical Base USDC, permission for both the deposit and its cleanup withdrawal, and a maximum approved USDC amount. If the account, vault, funding source, both operations, or maximum amount is missing or ambiguous, stop without preparing or dispatching anything. Never infer authorization from this runbook, an issue label, available account funds, or a previous run.

Use the smaller of the explicitly approved maximum and the amount the operator is prepared to put at risk. Do not move unrelated funds. The selected vault must have no pre-existing position for this account, so its entire position can be identified as this test position during cleanup; otherwise choose another explicitly approved configured vault or stop. The account must also have enough Base ETH for the documented smart-account execution path, enough current usable canonical USDC for the bounded test amount, and a recovery owner available; unrelated USDC is not authorized for movement. Do not access, copy, or record seed phrases, private keys, session tokens, provider credentials, environment files, or raw authenticated payloads.

Immediately before the run, verify in the deployed application and trusted release records:

1. Record the full current Git commit SHA, deployment identifier/URL, and build provenance, and prove the deployment serves that exact SHA. Do not continue from an uncommitted local build, a preview for another head, or a deployment whose SHA cannot be established.
2. In the authenticated session, compare the complete session subject, account provider, Base chain ID `8453`, and full verified smart-account address with the privately authorized owner record. Compare exact values in the secure operator context; put only a redacted address fingerprint in shared evidence.
3. Compare the selected vault's full address with exactly one enabled entry in `BASE_MORPHO_USDC_VAULTS`, and compare its asset with canonical Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` and `6` decimals. Confirm `capabilities.save` is `"enabled"` for the deposit. Public discovery text or a ticker match is not authority.
4. Capture fresh pre-run Save, Home, Activity, canonical USDC, and selected-vault position observations. Confirm the selected-vault position is zero and distinguish current observations from stale, partial, or unavailable ones. Stop on stale/partial/unavailable owner, balance, position, deployment, or vault identity.

### Deposit: review once, dispatch once

1. Select the authorized vault and enter an amount no greater than the authorized maximum. Record the exact decimal amount and integer USDC base units.
2. On the server-authored confirmation, compare the operation (`deposit`), verified owner, exact vault, Base chain identity, exact canonical-USDC amount, current fee, source block number/hash, onchain limit, share preview, exchange constraint, discovery-rate status/timestamps, and expiry with the authorization and current screen. Independently confirm the available USDC and onchain limit cover the amount. Stop on any mismatch, expiry, warning-only or missing review authority, stale owner identity, or unexpected calls.
3. Authorize exactly one deposit dispatch. Record its prepared-action ID and resulting transaction/user-operation identifier without initiating another action.
4. If signing, submission, or finality is rejected, failed, timed out, or ambiguous, stop. Do not click Deposit again, create a replacement preparation, or make an ambiguous retry. Reconcile the same action identifier and onchain account/vault state through the established status path; escalate to the recovery owner if its outcome cannot be proved. Never treat a missing UI receipt as proof that nothing executed.
5. Continue only after Base finality is established for the successful receipt and its exact owner, vault, USDC amount, and calls match the prepared review. Capture the block and transaction identifier in privacy-safe form.

### Deposit convergence evidence

Without dispatching another transaction, refresh through the normal product controls until all of these observations refer to the finalized deposit:

- Save shows the selected vault position increased from zero by the test position and labels its freshness/provenance correctly.
- Home shows the corresponding portfolio and usable-USDC changes without inventing zero during indexer lag.
- Activity shows one deposit with the same action/transaction, amount, vault, status, and owner context.
- The finalized receipt and direct onchain balance/position reads reconcile with the product observations.

Use bounded manual refreshes; do not poll indefinitely. If any surface stays stale, partial, unavailable, duplicated, or inconsistent beyond its documented convergence window, preserve the successful receipt, stop the run, and escalate. Do not withdraw until the deposited test position is authoritatively identified.

### Cleanup withdrawal: only the test position

1. Reverify the exact deployed SHA/deployment, authenticated owner identity, Base chain, configured vault, canonical USDC route, current selected-vault position, and authorization before preparing withdrawal. Stop if any identity changed. Confirm that the selected vault still contains only the position created by this run.
2. Prepare withdrawal of the entire current test position, bounded to that vault position; never include pre-existing or unrelated shares. On confirmation, compare operation (`withdraw`), verified owner, exact vault, Base chain, exact USDC amount, current fee, source block number/hash, `maxWithdraw`, share preview, exact-assets exchange constraint, discovery status, and expiry. The requested amount must not exceed the authoritative current test position or `maxWithdraw`.
3. Authorize exactly one withdrawal dispatch. Apply the same no-replacement and no-ambiguous-retry rule as the deposit. On rejection, failure, timeout, ambiguity, expiry, insufficient liquidity, identity change, or review mismatch, stop and reconcile the same action; do not improvise another amount or dispatch.
4. Require a finalized successful receipt whose calls and owner match the withdrawal review. Then verify direct onchain reads and Save show the selected-vault test position returned to zero, canonical USDC returned to the same verified smart account as usable (not merely pending or indexed), Home converged, and Activity contains exactly one matching withdrawal. Account for only explicit network costs and documented vault rounding; any unexplained residual share or USDC difference is a failed cleanup requiring escalation.

### Evidence, stop conditions, and verification status

Shared evidence may contain the full Git SHA, deployment identifier, public vault address, approved maximum and actual amount, timestamps, source/finality block numbers, transaction hashes, redacted owner-address fingerprints, and privacy-safe screenshots of the review and converged Save/Home/Activity states. Crop or redact balances unrelated to the test, account identifiers, notifications, and personal data. Never publish the full owner address alongside identity data, credentials, cookies, headers, authenticated raw payloads, or environment values.

Stop without further dispatch whenever authorization is incomplete; the approved maximum would be exceeded; owner, chain, deployment, vault, asset, amount, call, limit, preview, or expiry does not match; a required observation is stale/partial/unavailable; the vault has a pre-existing position; or either dispatch has an ambiguous or unsuccessful outcome. The recovery owner decides any follow-up after reconciling onchain state. A stopped run remains **Unverified**, even if one leg succeeded.

Change live Base deposit and withdrawal from **Unverified** to **Verified** only after independent review confirms, for one exact deployed head: bounded authorization; all preflight comparisons; one finalized deposit and one finalized cleanup withdrawal; matching prepared facts and receipts; Save, Home, Activity, and direct onchain convergence for both legs; zero remaining test-vault position; returned usable USDC; privacy-safe evidence; and no unresolved discrepancy. Record the verification date and evidence location in the delivery issue and update this status statement in a reviewed change. Partial execution, fixture tests, public read smoke tests, or a deposit without verified cleanup do not satisfy this criterion.

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

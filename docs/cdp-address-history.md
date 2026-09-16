# CDP Address History Activity source

Status: implemented behind a server-only source switch; **not enabled by default**. The currently configured CDP Client API Key returns provider status `code: 16` (`authentication required`), so live authentication and ordering are not proven.
Last reviewed: 2026-09-15.

Home can read wallet-scoped Base transactions through the CDP Node JSON-RPC method `cdp_listAddressTransactions`. This source is intended to discover arbitrary ERC-20 transfers for the smart-account address verified by the Home session. It is read-only Activity history, not balance, receipt, finality, or transaction-confirmation authority.

## Configuration and authentication

Set a server-only CDP Node Base mainnet URL in `BASE_RPC_URL`. Address History requires the configured URL to use CDP Node's `api.developer.coinbase.com` host; it never falls back to the public Base RPC URL or another RPC host. Mint and authorize the URL in CDP Portal according to the current Node Address History authentication documentation. Never expose the URL or embedded Client API Key with a `NEXT_PUBLIC_` prefix.

Activity selects its source with:

```sh
ACTIVITY_HISTORY_SOURCE=cdp-address-history
```

The only accepted values are `cdp-sql` and `cdp-address-history`. Unset defaults to `cdp-sql`; invalid values fail closed as not configured. Existing local, Preview, and Production deployments require a restart or redeploy after environment changes.

Do not enable Address History in Vercel until the rollout gate below passes. SQL remains the safe default fallback while the current Address History credential returns `code: 16`.

## Bounded behavior

- Each provider request asks for the maximum `pageSize: "100"`. CDP documents this method as costing 100 API credits per call.
- One Home Activity request makes at most three provider calls (at most 300 credits) and has a finite per-call timeout.
- Home returns at most 25 transfers in the existing 31-day `[from,to)` Activity window.
- Confirmed transactions are required to carry transaction/block identity, a canonical decimal `ethereum.index`, Ethereum block timestamp, and token transfers. Each eligible owner transfer must carry the same canonical decimal `transactionIndex` as its parent transaction. Pending and other non-confirmed transactions are omitted.
- Only subtype-free, exact decimal ERC-20 rows at or below `uint256` are accepted. Exact owner participation is required. Explicit ERC-721, ERC-1155, and other typed NFT rows, including unknown object-valued subtype payloads, are omitted; valid non-owner legs are omitted. Future scalar metadata does not invalidate an otherwise valid row. Malformed rows that could be owner-scoped fail the page rather than inventing values.
- Token metadata still uses Home's exact-contract registry, Codex, and bounded onchain resolver. The existing second-layer NFT-like contract filter remains in place.
- Provider transaction pages must be in strict descending chain position `(blockHeight, ethereum.index)`, including split-block page boundaries, with monotonic block time. Transaction hashes do not determine provider transaction order. Duplicate or non-descending positions fail as `invalid-response`; Home only sorts token-transfer legs within their atomic transaction and does not silently reorder across provider transaction pages.
- Activity transfers use Ethereum's block-scoped log position as their canonical descending order: `(blockNumber, logIndex, transactionHash, id)`. The opaque, versioned base64url cursor is capped at 4096 characters. It contains only the provider input page token and the last emitted canonical key—never transaction rows or an array offset. The source page is refetched at a transfer boundary so ordinary head insertion cannot duplicate or skip previously paginated rows. Sparse scans advance across at most three provider pages and return an advancing cursor for manual continuation.
- Scanning stops on provider exhaustion. A 31-day cutoff stops scanning only after descending transaction/block-time order has been observed and validated.

Provider error bodies and status messages are not returned. JSON-RPC errors, HTTP failures, and gRPC-style result status codes map to Home's existing typed chain-data failures. In particular, result `code: 16` is `unauthorized`; codes 7, 8, 3, 4, and 14 map to payment/entitlement, rate limit, invalid input, timeout, and upstream failure respectively. JSON-RPC `-32005`, numeric result code `429`, and HTTP 429 all map to `rate-limited`.

## Live smoke and rollout gate

Do not add a live smoke to CI. An authorized operator should use a private local or Preview environment and browser Activity request; do not paste the RPC URL, Client API Key, wallet address, cursor, transaction data, or response into commands, logs, screenshots, issue comments, or documentation.

1. Confirm `BASE_RPC_URL` is a CDP Node Base mainnet URL and `ACTIVITY_HISTORY_SOURCE=cdp-address-history` is set only in the smoke environment.
2. Restart or redeploy that environment.
3. Sign in normally so `/api/activity` derives the smart-account address from the verified session.
4. Make one bounded Activity request. Record only the safe outcome category, source discriminator, provider-call count, returned-row count, and whether a continuation cursor exists.
5. Require a valid page containing an arbitrary received ERC-20 whose exact amount, token contract, participants, transaction hash, block, and log index agree with Base receipt/explorer evidence.
6. Follow one continuation cursor and verify strict order, no duplicate/skip at the page boundary, and a stable first-page refetch after a new head transaction.
7. Run `bun check` at the exact candidate head and obtain independent review.
8. Only after all checks pass, set the source in the intended Vercel environment and redeploy. If authentication still returns `code: 16` or ordering is not canonical, restore/unset the switch so SQL remains selected and redeploy.

A successful mocked test run does not satisfy this gate. Current live status remains unauthorized (`result.code: 16`).

## Primary source

- CDP Address History JSON-RPC methods: https://docs.cdp.coinbase.com/api-reference/json-rpc-api/address-history
- CDP Node overview and API credits: https://docs.cdp.coinbase.com/data/node/overview
- CDP authentication: https://docs.cdp.coinbase.com/get-started/authentication/cdp-api-keys

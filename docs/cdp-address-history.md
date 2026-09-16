# CDP Address History Activity source

Status: implemented behind a server-only source switch; **not enabled by default**. The fixed REST endpoint and project-key JWT authentication were live-verified directly, but authenticated Home Activity pagination and ordering still require the staged rollout gate below.
Last reviewed: 2026-09-15.

Home can read wallet-scoped Base transactions from CDP's Address History REST endpoint at `api.cdp.coinbase.com/platform/v1/networks/base-mainnet/addresses/{address}/transactions`. This source discovers arbitrary ERC-20 transfers for the smart-account address verified by the Home session. It is read-only Activity history, not balance, receipt, finality, or transaction-confirmation authority.

## Configuration and authentication

Address History requires the server-only `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` used by Home's existing CDP server integrations. Every provider call generates a fresh 120-second JWT with `@coinbase/cdp-sdk/auth`, scoped to `GET`, the fixed `api.cdp.coinbase.com` host, and the exact lowercase-address path. Query parameters are not part of the signed request path. Home sends that JWT only as a bearer credential to the fixed HTTPS endpoint. Never expose either credential or the JWT with a `NEXT_PUBLIC_` prefix, in browser code, or in logs.

`BASE_RPC_URL` remains independently required for Home's existing Base RPC reads. Address History does not read it and does not change any of its consumers.

Activity selects its source with:

```sh
ACTIVITY_HISTORY_SOURCE=cdp-address-history
```

The only accepted values are `cdp-sql` and `cdp-address-history`. Unset defaults to `cdp-sql`; invalid values fail closed as not configured. Existing local, Preview, and Production deployments require a restart or redeploy after environment changes.

Do not enable Address History in Production until the rollout gate below passes. SQL remains the safe default fallback during staged validation.

## Transport revision and live evidence

The initial adapter used CDP Node JSON-RPC `cdp_listAddressTransactions`. Two different Client API Key RPC URLs returned HTTP 200 with gRPC-style `result.code: 16` (`authentication required`) for that method; `cdp_listBalances` failed the same way, and adding expected Origin headers did not change the result. A CDP partner confirmed that JSON-RPC authentication problem was under investigation and supplied the REST endpoint now used by Home.

A secret-safe direct probe with Home's existing server CDP credentials verified:

- JWT-authenticated `GET` requests to the fixed Base mainnet lowercase-address path return HTTP 200.
- The response envelope is `data`, `has_more`, and `next_page`.
- `limit=1` bounds the result to one row, and the continuation token advances only when sent as the `page` query parameter.
- Transactions and transfers use the snake_case schema described below; completed rows use status `complete`; numeric transaction and log indices were observed; transfer types included `erc20` and `erc721`.

This direct provider probe verifies the selected transport and schema seam. It does not constitute end-to-end Home Activity or rollout acceptance.

## Bounded behavior and response validation

- Each provider request uses `limit=100`. A continuation token is URL-encoded as `page`; a request does not use `page_token`, `pageKey`, JSON-RPC, or an address embedded in credentials.
- One Home Activity request makes at most three provider calls and has a finite per-call timeout with caller-abort propagation.
- Home returns at most 25 transfers in the existing 31-day `[from,to)` Activity window.
- The REST envelope must contain at most 100 `data` rows and a boolean `has_more`. `has_more=true` requires a non-empty bounded `next_page`; exhausted pages cannot carry a continuation token.
- Transactions must report exact `network_id: "base-mainnet"`. Only exact status `complete` is parsed; other string statuses are omitted rather than treated as confirmed.
- Completed rows require outer `transaction_hash`, `block_hash`, and canonical decimal-string `block_height`. `content.hash` must agree with the outer transaction hash. `content.block_timestamp` and safe non-negative numeric `content.index` are required. `content.token_transfers` may be omitted or null for transactions with no token transfers; when present, it must be an array.
- Only exact `token_transfer_type: "erc20"` rows are eligible. ERC-721 and every unknown, missing, or differently-cased transfer type are omitted. Safe non-negative numeric `log_index` values are converted to canonical decimal strings. Negative, fractional, non-finite, unsafe, and non-numeric indices fail validation.
- Eligible transfers map `contract_address`, `from_address`, `to_address`, and decimal-string `value`; their transaction/block identity is inherited from the validated parent because REST transfer rows do not repeat it. Amounts remain exact and cannot exceed `uint256`.
- Exact owner participation is required. Malformed participants fail closed; valid non-owner legs are omitted. Token metadata still uses Home's exact-contract registry, Codex, and bounded onchain resolver, including the existing second-layer NFT-like contract filter.
- Provider transaction pages must be in strict descending chain position `(block_height, content.index)`, including split-block page boundaries, with monotonic block time. Transaction hashes do not determine provider transaction order. Duplicate or non-descending positions fail as `invalid-response`; Home only sorts token-transfer legs within their atomic transaction.
- Activity transfers use Ethereum's block-scoped log position as their canonical descending order: `(blockNumber, logIndex, transactionHash, id)`. The opaque, versioned base64url cursor is capped at 4096 characters and contains only the provider input page token and last emitted canonical key. The source page is refetched at a transfer boundary so ordinary head insertion cannot duplicate or skip previously paginated rows. Sparse scans advance across at most three provider pages and return an advancing cursor for manual continuation.
- Scanning stops on provider exhaustion. A 31-day cutoff stops scanning only after descending transaction/block-time order has been observed and validated.

Provider response bodies, messages, credentials, JWTs, and secret-bearing error causes are not returned or retained. HTTP 400 maps to `invalid-input`; 401/403 to `unauthorized`; 402 to `payment-required`; 408/504 to `timed-out`; 429 to `rate-limited`; and other non-2xx responses to `upstream-error`. Malformed JSON, envelopes, and rows map to `invalid-response`; aborts and local timeout map to `timed-out`; other fetch failures map to `upstream-error`. JWT generation or malformed JWT output maps to `not-configured`.

## Live smoke and rollout gate

Do not add a live smoke to CI. An authorized operator should use a private Preview environment and the browser Activity flow. Do not paste the API key ID, API key secret, JWT, wallet address, cursor, transaction data, or provider response into commands, logs, screenshots, issue comments, or documentation.

1. Confirm `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `ACTIVITY_HISTORY_SOURCE=cdp-address-history` are set only in the smoke environment.
2. Redeploy that environment.
3. Sign in normally so `/api/activity` derives the smart-account address from the verified session.
4. Make one bounded Activity request. Record only the safe outcome category, source discriminator, provider-call count, returned-row count, and whether a continuation cursor exists.
5. Require a valid page containing an arbitrary received ERC-20 whose exact amount, token contract, participants, transaction hash, block, and log index agree with Base receipt/explorer evidence.
6. Follow at least two Activity pages and verify strict order, no duplicate/skip at the page boundary, and a stable first-page refetch after a new head transaction.
7. Run `bun check` at the exact candidate head and obtain independent auth-safety, schema, pagination, and regression review.
8. Only after Preview succeeds, set the source in Production and redeploy. If authentication, schema, or ordering fails, restore/unset the switch so SQL remains selected and redeploy.

A successful mocked test run or direct provider transport probe does not satisfy this end-to-end gate.

## Primary sources

- CDP authentication: https://docs.cdp.coinbase.com/get-started/authentication/cdp-api-keys
- CDP Address History JSON-RPC documentation (the superseded transport whose authentication incident motivated this revision): https://docs.cdp.coinbase.com/api-reference/json-rpc-api/address-history

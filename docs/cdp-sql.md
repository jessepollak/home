# CDP SQL chain-history adapter

Status: signed-JWT authentication and one basic bounded `base.events` query verified live by the parent; the transfer template and pagination remain pending live verification.
Last reviewed: 2026-09-07.

Home uses CDP SQL only as a read-only indexed history source. It is **not** a spendable-balance, transaction-confirmation, vault-position, debt, or authorization source. Current spendable inventory uses CDP Onchain Data Token Balances for allowlisted directs and pinned-block RPC for Morpho vault conversion; receipts and protocol adapters remain the confirmation path. Do not query CoinbaSeQL for balances. Locked inventory direction: [balances inventory](balances-inventory-architecture.md); research detail on [#76](https://github.com/jessepollak/home/issues/76#issuecomment-5594452047).

## Implemented contract

`apps/web/server/chain-data` provides:

- A fixed Base mainnet ERC-20 `Transfer(address,address,uint256)` history template over `base.events`.
- Runtime validation for a session-verified wallet address, operator-supplied asset allowlist, selected asset IDs, a maximum 31-day time window, page sizes of 1–200, and cache ages of 500–900,000 ms.
- Deterministic descending keyset pagination by block number, transaction hash, log index, and CDP log ID.
- Re-org-aware event selection using `GROUP BY log_id HAVING sum(toInt8(action)) > 0`. The adapter does not filter naively to added rows.
- Numeric ordering and cursor comparisons use distinct internal aliases before block numbers and log indexes are cast to lossless public strings. Runtime parsing rejects numeric values for those public fields and token amounts, preventing already-rounded JavaScript numbers from being accepted.
- Strict response validation: the live envelope without `schema` is supported; when `schema` is present its known fields are validated. Returned assets and participants must still match the requested allowlist and verified wallet.
- Separate `cached` and `stale` source flags plus CDP's execution timestamp, execution duration, and the local fetch timestamp.
- A fixed-host HTTP transport with a finite local timeout, typed 401/402/408/429/504 failures, no automatic retries, and no upstream body or credential text in errors.

The intended parent integration is:

1. Validate the browser session on the server.
2. Resolve the session's smart-account address from trusted provider data.
3. Pass that address as `verifiedWalletAddress`; never accept an unverified browser wallet as authority.
4. Resolve requested asset IDs against Home's reviewed Base asset registry and pass the matching `BaseErc20Asset[]` allowlist.
5. Return the normalized page to the authenticated caller with private/no-shared-cache response policy.

No API route, authentication handler, database record, UI, balance read, or mutation is included in this lane.

## Authentication decision

CDP's SQL quickstart currently tells programmatic users to create a **CDP Client API key** and use it as the bearer value for `/run`. The v2 REST OpenAPI reference describes the same endpoint's bearer security scheme as a **JWT signed with a CDP API Key Secret**. Those are distinct credential paths in the current official documentation.

The transport supports two explicit modes and never guesses:

- `client-api-key` (default): loaded only from `CDP_SQL_CLIENT_API_KEY` by `createCdpSqlAuthFromEnv`.
- `signed-jwt` (explicit opt-in): set `CDP_SQL_AUTH_MODE=signed-jwt`; `createCdpSqlAuthFromEnv` then requires `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` and uses `generateJwt` from the official `@coinbase/cdp-sdk/auth` subpath for the fixed `POST api.cdp.coinbase.com/platform/v2/data/query/run` target.

There is no automatic fallback from the default client-key mode to project credentials, no client-side variable, and no wallet secret. The SDK auth subpath is already installed and avoids importing the optional x402 entrypoint. The chain-data public entrypoint is guarded by `server-only`; operator scripts import the server implementation directly because they run only under Bun on the server.

## Safe operator commands

Configuration-only check (never sends a request):

```sh
bun --env-file=apps/web/.env.local scripts/cdp-sql-check.ts
```

For signed JWT configuration, set `CDP_SQL_AUTH_MODE=signed-jwt` in `apps/web/.env.local` (or explicitly in the command environment). Leaving the mode unset keeps the client-key default and does not reuse project credentials.

It prints only whether configuration is present, the selected auth mode, and `networkRequestMade: false`.

Opt-in smoke probe:

```sh
CDP_SQL_SMOKE=1 \
bun --env-file=apps/web/.env.local scripts/cdp-sql-smoke.ts
```

Put the selected auth mode and the three smoke inputs (`CDP_SQL_SMOKE_WALLET_ADDRESS`, `CDP_SQL_SMOKE_ASSET_ID`, and `CDP_SQL_SMOKE_ASSET_ADDRESS`) in `apps/web/.env.local`; do not place real values in the repository.

The smoke command refuses network access unless `CDP_SQL_SMOKE=1`. It sends one read-only query covering only the previous hour, one explicitly supplied allowlisted asset, one verified wallet, and at most two provider rows (`limit: 1` plus one row to determine `hasMore`). It requests the maximum documented cache age to avoid needless repeat execution. It prints only safe metadata: success/failure category, HTTP status when relevant, cache/stale state, execution timestamp/duration, returned-row count, and whether another page exists. It never prints the key, bearer value, SQL text, wallet, asset address, cursor, or customer rows.

Do not run the smoke command in CI or during ordinary local tests. The parent/operator should make at most one tiny authorized probe after confirming project entitlement.

## Schema and correctness notes

The template uses the currently documented `base.events` columns: `log_id`, block fields, transaction hash, log index, event signature, contract `address`, decoded `parameters`, and `action`. CDP documents `parameters` as a variant map and describes an event as active when actions for a log ID sum above zero. Values from `parameters['value']` are cast to strings in SQL. The schema documents `log_id` only as `String`, without a character-set guarantee, so row and cursor validation use the same non-empty 256-character local bound rather than rejecting otherwise safe string characters.

The live basic-table response reported `action` as a string field, but its actual value was intentionally not inspected or retained. The transfer template currently uses `sum(toInt8(action))`; whether live values are numeric strings compatible with that expression is unresolved. Do not silently change this to an `added`-only filter: the operator must inspect only the minimum action value/type needed to validate CDP's documented net-action semantics.

The query covers decoded ERC-20 transfer events only. It does not cover:

- native ETH transfers;
- logs that remain only in `base.encoded_logs`;
- protocol-specific vault, trade, borrow, or B20 semantics;
- Home operations that have not reached indexed chain data;
- ERC-4337 user-operation records.

For smart accounts, transfer participation can show token effects because the smart-account address appears in decoded event parameters. It does **not** make smart-account history complete. Bundled ERC-4337 activity must separately query `base.decoded_user_operations` by its documented `sender` field and correlate user-operation hashes, transaction hashes, and effects. Filtering only `base.transactions.from_address` would identify the bundler/EOA and can miss the user's smart account.

Re-org handling is limited to CDP's documented net-action semantics. Active logs are deduplicated by stable `log_id`; removed logs are omitted. The response still represents indexed history at `executionTimestamp`, not canonical confirmation authority. Recent actions must remain refreshable, and money-action status must be established from receipts/canonical chain evidence. If CDP changes action or log-ID semantics, fail validation/review the query rather than switching to added-only history.

## Error and caching behavior

- Local requests time out before CDP's documented 30-second server limit (10 seconds by default, configurable only up to 29 seconds).
- A 429 returns `rate-limited` and an optional parsed `retryAfterMs`; the transport does not poll or retry.
- A 408/504 or local abort returns `timed-out`.
- A 401/403 returns `unauthorized`; a 402 returns `payment-required`.
- Other non-success responses return a redacted `upstream-error`.
- The adapter itself has no persistence/cache fallback. A parent service may return previously stored history on transport failure only if it preserves the old execution timestamp and explicitly marks it stale. It must not present stale history as current balance or confirmation evidence.

## Verification status

Implemented and mocked:

- scoped SQL construction and injection rejection;
- allowlist, address, page, time, cursor, and cache bounds;
- lossless uint256/index parsing;
- keyset cursor creation;
- invalid/out-of-scope row rejection;
- response metadata validation and stale/cached distinction;
- fixed endpoint/auth request construction;
- signed-JWT callback request binding;
- timeout and single-attempt 429 behavior;
- credential/upstream-body redaction.

Verified live by the parent on 2026-09-07:

- the existing Home project credentials can generate a signed JWT accepted by the exact SQL endpoint;
- one bounded `SELECT * FROM base.events LIMIT 1` request returned HTTP 200;
- the response envelope contained `metadata` and `result` but no `schema`; only safe metadata/shape evidence was retained here, with no credential, bearer token, address, hash, or customer row value recorded.
- the complete bounded USDC transfer template compiled and returned a page with a follow-up cursor;
- two one-row pages from a fixed one-hour public zero-address issuance window returned distinct log IDs and string-valued amounts; no row contents were logged;
- `action` serializes as `"added"`; the documented database type is `Enum8('removed' = -1, 'added' = 1)`, and the template's numeric conversion succeeded live.

Pending live verification:

- decoded coverage for the operator's selected tokens and demo smart account;
- comparison of returned hashes and exact amounts with Base receipts;
- separate ERC-4337 sender history;
- observed re-org records and pagination through the chosen account's full supported history.

These checks were explicit, bounded read-only probes. They do not establish receipt-backed finality, complete smart-account history, or current spendable balances.

## Primary sources

- SQL quickstart and Client API key path: https://docs.cdp.coinbase.com/data/sql-api/quickstart
- Current SQL schema: https://docs.cdp.coinbase.com/data/sql-api/schema
- Run-query REST/OpenAPI reference, response envelope, signed-JWT scheme, timeout, row and cache limits: https://docs.cdp.coinbase.com/api-reference/v2/rest-api/sql-api/run-sql-query
- CDP server JWT generator type inspected locally: `apps/web/node_modules/@coinbase/cdp-sdk/_types/auth/utils/jwt.d.ts` from the already-installed `@coinbase/cdp-sdk` 1.55.0.

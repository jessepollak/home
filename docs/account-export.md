# Account data export

For deletion, retention and the provider/public-chain boundary, see [Leave Home](account-deletion.md).

`GET /api/account/export` requires a verified Home session and stays behind the existing deployment-access gate. It is not a public, webhook or machine route, so neither the access allowlist nor the unauthenticated firewall exemptions change. Query parameters and request bodies cannot select an owner. Responses, including authentication failures, are private and `no-store`.

## Schema and envelope

The shared parser is `shared/account/contracts/data-export.ts`. Version **1**, schema **`home.account-export`**. The envelope contains `version`, `schema`, `generatedAt` (server UTC ISO timestamp), `complete: true`, `classes` and `boundaries`. Home classes appear in the following order, including empty classes as `records: []`. Each entry has `name`, `holder: "home"` and an array of camelCase records. SQL numeric/bigint quantities, block numbers and log indexes are strings; ordinary integer IDs, chain IDs and safe integer metadata can be numbers. SQL timestamps become UTC ISO strings ending in `Z`.

Each class has a 50,000-record ceiling. Queries fetch at most ceiling + 1; overflow rejects the whole export, never silently truncates it. JSON projections are explicit allowlists, not provider payload dumps. Malformed selected values reject the export rather than returning an unsafe or partial file.

Export and deletion share `server/account-export/action-scope.ts`: legacy null-customer actions are scoped across every linked credential of C, including unrecorded wallets, using canonical Base owner-key subject/provider prefixes and suffixes. Invalid credential subjects and matching owner keys assigned to another non-null customer fail closed with `ACCOUNT_EXPORT_LINKAGE`. Cash-out orders and operator fees use all exported action IDs, with the same per-class caps; other subjects and the same subject under another provider remain excluded. Wallet snapshots/history in export remain restricted to recorded wallets.

## Class inventory

`C` means the resolved, unmerged Home customer; `credentials(C)` includes all linked credentials; `wallets(C)` includes only recorded wallets. `A` is the exported action IDs and `H` the exported history-address IDs. Listed field names are the exported names, not raw database names.

| Class | Table | Scope | Fields | Access index |
|---|---|---|---|---|
| customer | customers | id = C | id, status, country, inviteCode used at signup, firstSeenAt, lastSeenAt, firstSeenSource, createdAt | customers_pkey |
| credentials | customer_credentials | customer_id = C | id, accountProvider, subject, linkedVia, email, emailSource, firstSeenAt, lastSeenAt | customer_credentials_customer_idx |
| wallets | customer_wallets | customer_id = C | id, chainId, address, credentialId, createdAt | customer_wallets_customer_idx |
| preferences | customer_preferences | customer_id = C | countryPreference, createdAt, updatedAt | customer_preferences_pkey |
| invites | invite_codes | customer_id = C | code, createdAt | invite_codes_customer_id_key |
| email_requests | customer_email_requests | credential tuple in credentials(C) | accountProvider, subject, askedAt, answer, answerChannel, signInCapability, walletCode, walletMessage, bundleId, createdAt, updatedAt | customer_credentials_customer_idx; customer_email_requests_pkey |
| operator_events | operator_events | customer_id = C | name, occurredAt, source, sandbox; no props | operator_events_customer_time_idx |
| access_audit | admin_audit_log | target_kind = customer, target_id = C as text | occurredAt, action, purpose | admin_audit_export_target_idx |
| actions | actions | customer_id = C, or null customer_id with an exact authorized owner key or a credential-wide Base legacy key | id, accountAddress, provider, kind, safe summary, createdAt, confirmedAt, transactionHash, handleRecordedAt, declinedReportedAt, dispatchAttempt, outcome, outcomeSource, settledAt, outcomeRecordedAt, observedReceiptTransactionHash, observedReceiptBlockNumber, observedReceiptBlockHash, observedReceiptOutcome, observedAt | actions_customer_created_idx; actions_export_owner_idx; actions_legacy_owner_pattern_idx |
| cashout_orders | cashout_orders | action_id in A | actionId, providerId, environment, region, depositId, depositProven, state, platform, platformLabel, amountAtomic, filledAtomic, returnedAtomic, remainingAtomic, withdrawable, etaSeconds, createdAt, updatedAt, refreshedAt, settledAt, providerUpdatedAt | cashout_orders_pkey |
| operator_fees | operator_fee_records | action_id in A | id, actionId, actionKind, amountBaseUnits, tokenAssetId, tokenAddress, tokenDecimals, bps, recipient, collectedBy, recordedAt | operator_fee_records_action_id_key |
| funding_orders | funding_orders | customer_id = C, or null customer_id on credentials(C) | id, destination, providerId, region, assetId, paymentMethod, fiatAmount, safe quote and fees, state, creationBlock, providerOrderId, expectedTokenAmountAtomic, expiresAt, providerStatus, providerTransactionHash, transactionHash, logIndex, version, sandbox, createdAt, updatedAt, abandonReason, checkedAt | funding_orders_customer_created_idx; funding_orders_owner_open_idx |
| funding_provider_customers | funding_provider_customers | same customer/legacy credential rule | id, providerId, region, state, verificationStartedAt, createdAt, updatedAt; customerRef omitted conservatively | funding_provider_customers_customer_idx; funding_provider_customers_owner_region_idx |
| funding_provider_credentials | funding_provider_user_tokens | same customer/legacy credential rule | providerId, region, sandbox, returnedAt, updatedAt only | funding_provider_user_tokens_customer_idx; funding_provider_user_tokens_pkey |
| balance_snapshots | balance_snapshots | chain_id/address in wallets(C) | chainId, address, blockNumber, blockTimestamp, observedAt, safe holdings, coverage and borrow observations | customer_wallets_customer_idx; balance_snapshots_pkey |
| balance_history_addresses | history_addresses | chain_id/address in wallets(C) | id, chainId, address, windowStartBlock, windowStartAt, enrolledBlock, backfillBlock, forwardBlock, dirtyAt, ingestedAt, createdAt | customer_wallets_customer_idx; history_addresses_chain_id_address_key |
| balance_changes | balance_changes | address_id in H | addressId, assetId, blockNumber, logIndex, blockTime, transactionHash, delta, source | address hash partition pruning; balance_changes partition primary keys beginning address_id |
| balance_checkpoints | balance_checkpoints | address_id in H | addressId, assetId, blockNumber, purpose, chainQuantity, logQuantity, observedAt | balance_checkpoints_pkey |
| card_accounts | card_accounts | customer_id = C | mode, createdAt, updatedAt; provider customer/cardholder IDs omitted | card_accounts_pkey |
| cards | cards | customer_id = C | id, mode, stripeCardId, walletAddress, createdAt | cards_customer_mode_idx |
| card_events | card_events | bridge provider customer or cardholder + mode from C's card_accounts, or bridge provider card_id + mode from C's cards; overlapping events deduplicated | provider, mode, eventId, kind, cardId, transactionId, occurredAt, receivedAt; provider customer ID omitted | card_accounts_pkey; card_events_export_customer_idx; card_events_deletion_cardholder_idx; cards_customer_mode_idx; card_events_export_card_idx |
| card_transactions | card_transactions | card_id from C's cards | id, cardId, provider, mode, providerTransactionId, authorizationId, kind, amountMinor, currency, merchantName, merchantCategory, status, authorizationClosed, declineReasonCode, providerCreatedAt, updatedAt | cards_customer_mode_idx; card_transactions_card_time_idx |
| support_conversations | support_conversations | customer_id = C | id, status, handler, handedOffAt, createdAt, updatedAt, lastMessageAt, lastCustomerMessageAt, lastOperatorMessageAt, customerReadAt, resolvedAt | support_conversations_customer_id_key |
| support_messages | support_messages | C's conversations, status = sent | id, conversationId, authorType, status, body, createdAt | support_messages_conversation_recent_idx |
| support_assistant_runs | support_assistant_runs | C's conversations, message belongs to same conversation and is sent | id, conversationId, messageId, startedAt, replay | support_assistant_runs_budget_idx; support_messages primary/recent indexes |
| support_context_refs | support_context_refs | C's conversations, referenced action/order is also exported | id, conversationId, kind, refId, createdAt | support_context_refs_conversation_id_kind_ref_id_key |

Credential lookup uses the unique `(account_provider, subject)` index. Wallet-conflict lookup uses the unique `(chain_id, address)` index. Legacy funding conflict checks join credentials through their customer index to each funding table's credential-tuple index. Funding branches have separate limits and `UNION ALL` over disjoint customer/null-customer sets, retaining selective access instead of scanning a hashed owner subquery.

### JSON field allowlists

- Action summary: title, expiresAt; amounts: assetId, symbol, decimals, amountBaseUnits, direction, estimated, maximum; networkFee: payment, token, maxFeeBaseUnits, decimals. Metadata, warnings, signing data, calldata and pending payloads are not copied.
- Funding quote: fiatAmount, enteredFiatAmount, tokenAmountAtomic, feesKnown, expiresAt, fees. Quote and order fees: label, amount, currency. No quote identifier, customer reference, token or instructions/redirect URL.
- Snapshot holdings: key, kind, source, id, name, symbol, decimals, contractAddress, cashCurrency; balance, underlyingBalance and withdrawableBalance each contain status and baseUnits only. Coverage: registry and catalog. Borrow observations: nullable object with markets containing marketId and status; ready markets also include blockNumber, collateralRaw, debtAssetsRaw and borrowAprWad as exact decimal-integer strings. Unavailable balances retain baseUnits: null; unavailable markets have no quantities. Prices, image URLs and unrelated nested payloads are omitted.

Atomic amounts, block quantities and rates in JSON must be decimal-integer strings, never coerced numbers or booleans. Persisted funding fiat amounts and fees use exact decimal strings, including fractional values. Selected status and text fields must be strings, and required arrays must be arrays: null or missing arrays reject the export rather than fabricating empty lists.

## Linkage and consistency

Only the verified session's provider, subject and smart-account address participate in owner resolution. The credential must already exist. Its customer must exist and be unmerged. A recorded session wallet belonging to a different customer fails closed; an unrecorded session wallet is allowed without writing a record. Every exported wallet's credential must belong to C.

Legacy action keys are built with the existing actionOwnerKey format for each credential's bound Base wallet, plus the session's own credential/address pair. An action on one of these keys with a different non-null customer_id rejects the export. The same rule applies to funding orders, provider customers and provider user-token metadata on C's credential tuples. Non-null customer ownership never widens through legacy keys. No customer resolver, backfill, record writer or provider request runs during export.

One database transaction reads all classes. Its first application statements set `REPEATABLE READ, READ ONLY` and a local `10s` statement timeout. Every application query receives the request's abort signal. Any abort, failed query, failed transaction/commit or malformed selected data returns an error without a partial success envelope.

## Exclusions and boundaries

Never included: passwords, access/session/SDK/quote tokens, cookies, signing secrets, private keys, encrypted envelopes, provider raw payloads, webhook subscription secrets, support assistant credentials, operator credentials/identities, event props or unrelated customer references. Card PANs and ephemeral keys are not selected. Support drafts/discarded messages and runs tied to those messages are internal, so only sent message content and its run metadata are included. Cross-customer support references are excluded even if a conversation row names them. Global prices, asset catalogs and valuation series are not exported; an asset ID on an owned balance row is retained.

The response's boundary strings distinguish:

- **providerHeld:** records held by account, wallet, funding, card and other providers are not included; Home does not hold copies of provider documents.
- **publicChain:** onchain history is public on Base and Home cannot erase it.
- **currentDevice:** browser preferences cover only the device making the export.

The client appends `device_preferences` and `device_caches` with `holder: "current-device"` before downloading the file. These describe the current browser's preferences and Home cache inventory, not provider data, credentials, another browser or a second server-side owner. The server response deliberately contains only the 26 Home classes. Cache `present` is `true`, `false` or `null`: `null` means inspection was unavailable, not that the cache is absent. This applies equally to denied local storage, denied cookie access and IndexedDB errors. IndexedDB inspection has a 1,500 ms deadline and follows the export's abort signal, including database discovery, opening and reading; late-opening connections are closed. A device inspection failure does not prevent a complete Home export, while logout or owner-switch aborts still discard the fenced download.

## Errors

| HTTP | Code | Meaning |
|---|---|---|
| 409 | ACCOUNT_EXPORT_LINKAGE | Absent, merged, conflicting or inconsistent customer linkage |
| 413 | ACCOUNT_EXPORT_TOO_LARGE | Any class exceeds its ceiling |
| 503 | ACCOUNT_EXPORT_UNAVAILABLE | Database unset, query/transaction failure, abort or malformed data |

Authentication errors retain their HTTP status with generic private error text. Export errors and logs contain no row data, subject, wallet address, email or customer ID.

## SQL validation and rollout

Migration `023_account_export_indexes.sql` adds four query-required indexes absent from the prior schema: unfiltered action owner lookup (the old owner index covers confirmed actions only), audit target lookup (the old index leads actor), provider/mode/customer event lookup, and mode/card event lookup. It uses ordinary `CREATE INDEX IF NOT EXISTS` because the migration runner wraps migrations in a transaction. Existing customer, credential, wallet, action-child, funding, history, card and support indexes are reused.

The additive indexes require production rollout review: ordinary builds take table locks and add storage/write cost; synthetic local timings are not proof of live build safety. No production database was modified. On large live tables, the owner must arrange an approved rollout compatible with the transactional runner before deploying this migration; do not insert CONCURRENTLY into it.

Representative local EXPLAIN evidence covers exact queries with 3,002 synthetic owners, roughly 3,000 records per growing class, 300,002 balance changes, half legacy funding rows, common/empty scopes and a 257-action skew. Balance reads prune and use the address-leading partition primary key. Common point-owner queries use selective existing/new indexes. At 257 requested actions out of about 3,000 rows, PostgreSQL can choose a sequential scan for conflict checks and child-table ANY lookups (about 0.3ms or less locally): this is a measured broad-result choice for an intentional bounded bulk export, not a claim that indexes always win. Cap + 1 bounds records returned; the transaction's per-statement timeout bounds database work. Full-cap performance and production index-build duration remain unverified.

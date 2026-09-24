# Server secrets at rest

Home encrypts Coinbase Embedded Orders `userAuthToken` in `funding_provider_user_tokens` with AES-256-GCM. The key is held in server environment variables, not in PostgreSQL. This protects against database-only exposure, **not** a compromised Vercel project, server process, or key-bearing deployment; there is no KMS. Public orders, quote tokens, shared funding contracts, and structured logs never carry the credential.

## Provisioning gate

Before enabling production keys, run a **non-funded Coinbase sandbox check** to confirm the top-level response token is returned and a later create for the same user and wallet can reuse it. This change does not authorize production enablement or a funded transaction. Until this check and key provisioning, create works without token persistence.

Generate a key as 32 random bytes, strict unpadded base64url (`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`). Configure `HOME_SECRET_ENCRYPTION_KEY` and `HOME_SECRET_KEY_VERSION=1`; omit `HOME_SECRET_ENCRYPTION_KEY_PREVIOUS` initially. Every deployment **writing the same `DATABASE_URL` must share the same key set and version**. Do not configure a preview writing a shared database with an unrelated same-version key. Missing or malformed configuration disables token reads and writes, but funding orders proceed normally.

Each envelope is `vN.iv.tag.ciphertext` with authenticated purpose and the complete owner account-provider, owner subject, provider ID, region, sandbox mode, and lowercase destination. Reuse ends locally at 55 days after the token was first returned, even though Coinbase's documented validity is 60 days; when a later create echoes the same token, the original `returned_at` is kept so repeat purchases cannot extend the limit. A new destination has no reuse; a provider rejection after a reused token compare-deletes that exact envelope for the next purchase, with no redispatch. Ambiguous creates retain the credential. A capture replaces only the envelope that create read before dispatch (or inserts only when it read no row), so a stale response from an overlapping create loses to a token already captured by another create. Unreadable ciphertext is preserved for recovery and falls back to hosted verification. Captures do not overwrite unreadable rows; operators delete unrecoverable rows using the store delete path.

## Rotate and verify

1. Set `HOME_SECRET_ENCRYPTION_KEY_PREVIOUS` to the old key, `HOME_SECRET_ENCRYPTION_KEY` to a **new** key, and `HOME_SECRET_KEY_VERSION` to N+1 on all writers, then deploy. The previous key decrypts N only; it never encrypts new rows.
2. With database access and the same environment, run `bun run --cwd apps/web secrets:rotate rotate`. This processes deterministic primary-key batches with compare-and-swap; unreadable rows stay untouched. Repeat if concurrent writes or rotations require another pass.
3. Run `bun run --cwd apps/web secrets:rotate verify` until `not-at-active=0 unreadable=0` and exit status is zero. Only then remove `HOME_SECRET_ENCRYPTION_KEY_PREVIOUS` from all deployments. Commands print counts only, never credentials.

If a key is lost, unreadable rows remain a harmless verification fallback. Delete affected owner rows with `bun run --cwd apps/web secrets:rotate delete --account-provider base-account --subject SUBJECT --provider coinbase --region US --sandbox false`, or explicitly truncate `funding_provider_user_tokens` after operator approval; customers re-verify. Use the same delete command for a per-owner deletion, repeating for each known provider, region and sandbox binding. Do not log subjects or envelopes in operational reports.

Sibling work #570/#627 will use this provider-agnostic primitive for `webhook_subscriptions.secret` separately; this migration does not touch those rows.

# SQL performance

Growing request-path data must have bounded, selective access through an appropriate index or provider partition/index. When a new query needs an index Home does not have, ship the index and query together. A WHERE clause, a LIMIT, an existing index on some column, or a successful tiny-fixture query is not performance evidence.

## Home-owned PostgreSQL

Before adding or changing a query, identify the table's expected growth, owner/key predicates, joins, ordering, page size and deadline. Reuse primary/unique indexes when they cover the access pattern. For B-tree indexes, put equality predicates on leading columns, followed by the range/order keys; verify the actual plan. Avoid functions or casts on indexed predicate columns unless the matching expression index is deliberate. Keep normalization on inputs where the stored representation supports it. Partial-index predicates must match the query. An index on a foreign key's referenced table does not establish efficient access to the referencing rows.

Use keyset pagination with a stable tie-breaker for growing feeds. Select only required columns. Batch lookups rather than issuing a query per row. Keep deadlines and page bounds explicit; LIMIT caps returned rows, but a preceding scan, join, sort or aggregation can still process the whole table.

Measure the exact parameterized query on a disposable database loaded through Home's migration helper, with representative synthetic size, owner distribution and skew. Run ANALYZE after loading data. Capture EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) for read-only SELECTs, including common and worst supported parameters and an empty-result case. Record index names/conditions, rows scanned versus returned, buffer reads, sort/spill work and elapsed time. Compare before/after when adding an index. Never disable sequential scans to manufacture acceptance. Plan costs and small-table choices are not fixed snapshots; test the selective access property on representative data when regression coverage is needed.

For writes, use plain EXPLAIN for inspection or execute ANALYZE only in a disposable database: EXPLAIN ANALYZE actually executes the statement. Do not use production write statements as performance probes.

Sequential scans need a specific justification: a genuinely small bounded configuration table, an intentional bulk/background operation with a work budget, or a measured planner choice that is cheaper for a broad result. A table that is small only in tests is not an exception. Do not force every plan node to be an Index Scan; joins and aggregates can correctly use other nodes.

Add a new immutable migration when an index is missing. Check existing overlapping indexes, added storage and write amplification, build time, lock impact and rollout order. Home's current migration runner wraps migrations in a transaction; CREATE INDEX CONCURRENTLY cannot run there. A large live-table index that needs a concurrent build requires an explicit compatible rollout/runbook, not a concurrent statement slipped into the current runner. Do not change applied migrations or add speculative indexes without a query and plan that use them.

## Provider-hosted SQL

Home does not own CDP's schema or index DDL. Use the provider's documented indexed/pruning fields and prove bounded query behavior. CDP documents event_signature, address and block_timestamp for Base events. A decoded wallet condition in parameters is an account-scope filter, not proof of a wallet index. Keep exact wallet/asset scope, reorg cancellation and pagination correctness while narrowing the scan.

Activity Base event SQL is owned by `server/chain-data/base-erc20-transfers.ts`; the query builder enforces a seven-day maximum per scan and opaque cursors retain full onchain history through adjacent chunks (31 days for legacy clients). A provider capacity rejection (HTTP 400 or 413 other than a recognized syntax rejection) halves that request's scan up to three times, to about 21 hours for a full seven-day chunk, before failing. Narrowed continuations remain contiguous, and the next request starts again with the seven-day maximum. `home/bounded-cdp-event-query` prevents static event queries outside that adapter. Preserve both the scan cap and chunk/row continuation when changing the query; a larger supported history window must never become a larger individual scan. See [CDP SQL](cdp-sql.md#bounded-activity-scans) for full-history opt-in, cache separation and continuation budgets.

Use the narrowest supported time window, projected columns and bounded pages; select a provider table/API intended for the access pattern when a broad events scan remains expensive. Verify the source's semantics before substituting it. Do not widen a window or retry an expensive rejected scan until it happens to succeed. LIMIT after grouped net-action selection does not bound the underlying event scan. Record safe timing, row/page counts, cache state and any resource-limit outcome from a minimal authorized read-only probe. Cached success is not cold-query evidence. No raw provider SQL containing customer parameters, result rows or credentials belongs in public artifacts.

Follow [CDP SQL](cdp-sql.md) for auth, probe bounds and known older-window scan failures. If a query cannot be made sufficiently selective on provider-owned data, change the supported access pattern or explicitly report the limitation; do not claim Home can add the provider's missing index.

## Review and CI

For each changed query, reviewers verify the access path and index migration or documented exception. Include the evidence under the PR's collapsed Evidence section and exactly one visible summary line:

- `SQL-performance: verified — <query/module, index or provider pruning fields, representative data/window, plan/probe results and evidence pointer>`
- `SQL-performance: not-verified — <exact missing database/provider access or evidence and remaining validation>`
- `SQL-performance: not-applicable — <why this detected change does not alter SQL access, such as a formatting-only module edit>`

A blocked line is an honest draft result, not performance acceptance. New growing-data queries cannot use not-applicable to avoid plan validation. Keep synthetic plans and specific index names public-safe; retain useful reproducible tests rather than noisy full plan snapshots. No customer rows are needed.

The SQL performance CI gate inspects changed production server modules for SQL-looking string/template literals, and all server SQL files, including migrations. It is intentionally conservative: any edit to a detected SQL-bearing module requires the summary, even when the SQL itself is unchanged. Tests, fixtures and docs are excluded. It accepts the three explicit dispositions above and rejects absent, duplicate, hidden or malformed lines. It verifies evidence presence, not whether a database selects an index. Runtime-generated SQL without a recognizable literal, indirect changes to parameters/helpers in another module, provider schema changes and changes outside server paths need manual review; detection is not a complete SQL call graph. The guidance applies whether or not the detector finds a query.

## References

- [PostgreSQL 14: Using EXPLAIN](https://www.postgresql.org/docs/14/using-explain.html)
- [PostgreSQL 14: Multicolumn indexes](https://www.postgresql.org/docs/14/indexes-multicolumn.html)
- [PostgreSQL 14: CREATE INDEX and concurrent build constraints](https://www.postgresql.org/docs/14/sql-createindex.html)
- [CDP SQL: Best practices](https://docs.cdp.coinbase.com/data/sql-api/best-practices)

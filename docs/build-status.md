# Build status

Snapshot: September 12, 2026.

Home is a local app, not a production authorization. It has the persistent shell, verified wallet sessions, wallet and savings balances, Activity, send and savings action flows, bounded Borrow, and provider-backed funding surfaces. Availability still depends on the verified session, configured provider credentials, and the relevant product gate.

Actions use the thin model: one confirmed `actions` row, server-authored calldata, client dispatch through CDP or Base, and provider/chain-derived status. `DATABASE_URL` is required for actions; the database is disposable. See [Home is thin](home-is-thin.md).

`bun check` and the mocked browser smoke provide local regression coverage. No live funded wallet, provider, production deployment, or end-to-end settlement acceptance is implied.

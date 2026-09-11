# Send recovery history

Send admission uses a dedicated read-only view of the authenticated account's durable money actions:

```text
GET /api/actions/operations?scope=unresolved-send&limit=50
```

The handler authenticates first and derives the owner tuple from the verified session. Query parameters cannot select another owner or wallet. The `unresolved-send` scope filters to `send` actions in `submitting`, `submitted`, `included`, or `unknown` status that have not been owner-abandoned (`abandonedAt`) before applying the bounded limit, then preserves the existing newest-first ordering. Abandonment releases this gate only; it does not expire or cancel chain execution.

A scoped response is explicitly identified:

```json
{
  "scope": "unresolved-send",
  "operations": []
}
```

The ordinary operations endpoint (`scope` absent) still uses the `{ "operations": [...] }` envelope and the existing default limit. It is a display filter for Activity: pre-chain `rejected` / `expired` / failed-without-execution-reference rows are omitted; confirmed success and failed-onchain remain. `MoneyActionStore` records are not deleted. `scope=unresolved-send` is unchanged.

The Send UI requires the scoped response before preparing a durable send. A failed request, an unknown scope, a generic history response, or a malformed scoped record keeps admission closed. A recovered action is check-only and does not prepare or broadcast a new action.

This recovery view prevents newer terminal or non-send history from hiding an older unresolved send. It does not serialize independently created concurrent intents or change global claim and dispatch semantics.

<!-- vercel preview rebuild 2026-09-10 #165 -->

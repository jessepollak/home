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

The ordinary operations endpoint remains unchanged when `scope` is absent: it returns recent owner history with the existing default limit and `{ "operations": [...] }` envelope.

The Send UI requires the scoped response before preparing a durable send. A failed request, an unknown scope, a generic history response, or a malformed scoped record keeps admission closed. A recovered action is check-only and does not prepare or broadcast a new action.

This recovery view prevents newer terminal or non-send history from hiding an older unresolved send. It does not serialize independently created concurrent intents or change global claim and dispatch semantics.

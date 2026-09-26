import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { CardObservation } from "./provider";

export function createCardEventStore(sql: Pick<SqlExecutor, "query">) {
  return {
    async insert(event: CardObservation): Promise<boolean> {
      await sql.query("DELETE FROM card_events WHERE ctid IN (SELECT ctid FROM card_events WHERE received_at < now() - interval '30 days' LIMIT 100)");
      const result = await sql.query(
        `INSERT INTO card_events (provider, mode, event_id, kind, cardholder_account_id, card_id, transaction_id, customer_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (provider, mode, event_id) DO NOTHING`,
        [event.provider, event.mode, event.eventId, event.kind, event.externalIds.cardholder,
          event.externalIds.card, event.externalIds.transaction, event.externalIds.customer, event.occurredAt],
      );
      return result.rowCount === 1;
    },
  };
}

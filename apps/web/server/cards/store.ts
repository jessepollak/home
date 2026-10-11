import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { CardObservation } from "./provider";

export function createCardEventStore(sql: Pick<SqlExecutor, "query">) {
  return {
    async insert(event: CardObservation): Promise<boolean> {
      await sql.query(`DELETE FROM card_events WHERE ctid IN (
        SELECT e.ctid FROM card_events e WHERE e.received_at < now() - interval '30 days'
          AND (e.transaction_id IS NULL OR (e.kind NOT LIKE 'issuing_authorization.%' AND e.kind NOT LIKE 'issuing_transaction.%')
            OR EXISTS (SELECT 1 FROM cards c JOIN card_transactions t ON t.card_id=c.id
              WHERE c.stripe_card_id=e.card_id AND c.mode=e.mode AND t.provider=e.provider AND t.mode=e.mode
                AND t.provider_transaction_id=e.transaction_id AND t.status IN ('completed','declined','reversed','refunded') AND t.updated_at>=e.received_at))
        LIMIT 100)`);
      const result = await sql.query(
        `WITH live_accounts AS (
           SELECT ca.customer_id FROM card_accounts ca JOIN customers c ON c.id=ca.customer_id
           WHERE ca.mode=$2 AND c.retained_until IS NULL AND
             (($8::text IS NOT NULL AND ca.bridge_customer_id=$8) OR ($5::text IS NOT NULL AND ca.stripe_cardholder_id=$5)
               OR EXISTS (SELECT 1 FROM cards card WHERE card.customer_id=ca.customer_id AND card.mode=ca.mode AND card.stripe_card_id=$6))
           FOR UPDATE OF ca
         ) INSERT INTO card_events (provider, mode, event_id, kind, cardholder_account_id, card_id, transaction_id, customer_id, occurred_at)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS (SELECT 1 FROM live_accounts)
         ON CONFLICT (provider, mode, event_id) DO NOTHING`,
        [event.provider, event.mode, event.eventId, event.kind, event.externalIds.cardholder,
          event.externalIds.card, event.externalIds.transaction, event.externalIds.customer, event.occurredAt],
      );
      return result.rowCount === 1;
    },
  };
}

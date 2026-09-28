import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { ImmersveMode } from "./config";

export type CardEvent = Readonly<{
  mode: ImmersveMode;
  messageId: string;
  topic: string;
  cardholderAccountId: string | null;
  cardId: string | null;
  paymentId: string | null;
}>;

export function createCardEventStore(sql: Pick<SqlExecutor, "query">) {
  return {
    async insert(event: CardEvent): Promise<boolean> {
      await sql.query("DELETE FROM card_events WHERE ctid IN (SELECT ctid FROM card_events WHERE received_at < now() - interval '30 days' LIMIT 100)");
      const result = await sql.query(
        `INSERT INTO card_events (mode, message_id, topic, cardholder_account_id, card_id, payment_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (mode, message_id) DO NOTHING`,
        [event.mode, event.messageId, event.topic, event.cardholderAccountId, event.cardId, event.paymentId],
      );
      return result.rowCount === 1;
    },
  };
}

import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { CardMode } from "./provider";
import type { CardPurchase } from "@/shared/cards/transactions-contract";
import type { ProgramPurchase } from "./program";
import type { CardProviderName, CardObservation } from "./provider";
import { isProgramPurchase } from "./purchases";

type Row = { id: string; kind: CardPurchase["kind"]; amount_minor: string; currency: string; merchant_name: string;
  merchant_category: string | null; status: CardPurchase["status"]; decline_reason_code: string | null; provider_created_at: Date; updated_at: Date;
  authorization_id: string | null };

export function createCardTransactionStore(sql: Pick<SqlExecutor, "query">) {
  return {
    async cards(customerId: string, mode: CardMode) {
      const result = await sql.query<{ id: string; provider: CardProviderName; provider_card_id: string }>(
        "SELECT id, provider, provider_card_id FROM cards WHERE customer_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT 3", [customerId, mode]);
      return result.rows;
    },
    async pending(cardId: string, mode: CardMode) {
      const result = await sql.query<{ transaction_id: string; kind: string; provider: CardProviderName; event_id: string; card_id: string; occurred_at: Date }>(
        `SELECT e.transaction_id,e.kind,e.provider,e.event_id,e.card_id,e.occurred_at FROM cards c JOIN card_events e ON c.provider=e.provider AND c.provider_card_id=e.card_id AND c.mode=e.mode
         LEFT JOIN card_transactions t ON t.card_id=c.id AND t.provider=e.provider AND t.mode=e.mode AND t.provider_transaction_id=e.transaction_id
         WHERE c.id=$1 AND e.mode=$2 AND e.card_id IS NOT NULL AND e.transaction_id IS NOT NULL
           AND (t.id IS NULL OR t.updated_at < e.received_at)
         ORDER BY e.received_at ASC, e.event_id ASC LIMIT 11`, [cardId, mode]);
      return result.rows.map((row): CardObservation => ({ provider: row.provider, mode, eventId: row.event_id, kind: row.kind,
        occurredAt: new Date(row.occurred_at).toISOString(), externalIds: { card: row.card_id, transaction: row.transaction_id, customer: null, cardholder: null } }));
    },
    async upsert(cardId: string, mode: CardMode, provider: CardProviderName, purchase: ProgramPurchase) {
      if (!isProgramPurchase(purchase)) throw new Error("Invalid program purchase");
      const result = await sql.query(
        `INSERT INTO card_transactions (card_id,provider,mode,provider_transaction_id,authorization_id,kind,amount_minor,currency,merchant_name,merchant_category,status,decline_reason_code,provider_created_at)
         SELECT c.id,$14,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 FROM cards c
         WHERE c.id=$1 AND c.mode=$2 AND c.provider_card_id=$13 AND c.provider=$14
         ON CONFLICT (provider,mode,provider_transaction_id) DO UPDATE SET
         amount_minor=EXCLUDED.amount_minor, currency=EXCLUDED.currency, merchant_name=EXCLUDED.merchant_name,
         merchant_category=EXCLUDED.merchant_category, status=EXCLUDED.status, decline_reason_code=EXCLUDED.decline_reason_code,
         authorization_id=EXCLUDED.authorization_id, updated_at=now()
         WHERE card_transactions.card_id=EXCLUDED.card_id`,
        [cardId, mode, purchase.id, purchase.authorizationId, purchase.kind, purchase.amountMinor, purchase.currency,
          purchase.merchantName, purchase.merchantCategory, purchase.status, purchase.declineReasonCode, purchase.createdAt, purchase.cardId, provider]);
      if (result.rowCount !== 1) throw new Error("Card purchase owner mismatch");
    },
    async rows(customerId: string, mode: CardMode, window?: { from: string; to: string }): Promise<CardPurchase[]> {
      const result = await sql.query<Row>(
        `SELECT t.id,t.kind,t.amount_minor::text,t.currency,t.merchant_name,t.merchant_category,t.status,t.decline_reason_code,t.provider_created_at,t.updated_at,t.authorization_id
         FROM card_transactions t JOIN cards c ON c.id=t.card_id
         WHERE c.customer_id=$1 AND c.mode=$2 AND t.mode=$2 AND t.provider=c.provider
         AND ($3::timestamptz IS NULL OR t.provider_created_at >= $3)
         AND ($4::timestamptz IS NULL OR t.provider_created_at < $4)
         AND NOT (t.kind='authorization' AND EXISTS (
           SELECT 1 FROM card_transactions newer WHERE newer.card_id=t.card_id AND newer.provider=t.provider AND newer.mode=t.mode AND newer.authorization_id=t.authorization_id
             AND newer.kind='transaction'))
         ORDER BY t.provider_created_at DESC,t.provider_transaction_id DESC LIMIT 50`, [customerId, mode, window?.from ?? null, window?.to ?? null]);
      return result.rows.map((row) => ({ id: row.id, kind: row.kind, amountMinor: row.amount_minor,
        currency: row.currency, merchantName: row.merchant_name, merchantCategory: row.merchant_category,
        status: row.status, declineReasonCode: row.decline_reason_code,
        createdAt: new Date(row.provider_created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }));
    },
  };
}

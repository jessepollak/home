import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { CardMode } from "./provider";
import type { CardPurchase } from "@/shared/cards/transactions-contract";
import type { StripePurchase } from "./stripe/transactions";

type Row = { provider_transaction_id: string; kind: CardPurchase["kind"]; amount_minor: string; currency: string; merchant_name: string;
  merchant_category: string | null; status: CardPurchase["status"]; decline_reason_code: string | null; provider_created_at: Date; updated_at: Date;
  authorization_id: string | null };

export function createCardTransactionStore(sql: Pick<SqlExecutor, "query">) {
  return {
    async cards(customerId: string, mode: CardMode) {
      const result = await sql.query<{ id: string; stripe_card_id: string }>(
        "SELECT id, stripe_card_id FROM cards WHERE customer_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT 3", [customerId, mode]);
      return result.rows;
    },
    async pending(cardId: string, mode: CardMode) {
      const result = await sql.query<{ transaction_id: string; kind: string }>(
        `SELECT e.transaction_id, e.kind FROM card_events e JOIN cards c ON c.stripe_card_id=e.card_id
         LEFT JOIN card_transactions t ON t.card_id=c.id AND t.provider='bridge' AND t.mode=e.mode AND t.provider_transaction_id=e.transaction_id
         WHERE c.id=$1 AND e.mode=$2 AND e.provider='bridge' AND e.transaction_id IS NOT NULL
           AND (e.kind LIKE 'issuing_authorization.%' OR e.kind LIKE 'issuing_transaction.%')
           AND (t.id IS NULL OR t.updated_at < e.received_at)
         ORDER BY e.received_at ASC, e.event_id ASC LIMIT 11`, [cardId, mode]);
      return result.rows;
    },
    async upsert(cardId: string, mode: CardMode, purchase: StripePurchase) {
      const result = await sql.query(
        `INSERT INTO card_transactions (card_id,provider,mode,provider_transaction_id,authorization_id,kind,amount_minor,currency,merchant_name,merchant_category,status,decline_reason_code,provider_created_at)
         SELECT c.id,'bridge',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 FROM cards c
         WHERE c.id=$1 AND c.mode=$2 AND c.stripe_card_id=$13
         ON CONFLICT (provider,mode,provider_transaction_id) DO UPDATE SET
         amount_minor=EXCLUDED.amount_minor, currency=EXCLUDED.currency, merchant_name=EXCLUDED.merchant_name,
         merchant_category=EXCLUDED.merchant_category, status=EXCLUDED.status, decline_reason_code=EXCLUDED.decline_reason_code,
         authorization_id=EXCLUDED.authorization_id, updated_at=now()
         WHERE card_transactions.card_id=EXCLUDED.card_id`,
        [cardId, mode, purchase.id, purchase.authorizationId, purchase.kind, purchase.amountMinor, purchase.currency,
          purchase.merchantName, purchase.merchantCategory, purchase.status, purchase.declineReasonCode, purchase.createdAt, purchase.cardId]);
      if (result.rowCount !== 1) throw new Error("Card purchase owner mismatch");
    },
    async rows(customerId: string, mode: CardMode, window?: { from: string; to: string }): Promise<CardPurchase[]> {
      const result = await sql.query<Row>(
        `SELECT t.provider_transaction_id,t.kind,t.amount_minor::text,t.currency,t.merchant_name,t.merchant_category,t.status,t.decline_reason_code,t.provider_created_at,t.updated_at,t.authorization_id
         FROM card_transactions t JOIN cards c ON c.id=t.card_id
         WHERE c.customer_id=$1 AND c.mode=$2 AND t.mode=$2 AND t.provider='bridge'
         AND ($3::timestamptz IS NULL OR t.provider_created_at >= $3)
         AND ($4::timestamptz IS NULL OR t.provider_created_at < $4)
         AND NOT (t.kind='authorization' AND EXISTS (
           SELECT 1 FROM card_transactions newer WHERE newer.card_id=t.card_id AND newer.authorization_id=t.authorization_id
             AND newer.kind='transaction'))
         ORDER BY t.provider_created_at DESC,t.provider_transaction_id DESC LIMIT 50`, [customerId, mode, window?.from ?? null, window?.to ?? null]);
      return result.rows.map((row) => ({ id: row.provider_transaction_id, kind: row.kind, amountMinor: row.amount_minor,
        currency: row.currency, merchantName: row.merchant_name, merchantCategory: row.merchant_category,
        status: row.status, declineReasonCode: row.decline_reason_code,
        createdAt: new Date(row.provider_created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }));
    },
  };
}

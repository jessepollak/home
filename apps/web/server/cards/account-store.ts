import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { CardMode } from "./provider";

export type CardAccountLink = Readonly<{
  bridgeCustomerId: string | null;
  stripeCardholderId: string | null;
  cards: ReadonlyArray<Readonly<{ id: string; stripeCardId: string; walletAddress: string }>>;
}>;

export function createCardAccountStore(sql: Pick<SqlExecutor, "query">) {
  return {
    async read(customerId: string, mode: CardMode): Promise<CardAccountLink | null> {
      const account = await sql.query<{ bridge_customer_id: string | null; stripe_cardholder_id: string | null }>(
        "SELECT bridge_customer_id, stripe_cardholder_id FROM card_accounts WHERE customer_id=$1 AND mode=$2",
        [customerId, mode],
      );
      if (!account.rows[0]) return null;
      const cards = await sql.query<{ id: string; stripe_card_id: string; wallet_address: string }>(
        "SELECT id, stripe_card_id, wallet_address FROM cards WHERE customer_id=$1 AND mode=$2 ORDER BY created_at, id",
        [customerId, mode],
      );
      return { bridgeCustomerId: account.rows[0].bridge_customer_id,
        stripeCardholderId: account.rows[0].stripe_cardholder_id,
        cards: cards.rows.map((card) => ({ id: card.id, stripeCardId: card.stripe_card_id, walletAddress: card.wallet_address })) };
    },
  };
}

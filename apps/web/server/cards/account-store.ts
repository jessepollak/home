import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { CardMode, CardProviderName } from "./provider";
import type { ProgramLink } from "./program";

export type CardAccountLink = ProgramLink & Readonly<{
  provider: CardProviderName;
  cards: ReadonlyArray<Readonly<{ id: string; providerCardId: string; walletAddress: string }>>;
}>;

export function createCardAccountStore(sql: Pick<SqlExecutor, "query">) {
  return {
    async read(customerId: string, mode: CardMode, signal?: AbortSignal, lock = false): Promise<CardAccountLink | null> {
      const account = await sql.query<{ provider: CardProviderName; provider_account_id: string | null; provider_cardholder_id: string | null }>(
        `SELECT provider,provider_account_id,provider_cardholder_id FROM card_accounts WHERE customer_id=$1 AND mode=$2${lock ? " FOR UPDATE" : ""}`,
        [customerId, mode], { signal },
      );
      if (!account.rows[0]) return null;
      const cards = await sql.query<{ id: string; provider_card_id: string; wallet_address: string }>(
        "SELECT id,provider_card_id,wallet_address FROM cards WHERE customer_id=$1 AND mode=$2 ORDER BY created_at,id",
        [customerId, mode], { signal },
      );
      return { customerId, mode, provider: account.rows[0].provider, accountId: account.rows[0].provider_account_id,
        cardholderId: account.rows[0].provider_cardholder_id,
        cards: cards.rows.map((card) => ({ id: card.id, providerCardId: card.provider_card_id, walletAddress: card.wallet_address })) };
    },
    async update(link: ProgramLink, fields: Partial<Pick<ProgramLink, "accountId" | "cardholderId">>) {
      if (fields.accountId !== undefined && link.accountId && fields.accountId !== link.accountId ||
          fields.cardholderId !== undefined && link.cardholderId && fields.cardholderId !== link.cardholderId) throw new Error("Card account mismatch");
      await sql.query("UPDATE card_accounts SET provider_account_id=$3,provider_cardholder_id=$4,updated_at=now() WHERE customer_id=$1 AND mode=$2",
        [link.customerId, link.mode, fields.accountId ?? link.accountId, fields.cardholderId ?? link.cardholderId]);
    },
  };
}

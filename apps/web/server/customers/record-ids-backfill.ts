import "server-only";

import type { SqlExecutor } from "@/server/db/sql";

const owners = {
  actions: { provider: "a.owner_key::jsonb->>3", subject: "a.owner_key::jsonb->>0", address: "COALESCE(a.account_address,a.owner_key::jsonb->>1)" },
  funding_orders: { provider: "a.account_provider", subject: "a.owner_subject", address: "a.destination" },
  funding_provider_customers: { provider: "a.account_provider", subject: "a.owner_subject", address: null },
  funding_provider_user_tokens: { provider: "a.account_provider", subject: "a.owner_subject", address: "a.destination" },
} as const;

type Table = keyof typeof owners;
type Counts = Record<Table, number>;

export async function backfillRecordCustomerIds(sql: SqlExecutor): Promise<{ updated: Counts; unresolved: Counts }> {
  const updated = {} as Counts;
  const unresolved = {} as Counts;
  for (const table of Object.keys(owners) as Table[]) {
    const { provider, subject, address } = owners[table];
    const wallet = address
      ? `(SELECT w.id FROM customer_wallets w WHERE w.chain_id=8453 AND w.address=lower(${address}) AND w.credential_id=cr.id)`
      : "NULL::uuid";
    const first = await sql.query(`UPDATE ${table} a SET customer_id=cr.customer_id, credential_id=cr.id,
      wallet_id=${wallet} FROM customer_credentials cr
      WHERE a.customer_id IS NULL AND cr.account_provider=${provider} AND cr.subject=${subject}`);
    const wallets = address ? await sql.query(`UPDATE ${table} a SET wallet_id=${wallet}
      FROM customer_credentials cr WHERE a.customer_id IS NOT NULL AND a.wallet_id IS NULL
      AND cr.id=a.credential_id AND cr.customer_id=a.customer_id
      AND cr.account_provider=${provider} AND cr.subject=${subject}
      AND EXISTS (SELECT 1 FROM customer_wallets w WHERE w.chain_id=8453 AND w.address=lower(${address}) AND w.credential_id=cr.id)`) : null;
    updated[table] = first.rowCount + (wallets?.rowCount ?? 0);
    unresolved[table] = Number((await sql.query<{ count: number }>(`SELECT count(*)::integer AS count FROM ${table} WHERE customer_id IS NULL`)).rows[0]?.count ?? 0);
  }
  return { updated, unresolved };
}

import "server-only";

import type { SqlExecutor } from "@/server/db/sql";

export async function lockWalletAddress(sql: SqlExecutor, chainId: number, address: string): Promise<void> {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`home.customer-wallet.v1:${chainId}:${address.toLowerCase()}`]);
}

import "server-only";

import type { AccountProvider, VerifiedAccountSession } from "@/shared/account/session-types";
import { actionOwnerKey } from "@/server/actions/store";
import type { SqlExecutor } from "@/server/db/sql";
import { AccountExportError } from "./errors";

type Credential = { id: string; account_provider: AccountProvider; subject: string; linked_via: string; email: string | null; email_source: string | null; first_seen_at: Date; last_seen_at: Date };
type Wallet = { id: string; chain_id: number; address: `0x${string}`; credential_id: string; created_at: Date };
export type ExportScope = { customerId: string; ownerKeys: string[]; credentials: Credential[]; wallets: Wallet[] };

export async function resolveExportOwner(sql: SqlExecutor, session: VerifiedAccountSession, cap: number, signal?: AbortSignal): Promise<ExportScope> {
  const options = { signal };
  const credential = (await sql.query<{ customer_id: string }>(
    "SELECT customer_id FROM customer_credentials WHERE account_provider=$1 AND subject=$2",
    [session.accountProvider, session.user.subject], options,
  )).rows[0];
  if (!credential) throw new AccountExportError("ACCOUNT_EXPORT_LINKAGE");
  const customer = (await sql.query<{ id: string; merged_into: string | null }>(
    "SELECT id,merged_into FROM customers WHERE id=$1", [credential.customer_id], options,
  )).rows[0];
  if (!customer || customer.merged_into !== null) throw new AccountExportError("ACCOUNT_EXPORT_LINKAGE");
  if (session.smartAccount) {
    const wallet = (await sql.query<{ customer_id: string }>(
      "SELECT customer_id FROM customer_wallets WHERE chain_id=8453 AND address=$1",
      [session.smartAccount.address.toLowerCase()], options,
    )).rows[0];
    if (wallet && wallet.customer_id !== customer.id) throw new AccountExportError("ACCOUNT_EXPORT_LINKAGE");
  }
  const credentials = (await sql.query<Credential>(
    "SELECT id,account_provider,subject,linked_via,email,email_source,first_seen_at,last_seen_at FROM customer_credentials WHERE customer_id=$1 LIMIT $2",
    [customer.id, cap + 1], options,
  )).rows;
  const wallets = (await sql.query<Wallet>(
    "SELECT id,chain_id,address,credential_id,created_at FROM customer_wallets WHERE customer_id=$1 LIMIT $2",
    [customer.id, cap + 1], options,
  )).rows;
  if (credentials.length > cap || wallets.length > cap) throw new AccountExportError("ACCOUNT_EXPORT_TOO_LARGE");
  const ownerKeys = new Set<string>();
  const credentialsById = new Map(credentials.map((entry) => [entry.id, entry]));
  for (const wallet of wallets) {
    const linked = credentialsById.get(wallet.credential_id);
    if (!linked) throw new AccountExportError("ACCOUNT_EXPORT_LINKAGE");
    if (wallet.chain_id === 8453) ownerKeys.add(actionOwnerKey({ subject: linked.subject, accountProvider: linked.account_provider, chainId: 8453, address: wallet.address }));
  }
  if (session.smartAccount) ownerKeys.add(actionOwnerKey({ subject: session.user.subject, accountProvider: session.accountProvider, chainId: 8453, address: session.smartAccount.address }));
  const scope = { customerId: customer.id, credentials, wallets, ownerKeys: [...ownerKeys] };
  const conflict = (await sql.query(
    "SELECT id FROM actions WHERE owner_key=ANY($1::text[]) AND customer_id IS NOT NULL AND customer_id<>$2 LIMIT 1",
    [scope.ownerKeys, scope.customerId], options,
  )).rows.length > 0;
  if (conflict) throw new AccountExportError("ACCOUNT_EXPORT_LINKAGE");
  for (const table of ["funding_orders", "funding_provider_customers", "funding_provider_user_tokens"] as const) {
    const conflicting = (await sql.query(
      `SELECT f.customer_id FROM ${table} f JOIN customer_credentials cr ON cr.account_provider=f.account_provider AND cr.subject=f.owner_subject
       WHERE cr.customer_id=$1 AND f.customer_id IS NOT NULL AND f.customer_id<>$1 LIMIT 1`,
      [customer.id], options,
    )).rows.length > 0;
    if (conflicting) throw new AccountExportError("ACCOUNT_EXPORT_LINKAGE");
  }
  return scope;
}

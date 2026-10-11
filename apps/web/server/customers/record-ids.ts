import "server-only";

import { requireAddress } from "@/shared/chain/hex";
import type { SqlExecutor } from "@/server/db/sql";
import { CustomerResolver } from "./resolve";

type Owner = Parameters<CustomerResolver["resolveOwner"]>[0];

export async function recordCustomerIds(sql: SqlExecutor, owner: Owner, at: Date) {
  const session = { accountProvider: owner.accountProvider, user: { subject: owner.subject }, smartAccount: owner.address ? { chainId: 8453 as const, address: requireAddress(owner.address) } : null };
  const result = await new CustomerResolver(sql).resolveCustomerInTransaction(sql, session, at, "activity");
  return { customerId: result.id, credentialId: result.credentialId, walletId: result.walletId };
}

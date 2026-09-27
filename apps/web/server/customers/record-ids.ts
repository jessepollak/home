import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import { emitServerEvent } from "@/server/observability/log";
import { CustomerResolver } from "./resolve";

type Owner = Parameters<CustomerResolver["resolveOwner"]>[0];

export async function recordCustomerIds(sql: SqlExecutor, owner: Owner, at: Date) {
  try {
    return await new CustomerResolver(sql).resolveOwner(owner, at);
  } catch {
    emitServerEvent("operator-registry", {
      route: "/operator-registry", code: "OPERATOR_REGISTRY_RECORD_IDS_FAILED", outcome: "failed",
    });
    return { customerId: null, credentialId: null, walletId: null };
  }
}

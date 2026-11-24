import "server-only";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  ADMIN_CUSTOMERS_CONTRACT_VERSION,
  isCustomerId,
  parseCustomerSearchRequest,
  type AdminCustomersErrorCode,
  type CustomerSearchResponse,
} from "@/shared/admin-customers/contract";
import { authorizeSession } from "@/server/auth/authorize";
import { PostgresBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor } from "@/server/db/sql";
import { privateJson } from "@/server/http/private-response";
import { readSameOriginJson } from "@/server/http/same-origin-mutation";
import { emitServerEvent } from "@/server/observability/log";
import { authorizeOperatorRequest } from "@/server/operator/api";
import { readOperatorConfig, type OperatorConfig } from "@/server/operator/config";
import { AdminAuditLog } from "@/server/operator-settings/audit";
import { createSnapshotBalanceReader } from "./balances";
import { AdminCustomerStore, type BalanceReader } from "./store";

const SEARCH_ROUTE = "/api/admin/customers";
const DETAIL_ROUTE = "/api/admin/customers/[id]";

type Dependencies = {
  authorize?: (request: Request) => Promise<VerifiedAccountSession | Response>;
  config?: () => OperatorConfig;
  store?: () => AdminCustomerStore | null;
  audit?: () => AdminAuditLog;
  balances?: () => BalanceReader;
};
type Context = { params: Promise<{ id: string }> };

function fail(route: string, code: AdminCustomersErrorCode, status: number): Response {
  emitServerEvent("operator-registry", { route, code, outcome: "failed" });
  return privateJson({ error: { code } }, status);
}

function store(deps: Dependencies): AdminCustomerStore | null {
  if (deps.store) return deps.store();
  return readDatabaseUrl() ? new AdminCustomerStore(getSqlExecutor()) : null;
}

function audit(deps: Dependencies): AdminAuditLog {
  return deps.audit ? deps.audit() : new AdminAuditLog(getSqlExecutor());
}

function balances(deps: Dependencies): BalanceReader {
  return deps.balances ? deps.balances() : createSnapshotBalanceReader(new PostgresBalanceSnapshotStore(getSqlExecutor()));
}

async function operator(request: Request, deps: Dependencies, route: string): Promise<{ address: `0x${string}`; store: AdminCustomerStore } | Response> {
  const decision = await authorizeOperatorRequest(request, deps.authorize ?? authorizeSession, deps.config ?? readOperatorConfig);
  if (decision instanceof Response) return decision;
  const customers = store(deps);
  return customers ? { address: decision.address, store: customers } : fail(route, "CUSTOMERS_NOT_CONFIGURED", 503);
}

async function run(route: string, operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch {
    return fail(route, "CUSTOMERS_UNAVAILABLE", 503);
  }
}

export function createCustomerSearchHandler(deps: Dependencies = {}) {
  return (request: Request): Promise<Response> => run(SEARCH_ROUTE, async () => {
    const access = await operator(request, deps, SEARCH_ROUTE);
    if (access instanceof Response) return access;
    const checked = await readSameOriginJson(request);
    if ("error" in checked) return fail(SEARCH_ROUTE, checked.error, checked.error === "CROSS_ORIGIN" ? 403 : 400);
    const query = parseCustomerSearchRequest(checked.value);
    if (!query) return fail(SEARCH_ROUTE, "INVALID_REQUEST", 400);
    const result = await access.store.search(query);
    await audit(deps).recordCustomerReads({
      actor: access.address, customerIds: result.customers.map((customer) => customer.customerId),
      purpose: "customer-search",
    });
    const body: CustomerSearchResponse = { version: ADMIN_CUSTOMERS_CONTRACT_VERSION, match: query.term.kind, ...result };
    return privateJson(body, 200);
  });
}

export function createCustomerDetailHandler(deps: Dependencies = {}) {
  return (request: Request, context: Context): Promise<Response> => run(DETAIL_ROUTE, async () => {
    const access = await operator(request, deps, DETAIL_ROUTE);
    if (access instanceof Response) return access;
    const { id } = await context.params;
    if (!isCustomerId(id)) return fail(DETAIL_ROUTE, "NOT_FOUND", 404);
    const profile = await access.store.profile(id);
    if (!profile) return fail(DETAIL_ROUTE, "NOT_FOUND", 404);
    await audit(deps).recordCustomerRead({
      actor: access.address, customerId: id, purpose: "customer-detail",
    });
    return privateJson(await access.store.detail(profile, balances(deps), request.signal), 200);
  });
}

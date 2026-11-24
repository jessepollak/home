import { PublicResourceError, publicResource } from "@/client/query/public-resource";
import {
  ADMIN_CUSTOMERS_CONTRACT_VERSION,
  parseAdminCustomersErrorResponse,
  parseCustomerDetailResponse,
  parseCustomerSearchResponse,
  type CustomerDetailResponse,
  type CustomerSearchQuery,
  type CustomerSearchRequest,
  type CustomerSearchResponse,
} from "@/shared/admin-customers/contract";

export type CustomerReadFailure = "signed-out" | "forbidden" | "not-found" | "invalid" | "not-configured" | "unavailable";
export class CustomerReadError extends Error {
  constructor(readonly reason: CustomerReadFailure) { super(reason); }
}

function failure(body: unknown): CustomerReadError {
  const code = parseAdminCustomersErrorResponse(body)?.error.code;
  if (code === "UNAUTHENTICATED") return new CustomerReadError("signed-out");
  if (code === "OPERATOR_FORBIDDEN") return new CustomerReadError("forbidden");
  if (code === "NOT_FOUND") return new CustomerReadError("not-found");
  if (code === "INVALID_REQUEST") return new CustomerReadError("invalid");
  if (code === "CUSTOMERS_NOT_CONFIGURED") return new CustomerReadError("not-configured");
  return new CustomerReadError("unavailable");
}

export async function fetchCustomerSearch(query: CustomerSearchQuery, signal: AbortSignal): Promise<CustomerSearchResponse> {
  const request: CustomerSearchRequest = { version: ADMIN_CUSTOMERS_CONTRACT_VERSION, q: query.q, ...query.filters, after: query.after };
  let response: Response;
  try {
    response = await fetch("/api/admin/customers", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CustomerReadError("unavailable");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw failure(body);
  const parsed = parseCustomerSearchResponse(body);
  if (!parsed) throw new CustomerReadError("unavailable");
  return parsed;
}

export async function fetchCustomerDetail(customerId: string, signal: AbortSignal): Promise<CustomerDetailResponse> {
  let body: unknown;
  try {
    body = await publicResource(`/api/admin/customers/${encodeURIComponent(customerId)}`, { signal });
  } catch (error) {
    if (signal.aborted || !(error instanceof PublicResourceError)) throw error;
    throw error.kind === "http" ? failure(error.body) : new CustomerReadError("unavailable");
  }
  const parsed = parseCustomerDetailResponse(body);
  if (!parsed || parsed.profile.customerId !== customerId) throw new CustomerReadError("unavailable");
  return parsed;
}

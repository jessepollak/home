import * as z from "zod/mini";
import type { AccountProvider } from "@/shared/account/session-types";
import { parseAddress, parseHash32, type Address, type Hash32 } from "@/shared/chain/hex";

export const ADMIN_CUSTOMERS_CONTRACT_VERSION = 1;
export const CUSTOMER_SEARCH_PAGE_SIZE = 25;
export const CUSTOMER_DETAIL_PAGE_SIZE = 20;
export const CUSTOMER_SEARCH_MAX_LENGTH = 320;
export const CUSTOMER_EMAIL_PREFIX_MIN = 3;
export const CUSTOMER_ADDRESS_PREFIX_MIN_HEX = 6;

export type CustomerStatusFilter = "any" | "active" | "restricted" | "closed";
export type CustomerSignInFilter = "any" | AccountProvider;
export type CustomerFundedFilter = "any" | "funded" | "not-funded";
export type CustomerSearchFilters = { status: CustomerStatusFilter; signIn: CustomerSignInFilter; funded: CustomerFundedFilter };
export type CustomerSearchTerm =
  | { kind: "all" }
  | { kind: "id"; value: string; orderId: string }
  | { kind: "transaction-hash"; value: Hash32 }
  | { kind: "address"; value: Address }
  | { kind: "address-prefix"; value: string }
  | { kind: "email-or-order"; emailPrefix: string | null; orderId: string | null };
export type CustomerSearchQuery = { q: string; term: CustomerSearchTerm; filters: CustomerSearchFilters; after: string | null; limit: number };
export type CustomerSearchMatch = CustomerSearchTerm["kind"];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const addressPrefixPattern = /^0x[0-9a-f]+$/;
const emailPrefixPattern = /^\S+$/u;
const orderIdPattern = /^[\x21-\x7e]{1,128}$/;
const statusFilters: readonly CustomerStatusFilter[] = ["any", "active", "restricted", "closed"];
const signInFilters: readonly CustomerSignInFilter[] = ["any", "cdp-embedded", "base-account"];
const fundedFilters: readonly CustomerFundedFilter[] = ["any", "funded", "not-funded"];
const searchKeys = new Set(["q", "status", "signIn", "funded", "after"]);

export function isCustomerId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function classifyCustomerSearch(raw: string): CustomerSearchTerm | null {
  const q = raw.trim();
  if (!q) return { kind: "all" };
  if (q.length > CUSTOMER_SEARCH_MAX_LENGTH) return null;
  const lower = q.toLowerCase();
  if (uuidPattern.test(lower)) return { kind: "id", value: lower, orderId: q };
  if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
    const hash = parseHash32(q);
    return hash ? { kind: "transaction-hash", value: hash } : null;
  }
  const address = lower.length === 42 ? parseAddress(lower) : null;
  if (address) return { kind: "address", value: address };
  if (addressPrefixPattern.test(lower) && lower.length - 2 >= CUSTOMER_ADDRESS_PREFIX_MIN_HEX && lower.length < 42) {
    return { kind: "address-prefix", value: lower };
  }
  const emailPrefix = lower.length >= CUSTOMER_EMAIL_PREFIX_MIN && emailPrefixPattern.test(lower) ? lower : null;
  if (!orderIdPattern.test(q)) return emailPrefix ? { kind: "email-or-order", emailPrefix, orderId: null } : null;
  return { kind: "email-or-order", emailPrefix, orderId: q };
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T | null {
  if (value === null || value === "") return fallback;
  return allowed.find((option) => option === value) ?? null;
}

function query(input: { q: unknown; status: unknown; signIn: unknown; funded: unknown; after: unknown }): CustomerSearchQuery | null {
  if (![input.q, input.status, input.signIn, input.funded, input.after].every((value) => value === undefined || value === null || typeof value === "string")) return null;
  const text = (value: unknown) => typeof value === "string" ? value : null;
  const q = (text(input.q) ?? "").trim();
  const term = classifyCustomerSearch(q);
  const status = pick(text(input.status), statusFilters, "any");
  const signIn = pick(text(input.signIn), signInFilters, "any");
  const funded = pick(text(input.funded), fundedFilters, "any");
  const after = text(input.after) || null;
  if (!term || !status || !signIn || !funded || (after !== null && !isCustomerId(after))) return null;
  return { q, term, filters: { status, signIn, funded }, after, limit: CUSTOMER_SEARCH_PAGE_SIZE };
}

export function parseCustomerSearchQuery(params: URLSearchParams): CustomerSearchQuery | null {
  for (const key of params.keys()) if (!searchKeys.has(key)) return null;
  for (const key of searchKeys) if (params.getAll(key).length > 1) return null;
  return query({ q: params.get("q"), status: params.get("status"), signIn: params.get("signIn"), funded: params.get("funded"), after: params.get("after") });
}

export type CustomerSearchRequest = { version: typeof ADMIN_CUSTOMERS_CONTRACT_VERSION; q?: string; status?: CustomerStatusFilter; signIn?: CustomerSignInFilter; funded?: CustomerFundedFilter; after?: string | null };

export function parseCustomerSearchRequest(value: unknown): CustomerSearchQuery | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body: Record<string, unknown> = { ...value };
  if (body.version !== ADMIN_CUSTOMERS_CONTRACT_VERSION || Object.keys(body).some((key) => key !== "version" && !searchKeys.has(key))) return null;
  return query({ q: body.q, status: body.status, signIn: body.signIn, funded: body.funded, after: body.after });
}

export function customerSearchString(input: { q?: string; status?: string; signIn?: string; funded?: string; after?: string | null }): string {
  const params = new URLSearchParams();
  const q = input.q?.trim();
  if (q) params.set("q", q);
  if (input.status && input.status !== "any") params.set("status", input.status);
  if (input.signIn && input.signIn !== "any") params.set("signIn", input.signIn);
  if (input.funded && input.funded !== "any") params.set("funded", input.funded);
  if (input.after) params.set("after", input.after);
  return params.toString();
}

export function customerListHref(fragment: string): string {
  const parsed = parseCustomerSearchQuery(new URLSearchParams(fragment.replace(/^#/, "")));
  const state = parsed ? customerSearchString({ q: parsed.q, ...parsed.filters, after: parsed.after }) : "";
  return state ? `/admin/customers#${state}` : "/admin/customers";
}

const iso = z.string().check(z.refine((text) => {
  const date = new Date(text);
  return !Number.isNaN(date.getTime()) && date.toISOString() === text;
}));
const id = z.string().check(z.refine(isCustomerId));
const address = z.custom<Address>((value) => typeof value === "string" && parseAddress(value) === value);
const hash = z.custom<Hash32>((value) => typeof value === "string" && parseHash32(value) === value);
const text = (max: number) => z.string().check(z.refine((value) => value.length > 0 && value.length <= max));
const decimal = z.string().check(z.refine((value) => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)));
const count = z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0));
const status = z.enum(["active", "restricted", "closed"]);
const signIn = z.enum(["cdp-embedded", "base-account"]);
const email = z.object({ address: text(320), source: z.enum(["cdp_verified", "wallet_reported"]) });
const firstSeenSource = z.enum(["sign_in", "activity", "backfill"]);
const match = z.enum(["all", "id", "transaction-hash", "address", "address-prefix", "email-or-order"]);

const searchRow = z.object({
  customerId: id, status, merged: z.boolean(), country: z.nullable(text(2)),
  firstSeenAt: iso, firstSeenSource, lastSeenAt: iso,
  signIn: z.array(signIn), emails: z.array(email), wallets: z.array(address), walletCount: count, funded: z.boolean(),
});
const searchResponse = z.object({
  version: z.literal(ADMIN_CUSTOMERS_CONTRACT_VERSION), match,
  customers: z.array(searchRow).check(z.maxLength(CUSTOMER_SEARCH_PAGE_SIZE)), nextCursor: z.nullable(id),
});

function section<T extends z.core.$ZodType>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), value }),
    z.object({ status: z.literal("unavailable") }),
  ]);
}
const money = z.nullable(decimal);
const holding = z.object({ symbol: text(64), name: text(64), category: z.enum(["cash", "savings", "investment", "collateral"]), amount: decimal, value: money });
const debt = z.object({ symbol: text(64), amount: decimal, value: money });
const walletBalance = z.object({
  address,
  snapshot: z.nullable(z.object({
    observedAt: iso, stale: z.boolean(), complete: z.boolean(), currency: z.nullable(z.literal("USD")),
    cash: money, investments: money, debt: money, net: money, netNegative: z.boolean(),
    holdings: z.array(holding), debts: z.array(debt),
  })),
});
const action = z.object({
  id, kind: text(64), title: z.nullable(text(120)), createdAt: iso, confirmedAt: iso,
  status: z.enum(["pending", "unknown", "confirmed", "failed"]), outcome: z.nullable(z.enum(["succeeded", "reverted", "not_submitted"])),
  transactionHash: z.nullable(hash),
});
const fundingOrder = z.object({
  id, providerId: text(64), region: text(16), assetId: text(64), fiatAmount: decimal, state: text(32), sandbox: z.boolean(),
  createdAt: iso, updatedAt: iso, providerOrderId: z.nullable(text(128)), transactionHash: z.nullable(hash),
});
const verification = z.object({ providerId: text(64), region: text(16), state: z.enum(["reserving", "pending", "verified", "rejected", "dispatch-ambiguous"]), updatedAt: iso });
const credential = z.object({ signIn, email: z.nullable(email), linkedVia: z.enum(["first_use", "link"]), firstSeenAt: iso, lastSeenAt: iso });
const wallet = z.object({ address, chainId: count, linkedAt: iso });
const detailResponse = z.object({
  version: z.literal(ADMIN_CUSTOMERS_CONTRACT_VERSION),
  profile: z.object({
    customerId: id, status, mergedInto: z.nullable(id), country: z.nullable(text(2)), firstSeenAt: iso, firstSeenSource, lastSeenAt: iso,
    deletionPending: z.boolean(), credentials: z.array(credential), wallets: z.array(wallet),
  }),
  balances: section(z.array(walletBalance)),
  actions: section(z.object({ items: z.array(action).check(z.maxLength(CUSTOMER_DETAIL_PAGE_SIZE)), more: z.boolean() })),
  funding: section(z.object({ items: z.array(fundingOrder).check(z.maxLength(CUSTOMER_DETAIL_PAGE_SIZE)), more: z.boolean() })),
  verification: section(z.array(verification)),
  invites: section(z.object({ attributedCode: z.nullable(text(128)), inviterCustomerId: z.nullable(id), ownCode: z.nullable(text(16)), attributedSignups: z.nullable(count) })),
  support: section(z.nullable(z.object({ conversationId: id, status: z.enum(["open", "resolved"]), lastMessageAt: iso }))),
});

export type CustomerEmail = z.output<typeof email>;
export type CustomerSearchRow = z.output<typeof searchRow>;
export type CustomerSearchResponse = z.output<typeof searchResponse>;
export type CustomerDetailResponse = z.output<typeof detailResponse>;
export type CustomerWalletBalance = z.output<typeof walletBalance>;
export type CustomerAction = z.output<typeof action>;
export type CustomerFundingOrder = z.output<typeof fundingOrder>;
export type CustomerSection<T> = { status: "available"; value: T } | { status: "unavailable" };

export type AdminCustomersErrorCode = "UNAUTHENTICATED" | "AUTH_UNAVAILABLE" | "OPERATOR_FORBIDDEN" | "NOT_FOUND" | "INVALID_REQUEST" | "CROSS_ORIGIN" | "CUSTOMERS_UNAVAILABLE" | "CUSTOMERS_NOT_CONFIGURED";
const errorResponse = z.object({ error: z.object({ code: z.enum(["UNAUTHENTICATED", "AUTH_UNAVAILABLE", "OPERATOR_FORBIDDEN", "NOT_FOUND", "INVALID_REQUEST", "CROSS_ORIGIN", "CUSTOMERS_UNAVAILABLE", "CUSTOMERS_NOT_CONFIGURED"]) }) });
export type AdminCustomersErrorResponse = z.output<typeof errorResponse>;

export function parseCustomerSearchResponse(value: unknown): CustomerSearchResponse | null {
  const parsed = searchResponse.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCustomerDetailResponse(value: unknown): CustomerDetailResponse | null {
  const parsed = detailResponse.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseAdminCustomersErrorResponse(value: unknown): AdminCustomersErrorResponse | null {
  const parsed = errorResponse.safeParse(value);
  return parsed.success ? parsed.data : null;
}

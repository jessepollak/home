import { expect, test } from "bun:test";
import { classifyCustomerSearch, customerListHref, parseCustomerSearchQuery, parseCustomerSearchRequest } from "./contract";

test("search input is normalized and routed to exactly one indexed lookup", () => {
  expect<unknown>(classifyCustomerSearch("  ")).toEqual({ kind: "all" });
  expect<unknown>(classifyCustomerSearch("1111AAAA-1111-4111-8111-111111111111")).toEqual({ kind: "id", value: "1111aaaa-1111-4111-8111-111111111111", orderId: "1111AAAA-1111-4111-8111-111111111111" });
  expect<unknown>(classifyCustomerSearch("O'Connor@example.test")).toEqual({ kind: "email-or-order", emailPrefix: "o'connor@example.test", orderId: "O'Connor@example.test" });
  expect<unknown>(classifyCustomerSearch(`0x${"AB".repeat(32)}`)).toEqual({ kind: "transaction-hash", value: `0x${"ab".repeat(32)}` });
  expect<unknown>(classifyCustomerSearch("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toEqual({ kind: "address", value: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" });
  expect<unknown>(classifyCustomerSearch("0xABCDEF")).toEqual({ kind: "address-prefix", value: "0xabcdef" });
  expect<unknown>(classifyCustomerSearch("0xabcde")).toEqual({ kind: "email-or-order", emailPrefix: "0xabcde", orderId: "0xabcde" });
  expect<unknown>(classifyCustomerSearch("Ada@Example.test")).toEqual({ kind: "email-or-order", emailPrefix: "ada@example.test", orderId: "Ada@Example.test" });
  expect<unknown>(classifyCustomerSearch("ab")).toEqual({ kind: "email-or-order", emailPrefix: null, orderId: "ab" });
  expect<unknown>(classifyCustomerSearch("a b")).toBeNull();
  expect<unknown>(classifyCustomerSearch("x".repeat(321))).toBeNull();
});

test("search queries reject unknown, repeated and malformed parameters", () => {
  expect(parseCustomerSearchQuery(new URLSearchParams("q=ada&status=active&signIn=base-account&funded=not-funded"))?.filters)
    .toEqual({ status: "active", signIn: "base-account", funded: "not-funded" });
  expect(parseCustomerSearchQuery(new URLSearchParams("q=ada&email=ada"))).toBeNull();
  expect(parseCustomerSearchQuery(new URLSearchParams("q=ada&q=grace"))).toBeNull();
  expect(parseCustomerSearchQuery(new URLSearchParams("status=deleted"))).toBeNull();
  expect(parseCustomerSearchQuery(new URLSearchParams("after=42"))).toBeNull();
});

test("search requests accept only the versioned body shape", () => {
  expect(parseCustomerSearchRequest({ version: 1, q: "ada", funded: "funded", after: null })?.filters.funded).toBe("funded");
  expect(parseCustomerSearchRequest({ q: "ada" })).toBeNull();
  expect(parseCustomerSearchRequest({ version: 1, q: ["ada"] })).toBeNull();
  expect(parseCustomerSearchRequest({ version: 1, email: "ada" })).toBeNull();
});

test("the detail Back link keeps a valid list state in the fragment and drops anything else", () => {
  expect(customerListHref("#q=ada&funded=funded&after=11111111-1111-4111-8111-111111111111"))
    .toBe("/admin/customers#q=ada&funded=funded&after=11111111-1111-4111-8111-111111111111");
  expect(customerListHref("q=ada&next=//evil.test")).toBe("/admin/customers");
  expect(customerListHref("")).toBe("/admin/customers");
});

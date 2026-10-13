import { expect, test } from "bun:test";
import { parseCardPurchases } from "./transactions-contract";

const purchase = {
  id: "11111111-1111-4111-8111-111111111111", kind: "authorization", amountMinor: "1250", currency: "USD",
  merchantName: "Shop", merchantCategory: null, status: "pending", declineReasonCode: null,
  createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z",
};
const response = { version: 1, status: "ready", rows: [purchase] };

test("accepts string purchase kinds and statuses", () => {
  for (const override of [
    { kind: "authorization" }, { kind: "transaction" },
    ...["pending", "declined", "completed", "reversed", "refunded"].map((status) => ({ status })),
  ]) {
    const input = { ...response, rows: [{ ...purchase, ...override }] };
    expect<unknown>(parseCardPurchases(input)).toEqual(input);
  }
});

test("rejects provider purchase IDs at the public boundary", () => {
  expect(() => parseCardPurchases({ ...response, rows: [{ ...purchase, id: "iauth_synthetic" }] })).toThrow("Invalid card purchase");
});

test("rejects missing or skewed purchase response versions", () => {
  for (const version of [undefined, 2]) {
    expect(() => parseCardPurchases({ ...response, version })).toThrow("Invalid card purchases");
  }
});

test.each([
  { field: "kind", valid: "authorization" },
  { field: "status", valid: "pending" },
])("rejects non-string purchase $field without coercion", ({ field, valid }) => {
  for (const value of [null, undefined, 1, [valid], { toString: () => valid }]) {
    expect(() => parseCardPurchases({ ...response, rows: [{ ...purchase, [field]: value }] })).toThrow("Invalid card purchase");
  }
});

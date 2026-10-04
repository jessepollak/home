import { expect, test } from "bun:test";
import { parseCardPurchases } from "./transactions-contract";

const purchase = {
  id: "iauth_synthetic", kind: "authorization", amountMinor: "1250", currency: "USD",
  merchantName: "Shop", merchantCategory: null, status: "pending", declineReasonCode: null,
  createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z",
};
const response = { version: 1, status: "ready", rows: [purchase] };

test("accepts string purchase kinds and statuses", () => {
  for (const kind of ["authorization", "transaction"]) {
    for (const status of ["pending", "declined", "completed", "reversed", "refunded"]) {
      const input = { ...response, rows: [{ ...purchase, kind, status }] };
      expect<unknown>(parseCardPurchases(input)).toEqual(input);
    }
  }
});

test.each([
  { field: "kind", value: ["authorization"] },
  { field: "kind", value: { toString: () => "authorization" } },
  { field: "status", value: ["pending"] },
  { field: "status", value: { toString: () => "pending" } },
  ...["kind", "status"].flatMap((field) => [null, undefined, 1, true, {}].map((value) => ({ field, value }))),
])("rejects non-string purchase enum %p", ({ field, value }) => {
  expect(() => parseCardPurchases({ ...response, rows: [{ ...purchase, [field]: value }] })).toThrow("Invalid card purchase");
});

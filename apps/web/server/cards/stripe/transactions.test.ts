import { expect, test } from "bun:test";
import { createStripeTransactionClient } from "./transactions";

const config = { stripeSecretKey: "sk_test_synthetic", stripeApiVersion: "2026-08-26.dahlia" };
const transaction = {
  object: "issuing.transaction", id: "ipi_synthetic", card: "ic_synthetic",
  amount: 100, currency: "usd", created: 1788264000,
  merchant_data: { name: "Synthetic Cafe" }, status: "posted", type: "capture", authorization: null,
};
const authorization = { ...transaction, object: "issuing.authorization", id: "iauth_synthetic", status: "pending", approved: true };

test("raw Stripe purchase detail rejects non-primitive enums, IDs and card references", async () => {
  let payload: unknown = transaction;
  const client = createStripeTransactionClient(config, Object.assign(async () => Response.json(payload), { preconnect: fetch.preconnect }));
  expect(await client.read("transaction", "ipi_synthetic"))
    .toMatchObject({ id: "ipi_synthetic", cardId: "ic_synthetic", amountMinor: "100", currency: "USD", status: "completed" });
  payload = authorization;
  expect(await client.read("authorization", "iauth_synthetic"))
    .toMatchObject({ id: "iauth_synthetic", cardId: "ic_synthetic", status: "pending" });

  const cases: { kind: "authorization" | "transaction"; id: string; payload: unknown; error: string }[] = [
    { kind: "authorization", id: "iauth_synthetic", payload: { ...authorization, status: ["pending"] }, error: "Invalid Stripe authorization status" },
    { kind: "transaction", id: "ipi_synthetic", payload: { ...transaction, status: ["void"] }, error: "Invalid Stripe transaction status" },
    { kind: "transaction", id: "ipi_synthetic", payload: { ...transaction, type: ["capture"] }, error: "Invalid Stripe transaction status" },
    { kind: "transaction", id: "ipi_synthetic", payload: { ...transaction, id: ["ipi_synthetic"] }, error: "Invalid Stripe purchase" },
    { kind: "transaction", id: "ipi_synthetic", payload: { ...transaction, card: { id: ["ic_synthetic"] } }, error: "Invalid Stripe purchase" },
  ];
  for (const item of cases) {
    payload = item.payload;
    await expect(client.read(item.kind, item.id)).rejects.toThrow(item.error);
  }
});

test("raw Stripe purchase lists reject malformed pages and another card's purchase", async () => {
  const page = { object: "list", data: [transaction], has_more: false };
  let payload: unknown = page;
  const client = createStripeTransactionClient(config, Object.assign(async () => Response.json(payload), { preconnect: fetch.preconnect }));
  expect(await client.list("transaction", "ic_synthetic", 0))
    .toMatchObject({ rows: [{ id: "ipi_synthetic", cardId: "ic_synthetic", status: "completed" }], partial: false });

  for (const item of [
    { payload: { ...page, data: {} }, error: "Invalid Stripe purchase list" },
    { payload: { ...page, has_more: "false" }, error: "Invalid Stripe purchase list" },
    { payload: { ...page, data: [{ ...transaction, card: "ic_other" }] }, error: "Partial Stripe purchase list" },
  ]) {
    payload = item.payload;
    await expect(client.list("transaction", "ic_synthetic", 0)).rejects.toThrow(item.error);
  }
});

test.each(["closed", "expired"])("approved %s authorization records terminal closure", async (status) => {
  const client = createStripeTransactionClient(config, Object.assign(async () => Response.json({ ...authorization, status }), { preconnect: fetch.preconnect }));
  expect(await client.read("authorization", "iauth_synthetic")).toMatchObject({ status: "pending", authorizationClosed: true });
});

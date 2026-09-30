import { expect, test } from "bun:test";
import { createHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { activityOrdersQuery } from "./activity-orders-query";

const session: VerifiedAccountSession = {
  user: { subject: "orders-owner" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

const response = { version: 1, owner: { subject: session.user.subject, accountProvider: session.accountProvider }, orders: [] };

test("activity orders factory caches parsed rows at the registered owner key", async () => {
  const client = createHomeQueryClient();
  const options = activityOrdersQuery({ owner: "orders-owner-key", session, fetchOrders: async () => response });
  expect([...options.queryKey]).toEqual([...ownerQueryKey("orders-owner-key", "activity-orders")]);
  expect(await client.fetchQuery(options)).toEqual([]);
  expect(client.getQueryData<unknown>(options.queryKey)).toEqual([]);
  client.clear();
});

test("malformed or cross-owner activity orders reject without replacing cached rows", async () => {
  const client = createHomeQueryClient();
  let value: unknown = response;
  const options = activityOrdersQuery({ owner: "orders-owner-key", session, fetchOrders: async () => value });
  expect(await client.fetchQuery(options)).toEqual([]);
  for (const bad of [{}, { ...response, owner: { ...response.owner, subject: "other" } }]) {
    value = bad;
    await expect(client.fetchQuery({ ...options, staleTime: 0, retry: false })).rejects.toThrow("The activity orders response is invalid.");
    expect(client.getQueryData<unknown>(options.queryKey)).toEqual([]);
  }
  client.clear();
});

import "server-only";

import { beforeEach, describe, expect, test } from "bun:test";
import type { WebhookSubscriptionStore } from "./webhook-subscription-store";

export function webhookSubscriptionStoreContract(options: {
  name: string;
  createStore: () => WebhookSubscriptionStore;
  reset: () => Promise<void> | void;
}) {
  describe(`${options.name} WebhookSubscriptionStore contract`, () => {
    let store: WebhookSubscriptionStore;
    beforeEach(async () => {
      await options.reset();
      store = options.createStore();
    });

    test("inserts and lists the one-time signing secret record", async () => {
      await store.insert({
        subscriptionId: "subscription-1",
        secret: "one-time-value",
        target: "https://home.example/api/webhooks/cdp",
        eventType: "wallet_activity",
      });
      expect(await store.list()).toEqual([{
        subscriptionId: "subscription-1",
        secret: "one-time-value",
        target: "https://home.example/api/webhooks/cdp",
        eventType: "wallet_activity",
        createdAt: expect.any(String),
      }]);
    });

    test("upserts a returned secret for the same subscription id", async () => {
      await store.insert({
        subscriptionId: "subscription-1",
        secret: "first-value",
        target: "https://old.example/api/webhooks/cdp",
        eventType: "wallet_activity",
      });
      await store.insert({
        subscriptionId: "subscription-1",
        secret: "second-value",
        target: "https://home.example/api/webhooks/cdp",
        eventType: "wallet_activity",
      });
      expect(await store.list()).toHaveLength(1);
      expect((await store.list())[0]).toMatchObject({
        secret: "second-value",
        target: "https://home.example/api/webhooks/cdp",
      });
    });
  });
}

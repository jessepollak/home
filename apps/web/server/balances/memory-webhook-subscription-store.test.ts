import { MemoryWebhookSubscriptionStore, type WebhookSubscriptionRecord } from "./webhook-subscription-store";
import { webhookSubscriptionStoreContract } from "./webhook-subscription-store.contract";

const rows = new Map<string, WebhookSubscriptionRecord>();
const seed = new MemoryWebhookSubscriptionStore(null, rows);
webhookSubscriptionStoreContract({
  name: "Memory",
  createStore: (keyring) => new MemoryWebhookSubscriptionStore(keyring, rows),
  reset: () => seed.clearForTests(),
  seedLegacy: (record) => seed.seedLegacyForTests(record),
});

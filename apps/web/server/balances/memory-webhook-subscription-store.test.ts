import { MemoryWebhookSubscriptionStore } from "./webhook-subscription-store";
import { webhookSubscriptionStoreContract } from "./webhook-subscription-store.contract";

const store = new MemoryWebhookSubscriptionStore();
webhookSubscriptionStoreContract({
  name: "Memory",
  createStore: () => store,
  reset: () => store.clearForTests(),
});

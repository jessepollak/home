import { describe, expect, test } from "bun:test";
import {
  MemoryWebhookSubscriptionStore,
  type WebhookSubscriptionStore,
} from "./webhook-subscription-store";
import { CDP_WEBHOOK_SUBSCRIPTIONS_PATH, createCdpWebhookSubscriptions, deploymentWebhookOrigin } from "./webhook-subscriptions";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const env = { CDP_API_KEY_ID: "key", CDP_API_KEY_SECRET: "api-value", HOME_WEBHOOK_ORIGIN: "https://home.example" };
const jwt = async () => "fixture.jwt";

function persistentStore(subscriptionIds: string[] = []): WebhookSubscriptionStore {
  const memory = new MemoryWebhookSubscriptionStore();
  const seeded = subscriptionIds.map((subscriptionId) => ({
    subscriptionId,
    secret: "fixture-secret",
    target: "https://home.example/api/webhooks/cdp",
    eventType: "wallet_activity",
  }));
  const ready = Promise.all(seeded.map((record) => memory.insert(record)));
  return {
    persistent: true,
    insert: async (record) => { await ready; await memory.insert(record); },
    list: async () => { await ready; return memory.list(); },
  };
}

function subscription(addresses: string[] = [OTHER]) {
  return {
    subscriptionId: "subscription-1",
    eventTypes: ["wallet_activity"],
    target: { url: "https://home.example/api/webhooks/cdp" },
    labels: { network: "base-mainnet", wallet_addresses: addresses.join(",") },
    isEnabled: true,
  };
}

describe("CDP balance webhook subscriptions", () => {
  test("re-lists before PUT and confirms the address after a successful update", async () => {
    const requests: string[] = [];
    let updated = false;
    const manager = createCdpWebhookSubscriptions({
      env,
      store: persistentStore(["subscription-1"]),
      generateJwtImpl: jwt as never,
      fetchImpl: async (_input, init) => {
        const method = init?.method ?? "GET";
        requests.push(method);
        if (method === "PUT") updated = true;
        return Response.json({ subscriptions: [subscription(updated ? [OTHER, ADDRESS] : [OTHER])] });
      },
    });
    await manager.ensureAddressSubscribed(ADDRESS);
    expect(requests).toEqual(["GET", "GET", "PUT", "GET"]);
  });

  test("creates a subscription and persists its one-time signing SECRET when no candidate has room", async () => {
    const store = persistentStore();
    const requests: Array<{ method: string; body: unknown }> = [];
    const manager = createCdpWebhookSubscriptions({
      env,
      store,
      generateJwtImpl: jwt as never,
      fetchImpl: async (_input, init) => {
        const method = init?.method ?? "GET";
        requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return method === "POST"
          ? Response.json({ subscriptionId: "new-subscription", secret: "one-time-value" })
          : Response.json({ subscriptions: [] });
      },
    });
    await manager.ensureAddressSubscribed(ADDRESS);
    expect(requests.map(({ method }) => method)).toEqual(["GET", "POST"]);
    expect(requests[1]?.body).toEqual({
      eventTypes: ["wallet_activity"],
      target: { url: "https://home.example/api/webhooks/cdp" },
      labels: { network: "base-mainnet", wallet_addresses: ADDRESS },
      isEnabled: true,
    });
    expect(await store.list()).toEqual([expect.objectContaining({
      subscriptionId: "new-subscription",
      secret: "one-time-value",
    })]);
  });


  test("skips a matching subscription whose id is not stored", async () => {
    const failures: string[] = [];
    const requests: string[] = [];
    const manager = createCdpWebhookSubscriptions({
      env,
      store: persistentStore(),
      generateJwtImpl: jwt as never,
      logFailure: (reason) => failures.push(reason),
      fetchImpl: async (_input, init) => {
        const method = init?.method ?? "GET";
        requests.push(method);
        return method === "POST"
          ? Response.json({ subscriptionId: "new-subscription", secret: "new-secret" })
          : Response.json({ subscriptions: [subscription([ADDRESS])] });
      },
    });

    await manager.ensureAddressSubscribed(ADDRESS);
    expect(requests).toEqual(["GET", "POST"]);
    expect(failures).toEqual(["subscription-unverifiable"]);
  });

  test("never PUTs a subscription with an invalid address label", async () => {
    const requests: string[] = [];
    const invalid = subscription();
    invalid.labels.wallet_addresses = `${OTHER},not-an-address`;
    const manager = createCdpWebhookSubscriptions({
      env,
      store: persistentStore(["subscription-1"]),
      generateJwtImpl: jwt as never,
      fetchImpl: async (_input, init) => {
        const method = init?.method ?? "GET";
        requests.push(method);
        return method === "POST"
          ? Response.json({ subscriptionId: "new-subscription", secret: "new-secret" })
          : Response.json({ subscriptions: [invalid] });
      },
    });

    await manager.ensureAddressSubscribed(ADDRESS);
    expect(requests).toEqual(["GET", "POST"]);
  });

  test("does not create after the stored and listed subscriptions mismatch", async () => {
    const failures: string[] = [];
    const requests: string[] = [];
    const manager = createCdpWebhookSubscriptions({
      env,
      store: persistentStore(["stored-subscription"]),
      generateJwtImpl: jwt as never,
      logFailure: (reason) => failures.push(reason),
      fetchImpl: async (_input, init) => {
        requests.push(init?.method ?? "GET");
        return Response.json({ subscriptions: [] });
      },
    });

    await manager.ensureAddressSubscribed(ADDRESS);
    await manager.ensureAddressSubscribed(OTHER);
    expect(requests).toEqual(["GET"]);
    expect(failures).toEqual(["subscription-list-mismatch"]);
  });

  test("an unparseable create response disables later creates", async () => {
    const requests: string[] = [];
    const failures: string[] = [];
    const manager = createCdpWebhookSubscriptions({
      env,
      store: persistentStore(),
      generateJwtImpl: jwt as never,
      logFailure: (reason) => failures.push(reason),
      fetchImpl: async (_input, init) => {
        requests.push(init?.method ?? "GET");
        return init?.method === "POST"
          ? Response.json({ subscriptionId: "missing-secret" })
          : Response.json({ subscriptions: [] });
      },
    });

    await manager.ensureAddressSubscribed(ADDRESS);
    await manager.ensureAddressSubscribed(OTHER);
    expect(requests).toEqual(["GET", "POST"]);
    expect(failures).toEqual(["cdp-create-response-missing-secret"]);
  });

  test("serializes concurrent first-read subscription creation", async () => {
    const requests: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const manager = createCdpWebhookSubscriptions({
      env,
      store: persistentStore(),
      generateJwtImpl: jwt as never,
      fetchImpl: async (_input, init) => {
        const method = init?.method ?? "GET";
        requests.push(method);
        if (method === "POST") await gate;
        return method === "POST"
          ? Response.json({ subscriptionId: "new-subscription", secret: "new-secret" })
          : Response.json({ subscriptions: [] });
      },
    });

    const first = manager.ensureAddressSubscribed(ADDRESS);
    const second = manager.ensureAddressSubscribed(ADDRESS);
    await Promise.resolve();
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(requests.filter((method) => method === "POST")).toHaveLength(1);
  });

  test("registration is disabled once per instance without persistent storage", async () => {
    const failures: string[] = [];
    let calls = 0;
    const manager = createCdpWebhookSubscriptions({
      env,
      store: new MemoryWebhookSubscriptionStore(),
      fetchImpl: async () => { calls += 1; return Response.json({}); },
      logFailure: (reason) => failures.push(reason),
    });
    await manager.ensureAddressSubscribed(ADDRESS);
    await manager.ensureAddressSubscribed(OTHER);
    expect(calls).toBe(0);
    expect(failures).toEqual(["subscription-persistence-unavailable"]);
  });

  test("enables production or an explicit origin only", () => {
    expect(deploymentWebhookOrigin({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "home.example" })).toBeNull();
    expect(deploymentWebhookOrigin({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "home.example" })).toBe("https://home.example");
    expect(deploymentWebhookOrigin({ HOME_WEBHOOK_ORIGIN: "https://preview.example" })).toBe("https://preview.example");
  });

  test("uses the CDP subscription endpoint", () => {
    expect(CDP_WEBHOOK_SUBSCRIPTIONS_PATH).toBe("/platform/v2/data/webhooks/subscriptions");
  });
});

import { describe, expect, spyOn, test } from "bun:test";
import { createCdpWebhookSubscriptions } from "./webhook-subscriptions";
import type { WebhookSubscriptionInsert, WebhookSubscriptionRecord, WebhookSubscriptionStore } from "./webhook-subscription-store";

const env = {
  CDP_API_KEY_ID: "fixture-key-id",
  ["CDP_API_KEY_" + "SECRET"]: "fixture-private-part",
  HOME_WEBHOOK_ORIGIN: "https://home.example",
};
const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const PATH = "/platform/v2/data/webhooks/subscriptions";
type FetchLike = NonNullable<NonNullable<Parameters<typeof createCdpWebhookSubscriptions>[0]>["fetchImpl"]>;

function store(records: WebhookSubscriptionRecord[] = [], inserted: WebhookSubscriptionInsert[] = []): WebhookSubscriptionStore {
  return {
    persistent: true,
    sealing: true,
    list: async () => records,
    insert: async (record) => { inserted.push(record); },
    listForRotation: async () => { throw new Error("unused"); },
    replaceCredentialIf: async () => { throw new Error("unused"); },
    countStates: async () => { throw new Error("unused"); },
    delete: async () => { throw new Error("unused"); },
  };
}

async function failures(fetchImpl: FetchLike): Promise<string[]> {
  const reasons: string[] = [];
  const subscriptions = createCdpWebhookSubscriptions({
    env, store: store(), keyring: null, fetchImpl,
    generateJwtImpl: async () => "fixture.signed.token",
    now: () => 0,
    logFailure: (reason) => { reasons.push(reason); },
  });
  await subscriptions.ensureAddressSubscribed(ADDRESS);
  return reasons;
}

describe("CDP webhook subscription transport", () => {
  test.each([400, 429, 503])("preserves the non-ok status message for %s", async (status) => {
    expect(await failures(async () => new Response("not JSON", { status })))
      .toEqual([`cdp-webhooks-${status}`]);
  });

  test.each(["{", "", "null trailing"])( "preserves the malformed JSON message for %j", async (value) => {
    expect(await failures(async () => new Response(value))).toEqual(["cdp-webhooks-invalid-json"]);
  });

  test.each(["fetch", "body"] as const)("maps a %s timeout without waiting for the provider", async (phase) => {
    const controller = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    try {
      expect(await failures(() => {
        if (phase === "fetch") {
          controller.abort();
          return new Promise<Response>(() => {});
        }
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
          pull() { controller.abort(); },
        }, { highWaterMark: 0 })));
      })).toEqual(["cdp-webhooks-timeout"]);
      expect(timeout).toHaveBeenCalledWith(10_000);
    } finally { timeout.mockRestore(); }
  });

  test.each(["fetch", "body", "oversized"] as const)("maps %s failure to the stable transport message", async (phase) => {
    expect(await failures(async () => {
      if (phase === "fetch") throw new Error("connection failed");
      if (phase === "oversized") return new Response("x".repeat(1024 * 1024 + 1));
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.error(new Error("read failed")); },
      }));
    })).toEqual(["cdp-webhooks-transport"]);
  });

  test.each(["POST", "PUT"] as const)("retains signed GET and %s method/host/path, headers and payload", async (method) => {
    const signed: unknown[] = [];
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const inserted: WebhookSubscriptionInsert[] = [];
    const reasons: string[] = [];
    let addresses = OTHER_ADDRESS;
    const subscriptionId = "subscription/1";
    const target = "https://home.example/api/webhooks/cdp";
    const subscription = () => ({
      subscriptionId,
      eventTypes: ["wallet_activity"],
      target: { url: target },
      labels: { network: "base-mainnet", wallet_addresses: addresses },
      isEnabled: true,
    });
    const records: WebhookSubscriptionRecord[] = method === "PUT" ? [{
      subscriptionId, target, eventType: "wallet_activity", createdAt: "2026-09-13T12:00:00.000Z",
      credential: { kind: "legacy-plaintext", secret: "fixture-webhook-key" },
    }] : [];
    const subscriptions = createCdpWebhookSubscriptions({
      env, store: store(records, inserted), keyring: null, now: () => 0,
      logFailure: (reason) => { reasons.push(reason); },
      generateJwtImpl: async (options) => {
        signed.push([options.requestMethod, options.requestHost, options.requestPath]);
        return "fixture.signed.token";
      },
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        if (init?.method === "GET") return Response.json({ subscriptions: method === "PUT" ? [subscription()] : [] });
        if (init?.method === "PUT") {
          addresses = `${OTHER_ADDRESS},${ADDRESS}`;
          return Response.json({});
        }
        return Response.json({ subscriptionId, secret: "fixture-webhook-key" });
      },
    });
    await subscriptions.ensureAddressSubscribed(ADDRESS);
    expect(reasons).toEqual([]);
    const mutationPath = method === "PUT" ? `${PATH}/subscription%2F1` : PATH;
    const expectedMethods = method === "PUT" ? ["GET", "GET", "PUT", "GET"] : ["GET", "POST"];
    expect(signed).toEqual(expectedMethods.map((requestMethod) => [
      requestMethod, "api.cdp.coinbase.com", requestMethod === "GET" ? PATH : mutationPath,
    ]));
    expect(calls).toHaveLength(expectedMethods.length);
    for (const [index, requestMethod] of expectedMethods.entries()) {
      const call = calls[index];
      const init = call?.init;
      const headers = new Headers(init?.headers);
      expect(call?.url).toBe(`https://api.cdp.coinbase.com${requestMethod === "GET" ? PATH : mutationPath}`);
      expect(init?.method).toBe(requestMethod);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.cache).toBe("no-store");
      expect(headers.get("authorization")).toBe("Bearer fixture.signed.token");
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("content-type")).toBe(requestMethod === "GET" ? null : "application/json");
      if (requestMethod === "GET") expect(init?.body).toBeUndefined();
      else expect(init?.body).toBe(JSON.stringify({
        eventTypes: ["wallet_activity"], target: { url: target },
        labels: { network: "base-mainnet", wallet_addresses: method === "PUT" ? `${OTHER_ADDRESS},${ADDRESS}` : ADDRESS },
        isEnabled: true,
      }));
    }
    expect(inserted).toEqual(method === "POST" ? [{
      subscriptionId, secret: "fixture-webhook-key", target, eventType: "wallet_activity",
    }] : []);
  });
});

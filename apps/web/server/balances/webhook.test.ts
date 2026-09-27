import { createHmac, randomBytes } from "node:crypto";
import { resolveSecretKeyring } from "@/server/secrets/at-rest";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { sealSecret } from "@/server/secrets/at-rest";
import { webhookSecretAad } from "./webhook-secret";
import { describe, expect, test } from "bun:test";
import { MemoryBalanceSnapshotStore } from "./memory-snapshot-store";
import { createCdpWebhookHandler as handler, extractCdpActivityAddresses } from "./webhook";

type Dependencies = Parameters<typeof handler>[0];
function createCdpWebhookHandler(deps: Omit<Dependencies, "keyring"> & { keyring?: Dependencies["keyring"] }) {
  return handler({ ...deps, keyring: deps.keyring ?? null });
}
const key = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "1" });
if (!key.ok) throw new Error("invalid fixture key");
const keyring = key.keyring;

const SECRET = "fixture-webhook-secret";
const NOW = new Date("2026-09-13T12:00:00.000Z");
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function signed(
  raw: Uint8Array,
  timestamp = Math.floor(NOW.getTime() / 1000),
  version: "v0" | "v1" = "v0",
  headers = new Headers({ "content-type": "application/json" }),
) {
  const headerNames = "content-type";
  const prefix = version === "v1"
    ? `${timestamp}.${headerNames}.${headers.get("content-type")}.`
    : `${timestamp}.`;
  const digest = createHmac("sha256", SECRET)
    .update(Buffer.concat([Buffer.from(prefix), Buffer.from(raw)]))
    .digest("hex");
  return version === "v1"
    ? `t=${timestamp},h=${headerNames},v1=${digest}`
    : `t=${timestamp},v0=${digest}`;
}


function subscriptionStore() {
  return {
    list: async () => [{
      subscriptionId: "subscription-1",
      credential: { kind: "legacy-plaintext" as const, secret: SECRET },
      target: "https://home.example/api/webhooks/cdp",
      eventType: "wallet_activity",
      createdAt: NOW.toISOString(),
    }],
  };
}

function body(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function seededStore() {
  const store = new MemoryBalanceSnapshotStore();
  await store.putObservation({
    chainId: 8453,
    address: ADDRESS,
    blockNumber: "1",
    blockHash: `0x${"1".repeat(64)}`,
    blockTimestamp: "1",
    observedAt: "2026-09-13T11:59:00.000Z",
    holdings: [],
    coverage: { registry: "complete", catalog: "complete" },
  });
  return store;
}

describe("CDP balance activity webhook", () => {
  test.each(["v0", "v1"] as const)("verifies sealed %s deliveries", async (version) => {
    const store = await seededStore();
    const record = { subscriptionId: "subscription-1", target: "https://home.example/api/webhooks/cdp", eventType: "wallet_activity", createdAt: NOW.toISOString() };
    const sealed = { ...record, credential: { kind: "envelope" as const, envelope: sealSecret(keyring, SECRET, webhookSecretAad(record)), keyVersion: 1 } };
    const raw = body({ eventType: "wallet.activity.multi", data: { address: ADDRESS } });
    const headers = new Headers({ "content-type": "application/json" });
    const handle = createCdpWebhookHandler({ store, subscriptions: { list: async () => [sealed] }, keyring, now: () => NOW });
    expect((await handle(raw, signed(raw, undefined, version, headers), headers)).status).toBe(200);
    expect((await store.get(8453, ADDRESS))?.staleAt).toBe(NOW.toISOString());
  });

  test("unreadable envelopes fail closed and report without leaking credentials", async () => {
    const store = await seededStore();
    const record = { subscriptionId: "subscription-1", target: "https://home.example/api/webhooks/cdp", eventType: "wallet_activity", createdAt: NOW.toISOString() };
    const sealed = { ...record, credential: { kind: "envelope" as const, envelope: sealSecret(keyring, SECRET, webhookSecretAad(record)), keyVersion: 1 } };
    const raw = body({ eventType: "wallet.activity.multi", data: { address: ADDRESS } });
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    try {
      const handle = createCdpWebhookHandler({ store, subscriptions: { list: async () => [sealed] }, keyring: null, now: () => NOW });
      expect((await handle(raw, signed(raw))).status).toBe(401);
      expect((await store.get(8453, ADDRESS))?.staleAt).toBeNull();
      const logs = JSON.stringify(lines);
      expect(logs).toContain("WEBHOOK_SECRET_UNREADABLE");
      expect(logs).not.toContain(SECRET);
      expect(logs).not.toContain(sealed.credential.envelope);
      expect(logs).not.toContain(record.subscriptionId);
    } finally { setObservabilityLogWriterForTests(); }
  });
  test.each(["v0", "v1"] as const)("accepts a valid %s signature", async (version) => {
    const store = await seededStore();
    const raw = body({
      eventType: "wallet.activity.multi",
      data: { network: "base-mainnet", matchedAddress: ADDRESS.toUpperCase().replace("0X", "0x") },
    });
    const headers = new Headers({ "content-type": "application/json" });
    const response = await createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW })(raw, signed(raw, undefined, version, headers), headers);
    expect(response.status).toBe(200);
    expect((await store.get(8453, ADDRESS))?.staleAt).toBe(NOW.toISOString());
  });

  test("accepts any valid v1 value and uppercase signed header names", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "wallet.activity.multi", data: { address: ADDRESS } });
    const timestamp = Math.floor(NOW.getTime() / 1000);
    const headers = new Headers({ "Content-Type": "application/json" });
    const headerNames = "Content-Type";
    const digest = createHmac("sha256", SECRET)
      .update(Buffer.concat([
        Buffer.from(`${timestamp}.${headerNames}.application/json.`),
        Buffer.from(raw),
      ]))
      .digest("hex");
    const signature = `t=${timestamp},h=${headerNames},v1=${"0".repeat(64)},v1=${digest}`;
    const handler = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW });
    expect((await handler(raw, signature, headers)).status).toBe(200);
  });

  test("rejects when no stored subscription secret exists", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "wallet.activity.multi", data: { address: ADDRESS } });
    const handler = createCdpWebhookHandler({
      store,
      subscriptions: { list: async () => [] },
      now: () => NOW,
    });
    expect((await handler(raw, signed(raw))).status).toBe(401);
  });

  test("re-reads stored subscriptions once for an unknown identified id", async () => {
    const store = await seededStore();
    let reads = 0;
    const raw = body({
      subscriptionId: "subscription-2",
      eventType: "wallet.activity.multi",
      data: { address: ADDRESS },
    });
    const handler = createCdpWebhookHandler({
      store,
      subscriptions: {
        list: async () => {
          reads += 1;
          return reads === 1 ? [] : [{
            subscriptionId: "subscription-2",
            credential: { kind: "legacy-plaintext" as const, secret: SECRET },
            target: "https://home.example/api/webhooks/cdp",
            eventType: "wallet_activity",
            createdAt: NOW.toISOString(),
          }];
        },
      },
      now: () => NOW,
    });
    expect((await handler(raw, signed(raw))).status).toBe(200);
    expect(reads).toBe(2);
  });

  test("accepts an identified unknown id when another stored secret verifies", async () => {
    const store = await seededStore();
    const raw = body({
      subscriptionId: "unknown-subscription",
      eventType: "wallet.activity.multi",
      data: { address: ADDRESS },
    });
    const handler = createCdpWebhookHandler({
      store,
      subscriptions: subscriptionStore(),
      now: () => NOW,
    });

    expect((await handler(raw, signed(raw))).status).toBe(200);
  });

  test("throttles forced subscription re-lists to once per minute", async () => {
    const store = await seededStore();
    let reads = 0;
    const handler = createCdpWebhookHandler({
      store,
      subscriptions: {
        list: async () => {
          reads += 1;
          return subscriptionStore().list();
        },
      },
      now: () => NOW,
    });
    const first = body({ subscriptionId: "unknown-1", eventType: "wallet.activity.multi" });
    const second = body({ subscriptionId: "unknown-2", eventType: "wallet.activity.multi" });

    expect((await handler(first, "invalid")).status).toBe(401);
    expect((await handler(second, "invalid")).status).toBe(401);
    expect(reads).toBe(2);
  });

  test("rejects invalid signatures and timestamps outside the replay window", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "wallet.activity.detected", data: { address: ADDRESS } });
    const handler = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW });
    expect((await handler(raw, "t=1,v1=bad")).status).toBe(401);
    const old = Math.floor(NOW.getTime() / 1000) - 301;
    expect((await handler(raw, signed(raw, old))).status).toBe(401);
    expect((await store.get(8453, ADDRESS))?.staleAt).toBeNull();
  });

  test("duplicate delivery is harmless", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "wallet.activity.multi", data: { matchedAddress: ADDRESS, nested: { address: ADDRESS } } });
    const handler = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW });
    await handler(raw, signed(raw));
    await handler(raw, signed(raw));
    expect((await store.get(8453, ADDRESS))?.staleAt).toBe(NOW.toISOString());
  });

  test("unknown event types are accepted and ignored", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "other.event", data: { address: ADDRESS } });
    const response = await createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW })(raw, signed(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect((await store.get(8453, ADDRESS))?.staleAt).toBeNull();
  });

  test("a signed malformed body is rejected after signature verification", async () => {
    const store = await seededStore();
    let reads = 0;
    const raw = new TextEncoder().encode("{not-json");
    const response = await createCdpWebhookHandler({
      store,
      subscriptions: {
        list: async () => {
          reads += 1;
          return subscriptionStore().list();
        },
      },
      now: () => NOW,
    })(raw, signed(raw));
    expect(response.status).toBe(400);
    expect(reads).toBe(1);
  });

  test("extracts only documented address fields and lowercases/dedupes them", () => {
    expect(extractCdpActivityAddresses({
      data: {
        address: ADDRESS.toUpperCase().replace("0X", "0x"),
        matchedAddress: ADDRESS,
        from: "0x2222222222222222222222222222222222222222",
        contract: "0x3333333333333333333333333333333333333333",
      },
    })).toEqual([
      ADDRESS,
      "0x2222222222222222222222222222222222222222",
    ]);
  });
});

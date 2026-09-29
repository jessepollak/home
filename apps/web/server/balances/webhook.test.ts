import { createHmac, randomBytes } from "node:crypto";
import { resolveSecretKeyring } from "@/server/secrets/at-rest";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { sealSecret } from "@/server/secrets/at-rest";
import { webhookSecretAad } from "./webhook-secret";
import { describe, expect, test } from "bun:test";
import { MemoryBalanceSnapshotStore } from "./memory-snapshot-store";
import { createCdpWebhookHandler as handler, extractCdpActivityAddresses } from "./webhook";

type Dependencies = Parameters<typeof handler>[0];
function createCdpWebhookHandler(deps: Omit<Dependencies, "keyring" | "history"> & Partial<Pick<Dependencies, "keyring" | "history">>) {
  return handler({ ...deps, keyring: deps.keyring ?? null, history: deps.history ?? null });
}
const key = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "1" });
if (!key.ok) throw new Error("invalid fixture key");
const keyring = key.keyring;

const SECRET = "fixture-webhook-secret";
const NOW = new Date("2026-09-13T12:00:00.000Z");
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222" as const;

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
  test.each([
    ["v0", "sealed"], ["v1", "sealed"],
    ["v0", "legacy plaintext"], ["v1", "legacy plaintext"],
  ] as const)("verifies %s deliveries with %s credentials", async (version, kind) => {
    const store = await seededStore();
    const record = { subscriptionId: "subscription-1", target: "https://home.example/api/webhooks/cdp", eventType: "wallet_activity", createdAt: NOW.toISOString() };
    const subscriptions = kind === "sealed"
      ? { list: async () => [{ ...record, credential: { kind: "envelope" as const, envelope: sealSecret(keyring, SECRET, webhookSecretAad(record)), keyVersion: 1 } }] }
      : subscriptionStore();
    const raw = kind === "sealed"
      ? body({ eventType: "wallet.activity.multi", data: { address: ADDRESS } })
      : body({ eventType: "wallet.activity.multi", data: { network: "base-mainnet", matchedAddress: ADDRESS.toUpperCase().replace("0X", "0x") } });
    const headers = new Headers({ "content-type": "application/json" });
    const handle = createCdpWebhookHandler({ store, subscriptions, ...(kind === "sealed" ? { keyring } : {}), now: () => NOW });
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
  test("marks snapshot stale and enrolled history dirty with the same addresses and time", async () => {
    const store = await seededStore();
    const staleCalls: Array<[number, readonly `0x${string}`[], Date]> = [];
    const dirtyCalls: Array<[number, readonly `0x${string}`[], Date]> = [];
    const raw = body({ eventType: "wallet.activity.multi", data: {
      matchedAddress: ADDRESS.toUpperCase().replace("0X", "0x"),
      from: OTHER_ADDRESS,
      to: ADDRESS,
    } });
    const response = await createCdpWebhookHandler({
      store: { markStaleMany: async (chainId, addresses, at) => {
        staleCalls.push([chainId, addresses, at]);
        return store.markStaleMany(chainId, addresses, at);
      } },
      history: { markDirty: async (chainId, addresses, at) => {
        dirtyCalls.push([chainId, addresses, at]);
        return 1;
      } },
      subscriptions: subscriptionStore(), now: () => NOW,
    })(raw, signed(raw));
    expect(response.status).toBe(200);
    expect(staleCalls).toEqual([[8453, [ADDRESS, OTHER_ADDRESS], NOW]]);
    expect(dirtyCalls).toEqual(staleCalls);
    expect((await store.get(8453, ADDRESS))?.staleAt).toBe(NOW.toISOString());
  });
  test("accepts activity when history storage is unavailable", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "wallet.activity.detected", data: { address: ADDRESS } });
    const response = await createCdpWebhookHandler({ store, history: null, subscriptions: subscriptionStore(), now: () => NOW })(raw, signed(raw));
    expect(response.status).toBe(200);
    expect((await store.get(8453, ADDRESS))?.staleAt).toBe(NOW.toISOString());
  });
  test("history dirty failure preserves acceptance and stale marking and reports without addresses", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "wallet.activity.detected", data: { address: ADDRESS } });
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    try {
      const response = await createCdpWebhookHandler({
        store, history: { markDirty: async () => { throw new Error(`failed ${ADDRESS}`); } },
        subscriptions: subscriptionStore(), now: () => NOW,
      })(raw, signed(raw));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: true });
      expect((await store.get(8453, ADDRESS))?.staleAt).toBe(NOW.toISOString());
      const failureEvents = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line.code === "WEBHOOK_HISTORY_DIRTY_FAILED");
      expect(failureEvents).toHaveLength(1);
      expect(failureEvents[0]).toMatchObject({ kind: "balances-webhook", route: "/api/webhooks/cdp", outcome: "failed" });
      expect(lines.join("\n")).not.toContain(ADDRESS);
    } finally { setObservabilityLogWriterForTests(); }
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
    const dirtyCalls: number[] = [];
    const handler = createCdpWebhookHandler({ store, history: { markDirty: async () => { dirtyCalls.push(1); return 0; } }, subscriptions: subscriptionStore(), now: () => NOW });
    expect((await handler(raw, "t=1,v1=bad")).status).toBe(401);
    const old = Math.floor(NOW.getTime() / 1000) - 301;
    expect((await handler(raw, signed(raw, old))).status).toBe(401);
    expect((await store.get(8453, ADDRESS))?.staleAt).toBeNull();
    expect(dirtyCalls).toEqual([]);
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
    const dirtyCalls: number[] = [];
    const response = await createCdpWebhookHandler({ store, history: { markDirty: async () => { dirtyCalls.push(1); return 0; } }, subscriptions: subscriptionStore(), now: () => NOW })(raw, signed(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect((await store.get(8453, ADDRESS))?.staleAt).toBeNull();
    expect(dirtyCalls).toEqual([]);
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

  test("signed activity schedules a bounded account follow-through, but rejected and ignored events do not", async () => {
    const store = await seededStore();
    const tasks: Array<() => Promise<void>> = [];
    const calls: string[][] = [];
    const addresses = Array.from({ length: 55 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`);
    const handler = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW,
      schedule: (task) => { tasks.push(task); },
      settleActions: async (found, signal) => {
        expect(signal.aborted).toBe(false);
        calls.push([...found]);
      },
    });
    const raw = body({ eventType: "wallet.activity.multi", data: { matchedAddress: addresses } });
    expect((await handler(raw, signed(raw))).status).toBe(200);
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(calls).toEqual([addresses.slice(0, 50)]);
    expect((await handler(raw, null)).status).toBe(401);
    const ignored = body({ eventType: "other.event", data: { address: ADDRESS } });
    expect((await handler(ignored, signed(ignored))).status).toBe(200);
    expect(tasks).toHaveLength(1);
  });

  test("settles matched wallet addresses and never counterparties, whatever the field order", async () => {
    const store = await seededStore();
    const counterparties = Array.from({ length: 60 }, (_, i) => `0x${(i + 10).toString(16).padStart(40, "0")}`);
    const calls: string[][] = [];
    const tasks: Array<() => Promise<void>> = [];
    const handler = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW,
      schedule: (task) => { tasks.push(task); },
      settleActions: async (found) => { calls.push([...found]); },
    });
    const raw = body({ eventType: "wallet.activity.multi", data: { activities: counterparties.map((from) => ({ from, to: ADDRESS, matchedAddress: ADDRESS })) } });

    expect((await handler(raw, signed(raw))).status).toBe(200);
    await tasks[0]!();
    expect(calls).toEqual([[ADDRESS]]);
  });

  test("still settles the extracted addresses when the payload carries no matched wallet field", async () => {
    const store = await seededStore();
    const calls: string[][] = [];
    const tasks: Array<() => Promise<void>> = [];
    const handler = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW,
      schedule: (task) => { tasks.push(task); },
      settleActions: async (found) => { calls.push([...found]); },
    });
    const raw = body({ eventType: "wallet.activity.multi", data: { from: ADDRESS, to: "0x2222222222222222222222222222222222222222" } });

    expect((await handler(raw, signed(raw))).status).toBe(200);
    await tasks[0]!();
    expect(calls).toEqual([[ADDRESS, "0x2222222222222222222222222222222222222222"]]);
  });

  test("a throwing or slow scheduled settlement cannot change the accepted response", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "wallet.activity.detected", data: { address: ADDRESS } });
    const tasks: Array<() => Promise<void>> = [];
    const handler = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW,
      schedule: (task) => { tasks.push(task); },
      settleActions: async () => { throw new Error("settlement unavailable"); },
    });
    expect((await handler(raw, signed(raw))).status).toBe(200);
    await expect(tasks[0]!()).resolves.toBeUndefined();
    const slow = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW,
      schedule: (task) => { tasks.push(task); },
      settleActions: () => new Promise<void>(() => {}),
    });
    expect((await slow(raw, signed(raw))).status).toBe(200);
    expect(tasks).toHaveLength(2);
  });

  test("an unavailable scheduler does not reject signed activity", async () => {
    const store = await seededStore();
    const raw = body({ eventType: "wallet.activity.detected", data: { address: ADDRESS } });
    const handler = createCdpWebhookHandler({ store, subscriptions: subscriptionStore(), now: () => NOW,
      schedule: () => { throw new Error("scheduler unavailable"); },
      settleActions: async () => { throw new Error("should not settle"); },
    });
    expect((await handler(raw, signed(raw))).status).toBe(200);
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

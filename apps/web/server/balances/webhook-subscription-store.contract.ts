import "server-only";

import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, test } from "bun:test";
import { resolveSecretKeyring } from "@/server/secrets/at-rest";
import { openWebhookSecret } from "./webhook-secret";
import { rotateWebhookSecrets, verifyWebhookSecrets } from "./webhook-secret-rotation";
import type { WebhookSubscriptionInsert, WebhookSubscriptionStore } from "./webhook-subscription-store";

export function webhookSubscriptionStoreContract(options: {
  name: string;
  createStore: (keyring: Keyring | null) => WebhookSubscriptionStore;
  reset: () => Promise<void> | void;
  seedLegacy: (record: WebhookSubscriptionInsert) => Promise<void> | void;
}) {
  describe(`${options.name} WebhookSubscriptionStore contract`, () => {
    let store: WebhookSubscriptionStore;
    const active = keyring(1);
    const record = (subscriptionId: string, secret: string): WebhookSubscriptionInsert => ({
      subscriptionId, secret, target: "https://home.example/api/webhooks/cdp", eventType: "wallet_activity",
    });
    beforeEach(async () => {
      await options.reset();
      store = options.createStore(active);
    });

    test("seals fresh inserts and opens them without exposing plaintext records", async () => {
      const secret = randomBytes(32).toString("base64url");
      await store.insert(record("subscription-1", secret));
      const [row] = await store.list();
      expect(row?.credential.kind).toBe("envelope");
      expect(JSON.stringify(row)).not.toContain(secret);
      expect(openWebhookSecret(active, row!)).toEqual({ ok: true, secret });
      expect(await store.countStates(1)).toEqual({ plaintext: 0, notAtActive: 0, total: 1 });
    });

    test("upsert replaces the credential and updates its binding", async () => {
      const first = randomBytes(32).toString("base64url");
      const second = randomBytes(32).toString("base64url");
      await store.insert(record("subscription-1", first));
      await store.insert({ ...record("subscription-1", second), target: "https://new.example/api/webhooks/cdp" });
      const rows = await store.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.target).toBe("https://new.example/api/webhooks/cdp");
      expect(openWebhookSecret(active, rows[0]!)).toEqual({ ok: true, secret: second });
      expect(JSON.stringify(rows)).not.toContain(first);
    });

    test("missing keyring refuses insertion without writes", async () => {
      const unavailable = options.createStore(null);
      expect(unavailable.sealing).toBe(false);
      await expect(unavailable.insert(record("subscription-1", randomBytes(32).toString("base64url")))).rejects.toThrow("webhook-secret-keyring-unavailable");
      expect(await unavailable.list()).toEqual([]);
    });

    test("legacy records rotate and clear plaintext", async () => {
      const secret = randomBytes(32).toString("base64url");
      await options.seedLegacy(record("subscription-1", secret));
      expect(openWebhookSecret(null, (await store.list())[0]!)).toEqual({ ok: true, secret });
      expect(await rotateWebhookSecrets(store, active)).toEqual({ sealedLegacy: 1, rotated: 0, unreadable: 0, skippedConcurrent: 0 });
      expect(JSON.stringify(await store.list())).not.toContain(secret);
      expect(await verifyWebhookSecrets(store, active)).toEqual({ plaintext: 0, notAtActive: 0, unreadable: 0, safeToRemovePrevious: true });
    });

    test("rotates from the previous version", async () => {
      const old = randomBytes(32).toString("base64url");
      const next = randomBytes(32).toString("base64url");
      const previous = resolved({ HOME_SECRET_ENCRYPTION_KEY: old, HOME_SECRET_KEY_VERSION: "1" });
      const current = resolved({ HOME_SECRET_ENCRYPTION_KEY: next, HOME_SECRET_KEY_VERSION: "2", HOME_SECRET_ENCRYPTION_KEY_PREVIOUS: old });
      await options.createStore(previous).insert(record("subscription-1", "test-signing-secret"));
      expect(await rotateWebhookSecrets(options.createStore(current), current)).toEqual({ sealedLegacy: 0, rotated: 1, unreadable: 0, skippedConcurrent: 0 });
      expect(openWebhookSecret(current, (await store.list())[0]!)).toEqual({ ok: true, secret: "test-signing-secret" });
    });

    test("rotation scans ordered non-active credentials in bounded pages", async () => {
      await store.insert(record("subscription-b", "sealed-at-active"));
      await options.seedLegacy(record("subscription-c", "legacy-c"));
      await options.seedLegacy(record("subscription-a", "legacy-a"));
      expect((await store.listForRotation(1, null, 1)).map((row) => row.subscriptionId)).toEqual(["subscription-a"]);
      expect((await store.listForRotation(1, "subscription-a", 1)).map((row) => row.subscriptionId)).toEqual(["subscription-c"]);
      expect((await store.listForRotation(-1, null, 2)).map((row) => row.subscriptionId)).toEqual(["subscription-a", "subscription-b"]);
      expect(await store.countStates(1)).toEqual({ plaintext: 2, notAtActive: 2, total: 3 });
    });

    test("verification pages every row without using the unbounded list", async () => {
      await store.insert(record("subscription-a", "readable-a"));
      await options.createStore(keyring(1)).insert(record("subscription-b", "unreadable-b"));
      await options.seedLegacy(record("subscription-c", "legacy-c"));
      const cursors: Array<string | null> = [];
      const pagingStore = forwardingStore(store);
      pagingStore.list = () => { throw new Error("unbounded-list-called"); };
      pagingStore.listForRotation = (version, cursor, limit) => {
        expect(version).toBe(-1);
        expect(limit).toBe(1);
        cursors.push(cursor);
        return store.listForRotation(version, cursor, limit);
      };
      expect(await verifyWebhookSecrets(pagingStore, active, 1)).toEqual({ plaintext: 1, notAtActive: 1, unreadable: 1, safeToRemovePrevious: false });
      expect(cursors).toEqual([null, "subscription-a", "subscription-b", "subscription-c"]);
    });

    test("verification refuses an unreadable active-version envelope", async () => {
      const unrelated = keyring(1);
      await options.createStore(unrelated).insert(record("subscription-1", randomBytes(32).toString("base64url")));
      expect(await verifyWebhookSecrets(store, active)).toEqual({ plaintext: 0, notAtActive: 0, unreadable: 1, safeToRemovePrevious: false });
    });

    test("compare-and-swap loses to a concurrent credential change", async () => {
      await store.insert(record("subscription-1", "first-signing-secret"));
      const original = (await store.list())[0]!;
      await store.insert(record("subscription-1", "second-signing-secret"));
      const current = (await store.list())[0]!;
      if (current.credential.kind !== "envelope") throw new Error("invalid fixture credential");
      expect(await store.replaceCredentialIf(original.subscriptionId, original.credential, {
        envelope: current.credential.envelope, keyVersion: current.credential.keyVersion,
      })).toBe(false);
      expect(openWebhookSecret(active, (await store.list())[0]!)).toEqual({ ok: true, secret: "second-signing-secret" });
    });

    test("legacy plaintext CAS loses to a concurrent seal without reintroducing plaintext", async () => {
      const original = randomBytes(32).toString("base64url");
      const concurrent = randomBytes(32).toString("base64url");
      await options.seedLegacy(record("subscription-1", original));
      const racingStore = forwardingStore(store);
      racingStore.replaceCredentialIf = async (...args) => {
        await store.insert(record("subscription-1", concurrent));
        return store.replaceCredentialIf(...args);
      };
      expect(await rotateWebhookSecrets(racingStore, active)).toEqual({ sealedLegacy: 0, rotated: 0, unreadable: 0, skippedConcurrent: 1 });
      const [row] = await store.list();
      expect(row?.credential.kind).toBe("envelope");
      expect(JSON.stringify(row)).not.toContain(original);
      expect(openWebhookSecret(active, row!)).toEqual({ ok: true, secret: concurrent });
      expect(await store.countStates(active.version)).toEqual({ plaintext: 0, notAtActive: 0, total: 1 });
    });

    test("deletes a subscription by id", async () => {
      await store.insert(record("subscription-1", "test-signing-secret"));
      expect(await store.delete("subscription-1")).toBe(1);
      expect(await store.delete("subscription-1")).toBe(0);
      expect(await store.list()).toEqual([]);
    });
  });
}

function forwardingStore(store: WebhookSubscriptionStore): WebhookSubscriptionStore {
  return {
    persistent: store.persistent,
    sealing: store.sealing,
    insert: (row) => store.insert(row),
    list: () => store.list(),
    listForRotation: (version, cursor, limit) => store.listForRotation(version, cursor, limit),
    replaceCredentialIf: (id, expected, replacement) => store.replaceCredentialIf(id, expected, replacement),
    countStates: (version) => store.countStates(version),
    delete: (id) => store.delete(id),
  };
}

type Keyring = Extract<ReturnType<typeof resolveSecretKeyring>, { ok: true }>["keyring"];
function resolved(env: Readonly<Record<string, string | undefined>>): Keyring {
  const result = resolveSecretKeyring(env);
  if (!result.ok) throw new Error(result.reason);
  return result.keyring;
}
function keyring(version: number): Keyring {
  return resolved({ HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: String(version) });
}

import "server-only";

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { resolveSecretKeyring, sealSecret } from "@/server/secrets/at-rest";
import type { FundingProviderUserTokenStore, FundingUserTokenKey } from "../user-token-store";

const key: FundingUserTokenKey = { owner: { accountProvider: "base-account", subject: "owner-a" }, providerId: "coinbase", region: "US", sandbox: true };
const destination = "0x1111111111111111111111111111111111111111";
const now = "2026-09-18T00:00:00.000Z";
const env = { HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "1" };
const resolved = resolveSecretKeyring(env);
if (!resolved.ok) throw new Error("invalid synthetic keyring");
const envelope = (token: string) => sealSecret(resolved.keyring, token, { purpose: "test", binding: { owner: "owner-a" } });
export function describeUserTokenStore(name: string, create: () => FundingProviderUserTokenStore, inspect: (key: FundingUserTokenKey) => Promise<string>) {
  describe(name, () => {
    test("owner, account provider, region, provider and sandbox fence reads and deletes", async () => {
      const store = create(), sealed = envelope("private-one");
      expect(await store.putIfEnvelope(key, null, { destination, envelope: sealed, returnedAt: now, updatedAt: now })).toBe(true);
      for (const foreign of [
        { ...key, owner: { ...key.owner, subject: "owner-b" } },
        { ...key, owner: { ...key.owner, accountProvider: "cdp-embedded" as const } },
        { ...key, providerId: "other" }, { ...key, region: "CA" }, { ...key, sandbox: false },
      ]) {
        expect(await store.get(foreign)).toBeNull();
        expect(await store.deleteIfEnvelope(foreign, sealed)).toBe(false);
        expect(await store.delete(foreign)).toBe(false);
      }
      expect((await store.get(key))?.envelope).toBe(sealed);
      expect(await inspect(key)).not.toContain("private-one");
      expect(await store.delete(key)).toBe(true);
    });
    test("insert-if-absent and envelope CAS replace whole rows", async () => {
      const store = create(), first = envelope("private-first"), second = envelope("private-second");
      const original = { destination, envelope: first, returnedAt: now, updatedAt: now };
      const replacement = { destination: "0x2222222222222222222222222222222222222222", envelope: second, returnedAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z" };
      expect(await store.putIfEnvelope(key, null, original)).toBe(true);
      expect(await store.putIfEnvelope(key, null, replacement)).toBe(false);
      expect(await store.putIfEnvelope(key, second, replacement)).toBe(false);
      expect(await store.get(key)).toEqual({ ...original, keyVersion: 1 });
      expect(await store.putIfEnvelope(key, first, replacement)).toBe(true);
      expect(await store.get(key)).toEqual({ ...replacement, keyVersion: 1 });
      expect(await store.putIfEnvelope(key, first, original)).toBe(false);
      expect(await store.deleteIfEnvelope(key, first)).toBe(false);
      expect(await store.replaceIfEnvelope(key, first, { envelope: first, updatedAt: now })).toBe(false);
      expect(await store.replaceIfEnvelope(key, second, { envelope: first, updatedAt: now })).toBe(true);
      expect(await store.countNotAtVersion(2)).toBe(1);
    });
    test("concurrent insert-if-absent admits only one envelope", async () => {
      const store = create(), first = envelope("private-first"), second = envelope("private-second");
      await store.delete(key);
      const results = await Promise.all([
        store.putIfEnvelope(key, null, { destination, envelope: first, returnedAt: now, updatedAt: now }),
        store.putIfEnvelope(key, null, { destination, envelope: second, returnedAt: now, updatedAt: now }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.get(key))?.envelope).toBe(results[0] ? first : second);
    });
    test("rejects plaintext envelopes without leaking them in errors", async () => {
      const store = create(); const text = "private-plaintext-token";
      let error: unknown;
      try { await store.putIfEnvelope(key, null, { destination, envelope: text, returnedAt: now, updatedAt: now }); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect(JSON.stringify(error) + String(error)).not.toContain(text);
    });
  });
}

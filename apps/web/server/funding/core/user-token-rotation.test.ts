import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { resolveSecretKeyring, sealSecret } from "@/server/secrets/at-rest";
import { userTokenAad } from "./provider-user-token";
import { rotateUserTokens, verifyUserTokens } from "./user-token-rotation";
import { MemoryFundingProviderUserTokenStore } from "./user-token-store";
const old = randomBytes(32).toString("base64url"), active = randomBytes(32).toString("base64url");
function ring(version: string, key: string, previous?: string) {
  const resolved = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: key, HOME_SECRET_KEY_VERSION: version, HOME_SECRET_ENCRYPTION_KEY_PREVIOUS: previous });
  if (!resolved.ok) throw new Error("invalid synthetic ring"); return resolved.keyring;
}
const key = { owner: { accountProvider: "base-account" as const, subject: "owner" }, providerId: "coinbase", region: "US", sandbox: true };
const binding = { ...key, destination: "0x1111111111111111111111111111111111111111" };
const now = "2026-09-18T00:00:00.000Z";
test("verification fails with prior version and passes after rotation", async () => {
  const store = new MemoryFundingProviderUserTokenStore();
  const previous = sealSecret(ring("1", old), "synthetic-token", userTokenAad(binding));
  await store.putIfEnvelope(key, null, { destination: binding.destination, envelope: previous, returnedAt: now, updatedAt: now });
  const current = ring("2", active, old);
  expect((await verifyUserTokens(store, current)).safeToRemovePrevious).toBe(false);
  expect(await rotateUserTokens(store, current, () => new Date(now))).toEqual({ rotated: 1, unreadable: 0, skippedConcurrent: 0 });
  expect(await verifyUserTokens(store, current)).toEqual({ notAtActive: 0, unreadable: 0, safeToRemovePrevious: true });
  expect((await store.get(key))?.returnedAt).toBe(now);
});
test("unreadable stays and concurrent replacement is not overwritten", async () => {
  const store = new MemoryFundingProviderUserTokenStore(), current = ring("2", active, old);
  const invalid = sealSecret(ring("1", randomBytes(32).toString("base64url")), "synthetic-token", userTokenAad(binding));
  await store.putIfEnvelope(key, null, { destination: binding.destination, envelope: invalid, returnedAt: now, updatedAt: now });
  expect(await rotateUserTokens(store, current, () => new Date(now))).toEqual({ rotated: 0, unreadable: 1, skippedConcurrent: 0 });
  expect((await store.get(key))?.envelope).toBe(invalid);
  const prior = sealSecret(ring("1", old), "synthetic-token", userTokenAad(binding));
  await store.putIfEnvelope(key, invalid, { destination: binding.destination, envelope: prior, returnedAt: now, updatedAt: now });
  const replacement = sealSecret(current, "replacement", userTokenAad(binding));
  let calls = 0;
  const guarded = new Proxy(store, { get(target, property) {
    if (property === "listNotAtVersion") return async () => {
      if (++calls !== 1) return [];
      await store.putIfEnvelope(key, prior, { destination: binding.destination, envelope: replacement, returnedAt: now, updatedAt: now });
      return [{ key, row: { destination: binding.destination, envelope: prior, keyVersion: 1, returnedAt: now, updatedAt: now } }];
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  expect(await rotateUserTokens(guarded, current, () => new Date(now))).toEqual({ rotated: 0, unreadable: 0, skippedConcurrent: 1 });
  expect((await store.get(key))?.envelope).toBe(replacement);
});

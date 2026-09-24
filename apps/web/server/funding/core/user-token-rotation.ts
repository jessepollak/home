import "server-only";

import { openSecret, sealSecret, type SecretKeyring } from "@/server/secrets/at-rest";
import { userTokenAad } from "./provider-user-token";
import type { FundingProviderUserTokenStore, FundingUserTokenKey } from "./user-token-store";

export async function rotateUserTokens(store: FundingProviderUserTokenStore, keyring: SecretKeyring, now: () => Date, batchSize = 100) {
  let rotated = 0, unreadable = 0, skippedConcurrent = 0;
  let cursor: FundingUserTokenKey | null = null;
  for (;;) {
    const batch = await store.listNotAtVersion(keyring.version, cursor, batchSize);
    if (!batch.length) break;
    for (const { key, row } of batch) {
      cursor = key;
      const binding = { ...key, destination: row.destination };
      const opened = openSecret(keyring, row.envelope, userTokenAad(binding));
      if (!opened.ok) { unreadable++; continue; }
      const envelope = sealSecret(keyring, opened.plaintext, userTokenAad(binding));
      if (await store.replaceIfEnvelope(key, row.envelope, { envelope, updatedAt: now().toISOString() })) rotated++;
      else skippedConcurrent++;
    }
  }
  return { rotated, unreadable, skippedConcurrent };
}
export async function verifyUserTokens(store: FundingProviderUserTokenStore, keyring: SecretKeyring, batchSize = 100) {
  const notAtActive = await store.countNotAtVersion(keyring.version);
  let unreadable = 0;
  let cursor: FundingUserTokenKey | null = null;
  for (;;) {
    const batch = await store.listNotAtVersion(-1, cursor, batchSize);
    if (!batch.length) break;
    for (const { key, row } of batch) {
      cursor = key;
      if (!openSecret(keyring, row.envelope, userTokenAad({ ...key, destination: row.destination })).ok) unreadable++;
    }
  }
  return { notAtActive, unreadable, safeToRemovePrevious: notAtActive === 0 && unreadable === 0 };
}

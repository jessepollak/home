import "server-only";

import { sealSecret, type SecretKeyring } from "@/server/secrets/at-rest";
import { canOpenWebhookSecret, openWebhookSecret, webhookSecretAad } from "./webhook-secret";
import type { WebhookSubscriptionStore } from "./webhook-subscription-store";

export async function rotateWebhookSecrets(store: WebhookSubscriptionStore, keyring: SecretKeyring, batch = 100) {
  let sealedLegacy = 0, rotated = 0, unreadable = 0, skippedConcurrent = 0;
  let cursor: string | null = null;
  for (;;) {
    const rows = await store.listForRotation(keyring.version, cursor, batch);
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row.subscriptionId;
      if (row.credential.kind === "envelope" && row.credential.keyVersion === keyring.version) continue;
      const opened = openWebhookSecret(keyring, row);
      if (!opened.ok) { unreadable++; continue; }
      const envelope = sealSecret(keyring, opened.secret, webhookSecretAad(row));
      if (await store.replaceCredentialIf(row.subscriptionId, row.credential, { envelope, keyVersion: keyring.version })) {
        if (row.credential.kind === "legacy-plaintext") sealedLegacy++;
        else rotated++;
      } else skippedConcurrent++;
    }
  }
  return { sealedLegacy, rotated, unreadable, skippedConcurrent };
}

export async function verifyWebhookSecrets(store: WebhookSubscriptionStore, keyring: SecretKeyring, batch = 100) {
  const { plaintext, notAtActive } = await store.countStates(keyring.version);
  let unreadable = 0;
  let cursor: string | null = null;
  for (;;) {
    const rows = await store.listForRotation(-1, cursor, batch);
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row.subscriptionId;
      if (!canOpenWebhookSecret(keyring, row)) unreadable++;
    }
  }
  return { plaintext, notAtActive, unreadable, safeToRemovePrevious: plaintext === 0 && notAtActive === 0 && unreadable === 0 };
}
